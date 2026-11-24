# CV Upload and Text Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: load the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student uploads a PDF CV and receives the extracted English or Arabic text, with every rejection case explained by a stable error code.

**Architecture:** One parser module (`api/app/parsers/pdf.py`) owns all PDF knowledge behind `extract(bytes) -> PdfDocument`, raising `PdfExtractionError` with a stable code. One route (`POST /api/runs`) streams the upload to a bounded buffer, maps parser codes to HTTP statuses, and returns the text without storing it. The React dropzone calls that route and renders idle, uploading, success and error states.

**Tech Stack:** FastAPI, pypdf, pytest, React 19 + TypeScript, Vite.

**Spec:** `docs/superpowers/specs/2026-11-11-cv-upload-extraction-design.md`

## Global Constraints

- Maximum upload size: 5 MB, enforced while reading in 64 KB chunks.
- Maximum pages: 10.
- Minimum extracted non-whitespace characters: 40.
- `run_id` is a UUID4 generated per upload; nothing is persisted.
- The CV bytes and text are never written to disk, never logged, never stored.
- No auth on `/api/runs` in this step.
- Arabic and English CVs must both extract to readable text.
- Error body shape is always `{"detail": {"code": "...", "message": "..."}}`.

## Review Focus

- A file declaring `application/pdf` whose bytes are HTML: magic-byte check must reject it with 415 `NOT_A_PDF_MAGIC`, not 500.
- A 40 MB upload: the request must stop at 5 MB with 413 `PDF_TOO_LARGE` and must not buffer the rest.
- An Arabic CV: extraction must return Arabic codepoints, not glyph indices or presentation forms.
- A password-protected PDF that opens with an empty password: it must still be rejected with `PDF_ENCRYPTED`.
- A CV containing a unique marker string: the marker must never appear in captured logs.

---

### Task 1: PDF parser module and Latin fixture

**Files:**
- Create: `api/app/parsers/__init__.py`
- Create: `api/app/parsers/pdf.py`
- Create: `api/tests/fixtures/make_fixtures.py`
- Create: `api/tests/fixtures/english_cv.pdf` (generated)
- Test: `api/tests/test_pdf_parser.py`
- Modify: `api/requirements.txt`

**Interfaces:**
- Produces: `PdfDocument(pages: int, text: str, characters: int)`, `PdfExtractionError(code: str, message: str)`, `extract(data: bytes) -> PdfDocument`, constants `MAX_PAGES = 10`, `MIN_CHARACTERS = 40`.

- [ ] **Step 1: Add the dependency**

```bash
cd api
.venv\Scripts\python -m pip install "pypdf>=5.1"
```

Append to `api/requirements.txt`:

```
pypdf>=5.1
```

- [ ] **Step 2: Write the fixture generator**

```python
"""Generates the committed PDF fixtures. Needs PyMuPDF: pip install pymupdf."""

from pathlib import Path

import fitz

HERE = Path(__file__).resolve().parent
ARABIC_FONT = HERE / "NotoNaskhArabic.ttf"

ENGLISH = [
    "Example Candidate",
    "Computer Science, King Saud University",
    "MARKER-7731",
    "Skills: Python, FastAPI, React, TypeScript, SQL",
    "Projects: SkillSync pipeline, campus course planner",
]


def write_text_pdf(path: Path, lines: list[str], font: str | None = None) -> None:
    document = fitz.open()
    page = document.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=12, fontname="F0", fontfile=font)
        y += 22
    document.save(path)
    document.close()


def write_scanned_pdf(path: Path) -> None:
    document = fitz.open()
    page = document.new_page()
    page.draw_rect(fitz.Rect(72, 72, 500, 400), color=(0.2, 0.2, 0.2), fill=(0.9, 0.9, 0.9))
    document.save(path)
    document.close()


if __name__ == "__main__":
    write_text_pdf(HERE / "english_cv.pdf", ENGLISH)
    write_text_pdf(HERE / "arabic_cv.pdf", ARABIC_LINES, font=str(ARABIC_FONT))
    write_scanned_pdf(HERE / "scanned.pdf")
```

