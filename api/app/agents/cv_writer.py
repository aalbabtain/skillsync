"""Agent 5, CV Writer: turns a person's own answers into English CV lines.

It writes the summary and the bullets of a job or project, asks one follow-up when an answer
is too vague to write from, and translates short Arabic fields. It never sees contact details,
and it never decides what is true: every line it writes is checked by app.cv_check.
"""

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.agents import cv_skills, gemini
from app.agents.json_stream import ObjectScanner
from app.config import get_settings

logger = logging.getLogger("skillsync.agents")

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
QUOTA_STATUS = 429
MAX_LINE_CHARS = 300
MAX_LINES = 4
MAX_DEMO_BULLETS = 3

Task = Literal["summary", "bullets"]

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)\S+|\b(?:linkedin|github)\.com/\S*", re.IGNORECASE)
PHONE = re.compile(r"\+?\d[\d\s().-]{5,}\d")
ARABIC = re.compile(r"[؀-ۿ]")


class Line(BaseModel):
    text: str


class Lines(BaseModel):
    lines: list[Line]


class FollowUp(BaseModel):
    question: str | None = None


class Translated(BaseModel):
    key: str
    text: str


class Translation(BaseModel):
    items: list[Translated]


class CvWriterError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@lru_cache
def load_prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


def _looks_like_phone(text: str) -> bool:
    """A + or 0 in front and seven digits or more, or nine digits or more. Year ranges
    such as 2023-2025 have eight digits and no leading + or 0, so they stay."""
    digits = sum(c.isdigit() for c in text)
    return digits >= 9 or (digits >= 7 and text[0] in "+0")


def strip_contact(text: str) -> str:
    """Remove emails, links and phone numbers from free text."""
    text = EMAIL.sub(" ", text)
    text = URL.sub(" ", text)
    text = PHONE.sub(lambda match: " " if _looks_like_phone(match.group()) else match.group(), text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _demo(mode: str | None) -> bool:
    return (mode or cv_skills.extractor_mode()) == cv_skills.MOCK


def _cap(text: str) -> str:
    text = text.strip()
    return text[:1].upper() + text[1:]


def _demo_lines(task: Task, answers: dict[str, str]) -> list[str]:
    if task == "summary":
        parts = [_cap(answers.get("field", "")), _cap(answers.get("background", ""))]
        text = " ".join(f"{part.rstrip('.')}." for part in parts if part)
        if target := answers.get("target", "").strip():
            text += f" Seeking a {target} role."
        return [text] if text else []
    words = " ".join(value for key, value in answers.items() if key != "rejected")
    parts = [part.strip() for part in re.split(r"[.؛;،]\s*", words)]
    return [_cap(part) for part in parts if len(part) > 3][:MAX_DEMO_BULLETS]


def _client():
    settings = get_settings()
    if not settings.gemini_api_key:
        raise CvWriterError("CV_UNAVAILABLE", "CV writing is not configured.")
    return genai.Client(api_key=settings.gemini_api_key), gemini.models_to_try(settings)


def _config(prompt: str, schema, temperature: float):
    return types.GenerateContentConfig(
        system_instruction=load_prompt(prompt),
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=gemini.MINIMAL_THINKING,
    )


def _failure(error: Exception) -> CvWriterError:
    logger.warning("cv writer request failed: %s code=%s", type(error).__name__, getattr(error, "code", None))
    if gemini.is_busy(error):
        return CvWriterError("CV_BUSY", "The AI model is busy right now. Try again in a minute.")
    if getattr(error, "code", None) == QUOTA_STATUS:
        return CvWriterError("CV_QUOTA", "The Gemini request limit is used up. Try again later.")
    return CvWriterError("CV_UNAVAILABLE", "The writing service did not respond.")


def model_input(task: Task, answers: dict[str, str]) -> str:
    avoid = [fact.strip() for fact in answers.get("rejected", "").split(",") if fact.strip()]
    clean = {key: strip_contact(value) for key, value in answers.items() if key != "rejected" and value.strip()}
    return json.dumps({"task": task, "answers": clean, "avoid": avoid}, ensure_ascii=False)


def write_lines(task: Task, answers: dict[str, str], extractor: str | None = None) -> Iterator[str]:
    """Yield each English line as soon as the model closes it. If a model stops mid-answer,
    the next one starts over and lines already yielded are not yielded again."""
    if _demo(extractor):
        yield from _demo_lines(task, {key: strip_contact(value) for key, value in answers.items()})
        return

    client, models = _client()
    pieces = gemini.generate_stream(
        client, models, contents=model_input(task, answers), config=_config("cv_writer", Lines, 0.3)
    )
    sent: set[str] = set()
    scanner = ObjectScanner()
    try:
        for piece in pieces:
            if piece is gemini.RESTART:
                scanner = ObjectScanner()
                continue
            for found in scanner.feed(piece):
                try:
                    text = " ".join(Line.model_validate(found).text.split())[:MAX_LINE_CHARS]
                except ValidationError:
                    continue
                if text and text not in sent and len(sent) < MAX_LINES:
                    sent.add(text)
                    yield text
    except Exception as error:  # noqa: BLE001
        raise _failure(error) from error


def _ask(prompt: str, schema, contents: str):
    client, models = _client()
    try:
        response = gemini.generate(client, models, contents=contents, config=_config(prompt, schema, 0))
    except Exception as error:  # noqa: BLE001
        raise _failure(error) from error
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    try:
        return schema.model_validate(parsed if isinstance(parsed, dict) else json.loads(response.text or ""))
    except (ValueError, TypeError, ValidationError) as error:
        raise CvWriterError("CV_MALFORMED", "The writing model returned unusable output.") from error


def follow_up(answer: str, extractor: str | None = None) -> str | None:
    """One short English question when the answer is too vague to write from, else None.
    Demo mode never asks; the page asks its own fixed question for short answers."""
    if _demo(extractor):
        return None
    question = _ask("cv_follow_up", FollowUp, strip_contact(answer)).question
    question = " ".join((question or "").split())
    return question[:200] or None


def translate(items: dict[str, str], extractor: str | None = None) -> dict[str, str]:
    """English for each short value. Values without Arabic letters are never sent."""
    arabic = {key: value for key, value in items.items() if ARABIC.search(value)}
    if _demo(extractor) or not arabic:
        return dict(items)
    contents = json.dumps([{"key": key, "text": strip_contact(value)} for key, value in arabic.items()], ensure_ascii=False)
    answer = {item.key: " ".join(item.text.split()) for item in _ask("cv_translate", Translation, contents).items}
    return {key: answer.get(key) or value for key, value in items.items()}
