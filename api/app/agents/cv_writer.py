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
from app.cv_check import check_line, mentions, words_in

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
    url: str = ""
    start: str = ""
    end: str = ""
    role: str = ""
    tools: str = ""
    lines: list[str] = []


class ImportedJob(BaseModel):
    company: str = ""
    title: str = ""
    start: str = ""
    end: str = ""
    lines: list[str] = []


class Imported(BaseModel):
    name: str = ""
    title: str = ""
    location: str = ""
    summary: str = ""
    field: str = ""
    school: str = ""
    degree: str = ""
    grad: str = ""
    gpa: str = ""
    skills: list[str] = []
    projects: list[ImportedProject] = []
    jobs: list[ImportedJob] = []
    certs: list[str] = []
    langs: list[str] = []
    activities: list[str] = []


IMPORT_TEXT_FIELDS = ("name", "title", "location", "field", "school", "degree", "grad", "gpa")
# A bullet copied with its mark ("• Built…", "- Built…") keeps only its words.
BULLET_MARK = re.compile(r"^[\s•·▪●◦\-*–]+")
MAX_IMPORT_ITEMS = 30
MAX_IMPORT_LINES = 8
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


def _in_cv(value: str, cv_text: str) -> str:
    value = " ".join(value.split())
    return value if value and mentions(value, cv_text) else ""


def _lines(lines: list[str], cv_text: str) -> list[str]:
    """Bullet points without their marks, each kept only when the grounding check passes."""
    cleaned = [" ".join(BULLET_MARK.sub("", line).split()) for line in lines]
    return [line for line in cleaned if line and check_line(line, cv_text)][:MAX_IMPORT_LINES]


def _kept(found: Imported, cv_text: str) -> dict:
    """Only what the CV itself contains: fields and list items by mention, written lines (the
    summary and bullet points) by the grounding check."""
    resume = {key: _in_cv(getattr(found, key), cv_text) for key in IMPORT_TEXT_FIELDS}
    summary = " ".join(found.summary.split())
    resume["summary"] = summary if summary and check_line(summary, cv_text) else ""
    for key in ("skills", "certs", "langs", "activities"):
        items = [_in_cv(item, cv_text) for item in getattr(found, key)]
        resume[key] = list(dict.fromkeys(item for item in items if item))[:MAX_IMPORT_ITEMS]
    projects = []
    for project in found.projects[:MAX_IMPORT_ITEMS]:
        name = _in_cv(project.name, cv_text)
        if not name:
            continue
        url = _in_cv(project.url, cv_text)
        projects.append({
            "name": name,
            "url": _https(url) if url else "",
            "start": _in_cv(project.start, cv_text),
            "end": _in_cv(project.end, cv_text),
            "role": _in_cv(project.role, cv_text),
            "tools": _in_cv(project.tools, cv_text),
            "lines": _lines(project.lines, cv_text),
        })
    resume["projects"] = projects
    jobs = []
    for job in found.jobs[:MAX_IMPORT_ITEMS]:
        company, title = _in_cv(job.company, cv_text), _in_cv(job.title, cv_text)
        if not (company or title):
            continue
        jobs.append({
            "company": company, "title": title,
            "start": _in_cv(job.start, cv_text), "end": _in_cv(job.end, cv_text),
            "lines": _lines(job.lines, cv_text),
        })
    resume["jobs"] = jobs
    return resume


def import_resume(cv_text: str, extractor: str | None = None) -> dict:
    """Fill the resume from an existing CV. The model sees the text without contact details,
    and every value it returns is kept only when the CV contains it."""
    if _demo(extractor):
        first = next((line.strip() for line in cv_text.splitlines() if line.strip()), "")
        skills = [item["name"] for item in mock_extractor.extract(cv_text)]
        return _kept(Imported(name=first, skills=skills), cv_text)
    return _kept(_ask("cv_import", Imported, strip_contact(cv_text)), cv_text)


class Polished(BaseModel):
    items: list[str]


LOWER_WORDS = {"and", "of", "in", "the", "for", "at", "with", "to", "on", "a", "an"}


def _tidy(text: str) -> str:
    """Demo mode's polish: spaces and capital letters only, by code."""
    words = text.split()
    out = []
    for i, word in enumerate(words):
        if word.islower() and (i == 0 or word not in LOWER_WORDS) and not ARABIC.search(word):
            word = word[:1].upper() + word[1:]
        out.append(word)
    return " ".join(out)


