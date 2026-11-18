"""Agent 2, Requirements Extractor: turns one job posting into candidate requirements."""

import json
import logging
from functools import lru_cache
from pathlib import Path

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.agents import cv_skills, gemini, mock_extractor
from app.agents.json_stream import ObjectScanner
from app.config import get_settings

logger = logging.getLogger("skillsync.agents")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "requirements_extractor.md"

MAX_SKILLS = 40
MAX_NAME_CHARS = 80
MAX_EVIDENCE_CHARS = 300
QUOTA_STATUS = 429

REQUIRED = "required"
PREFERRED = "preferred"
LEVELS = (REQUIRED, PREFERRED)


class ExtractedRequirement(BaseModel):
    name: str
    category: str
    level: str
    evidence: str


class Extraction(BaseModel):
    skills: list[ExtractedRequirement]


class RequirementsError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@lru_cache
def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8").strip()


def _clean(item: ExtractedRequirement) -> dict[str, str] | None:
    name = " ".join(item.name.split())[:MAX_NAME_CHARS]
    evidence = " ".join(item.evidence.split())[:MAX_EVIDENCE_CHARS]

    if not name or not evidence:
        return None

    category = item.category if item.category in cv_skills.CATEGORIES else "Other"
    level = item.level.strip().lower()
    return {
        "name": name,
        "category": category,
        "level": level if level in LEVELS else REQUIRED,
        "evidence": evidence,
    }


def _malformed() -> RequirementsError:
    return RequirementsError(
        "REQUIREMENTS_MALFORMED", "The extraction model returned unusable output."
    )


def _parse(response) -> list[ExtractedRequirement]:
    parsed = getattr(response, "parsed", None)

    if isinstance(parsed, dict):
        try:
            parsed = Extraction.model_validate(parsed)
        except ValidationError as error:
            raise _malformed() from error

    if not isinstance(parsed, Extraction):
        try:
            parsed = Extraction.model_validate(json.loads(getattr(response, "text", "") or ""))
        except (ValueError, TypeError, ValidationError) as error:
            raise _malformed() from error

    return parsed.skills


def _finish(items: list[ExtractedRequirement]) -> list[dict[str, str]]:
    cleaned = [result for item in items if (result := _clean(item))]
    return cleaned[:MAX_SKILLS]


def extract(posting_text: str, extractor: str | None = None) -> list[dict[str, str]]:
    if (extractor or cv_skills.extractor_mode()) == cv_skills.MOCK:
        found = mock_extractor.extract_requirements(posting_text)
        return _finish([ExtractedRequirement(**item) for item in found])

    settings = get_settings()
    if not settings.gemini_api_key:
        raise RequirementsError(
            "REQUIREMENTS_UNAVAILABLE", "Requirements extraction is not configured."
        )
    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = gemini.generate(
            client,
            gemini.models_to_try(settings),
            contents=posting_text,
            config=types.GenerateContentConfig(
                system_instruction=load_prompt(),
                temperature=0,
                response_mime_type="application/json",
                response_schema=Extraction,
                thinking_config=gemini.MINIMAL_THINKING,
            ),
        )
    except Exception as error:  # noqa: BLE001
        raise _upstream_failure(error) from error

    return _finish(_parse(response))


def stream(posting_text: str, extractor: str | None = None):
    """Yield candidate requirements one at a time as the model writes them, cleaned like
    extract's. Raises RequirementsError as extract does, possibly after some were yielded."""
    if (extractor or cv_skills.extractor_mode()) == cv_skills.MOCK:
        yield from extract(posting_text, extractor=cv_skills.MOCK)
        return

    settings = get_settings()
    if not settings.gemini_api_key:
        raise RequirementsError(
            "REQUIREMENTS_UNAVAILABLE", "Requirements extraction is not configured."
        )
    client = genai.Client(api_key=settings.gemini_api_key)

    scanner = ObjectScanner()
    text_seen: list[str] = []
    count = 0
    pieces = gemini.generate_stream(
        client,
        gemini.models_to_try(settings),
        contents=posting_text,
        config=types.GenerateContentConfig(
            system_instruction=load_prompt(),
            temperature=0,
            response_mime_type="application/json",
            response_schema=Extraction,
            thinking_config=gemini.MINIMAL_THINKING,
        ),
    )
    try:
        for piece in pieces:
            if piece is gemini.RESTART:
                scanner = ObjectScanner()
                text_seen = []
                continue
            text_seen.append(piece)
            for found in scanner.feed(piece):
                try:
                    item = _clean(ExtractedRequirement.model_validate(found))
                except ValidationError:
                    continue
                if item:
                    count += 1
                    yield item
                    if count >= MAX_SKILLS:
                        return
    except Exception as error:  # noqa: BLE001
        raise _upstream_failure(error) from error

    if count == 0:
        try:
            Extraction.model_validate(json.loads("".join(text_seen) or ""))
        except (ValueError, TypeError, ValidationError) as error:
            raise _malformed() from error


def _upstream_failure(error: Exception) -> RequirementsError:
    logger.warning(
        "requirements extraction request failed: %s code=%s",
        type(error).__name__,
        getattr(error, "code", None),
    )

    if gemini.is_busy(error):
        return RequirementsError(
            "REQUIREMENTS_BUSY",
            "The AI model is busy right now. Try again in a minute.",
        )

    if getattr(error, "code", None) == QUOTA_STATUS:
        return RequirementsError(
            "REQUIREMENTS_QUOTA_EXCEEDED",
            "The Gemini request limit is used up. Try again after the quota resets "
            "or use an API key with available quota.",
        )

    return RequirementsError(
        "REQUIREMENTS_UNAVAILABLE", "The extraction service did not respond."
    )