`ARABIC_LINES` is defined in Task 2; until then leave the call out.

- [ ] **Step 3: Generate the Latin fixture**

```bash
cd api
.venv\Scripts\python -m pip install pymupdf
.venv\Scripts\python tests/fixtures/make_fixtures.py
```

Expected: `api/tests/fixtures/english_cv.pdf` exists and is a few KB.

- [ ] **Step 4: Write the failing tests**

```python
from pathlib import Path

import pytest

from app.parsers.pdf import PdfExtractionError, extract

FIXTURES = Path(__file__).parent / "fixtures"


def read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_extracts_latin_text():
    document = extract(read("english_cv.pdf"))

    assert document.pages == 1
    assert "Example Candidate" in document.text
    assert "FastAPI" in document.text
    assert document.characters >= 40


def test_rejects_bytes_without_pdf_magic():
    with pytest.raises(PdfExtractionError) as error:
        extract(b"<html>not a pdf</html>")

    assert error.value.code == "NOT_A_PDF_MAGIC"


def test_rejects_empty_upload():
    with pytest.raises(PdfExtractionError) as error:
        extract(b"")

    assert error.value.code == "EMPTY_UPLOAD"


def test_rejects_truncated_pdf():
    broken = read("english_cv.pdf")[:120]

    with pytest.raises(PdfExtractionError) as error:
        extract(broken)

    assert error.value.code == "PDF_CORRUPTED"
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.parsers'`.

- [ ] **Step 6: Write the parser**

```python
"""PDF text extraction. The only module that knows about PDF libraries."""

import io
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PyPdfError

MAGIC = b"%PDF-"
MAX_PAGES = 10
MIN_CHARACTERS = 40


@dataclass(frozen=True)
class PdfDocument:
    pages: int
    text: str
    characters: int


class PdfExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _normalise(raw: str) -> str:
    lines = (line.strip() for line in raw.replace("\r\n", "\n").split("\n"))
    return "\n".join(line for line in lines if line)


def _count(text: str) -> int:
    return sum(1 for character in text if not character.isspace())


def extract(data: bytes) -> PdfDocument:
    if not data:
        raise PdfExtractionError("EMPTY_UPLOAD", "The uploaded file is empty.")

    if not data.startswith(MAGIC):
        raise PdfExtractionError("NOT_A_PDF_MAGIC", "The file is not a PDF.")

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = len(reader.pages)
    except PyPdfError as error:
        raise PdfExtractionError("PDF_CORRUPTED", "The PDF could not be read.") from error

    if reader.is_encrypted:
        raise PdfExtractionError("PDF_ENCRYPTED", "The PDF is password protected.")

    if pages > MAX_PAGES:
        raise PdfExtractionError(
            "PDF_TOO_MANY_PAGES",
            f"The PDF has {pages} pages; the limit is {MAX_PAGES}.",
        )

    try:
        raw_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except PyPdfError as error:
        raise PdfExtractionError("PDF_CORRUPTED", "The PDF could not be read.") from error

    text = _normalise(raw_text)
    characters = _count(text)

    if characters < MIN_CHARACTERS:
        raise PdfExtractionError(
            "PDF_NO_TEXT_LAYER",
            "No text layer found. Scanned PDFs are not supported yet.",
        )

    return PdfDocument(pages=pages, text=text, characters=characters)
```

`api/app/parsers/__init__.py` stays empty.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py -v`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add api/app/parsers api/tests api/requirements.txt
git commit -m "feat: extract text from PDF uploads"
```

---

### Task 2: Arabic fixture and extraction check

**Files:**
- Modify: `api/tests/fixtures/make_fixtures.py`
- Create: `api/tests/fixtures/arabic_cv.pdf` (generated)
- Modify: `api/tests/test_pdf_parser.py`

**Interfaces:**
- Consumes: `extract`, `PdfDocument` from Task 1.
- Produces: nothing new; confirms the engine choice stays pypdf or moves to PyMuPDF behind `extract`.

- [ ] **Step 1: Add the Arabic lines and fetch an OFL font**

