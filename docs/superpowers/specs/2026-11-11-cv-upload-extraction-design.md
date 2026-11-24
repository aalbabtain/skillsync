# CV upload and text extraction — design

Date: 2026-11-11
Step: 2 of the SkillSync roadmap
Status: awaiting approval

## Goal

A student uploads a PDF CV and gets the extracted text back. This is the input stage the four
agents will build on; it does not run any agent and does not call Gemini.

Success looks like: dropping a real CV in the browser returns readable English or Arabic text in
under a second for a normal 1–3 page file, and every rejection case returns a distinct, explainable
error.

## Decisions taken

| Decision | Choice |
|----------|--------|
| Persistence | None. The CV and its text are never written to disk or to SQLite. |
| Auth | None yet. `/api/runs` is open until sessions and run history are added. |
| Response | Full extracted text in the JSON response. |
| `run_id` | A UUID4 generated per upload, returned but not stored. |

## Contract

`POST /api/runs` — `multipart/form-data`, one field `file`.

Success `200`:

```json
{
  "run_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "filename": "cv.pdf",
  "pages": 2,
  "characters": 1840,
  "text": "Example Candidate\n..."
}
```

`characters` counts non-whitespace characters of `text`.

Errors share one shape, with a stable machine-readable `code`:

```json
{ "detail": { "code": "PDF_NO_TEXT_LAYER", "message": "This PDF has no text layer..." } }
```

| Status | `code` | When |
|--------|--------|------|
| 413 | `PDF_TOO_LARGE` | Upload exceeds 5 MB while streaming |
| 415 | `NOT_A_PDF` | Content-type is not `application/pdf` |
| 415 | `NOT_A_PDF_MAGIC` | First 5 bytes are not `%PDF-` |
| 400 | `PDF_ENCRYPTED` | File is password protected |
| 400 | `PDF_CORRUPTED` | Parser cannot read the document |
| 422 | `PDF_NO_TEXT_LAYER` | Fewer than 40 non-whitespace characters extracted |
| 422 | `PDF_TOO_MANY_PAGES` | More than 10 pages |
| 400 | `EMPTY_UPLOAD` | Zero-byte file |

## Validation order

1. Read the upload as a stream in 64 KB chunks, aborting with 413 as soon as the running total
   passes 5 MB. The body is never buffered past the cap.
2. Reject an empty body.
3. Check the declared content-type (`application/pdf`), then the first bytes (`%PDF-`). The magic-byte
   check is authoritative.
4. Open the document. An encrypted file is rejected before any page is read.
5. Reject documents over 10 pages.
6. Extract text from every page.
7. Reject when fewer than 40 non-whitespace characters come back, which is what a scan produces.

## Components

`api/app/parsers/pdf.py` — the only module that knows about PDF libraries.

```python
@dataclass(frozen=True)
class PdfDocument:
    pages: int
    text: str
    characters: int

class PdfExtractionError(Exception):
    code: str

def extract(data: bytes) -> PdfDocument: ...
```

Every rejection raises `PdfExtractionError` with one of the codes above; the route maps the code to
its HTTP status. Nothing else imports a PDF library, so swapping the engine is a one-file change.

`api/app/main.py` — adds `POST /api/runs`. The route streams the upload to a bounded buffer,
calls `extract`, and builds the response. It logs only `run_id`, page count and character count.

`web/src/App.tsx` and `web/src/api.ts` — the existing dropzone becomes a real control: click to
choose a file, drag and drop, upload, then show pages and character count with the extracted text in a
collapsible block. It renders idle, uploading, success and error states, with the error message taken
from the API `code`.

## Extraction engine

Start with `pypdf`. It is pure Python and extracts both Latin and Arabic text without extra system
libraries. The Arabic fixture test decides whether it is good enough: the test asserts that expected Arabic
words appear in the extracted text after normalising whitespace and Arabic presentation forms.

If pypdf mangles Arabic, replace the body of `extract()` with PyMuPDF (`fitz`) and keep the same
interface, error codes and tests. That decision is recorded in this spec when the test is run.

## Fixtures

`api/tests/fixtures/` holds three committed files:

- `english_cv.pdf` — one page, Latin text with a name, a skills section and a project.
- `arabic_cv.pdf` — one page, Arabic text with a name, a skills section and a project.
- `scanned.pdf` — one page containing an image only, no text layer.

`make_fixtures.py` sits next to them as a dev-only generator, documented as not required to run
the test suite. The generated PDFs are committed so the suite needs no extra dependency.

## Tests

`api/tests/test_pdf_parser.py`

- extracts Latin text and returns the expected pages and character count
- extracts Arabic text containing the expected words
- rejects a scanned PDF with `PDF_NO_TEXT_LAYER`
- rejects a truncated document with `PDF_CORRUPTED`
- rejects a password-protected PDF with `PDF_ENCRYPTED`
- rejects an 11-page document with `PDF_TOO_MANY_PAGES`

`api/tests/test_upload_route.py`

- `POST /api/runs` with `english_cv.pdf` returns 200 with a UUID `run_id` and the text
- rejects a `.txt` upload with 415 `NOT_A_PDF`
- rejects a file whose bytes do not start with `%PDF-` with 415 `NOT_A_PDF_MAGIC`
- rejects an upload larger than 5 MB with 413 `PDF_TOO_LARGE`
- rejects a zero-byte upload with 400 `EMPTY_UPLOAD`
- asserts the CV text never appears in captured logs

## Privacy

- The CV bytes and text stay in memory for the duration of the request.
- No file is written to disk, not even to a temp directory.
- Logs contain only `run_id`, byte size, page count and character count. The exception message
  never includes file content.
- The existing `.gitignore` already excludes `*.db`, uploads and `.env`.

## Non-goals

- No database, no run history, no auth, no Gemini call, no agent execution.
- No OCR for scanned documents; a scan is rejected with a clear error.
- No CV editing, no multi-file upload, no format other than PDF.

## Frontend states

| State | What the student sees |
|-------|-----------------------|
| Idle | Dashed dropzone, "Choose a PDF or drop it here", 5 MB limit stated |
| Dragging | Accent border while a file is over the zone |
| Uploading | Disabled zone, "Extracting text…" |
| Success | Page and character counts, extracted text in a scrollable block, "Start over" |
| Error | The API message in accent-muted text, zone active again, retry allowed |

All colours, radii and typography come from the existing dark tokens; no new visual direction.

## Dependencies

- `pypdf` added to `api/requirements.txt`.
- No new frontend dependency.

## Verification

- `pytest` green, including every rejection case and the Arabic fixture test.
- Manual run: upload a real CV in the browser, confirm the text renders and the console is clean.
- Confirm `git status` shows no PDF or text artefacts after a run.
