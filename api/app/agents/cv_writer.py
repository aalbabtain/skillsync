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

from app.agents import cv_skills, gemini, mock_extractor
from app.agents.json_stream import ObjectScanner
from app.config import get_settings
from app.cv_check import check_line, mentions

logger = logging.getLogger("skillsync.agents")

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
QUOTA_STATUS = 429
MAX_LINE_CHARS = 300
MAX_LINES = 4
MAX_DEMO_BULLETS = 3
DESCRIPTION_KEYS = ("jobWhat", "projWhat")

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


class ImportedProject(BaseModel):
    name: str = ""
    lines: list[str] = []


class Imported(BaseModel):
    name: str = ""
    field: str = ""
    school: str = ""
    degree: str = ""
    grad: str = ""
    gpa: str = ""
    skills: list[str] = []
    projects: list[ImportedProject] = []
    certs: list[str] = []
    langs: list[str] = []


IMPORT_TEXT_FIELDS = ("name", "field", "school", "degree", "grad", "gpa")
MAX_IMPORT_ITEMS = 30
LINKEDIN = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/[^\s|,;]+", re.IGNORECASE)
GITHUB = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[^\s|,;]+", re.IGNORECASE)


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
    # The description is what bullets are written from; names, tools and roles have their own lines.
    described = [answers[key] for key in DESCRIPTION_KEYS if answers.get(key)]
    words = " ".join(described or [value for key, value in answers.items() if key != "rejected"])
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


LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}


def follow_up(answer: str, extractor: str | None = None, language: str = "en") -> str | None:
    """One short question, in the site's language, when the answer is too vague to write
    from, else None. Demo mode never asks; the page asks its own fixed question for short
    answers."""
    if _demo(extractor):
        return None
    contents = json.dumps(
        {"answer": strip_contact(answer), "ask_in": LANGUAGE_NAMES.get(language, "English")}, ensure_ascii=False
    )
    question = _ask("cv_follow_up", FollowUp, contents).question
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


def _https(link: str) -> str:
    link = link.rstrip("./")
    return link if link.lower().startswith("http") else f"https://{link}"


def contact_from(cv_text: str) -> dict[str, str]:
    """Contact details read by code, so they never pass through the model."""
    email = EMAIL.search(cv_text)
    phone = next((m.group().strip() for m in PHONE.finditer(cv_text) if _looks_like_phone(m.group())), "")
    linkedin = LINKEDIN.search(cv_text)
    github = GITHUB.search(cv_text)
    return {
        "email": email.group() if email else "",
        "phone": phone,
        "linkedin": _https(linkedin.group()) if linkedin else "",
        "github": _https(github.group()) if github else "",
    }


def _kept(found: Imported, cv_text: str) -> dict:
    """Only values the CV itself contains: text fields and list items by mention, project
    lines by the grounding check."""
    resume = {key: (value if (value := getattr(found, key).strip()) and mentions(value, cv_text) else "") for key in IMPORT_TEXT_FIELDS}
    for key in ("skills", "certs", "langs"):
        items = [" ".join(item.split()) for item in getattr(found, key)]
        resume[key] = list(dict.fromkeys(item for item in items if item and mentions(item, cv_text)))[:MAX_IMPORT_ITEMS]
    projects = []
    for project in found.projects[:MAX_IMPORT_ITEMS]:
        name = project.name.strip()
        if not name or not mentions(name, cv_text):
            continue
        lines = [" ".join(line.split()) for line in project.lines]
        projects.append({"name": name, "lines": [line for line in lines if line and check_line(line, cv_text)][:MAX_LINES]})
    resume["projects"] = projects
    return resume


def import_resume(cv_text: str, extractor: str | None = None) -> dict:
    """Fill the resume from an existing CV. The model sees the text without contact details,
    and every value it returns is kept only when the CV contains it."""
    if _demo(extractor):
        first = next((line.strip() for line in cv_text.splitlines() if line.strip()), "")
        skills = [item["name"] for item in mock_extractor.extract(cv_text)]
        return _kept(Imported(name=first, skills=skills), cv_text)
    return _kept(_ask("cv_import", Imported, strip_contact(cv_text)), cv_text)