```python
ARABIC_LINES = [
    "مرشح تجريبي",
    "علوم الحاسب - جامعة الملك سعود",
    "المهارات: بايثون، فاستAPI، ريأكت، تايب سكربت",
    "المشاريع: منصة سكيل سينك، مخطط المقررات",
]
```

Download Noto Naskh Arabic (OFL) once, next to the generator, and delete it before committing:

```bash
curl -L -o api/tests/fixtures/NotoNaskhArabic.ttf "https://github.com/google/fonts/raw/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf"
```

Then run the generator and remove the font file:

```bash
cd api && .venv\Scripts\python tests/fixtures/make_fixtures.py && del tests\fixtures\NotoNaskhArabic.ttf
```

- [ ] **Step 2: Write the failing Arabic test**

```python
def test_extracts_arabic_text():
    document = extract(read("arabic_cv.pdf"))

    assert document.pages == 1
    assert "مرشح" in document.text
    assert "بايثون" in document.text
    assert document.characters >= 40
```

- [ ] **Step 3: Run the test**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py::test_extracts_arabic_text -v`

- [ ] **Step 4: Fix the engine if it fails**

If the assertion fails because pypdf returns reversed or presentation-form text, replace the body
of `extract` with PyMuPDF and keep the signature, codes and tests identical:

```python
import fitz

def extract(data: bytes) -> PdfDocument:
    if not data:
        raise PdfExtractionError("EMPTY_UPLOAD", "The uploaded file is empty.")

    if not data.startswith(MAGIC):
        raise PdfExtractionError("NOT_A_PDF_MAGIC", "The file is not a PDF.")

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as error:  # noqa: BLE001
        raise PdfExtractionError("PDF_CORRUPTED", "The PDF could not be read.") from error

    if document.needs_pass:
        raise PdfExtractionError("PDF_ENCRYPTED", "The PDF is password protected.")

    pages = document.page_count
    if pages > MAX_PAGES:
        raise PdfExtractionError(
            "PDF_TOO_MANY_PAGES",
            f"The PDF has {pages} pages; the limit is {MAX_PAGES}.",
        )

    text = _normalise("\n".join(page.get_text() for page in document))

    if _count(text) < MIN_CHARACTERS:
        raise PdfExtractionError(
            "PDF_NO_TEXT_LAYER",
            "No text layer found. Scanned PDFs are not supported yet.",
        )

    return PdfDocument(pages=pages, text=text, characters=_count(text))
```

Add `pymupdf>=1.24` to `api/requirements.txt` in the same commit.

- [ ] **Step 5: Run the whole parser suite**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add api/tests api/app api/requirements.txt
git commit -m "test: cover Arabic CV extraction"
```

---

### Task 3: Rejection cases

**Files:**
- Modify: `api/tests/fixtures/make_fixtures.py`
- Create: `api/tests/fixtures/scanned.pdf` (generated)
- Modify: `api/tests/test_pdf_parser.py`

**Interfaces:**
- Consumes: `extract`, `PdfExtractionError` from Task 1.
- Produces: covered codes `PDF_ENCRYPTED`, `PDF_NO_TEXT_LAYER`, `PDF_TOO_MANY_PAGES`.

- [ ] **Step 1: Write the failing tests**

```python
def test_rejects_scanned_pdf():
    with pytest.raises(PdfExtractionError) as error:
        extract(read("scanned.pdf"))

    assert error.value.code == "PDF_NO_TEXT_LAYER"


def test_rejects_encrypted_pdf():
    writer = PdfWriter()
    writer.append(io.BytesIO(read("english_cv.pdf")))
    writer.encrypt("secret")
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(PdfExtractionError) as error:
        extract(buffer.getvalue())

    assert error.value.code == "PDF_ENCRYPTED"


def test_rejects_more_than_ten_pages():
    writer = PdfWriter()
    for _ in range(11):
        writer.append(io.BytesIO(read("english_cv.pdf")))
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(PdfExtractionError) as error:
        extract(buffer.getvalue())

    assert error.value.code == "PDF_TOO_MANY_PAGES"
```

Add `import io` and `from pypdf import PdfWriter` to the test module.

