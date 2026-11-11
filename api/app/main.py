import logging
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.parsers.pdf import PdfExtractionError, extract

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
STATUS_BY_CODE = {
    "EMPTY_UPLOAD": 400,
    "NOT_A_PDF": 415,
    "NOT_A_PDF_MAGIC": 415,
    "PDF_ENCRYPTED": 400,
    "PDF_CORRUPTED": 400,
    "PDF_TOO_MANY_PAGES": 422,
    "PDF_NO_TEXT_LAYER": 422,
}

logger = logging.getLogger("skillsync.runs")


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"detail": {"code": code, "message": message}},
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": settings.gemini_model}


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
