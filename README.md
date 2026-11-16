# SkillSync

**Aligning student skills with the technology job market.**

SkillSync is a multi-agent system that takes a student's CV and real job postings and returns a
personalized, prioritized learning plan — built only on skills the student can actually prove.

> Status: early scaffolding. The pipeline is designed; the API and UI are being built.

---

## The problem

Saudi Vision 2030's Human Capability Development Program calls for alignment between the labor
market and education outcomes. Students still graduate without knowing which market skills they
actually lack, and employers struggle to filter candidates by concrete, verifiable skills.

## How it works

A student uploads a CV. Four agents run in sequence and hand their output to the next one:

| # | Agent | Job | LLM? |
|---|-------|-----|------|
| 1 | **CV & Fit Assessor** | Parses the CV, verifies each claimed skill against project evidence and a short skill check, then screens job postings for fit. Only verified skills move forward. | yes |
| 2 | **Requirements Extractor** | Extracts required skills from the matched postings with RAG over the posting text, normalizes skill names, and counts how often each appears. | yes |
| 3 | **Gap Evaluator** | Compares verified skills with required skills and computes the gap. Deterministic code — the same input always yields the same gap. | no |
| 4 | **Plan Builder** | Orders the gap by how often each skill appears in the postings and drafts a learning plan from a curated resource list. | yes |

**Human-in-the-loop:** nothing is finalized until the student approves the plan. They can approve,
edit, or reject the draft.

## Tech stack

- **Backend** — FastAPI (Python), SQLite, JWT auth, Google Gemini for extraction and planning
- **Frontend** — React + Vite, TypeScript
- **Agents** — one Gemini model plus embeddings for steps 1, 2 and 4; step 3 is plain Python
- **Storage** — SQLite for users, runs and the approved plan
- **Quality** — pytest with fixture-based golden tests, secrets and dependency scanning

## Repository layout

```
skillsync/
  api/                  FastAPI service
    app/
      main.py           app entrypoint and routes
      pipeline.py       runs the agents in order, streams progress
      agents/           one module per agent
      parsers/          CV text extraction
      prompts/          agent system prompts, one markdown file each
      models/           DB models and Pydantic schemas
    tests/
      fixtures/cases/  the CVs used by the tests and the case runner
    scripts/
      run_cases.py    case runner CLI
    requirements.txt
  web/                  React + Vite frontend
    src/
    package.json
  schemas/              shared JSON contracts between agents
  reports/              case runner output, gitignored
  run.ps1               one-command setup and run
  AGENTS.md             how to run this repo in DevAI Desktop
  .env.example
  README.md
```

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Gemini API key from Google AI Studio — optional, see demo mode below

### One command (Windows, and DevAI Desktop)

```powershell
.\run.ps1          # set up and run the app
.\run.ps1 -Cases    # run every CV case and write the reports
.\run.ps1 -Tests    # run the backend test suite
```

Without a Gemini key the app starts in **demo mode**: skills are matched from a
built-in list in `api/app/agents/mock_extractor.py` instead of the model, and the web app
says so above the page. Evidence verification is unchanged. `AGENTS.md` has the details
for running this repo inside DevAI Desktop.

### Backend

```bash
cd api
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy ..\.env.example .env       # then fill in GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

API docs are served at `http://localhost:8000/docs`.

Check the Gemini key before running the pipeline:

```bash
.venv\Scripts\python scripts/check_gemini.py
```

It prints `OK: <model> replied 'OK'` or the error, and never prints the key.

### Frontend

```bash
cd web
npm install
npm run dev
```

The dev server runs at `http://localhost:5173` and proxies `/api` to the backend.

### Environment variables

Copy `.env.example` to `api/.env` and set:

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Server-side only. Never exposed to the browser. |
| `GEMINI_MODEL` | Model used for extraction and planning. |
| `SKILLSYNC_EXTRACTOR` | `mock` or `gemini`. Empty picks Gemini when a key is set, demo mode otherwise. |
| `DATABASE_URL` | SQLite path, e.g. `sqlite:///./skillsync.db`. |
| `JWT_SECRET` | Signing key for auth tokens. |

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create a student or instructor account |
| `POST` | `/api/auth/login` | Get a JWT |
| `POST` | `/api/runs` | Upload a CV and start the pipeline |
| `GET` | `/api/runs/{id}` | Fetch the run result |
| `GET` | `/api/runs/{id}/events` | Stream pipeline progress (SSE) |
| `POST` | `/api/runs/{id}/approve` | Approve, edit, or reject the draft plan |
| `POST` | `/api/skills/extract` | Extract skills from CV text and verify each one |
| `POST` | `/api/requirements/extract` | Extract and count the skills that pasted job postings ask for |