- [ ] **Step 2: Run to verify the scanned case fails**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py -v`
Expected: `test_rejects_scanned_pdf` FAILS with `FileNotFoundError` for `scanned.pdf`.

- [ ] **Step 3: Generate the scanned fixture**

```bash
cd api && .venv\Scripts\python tests/fixtures/make_fixtures.py
```

- [ ] **Step 4: Run to verify all pass**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_pdf_parser.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add api/tests
git commit -m "test: cover encrypted, scanned and oversized PDFs"
```

---

### Task 4: `POST /api/runs`

**Files:**
- Modify: `api/app/main.py`
- Create: `api/tests/test_upload_route.py`

**Interfaces:**
- Consumes: `extract`, `PdfExtractionError` from Task 1.
- Produces: `POST /api/runs` returning `{run_id, filename, pages, characters, text}` and error bodies `{"detail": {"code", "message"}}`.

- [ ] **Step 1: Write the failing tests**

```python
import logging
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"
client = TestClient(app)


def upload(name: str, content_type: str = "application/pdf", data: bytes | None = None):
    payload = data if data is not None else (FIXTURES / name).read_bytes()
    return client.post("/api/runs", files={"file": (name, payload, content_type)})


def test_accepts_a_pdf_and_returns_its_text():
    response = upload("english_cv.pdf")

    assert response.status_code == 200
    body = response.json()
    assert len(body["run_id"]) == 36
    assert body["pages"] == 1
    assert body["characters"] >= 40
    assert "Example Candidate" in body["text"]


def test_rejects_a_non_pdf_content_type():
    response = upload("cv.txt", content_type="text/plain", data=b"hello")

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "NOT_A_PDF"


def test_rejects_bytes_without_pdf_magic():
    response = upload("cv.pdf", data=b"<html>hello</html>")

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "NOT_A_PDF_MAGIC"


def test_rejects_an_oversized_upload():
    payload = b"%PDF-" + b"0" * (5 * 1024 * 1024)

    response = upload("big.pdf", data=payload)

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "PDF_TOO_LARGE"


def test_rejects_an_empty_upload():
    response = upload("empty.pdf", data=b"")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "EMPTY_UPLOAD"


def test_rejects_a_scanned_pdf_with_422():
    response = upload("scanned.pdf")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PDF_NO_TEXT_LAYER"


def test_never_logs_the_cv_text(caplog):
    caplog.set_level(logging.DEBUG)

    upload("english_cv.pdf")

    assert "MARKER-7731" not in caplog.text
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && .venv\Scripts\python -m pytest tests/test_upload_route.py -v`
Expected: FAIL, every request returns 404.

- [ ] **Step 3: Write the route**

Add to `api/app/main.py`:

```python
import logging
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

from app.parsers.pdf import PdfExtractionError, extract

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
```

- [ ] **Step 4: Run the tests**

Run: `cd api && .venv\Scripts\python -m pytest -v`
Expected: 13 passed (2 health + 8 parser + 7 route cases).

- [ ] **Step 5: Commit**

```bash
git add api/app/main.py api/tests/test_upload_route.py
git commit -m "feat: accept CV uploads at POST /api/runs"
```

---

### Task 5: Upload panel in the browser

**Files:**
- Create: `web/src/api.ts`
- Create: `web/src/components/UploadPanel.tsx`
- Modify: `web/src/App.tsx:48-56`
- Modify: `web/src/index.css`

**Interfaces:**
- Consumes: `POST /api/runs` from Task 4, proxied by Vite at `/api`.
- Produces: `createRun(file: File): Promise<RunResult>` and `ApiRequestError` with `code`.

- [ ] **Step 1: Write the API client**

```ts
export type RunResult = {
  run_id: string;
  filename: string;
  pages: number;
  characters: number;
  text: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function createRun(file: File): Promise<RunResult> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/runs", { method: "POST", body });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "The upload failed.",
    );
  }

  return payload as RunResult;
}
```

- [ ] **Step 2: Write the upload panel**

