import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field

from app.agents import cv_skills, requirements
from app.config import get_settings
from app.frontend import register_frontend
from app.gap import evaluate_gap
from app.rate_limit import RateLimiter, client_address
from app.skills_catalog import CATALOG, RELATED
from app.parsers import extract_document
from app.parsers.pdf import PdfExtractionError
from app.verification import SkillVerifier, aggregate, verify_requirements, verify_skills

settings = get_settings()

app = FastAPI(
    title="SkillSync API",
    version="0.1.0",
    description="Aligns a student's verified skills with real job market requirements.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
MAX_CV_TEXT_CHARS = 50_000
MIN_CV_TEXT_CHARS = 40
STATUS_BY_CODE = {
    "EMPTY_UPLOAD": 400,
    "UNSUPPORTED_FILE": 415,
    "WORD_LEGACY_OR_PROTECTED": 415,
    "NOT_A_PDF_MAGIC": 415,
    "DOCX_CORRUPTED": 400,
    "DOCX_NO_TEXT": 422,
    "PDF_ENCRYPTED": 400,
    "PDF_CORRUPTED": 400,
    "PDF_TOO_MANY_PAGES": 422,
    "PDF_NO_TEXT_LAYER": 422,
}

STATUS_BY_SKILL_ERROR = {
    "SKILLS_UNAVAILABLE": 503,
    "SKILLS_BUSY": 503,
    "SKILLS_QUOTA_EXCEEDED": 429,
}

# SkillSync's own messages (timings, counts, never CV text) at INFO, so Render's logs show them.
logging.getLogger("skillsync").setLevel(logging.INFO)
if not logging.getLogger("skillsync").handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s: %(name)s: %(message)s"))
    logging.getLogger("skillsync").addHandler(_handler)
    logging.getLogger("skillsync").propagate = False

logger = logging.getLogger("skillsync.runs")

RATE_WINDOW_SECONDS = 3600
rate_limiter = RateLimiter(limit=settings.skillsync_rate_limit, window_seconds=RATE_WINDOW_SECONDS)


def _rate_limited(request: Request, units: int) -> JSONResponse | None:
    wait = rate_limiter.take(client_address(request), units)
    if wait is None:
        return None
    response = _error(
        429,
        "RATE_LIMITED",
        "This address has used its hourly allowance of extractions. Try again later.",
    )
    response.headers["Retry-After"] = str(wait)
    return response


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"detail": {"code": code, "message": message}},
    )


# A GoatCounter code is a plain lowercase name; it becomes part of the counter's address.
GOATCOUNTER_CODE = re.compile(r"[a-z0-9][a-z0-9-]{0,49}")


def _goatcounter_code() -> str:
    code = settings.goatcounter_code.strip().lower()
    return code if GOATCOUNTER_CODE.fullmatch(code) else ""


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": settings.gemini_model,
        "extractor": cv_skills.extractor_mode(),
        "analytics": _goatcounter_code(),
    }


STATS_TTL_SECONDS = 300
# A failed read is retried sooner, so a GoatCounter hiccup does not hide the count for long.
STATS_RETRY_SECONDS = 60
_stats_cache: dict = {"at": 0.0, "checked": None}


def _get_json(url: str, token: str = ""):
    # A plain client name: some hosts turn away requests that do not say who is asking.
    headers = {"User-Agent": "SkillSync/1.0", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=4) as response:
        return json.loads(response.read().decode("utf-8"))


def _error_body(error: Exception) -> str:
    """The start of an HTTP error's reply, where GoatCounter says what it did not accept."""
    if isinstance(error, urllib.error.HTTPError):
        try:
            return error.read(300).decode("utf-8", "replace")
        except OSError:
            return ""
    return ""