`POST /api/runs` currently accepts a multipart `file` field with a PDF up to 5 MB and 10 pages,
extracts the text in memory, and returns it with a `run_id`. The file and its text are never
written to disk or logged. Rejections use `{"detail": {"code", "message"}}` with the codes
`EMPTY_UPLOAD`, `NOT_A_PDF`, `NOT_A_PDF_MAGIC`, `PDF_TOO_LARGE`, `PDF_ENCRYPTED`,
`PDF_CORRUPTED`, `PDF_TOO_MANY_PAGES` and `PDF_NO_TEXT_LAYER`.

Arabic CVs are supported: the parser restores right-to-left runs from the visual order PDF stores
them in. Punctuation that sits between two Arabic words can land on the neighbouring word, and a
scanned CV with no text layer is rejected rather than OCR'd.

`POST /api/skills/extract` takes `{"text": "..."}` between 40 and 50,000 characters and returns
`{"skills": [{"name", "category", "evidence"}], "dropped_count": n}`. The model proposes a skill
only with a verbatim quote from the CV; plain code then normalizes both, requires a whole-word match,
merges aliases, and drops anything it cannot prove. The model never decides what is verified.
Rejections use `TEXT_TOO_SHORT`, `TEXT_TOO_LONG`, `SKILLS_MALFORMED` and `SKILLS_UNAVAILABLE`.
The prompt lives in `api/app/prompts/cv_assessor.md`, and the CV text is never logged or stored.

`POST /api/requirements/extract` (Agent 2) takes `{"postings": [{"title", "text"}]}`: 1 to 10
postings the student pasted, each 80 to 20,000 characters, title up to 120. Each posting goes to
the model on its own (prompt: `api/app/prompts/requirements_extractor.md`); every skill must come
with a verbatim quote from that posting and a level, `required` or `preferred`. Code then verifies
the quotes with the same normalization as Agent 1, merges aliases, counts how many postings ask
for each skill (`frequency`) and ranks by frequency, then required before preferred. It returns
`{"postings_count", "requirements": [{"name", "category", "level", "frequency", "sources":
[{"posting", "level", "evidence"}]}], "dropped_count"}`. Rejections use `POSTINGS_EMPTY`,
`POSTINGS_TOO_MANY`, `POSTING_TOO_SHORT`, `POSTING_TOO_LONG`, `POSTING_TITLE_TOO_LONG`,
`REQUIREMENTS_MALFORMED`, `REQUIREMENTS_UNAVAILABLE` and `REQUIREMENTS_QUOTA_EXCEEDED`; if any
posting fails, the whole request fails. Posting text is never logged or stored. In demo mode the
skill dictionary is matched instead, and a skill is `preferred` when its line, or the heading above
it, says "nice to have", "preferred", "bonus", "يفضل" and similar.

## Testing

```bash
cd api
.venv\Scripts\python -m pytest
```

Agent tests use recorded fixtures in `api/tests/fixtures/cases/` so they run without a
Gemini key. The Gap Evaluator is covered by golden tests against the same input/output pairs.

Every fixture CV can be run through the whole pipeline at once:

```powershell
.\run.ps1 -Cases
```

It prints one line per case and writes `reports/<case>.md` (skill, category, the CV line that
proves it) and `reports/summary.json`. A PDF with no text layer is reported as a failed case
rather than skipped.

## Roadmap

- [x] Repo scaffolding, `.env.example`, CI
- [x] CV upload and PDF text extraction
- [x] Agent 1 — skill extraction with automatic evidence verification
- [ ] Agent 1 — short skill check and posting screening
- [x] Agent 2 — Requirements Extractor (pasted postings, verified quotes, counted by code)
- [ ] Agent 3 — Gap Evaluator (deterministic, tested)
- [ ] Agent 4 — Plan Builder
- [x] Landing page and full Arabic (right to left) / English site
- [ ] Human-in-the-loop approve / edit / reject
- [ ] Deploy frontend and backend

## Author

Ahmed Ababtain — SWE 485, Advanced Software Engineering with AI, King Saud University.

## License

Course project, not licensed for reuse yet.
