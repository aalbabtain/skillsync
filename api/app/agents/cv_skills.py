"""Agent 1, extraction half: turns CV text into candidate skills with evidence."""

import json
import logging
from functools import lru_cache
from pathlib import Path

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger("skillsync.agents")

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "cv_assessor.md"

MAX_SKILLS = 40
MAX_NAME_CHARS = 80
MAX_EVIDENCE_CHARS = 300

QUOTA_STATUS = 429

CATEGORIES = (
    "Programming languages",
    "Frameworks",
    "Databases",
    "Cloud & DevOps",
    "AI/ML",
    "Tools",
    "Soft skills",
    "Other",
)


class ExtractedSkill(BaseModel):
    name: str
    category: str
    evidence: str


class Extraction(BaseModel):
    skills: list[ExtractedSkill]


class SkillExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@lru_cache
def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8").strip()


def _clean(skill: ExtractedSkill) -> dict[str, str] | None:
    name = " ".join(skill.name.split())[:MAX_NAME_CHARS]
    evidence = " ".join(skill.evidence.split())[:MAX_EVIDENCE_CHARS]

    if not name or not evidence:
        return None

    category = skill.category if skill.category in CATEGORIES else "Other"
    return {"name": name, "category": category, "evidence": evidence}


def _malformed() -> SkillExtractionError:
    return SkillExtractionError(
        "SKILLS_MALFORMED", "The extraction model returned unusable output."
    )


def _parse(response) -> list[dict[str, str]]:
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

    cleaned = [skill for item in parsed.skills if (skill := _clean(item))]
    return cleaned[:MAX_SKILLS]


def extract(cv_text: str) -> list[dict[str, str]]:
    settings = get_settings()

    if not settings.gemini_api_key:
        raise SkillExtractionError("SKILLS_UNAVAILABLE", "Skill extraction is not configured.")

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=cv_text,
            config=types.GenerateContentConfig(
                system_instruction=load_prompt(),
                temperature=0,
                response_mime_type="application/json",
                response_schema=Extraction,
            ),
        )
    except Exception as error:  # noqa: BLE001
        raise _upstream_failure(error) from error

    return _parse(response)


def _upstream_failure(error: Exception) -> SkillExtractionError:
    logger.warning(
        "skill extraction request failed: %s code=%s",
        type(error).__name__,
        getattr(error, "code", None),
    )

    if getattr(error, "code", None) == QUOTA_STATUS:
        return SkillExtractionError(
            "SKILLS_QUOTA_EXCEEDED",
            "The Gemini request limit is used up. Try again after the quota resets "
            "or use an API key with available quota.",
        )

    return SkillExtractionError(
        "SKILLS_UNAVAILABLE", "The extraction service did not respond."
    )