def _read_goatcounter(code: str, path: str) -> int:
    """One count from GoatCounter: the dashboard's numbers through the API when a key is set,
    else the public counter (needs "Allow adding visitor counts on your website")."""
    token = settings.goatcounter_api_key.strip()
    if token:
        # The API takes times on the hour; the end is the next full hour, so today counts.
        next_hour = (int(time.time()) // 3600 + 1) * 3600
        end = time.strftime("%Y-%m-%dT%H:00:00Z", time.gmtime(next_hour))
        query = urllib.parse.urlencode({"start": "2020-01-01T00:00:00Z", "end": end, "limit": 100})
        try:
            body = _get_json(f"https://{code}.goatcounter.com/api/v0/stats/hits?{query}", token)
            return sum(int(hit.get("count") or 0) for hit in body.get("hits", []) if hit.get("path") == path)
        except (OSError, ValueError) as error:
            # Never the key: only which address failed, how, and GoatCounter's own reason.
            reason = _error_body(error)
            logger.warning("GoatCounter API /api/v0/stats/hits failed: %s %s; using the public counter", error, reason)
    try:
        body = _get_json(f"https://{code}.goatcounter.com/counter/{path}.json")
    except (OSError, ValueError) as error:
        raise OSError(f"public counter /counter/{path}.json: {error} {_error_body(error)}") from error
    return int("".join(ch for ch in str(body.get("count", "")) if ch.isdigit()))


@app.get("/api/stats")
def stats() -> dict[str, int | None]:
    """How many CVs were checked, for the landing. Asked here rather than in the browser, where
    ad blockers often stop requests to goatcounter.com; cached for a few minutes."""
    code = _goatcounter_code()
    if not code:
        return {"checked": None}
    now = time.monotonic()
    ttl = STATS_TTL_SECONDS if _stats_cache["checked"] is not None else STATS_RETRY_SECONDS
    if _stats_cache["at"] and now - _stats_cache["at"] < ttl:
        return {"checked": _stats_cache["checked"]}
    try:
        checked = _read_goatcounter(code, "step-skills")
    except (OSError, ValueError) as error:
        # The counter setting off, GoatCounter refusing or down; the landing then shows nothing.
        logger.warning("GoatCounter count unavailable: %s", error)
        checked = None
    _stats_cache.update(at=now, checked=checked)
    return {"checked": checked}


@app.post("/api/runs")
async def create_run(file: UploadFile = File(...)):
    # The type is read from the file's first bytes: browsers label .docx files inconsistently.
    buffer = bytearray()
    while chunk := await file.read(CHUNK_BYTES):
        buffer.extend(chunk)
        if len(buffer) > MAX_UPLOAD_BYTES:
            return _error(413, "FILE_TOO_LARGE", "The file is larger than 5 MB.")

    try:
        document = extract_document(bytes(buffer))
    except PdfExtractionError as error:
        return _error(STATUS_BY_CODE[error.code], error.code, error.message)

    run_id = str(uuid4())
    logger.info(
        "run %s accepted: %d bytes, %d pages, %d characters",
        run_id,
        len(buffer),
        document.pages,
        document.characters,
    )

    return {
        "run_id": run_id,
        "filename": file.filename or "cv",
        "pages": document.pages,
        "characters": document.characters,
        "text": document.text,
    }


# Built once: the picker and suggestions on the skills page read this list.
SKILL_CATALOG = {
    "skills": [
        {
            "name": name,
            "category": category,
            # The picker takes English names only, so Arabic spellings stay server-side.
            "aliases": [alias for alias in aliases if alias.isascii()],
        }
        for name, category, aliases in CATALOG
    ],
    "related": {skill: list(related) for skill, related in RELATED.items()},
}


@app.get("/api/skills/catalog")
def skill_catalog():
    return JSONResponse(SKILL_CATALOG, headers={"Cache-Control": "public, max-age=3600"})


class SkillsRequest(BaseModel):
    text: str


@app.post("/api/skills/extract")
def extract_skills_route(payload: SkillsRequest, request: Request):
    text = payload.text.strip()

    if len(text) < MIN_CV_TEXT_CHARS:
        return _error(422, "TEXT_TOO_SHORT", "The CV text is too short to extract skills.")

    if len(text) > MAX_CV_TEXT_CHARS:
        return _error(413, "TEXT_TOO_LONG", "The CV text is too long to extract skills.")

    if limited := _rate_limited(request, 1):
        return limited

    try:
        candidates = cv_skills.extract(text)
    except cv_skills.SkillExtractionError as error:
        status = STATUS_BY_SKILL_ERROR.get(error.code, 502)
        return _error(status, error.code, error.message)

    result = verify_skills(candidates, text)
    logger.info(
        "skills extraction: %d kept, %d dropped",
        len(result.skills),
        result.dropped_count,
    )

    return {
        "skills": [
            {"name": skill.name, "category": skill.category, "evidence": skill.evidence}
            for skill in result.skills
        ],
        "dropped_count": result.dropped_count,
    }


@app.post("/api/skills/extract/stream")
def stream_skills_route(payload: SkillsRequest, request: Request):
    """Agent 1, streamed: one JSON line per verified skill as soon as it is proven, then a
    closing line. Lines: {"type": "skill", name, category, evidence}, then {"type": "done",
    "dropped_count"} or {"type": "error", "code", "message"}."""
    text = payload.text.strip()

    if len(text) < MIN_CV_TEXT_CHARS:
        return _error(422, "TEXT_TOO_SHORT", "The CV text is too short to extract skills.")

    if len(text) > MAX_CV_TEXT_CHARS:
        return _error(413, "TEXT_TOO_LONG", "The CV text is too long to extract skills.")

    if limited := _rate_limited(request, 1):
        return limited

    def lines():
        verifier = SkillVerifier(text)
        kept = 0
        try:
            for candidate in cv_skills.stream(text):
                if skill := verifier.check(candidate):
                    kept += 1
                    yield _line({"type": "skill", "name": skill.name, "category": skill.category, "evidence": skill.evidence})
        except cv_skills.SkillExtractionError as error:
            yield _line({"type": "error", "code": error.code, "message": error.message})
            return
        logger.info("skills extraction (streamed): %d kept, %d dropped", kept, verifier.dropped_count)
        yield _line({"type": "done", "dropped_count": verifier.dropped_count})

    # No caching or proxy buffering, or the lines would arrive all at once at the end.
    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(lines(), media_type="application/x-ndjson", headers=headers)


def _line(item: dict) -> str:
    return json.dumps(item, ensure_ascii=False) + "\n"


MAX_POSTINGS = 10
MIN_POSTING_CHARS = 80
MAX_POSTING_CHARS = 20_000
MAX_TITLE_CHARS = 120

STATUS_BY_REQUIREMENTS_ERROR = {
    "REQUIREMENTS_MALFORMED": 502,
    "REQUIREMENTS_UNAVAILABLE": 503,
    "REQUIREMENTS_BUSY": 503,
    "REQUIREMENTS_QUOTA_EXCEEDED": 429,
}


class Posting(BaseModel):
    title: str = ""
    text: str


class RequirementsRequest(BaseModel):
    postings: list[Posting]


def _check_postings(postings: list[Posting]) -> JSONResponse | None:
    if not postings:
        return _error(422, "POSTINGS_EMPTY", "Paste at least one job posting.")

    if len(postings) > MAX_POSTINGS:
        return _error(422, "POSTINGS_TOO_MANY", f"Paste at most {MAX_POSTINGS} job postings.")

    for number, posting in enumerate(postings, start=1):
        text = posting.text.strip()

        if len(posting.title.strip()) > MAX_TITLE_CHARS:
            return _error(
                422,
                "POSTING_TITLE_TOO_LONG",
                f"Posting {number}: the title is longer than {MAX_TITLE_CHARS} characters.",
            )
        if len(text) < MIN_POSTING_CHARS:
            return _error(
                422,
                "POSTING_TOO_SHORT",
                f"Posting {number} is too short. Paste the full posting text.",
            )
        if len(text) > MAX_POSTING_CHARS:
            return _error(
                413,
                "POSTING_TOO_LONG",
                f"Posting {number} is longer than {MAX_POSTING_CHARS:,} characters.",
            )

    return None


@app.post("/api/requirements/extract")
def extract_requirements_route(payload: RequirementsRequest, request: Request):
    if rejection := _check_postings(payload.postings):
        return rejection

    if limited := _rate_limited(request, len(payload.postings)):
        return limited

    per_posting = []
    dropped = 0

    for posting in payload.postings:
        text = posting.text.strip()
        try:
            candidates = requirements.extract(text)
        except requirements.RequirementsError as error:
            status = STATUS_BY_REQUIREMENTS_ERROR.get(error.code, 502)
            return _error(status, error.code, error.message)

        kept, removed = verify_requirements(candidates, text)
        per_posting.append(kept)
        dropped += removed

    results = aggregate(per_posting)
    logger.info(
        "requirements extraction: %d postings, %d kept, %d dropped",
        len(per_posting),
        len(results),
        dropped,
    )

    return {
        "postings_count": len(per_posting),
        "requirements": [
            {
                "name": item.name,
                "category": item.category,
                "level": item.level,
                "frequency": item.frequency,
                "sources": [
                    {"posting": s.posting, "level": s.level, "evidence": s.evidence}
                    for s in item.sources
                ],
            }
            for item in results
        ],
        "dropped_count": dropped,
    }


MAX_GAP_SKILLS = 200
MAX_GAP_REQUIREMENTS = 400


class GapSkill(BaseModel):
    name: str = Field(max_length=80)
    category: str = Field(default="Other", max_length=40)
    evidence: str = Field(default="", max_length=300)
    verified: bool = False


class GapSource(BaseModel):
    posting: int = Field(ge=0, lt=MAX_POSTINGS)
    level: Literal["required", "preferred"]
    evidence: str = Field(max_length=300)


class GapRequirement(BaseModel):
    name: str = Field(max_length=80)
    category: str = Field(max_length=40)
    level: Literal["required", "preferred"]
    frequency: int = Field(ge=1, le=MAX_POSTINGS)
    sources: list[GapSource] = Field(min_length=1, max_length=MAX_POSTINGS)


class GapRequest(BaseModel):
    skills: list[GapSkill] = Field(max_length=MAX_GAP_SKILLS)
    requirements: list[GapRequirement] = Field(max_length=MAX_GAP_REQUIREMENTS)
    postings_count: int = Field(ge=1, le=MAX_POSTINGS)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    if request.url.path == "/api/gap":
        return _error(422, "GAP_INVALID", "The skills or requirements are not in the expected shape.")
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


@app.post("/api/gap")
def gap_route(payload: GapRequest):
    if not payload.requirements:
        return _error(422, "GAP_NO_REQUIREMENTS", "Extract requirements from postings first.")

    if any(item.frequency > payload.postings_count for item in payload.requirements):
        return _error(422, "GAP_INVALID", "A requirement appears in more postings than were sent.")

    result = evaluate_gap(
        [skill.model_dump() for skill in payload.skills],
        [item.model_dump() for item in payload.requirements],
        payload.postings_count,
    )
    summary = result["summary"]
    logger.info(
        "gap evaluation: %d have, %d need proof, %d missing",
        summary["have_count"],
        summary["needs_proof_count"],
        summary["missing_count"],
    )
    return result


# Registered last so every API route above takes precedence over the site's catch-all.
if settings.skillsync_static_dir:
    register_frontend(app, Path(settings.skillsync_static_dir))