def polish(items: list[dict[str, str]], extractor: str | None = None) -> list[str]:
    """Each short field tidied and in English: spelling, capital letters, a certificate's full
    name, a language's level. The route keeps only what app.cv_check.polished_ok accepts."""
    if _demo(extractor):
        return [_tidy(item["text"]) for item in items]
    contents = json.dumps([{"kind": item["kind"], "text": strip_contact(item["text"])} for item in items], ensure_ascii=False)
    found = _ask("cv_polish", Polished, contents).items
    return [" ".join(text.split()) for text in found]


class Categorized(BaseModel):
    skill: str
    category: str


class Categories(BaseModel):
    items: list[Categorized]


def categorize(skills: list[str], extractor: str | None = None) -> dict[str, str]:
    """A category for each skill the catalog does not know. Demo mode gives none, and the page
    files them under Other skills; the route keeps only the catalog's own categories."""
    if _demo(extractor) or not skills:
        return {}
    found = _ask("cv_categorize", Categories, json.dumps(skills, ensure_ascii=False)).items
    return {item.skill: item.category for item in found}


class NewProject(BaseModel):
    name: str = ""
    what: str = ""
    tools: str = ""
    role: str = ""
    start: str = ""
    end: str = ""
    url: str = ""


class NewJob(BaseModel):
    company: str = ""
    title: str = ""
    what: str = ""
    start: str = ""
    end: str = ""


class Changes(BaseModel):
    projects: list[NewProject] = []
    jobs: list[NewJob] = []
    skills: list[str] = []
    certs: list[str] = []
    langs: list[str] = []
    activities: list[str] = []


MEMBER = re.compile(r"^\s*member\s*(of|,|–|-)?\s*", re.IGNORECASE)
LABELLED_PROJECT = re.compile(r"(?:new project|project|مشروع جديد|مشروع)\s*:\s*([^.\n]+)\.?\s*([^\n]*)", re.IGNORECASE)


def _demo_changes(text: str) -> Changes:
    """Demo mode: skills the catalog finds, and a project written as "New project: Name. What"."""
    skills = [item["name"] for item in mock_extractor.extract(text)]
    projects = [NewProject(name=m.group(1).strip(), what=m.group(2).strip()) for m in LABELLED_PROJECT.finditer(text)]
    return Changes(projects=projects, skills=skills)


def _said(value: str, text: str) -> str:
    """A value kept only when the person's text says it (spelling aside)."""
    value = " ".join(value.split())
    return value if value and (mentions(value, text) or words_in(value, text)) else ""


def whats_new(text: str, extractor: str | None = None) -> dict:
    """What the person says is new since their CV, sorted into CV parts. Every name, skill,
    certificate and activity is kept only when their text says it; a project's or job's
    description must pass the grounding check against it."""
    found = _demo_changes(text) if _demo(extractor) else _ask("cv_whats_new", Changes, strip_contact(text))
    projects = []
    for project in found.projects[:10]:
        if not (name := _said(project.name, text)):
            continue
        what = " ".join(project.what.split())
        projects.append({
            "name": name,
            "what": what if what and check_line(what, text) else "",
            "tools": _said(project.tools, text), "role": _said(project.role, text),
            "start": _said(project.start, text), "end": _said(project.end, text),
            "url": _https(url) if (url := _said(project.url, text)) else "",
        })
    jobs = []
    for job in found.jobs[:10]:
        company, title = _said(job.company, text), _said(job.title, text)
        if not (company or title):
            continue
        what = " ".join(job.what.split())
        jobs.append({
            "company": company, "title": title, "what": what if what and check_line(what, text) else "",
            "start": _said(job.start, text), "end": _said(job.end, text),
        })
    lists = {key: list(dict.fromkeys(v for item in getattr(found, key)[:30] if (v := _said(item, text)))) for key in ("skills", "certs", "langs")}
    # Joining a club makes one a member, so "Member" may be added; any other title must be said.
    lists["activities"] = list(dict.fromkeys(
        " ".join(item.split()) for item in found.activities[:30]
        if item.strip() and _said(MEMBER.sub("", item), text)
    ))
    return {"projects": projects, "jobs": jobs, **lists}
