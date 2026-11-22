"""Agent 4, the part that is plain code: which skills go in the plan, in what order and phase,
and what survives of the model's cards.

The model only writes the words inside each card (topics and a project). Order, phases, weeks
limits and every link are decided here, so the same gap always gives the same plan shape.
"""

import re

from app.skills_catalog import CATALOG, RELATED
from app.verification import canonical_name, normalize

REQUIRED = "required"
MAX_PLAN_SKILLS = 12
MAX_TOPICS = 5
MIN_TOPICS = 2
MAX_TOPIC_CHARS = 80
MAX_PROJECT_TITLE = 70
MAX_PROJECT_SUMMARY = 220
LEARN_WEEKS = (1, 8)
PROVE_WEEKS = (1, 2)
MAX_EVIDENCE_LINES = 3

QUICK, CORE, EXTRA, PROVE = "quick", "core", "extra", "prove"
LEARN, PROVE_KIND = "learn", "prove"

_CATALOG_ORDER = {normalize(name): index for index, (name, _, _) in enumerate(CATALOG)}
_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def _key(name: str) -> str:
    return normalize(canonical_name(name))


def _related(a: str, b: str) -> bool:
    """True when the catalog lists either skill as related to the other."""
    ka, kb = _key(a), _key(b)
    for skill, others in RELATED.items():
        names = {_key(skill)} | {_key(other) for other in others}
        if _key(skill) in (ka, kb) and ka in names and kb in names:
            return True
    return False


def _evidence_lines(item: dict) -> list[str]:
    lines = []
    for source in item.get("sources", []):
        line = str(source.get("evidence", "")).strip()
        if line and line not in lines:
            lines.append(line)
    return lines[:MAX_EVIDENCE_LINES]


def order_plan(gap: dict, skills: list[dict], postings_count: int) -> tuple[list[dict], list[str]]:
    """The plan's skills in order with their phase, and the names left for later.

    Learn skills come from the gap's `missing` group, prove skills from `needs_proof`. Required
    before preferred, then the most-asked, then skills close to one the CV already proves, then
    catalog order. Prove skills always come last, in the same order.
    """
    proven = [
        str(skill.get("name", "")).strip()
        for skill in skills
        if skill.get("verified") and str(skill.get("evidence", "")).strip()
    ]

    def entry(item: dict, kind: str) -> dict:
        builds_on = next((name for name in proven if _related(name, item["name"])), None)
        return {
            "name": item["name"],
            "category": item.get("category", "Other"),
            "kind": kind,
            "level": item.get("level", REQUIRED),
            "frequency": int(item.get("frequency", 1)),
            "postings_count": postings_count,
            "builds_on": builds_on,
            "evidence_lines": _evidence_lines(item),
        }

    def rank(item: dict) -> tuple:
        return (
            item["level"] != REQUIRED,
            -item["frequency"],
            item["builds_on"] is None,
            _CATALOG_ORDER.get(_key(item["name"]), len(_CATALOG_ORDER)),
            item["name"].lower(),
        )

    learn = sorted((entry(item, LEARN) for item in gap.get("missing", [])), key=rank)
    prove = sorted((entry(item, PROVE_KIND) for item in gap.get("needs_proof", [])), key=rank)
    ordered = learn + prove
    kept, later = ordered[:MAX_PLAN_SKILLS], [item["name"] for item in ordered[MAX_PLAN_SKILLS:]]

    for index, item in enumerate(kept):
        item["id"] = f"s{index + 1}"
        if item["kind"] == PROVE_KIND:
            item["phase"] = PROVE
        elif item["level"] != REQUIRED:
            item["phase"] = EXTRA
        elif item["builds_on"] and item["frequency"] * 2 >= postings_count:
            item["phase"] = QUICK
        else:
            item["phase"] = CORE
    return kept, later


def _clip(text: str, limit: int) -> str:
    cleaned = " ".join(_URL.sub("", str(text)).split())
    return cleaned[:limit].rstrip()


def _clamp(value, bounds: tuple[int, int]) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = bounds[0]
    return max(bounds[0], min(bounds[1], number))


def verify_card(raw: dict, item: dict, notes: list[dict], language: str) -> dict:
    """Keep only what code can stand behind: every topic must cite a note retrieved for this
    skill, links come from the library, weeks stay in bounds."""
    by_id = {note["id"]: note for note in notes}
    topics: list[dict] = []
    if item["kind"] == LEARN:
        seen: set[str] = set()
        for topic in raw.get("topics") or []:
            if not isinstance(topic, dict):
                continue
            source_id = str(topic.get("source_id", ""))
            text = _clip(topic.get("text", ""), MAX_TOPIC_CHARS)
            if source_id not in by_id or source_id in seen or not text:
                continue
            seen.add(source_id)
            topics.append({"text": text, "source": _source(by_id[source_id])})
            if len(topics) == MAX_TOPICS:
                break
        if len(topics) < MIN_TOPICS:
            # Too little survived: show the retrieved notes themselves, which are sourced.
            topics = [{"text": note["title"], "source": _source(note)} for note in notes[:3]]

    title = _clip(raw.get("project_title", ""), MAX_PROJECT_TITLE)
    summary = _clip(raw.get("project_summary", ""), MAX_PROJECT_SUMMARY)
    if not title:
        title, summary = _project_template(item, language)

    bounds = LEARN_WEEKS if item["kind"] == LEARN else PROVE_WEEKS
    return {
        "id": item["id"],
        "name": item["name"],
        "kind": item["kind"],
        "phase": item["phase"],
        "level": item["level"],
        "frequency": item["frequency"],
        "postings_count": item["postings_count"],
        "builds_on": item["builds_on"],
        "weeks": _clamp(raw.get("weeks"), bounds),
        "topics": topics,
        "project": {"title": title, "summary": summary},
        "docs_url": notes[0]["url"] if notes else None,
    }


def _source(note: dict) -> dict:
    return {"title": note["title"], "publisher": note["publisher"], "url": note["url"]}


def _project_template(item: dict, language: str) -> tuple[str, str]:
    name = item["name"]
    if language == "ar":
        return (f"مشروع صغير بـ {name}", f"ابنِ شيئًا صغيرًا تستخدم فيه {name}، واكتب في سيرتك سطرًا يصف ما بنيته.")
    return (f"A small project with {name}", f"Build something small that uses {name}, and add one CV line on what you built.")
