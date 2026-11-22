"""Agent 4, the part the model writes: the topics and project inside each plan card.

One streamed call covers every skill in the plan, so a plan costs one generation call (and one
embedding call for retrieval). Each card arrives as soon as its JSON object closes. Code in
app/plan.py then keeps only topics whose source was retrieved for that skill.
"""

import json
import logging
from functools import lru_cache
from pathlib import Path

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.agents import cv_skills, gemini
from app.agents.json_stream import ObjectScanner
from app.config import get_settings

logger = logging.getLogger("skillsync.agents")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "plan_builder.md"
QUOTA_STATUS = 429


class Topic(BaseModel):
    source_id: str
    text: str


class Card(BaseModel):
    id: str
    topics: list[Topic]
    project_title: str
    project_summary: str
    weeks: int


class Plan(BaseModel):
    skills: list[Card]


class PlanError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@lru_cache
def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8").strip()


def model_input(items: list[dict], notes: dict[str, list[dict]], known: list[str], language: str) -> str:
    return json.dumps(
        {
            "language": language,
            "known_skills": known,
            "skills": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "kind": item["kind"],
                    "level": item["level"],
                    "asked_in": item["frequency"],
                    "postings_count": item["postings_count"],
                    "builds_on": item["builds_on"],
                    "sources": [
                        {"source_id": n["id"], "title": n["title"], "note": n["note"]}
                        for n in notes.get(item["id"], [])
                    ],
                }
                for item in items
            ],
        },
        ensure_ascii=False,
    )


def _demo_card(item: dict, notes: list[dict]) -> dict:
    """Demo mode: the retrieved notes' own titles as topics, and code's project template."""
    topics = [] if item["kind"] != "learn" else [{"source_id": n["id"], "text": n["title"]} for n in notes[:4]]
    weeks = 1 if item["kind"] != "learn" else min(8, 1 + len(topics) // 2 + (item["level"] == "required"))
    return {"id": item["id"], "topics": topics, "project_title": "", "project_summary": "", "weeks": weeks}


def stream(items: list[dict], notes: dict[str, list[dict]], known: list[str], language: str):
    """Yield each card as the model finishes it. Raises PlanError, possibly after some cards."""
    if cv_skills.extractor_mode() == cv_skills.MOCK:
        for item in items:
            yield _demo_card(item, notes.get(item["id"], []))
        return

    settings = get_settings()
    if not settings.gemini_api_key:
        raise PlanError("PLAN_UNAVAILABLE", "Plan building is not configured.")
    client = genai.Client(api_key=settings.gemini_api_key)

    scanner = ObjectScanner()
    count = 0
    pieces = gemini.generate_stream(
        client,
        gemini.models_to_try(settings),
        contents=model_input(items, notes, known, language),
        config=types.GenerateContentConfig(
            system_instruction=load_prompt(),
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=Plan,
            thinking_config=gemini.MINIMAL_THINKING,
        ),
    )
    try:
        for piece in pieces:
            if piece is gemini.RESTART:
                scanner = ObjectScanner()
                continue
            for found in scanner.feed(piece):
                try:
                    card = Card.model_validate(found)
                except ValidationError:
                    continue
                count += 1
                yield card.model_dump()
    except Exception as error:  # noqa: BLE001
        raise _upstream_failure(error) from error

    if count == 0:
        raise PlanError("PLAN_MALFORMED", "The plan model returned unusable output.")


def _upstream_failure(error: Exception) -> PlanError:
    logger.warning("plan request failed: %s code=%s", type(error).__name__, getattr(error, "code", None))
    if gemini.is_busy(error):
        return PlanError("PLAN_BUSY", "The AI model is busy right now. Try again in a minute.")
    if getattr(error, "code", None) == QUOTA_STATUS:
        return PlanError("PLAN_QUOTA_EXCEEDED", "The Gemini request limit is used up. Try again after the quota resets.")
    return PlanError("PLAN_UNAVAILABLE", "The plan service did not respond.")
