"""Retrieval for Agent 4 (the R in RAG): finds the library notes that fit one student's skill.

The query is the skill, what the student can build it on, and the postings' own lines, so two
students missing the same skill can get different notes. Ranking uses Gemini embeddings when a
key is set; without one, or if that call fails, it uses keyword scoring (BM25). Either way only
notes about that skill or a related one are candidates.
"""

import json
import logging
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from google import genai
from google.genai import types

from app.agents import cv_skills
from app.config import get_settings
from app.skills_catalog import RELATED
from app.verification import canonical_name, normalize

logger = logging.getLogger("skillsync.agents")

LIBRARY = Path(__file__).resolve().parent.parent / "library" / "sources.json"
TOP_K = 6
EMBED_BATCH = 100
DIMENSIONS = 768
EMBEDDINGS, KEYWORDS = "embeddings", "keywords"
_WORD = re.compile(r"[a-z0-9]+")

# Note vectors, built the first time a plan needs them and kept until the server restarts.
_note_vectors: dict[str, list[float]] = {}


@lru_cache
def load_notes() -> tuple[dict, ...]:
    return tuple(json.loads(LIBRARY.read_text(encoding="utf-8")))


def _key(name: str) -> str:
    return normalize(canonical_name(name))


def candidates(skill: str) -> list[dict]:
    """Notes about the skill itself first, then notes about skills the catalog relates to it."""
    own = _key(skill)
    related = set()
    for name, others in RELATED.items():
        keys = {_key(other) for other in others}
        if _key(name) == own:
            related |= keys
        elif own in keys:
            related.add(_key(name))
    notes = load_notes()
    return [n for n in notes if _key(n["skill"]) == own] + [
        n for n in notes if _key(n["skill"]) in related and _key(n["skill"]) != own
    ]


def query_for(item: dict) -> str:
    parts = [item["name"] + "."]
    if item.get("builds_on"):
        parts.append(f"Builds on {item['builds_on']}.")
    lines = item.get("evidence_lines") or []
    if lines:
        parts.append("Asked for: " + "; ".join(f"'{line}'" for line in lines) + ".")
    return " ".join(parts)


def _words(text: str) -> list[str]:
    return _WORD.findall(normalize(text))


def _bm25(query: str, notes: list[dict], k1: float = 1.5, b: float = 0.75) -> list[float]:
    docs = [_words(f"{n['skill']} {n['title']} {n['note']}") for n in notes]
    if not docs:
        return []
    average = sum(len(d) for d in docs) / len(docs)
    frequency = Counter(word for d in docs for word in set(d))
    scores = []
    for doc in docs:
        counts = Counter(doc)
        score = 0.0
        for word in set(_words(query)):
            if word not in counts:
                continue
            idf = math.log(1 + (len(docs) - frequency[word] + 0.5) / (frequency[word] + 0.5))
            tf = counts[word]
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len(doc) / average))
        scores.append(score)
    return scores


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def _embed(client, texts: list[str], task: str) -> list[list[float]]:
    model = get_settings().gemini_embedding_model
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        response = client.models.embed_content(
            model=model,
            contents=texts[start : start + EMBED_BATCH],
            config=types.EmbedContentConfig(task_type=task, output_dimensionality=DIMENSIONS),
        )
        vectors.extend(list(e.values) for e in response.embeddings)
    return vectors


def _ensure_note_vectors(client) -> None:
    missing = [n for n in load_notes() if n["id"] not in _note_vectors]
    if not missing:
        return
    texts = [f"{n['skill']}: {n['title']}. {n['note']}" for n in missing]
    for note, vector in zip(missing, _embed(client, texts, "RETRIEVAL_DOCUMENT")):
        _note_vectors[note["id"]] = vector
    logger.info("retrieval: embedded %d library notes", len(missing))


def _use_embeddings() -> bool:
    settings = get_settings()
    return bool(settings.gemini_api_key) and cv_skills.extractor_mode() != cv_skills.MOCK


def retrieve(items: list[dict]) -> tuple[dict[str, list[dict]], str]:
    """For each plan item id, its top notes; and which ranking ran."""
    pools = {item["id"]: candidates(item["name"]) for item in items}
    own = {item["id"]: sum(1 for n in pools[item["id"]] if _key(n["skill"]) == _key(item["name"])) for item in items}
    queries = {item["id"]: query_for(item) for item in items}

    if _use_embeddings():
        try:
            client = genai.Client(api_key=get_settings().gemini_api_key)
            _ensure_note_vectors(client)
            ids = [item["id"] for item in items if pools[item["id"]]]
            query_vectors = dict(zip(ids, _embed(client, [queries[i] for i in ids], "RETRIEVAL_QUERY")))
            result = {}
            for item_id, pool in pools.items():
                vector = query_vectors.get(item_id)
                scores = [_cosine(vector, _note_vectors[n["id"]]) for n in pool] if vector else [0.0] * len(pool)
                result[item_id] = _top(pool, scores, own[item_id])
            return result, EMBEDDINGS
        except Exception as error:  # noqa: BLE001
            logger.warning("retrieval fell back to keywords: %s code=%s", type(error).__name__, getattr(error, "code", None))

    return {item_id: _top(pool, _bm25(queries[item_id], pool), own[item_id]) for item_id, pool in pools.items()}, KEYWORDS


def _top(pool: list[dict], scores: list[float], own: int) -> list[dict]:
    """The skill's own notes first, best match first; related notes only fill what is left."""
    ranked = sorted(range(len(pool)), key=lambda i: (i >= own, -scores[i], i))
    return [pool[i] for i in ranked[:TOP_K]]
