import logging
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agents import cv_skills, requirements
from app.config import get_settings
from app.parsers.pdf import PdfExtractionError, extract
from app.verification import aggregate, verify_requirements, verify_skills

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
    "NOT_A_PDF": 415,
    "NOT_A_PDF_MAGIC": 415,
    "PDF_ENCRYPTED": 400,
    "PDF_CORRUPTED": 400,
    "PDF_TOO_MANY_PAGES": 422,
    "PDF_NO_TEXT_LAYER": 422,
}

STATUS_BY_SKILL_ERROR = {
    "SKILLS_UNAVAILABLE": 503,
    "SKILLS_QUOTA_EXCEEDED": 429,
}

logger = logging.getLogger("skillsync.runs")


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"detail": {"code": code, "message": message}},
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": settings.gemini_model,
        "extractor": cv_skills.extractor_mode(),
    }


@app.post("/api/runs")
async def create_run(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        return _error(415, "NOT_A_PDF", "Only PDF files are accepted.")

    buffer = bytearray()
    while chunk := await file.read(CHUNK_BYTES):
        buffer.extend(chunk)
        if len(buffer) > MAX_UPLOAD_BYTES:
            return _error(413, "PDF_TOO_LARGE", "The PDF is larger than 5 MB.")

    try:
        document = extract(bytes(buffer))
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
        "filename": file.filename or "cv.pdf",
        "pages": document.pages,
        "characters": document.characters,
        "text": document.text,
    }


class SkillsRequest(BaseModel):
    text: str


@app.post("/api/skills/extract")
def extract_skills_route(payload: SkillsRequest):
    text = payload.text.strip()

    if len(text) < MIN_CV_TEXT_CHARS:
        return _error(422, "TEXT_TOO_SHORT", "The CV text is too short to extract skills.")

    if len(text) > MAX_CV_TEXT_CHARS:
        return _error(413, "TEXT_TOO_LONG", "The CV text is too long to extract skills.")

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


MAX_POSTINGS = 10
MIN_POSTING_CHARS = 80
MAX_POSTING_CHARS = 20_000
MAX_TITLE_CHARS = 120

STATUS_BY_REQUIREMENTS_ERROR = {
    "REQUIREMENTS_MALFORMED": 502,
    "REQUIREMENTS_UNAVAILABLE": 503,
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
def extract_requirements_route(payload: RequirementsRequest):
    if rejection := _check_postings(payload.postings):
        return rejection

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