```tsx
import { useRef, useState } from "react";

import { ApiRequestError, createRun, type RunResult } from "../api";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result: RunResult };

const MAX_BYTES = 5 * 1024 * 1024;

export default function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function start(file: File) {
    if (file.type !== "application/pdf") {
      setState({ kind: "error", message: "Only PDF files are accepted." });
      return;
    }

    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "The PDF is larger than 5 MB." });
      return;
    }

    setState({ kind: "uploading", filename: file.name });

    try {
      const result = await createRun(file);
      setState({ kind: "done", result });
    } catch (error) {
      const message =
        error instanceof ApiRequestError ? error.message : "Could not reach the server.";
      setState({ kind: "error", message });
    }
  }

  return (
    <div className="upload">
      {state.kind === "done" ? (
        <>
          <div className="upload-meta">
            <span>
              {state.result.filename} · {state.result.pages} page
              {state.result.pages === 1 ? "" : "s"} · {state.result.characters} characters
            </span>
            <button className="btn btn-ghost" onClick={() => setState({ kind: "idle" })}>
              Start over
            </button>
          </div>
          <pre className="upload-text">{state.result.text}</pre>
        </>
      ) : (
        <>
          <div
            className={`dropzone${dragging ? " dropzone-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void start(file);
            }}
          >
            {state.kind === "uploading" ? (
              <p className="dropzone-title">Extracting text…</p>
            ) : (
              <>
                <p className="dropzone-title">Drop your CV here</p>
                <p className="dropzone-hint">PDF only, up to 5 MB and 10 pages.</p>
                <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                  Choose a PDF
                </button>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void start(file);
              event.target.value = "";
            }}
          />
          {state.kind === "error" && (
            <p className="upload-error" role="alert">
              {state.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Use the panel in `App.tsx`**

Replace the static dropzone inside the first panel:

```tsx
<section className="panel" aria-labelledby="upload-title">
  <h2 id="upload-title">Start with your CV</h2>
  <UploadPanel />
</section>
```

Add `import UploadPanel from "./components/UploadPanel";` at the top.

- [ ] **Step 4: Add the states to `index.css`**

```css
.dropzone-active {
  border-color: var(--accent);
  background: rgba(141, 162, 251, 0.06);
}

.dropzone .btn {
  margin-top: 0.6rem;
}

.upload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.upload-text {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 1rem;
  font-family: var(--font-body);
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.upload-error {
  margin-top: 0.8rem;
  font-size: 0.9rem;
  color: #f0a3a3;
}
```

- [ ] **Step 5: Build and check the browser**

Run: `cd web && npm run build`
Expected: TypeScript and Vite succeed.

Then upload a real PDF in the dev server and confirm the text appears, `Start over` resets the panel, and the console is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat: upload a CV and show its extracted text"
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the endpoint**

Add under the API table:

```markdown
`POST /api/runs` accepts a multipart `file` field with a PDF up to 5 MB and 10 pages,
extracts the text in memory, and returns it with a `run_id`. The file and its text are
never written to disk or logged. Rejections use `{"detail": {"code", "message"}}` with
codes `EMPTY_UPLOAD`, `NOT_A_PDF`, `NOT_A_PDF_MAGIC`, `PDF_TOO_LARGE`, `PDF_ENCRYPTED`,
`PDF_CORRUPTED`, `PDF_TOO_MANY_PAGES` and `PDF_NO_TEXT_LAYER`.
```

- [ ] **Step 2: Run the full suite**

Run: `cd api && .venv\Scripts\python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 3: Confirm nothing leaked into git**

```bash
git status --short
git ls-files | findstr /i "\.pdf$"
```

Expected: only the three fixtures appear, no `.env`, no CV from a manual run.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the CV upload endpoint"
```

---

## Self-review

- Spec coverage: validation order (Task 1 + Task 4), size cap while streaming (Task 4), distinct codes (Tasks 1, 3, 4), Arabic fixture (Task 2), fixtures (Tasks 1–3), privacy and no logging (Task 4 test), frontend states (Task 5), README (Task 6). Every spec section maps to a task.
- Types: `PdfDocument`, `PdfExtractionError`, `extract` and the route response names match across tasks.
- Placeholders: none; each step carries the code it needs.
