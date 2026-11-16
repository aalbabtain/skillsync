# SkillSync

[![CI](https://github.com/aalbabtain/skillsync/actions/workflows/ci.yml/badge.svg)](https://github.com/aalbabtain/skillsync/actions/workflows/ci.yml)

**See which skills the jobs you want are asking for.**

SkillSync reads a CV, keeps only the skills the CV proves, compares them with the job postings
the person is aiming for, and shows the gap. The site works in Arabic (right to left) and English.

**Live:** <https://skillsync-d9r7.onrender.com> (free plan: the first visit after a quiet spell
takes about a minute while the server wakes up).

---

## The problem

Saudi Vision 2030's Human Capability Development Program calls for alignment between the labor
market and education outcomes. Students, graduates and people changing careers often don't know
which skills the market asks for that they can't yet prove, and employers struggle to filter
candidates by concrete, verifiable skills.

## How it works

Four agents run one after another, each handing its output to the next. Three are built.

| # | Agent | What it does | Model? | Status |
|---|-------|--------------|--------|--------|
| 1 | **CV & Fit Assessor** | Reads the CV and returns each skill with a verbatim quote that proves it. Code checks every quote against the CV and drops what it cannot find. The person reviews the list and can add skills by hand. | Gemini | Built |
| 2 | **Requirements Extractor** | Reads the postings the person pastes and returns the skills each one asks for, with a quote and a level (required or preferred). Code checks the quotes and counts how many postings ask for each skill. | Gemini | Built |
| 3 | **Gap Evaluator** | Sorts every required skill into *you have it*, *needs proof* (added by hand, not shown in the CV) or *missing*. | No, plain code | Built |
| 4 | **Plan Builder** | Orders the gap by demand and drafts a learning plan the person approves, edits or rejects. | Gemini | Planned |

The model never decides what is verified: `api/app/verification.py` does, by matching each quote
against the CV or posting text.

## Tech stack

- **Backend:** FastAPI (Python), Google Gemini for extraction, PyMuPDF for PDF text
- **Frontend:** React + Vite, TypeScript, one dictionary file for Arabic and English
- **Quality:** pytest with golden fixtures, CI on GitHub Actions
- **Hosting:** one Docker container on Render, deployed from `main`

Planned with Agent 4: SQLite for saved plans, and accounts.

## Repository layout

```
skillsync/
  api/                      FastAPI service
    app/
      main.py               routes, limits, error codes
      agents/               cv_skills.py (Agent 1), requirements.py (Agent 2), mock_extractor.py
      gap.py                Agent 3, plain code
      verification.py       quote checks, name normalization, counting
      skills_catalog.py     every known skill, its category and spellings, and related skills
      parsers/              file type detection, PDF (both Arabic layouts) and Word .docx
      prompts/              one system prompt per agent
      frontend.py           serves the built web app in production
      rate_limit.py         per-visitor limit on model requests
      expectations.py       checks CV cases against expected.json
    tests/
      fixtures/cases/       fictional CVs and expected.json
      fixtures/postings/    sample job postings
      fixtures/gap/         golden input/output pairs for Agent 3
    scripts/                run_cases.py, check_gemini.py
    requirements.txt        runtime dependencies
    requirements-dev.txt    plus test tools
  web/src/                  React app; i18n.tsx holds every string in both languages
  Dockerfile, render.yaml   production build and Render service
  .github/workflows/ci.yml  tests, web build, image build
  run.ps1                   one-command setup and run on Windows
  AGENTS.md                 how to run this repo, for people and coding agents
  docs/                     design specs and implementation plans
```

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Gemini API key from Google AI Studio: optional, see demo mode below

### One command (Windows)

```powershell
.\run.ps1          # set up and run the app
.\run.ps1 -Cases   # run every CV case and check it against expected.json
.\run.ps1 -Tests   # run the backend test suite
```

Without a Gemini key the app starts in **demo mode**: skills are matched from a built-in list
in `api/app/agents/mock_extractor.py` instead of the model, and the site says so at the top.
Quote verification and the gap are unchanged.

### By hand

```bash
cd api
python -m venv .venv
.venv\Scripts\activate          # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
copy ..\.env.example .env        # then fill in GEMINI_API_KEY, or leave it empty for demo mode
uvicorn app.main:app --reload --port 8000
```

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server forwards `/api` to the backend; API docs are at
<http://localhost:8000/docs>. Check a Gemini key with `python scripts/check_gemini.py`: it prints
`OK: <model> replied 'OK'` or the error, never the key.

### Environment variables

Copy `.env.example` to `api/.env`. On Render, set them under the service's **Environment** tab.

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Server-side only, never sent to the browser. Empty means demo mode. |
| `GEMINI_MODEL` | Model used for extraction. |
| `GEMINI_FALLBACK_MODEL` | Optional second model, tried when the main one stays busy. |
| `SKILLSYNC_EXTRACTOR` | `mock` or `gemini` to force one. Empty picks Gemini when a key is set. |
| `SKILLSYNC_RATE_LIMIT` | Model requests per visitor address per hour (default 20; a CV counts 1, each posting 1). `0` turns it off. |
| `SKILLSYNC_STATIC_DIR` | Folder with the built web app; set in the Docker image. |
| `GOATCOUNTER_CODE` | Optional GoatCounter site code (the name before `.goatcounter.com`). Counts visits and the steps reached (start, skills, postings, gap) anonymously, without cookies or any CV text. With **Allow adding visitor counts on your website** on in the GoatCounter settings, the landing shows how many CVs were checked, starting from 0. Empty turns counting off. |

## API

Every error uses `{"detail": {"code", "message"}}`, and the site shows each code in both languages.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Status, model and whether demo mode is on |
| `GET` | `/api/skills/catalog` | Every skill the picker offers, with its category, and related skills for suggestions |
| `POST` | `/api/runs` | Upload a CV (PDF or Word .docx) and get its text |
| `POST` | `/api/skills/extract` | Agent 1: skills from CV text, each verified against a quote |
| `POST` | `/api/requirements/extract` | Agent 2: skills the pasted postings ask for, counted |
| `POST` | `/api/gap` | Agent 3: confirmed skills against the requirements |

**`POST /api/runs`** takes a multipart `file` up to 5 MB: a PDF (up to 10 pages) or a Word
`.docx`. The type is read from the file's first bytes, not its name, because browsers label
`.docx` files inconsistently. Word files are read with the standard library (body, tables, text
boxes and the header, where names often sit). The text is read in memory and returned; the file
and its text are never written to disk or logged. Codes: `EMPTY_UPLOAD`, `UNSUPPORTED_FILE`,
`WORD_LEGACY_OR_PROTECTED` (an old `.doc` or a password-protected Office file), `FILE_TOO_LARGE`,
`DOCX_CORRUPTED`, `DOCX_NO_TEXT`, `PDF_ENCRYPTED`, `PDF_CORRUPTED`, `PDF_TOO_MANY_PAGES`,
`PDF_NO_TEXT_LAYER`. Arabic CVs work in both layouts PDFs use: reading order
(Chrome, Google Docs) and letters stored backwards (some generators); the parser tells them apart
before reordering. Scanned CVs with no text layer are rejected, not OCR'd.

**`POST /api/skills/extract`** takes `{"text"}` of 40 to 50,000 characters and returns
`{"skills": [{"name", "category", "evidence"}], "dropped_count"}`. Codes: `TEXT_TOO_SHORT`,
`TEXT_TOO_LONG`, `SKILLS_MALFORMED`, `SKILLS_UNAVAILABLE`, `SKILLS_BUSY`, `SKILLS_QUOTA_EXCEEDED`, `RATE_LIMITED`.
Prompt: `api/app/prompts/cv_assessor.md`.

**`POST /api/requirements/extract`** takes `{"postings": [{"title", "text"}]}`: 1 to 10 postings,
each 80 to 20,000 characters, title up to 120. Each posting goes to the model on its own; code
verifies the quotes, merges aliases, counts how many postings ask for each skill (`frequency`) and
ranks by frequency, then required before preferred. Returns `{"postings_count", "requirements":
[{"name", "category", "level", "frequency", "sources": [{"posting", "level", "evidence"}]}],
"dropped_count"}`. If any posting fails, the whole request fails. Codes: `POSTINGS_EMPTY`,
`POSTINGS_TOO_MANY`, `POSTING_TOO_SHORT`, `POSTING_TOO_LONG`, `POSTING_TITLE_TOO_LONG`,
`REQUIREMENTS_MALFORMED`, `REQUIREMENTS_UNAVAILABLE`, `REQUIREMENTS_BUSY`, `REQUIREMENTS_QUOTA_EXCEEDED`, `RATE_LIMITED`.
Prompt: `api/app/prompts/requirements_extractor.md`.

**`GET /api/skills/catalog`** returns the 129 skills in `api/app/skills_catalog.py`, each with its
category and English spellings, and a map of related skills. The skills page uses it for a
LinkedIn-style picker (people pick from the list, so a hand-added skill always uses the name
postings use, in the right category) and for "Suggested for you". Demo mode matches the same
list against CV and posting text.

**`POST /api/gap`** takes `{"skills": [{"name", "category", "evidence", "verified"}],
"requirements": [...], "postings_count"}` and returns `have`, `needs_proof` and `missing` with a
summary of required and preferred skills proven. No model; the same input always gives the same
gap. Codes: `GAP_NO_REQUIREMENTS`, `GAP_INVALID`.

**When Gemini is busy:** Google answers 500 to 504 when a model is overloaded. Each call is
tried three times (waiting 1 then 2 seconds), then once more on `GEMINI_FALLBACK_MODEL` if set,
before the route answers `SKILLS_BUSY` or `REQUIREMENTS_BUSY`.

**Limits:** the two model routes allow 20 model requests per visitor address per hour
(`SKILLSYNC_RATE_LIMIT`), then answer `429 RATE_LIMITED` with a `Retry-After` header.

**Planned with Agent 4:** saving runs (`GET /api/runs/{id}`), approving, editing or rejecting the
plan, and accounts.

## Testing

```bash
cd api
python -m pytest
```

171 tests, no network and no key: demo mode stands in for the model.

- **CV cases.** `api/tests/fixtures/cases/` holds 12 fictional CVs: English, Arabic and mixed;
  printed by Chrome like browser and Google Docs exports; a Word file; two pages; a career
  changer; a CV that mentions tools the person does not have yet; a scanned and a
  password-protected PDF.
  `expected.json` says what each must and must not produce, and for some the expected gap.
  `python scripts/run_cases.py` (or `.\run.ps1 -Cases`) prints PASS or FAIL per case and writes
  `reports/`; add `--extractor gemini` to check the model on the same CVs.
- **Agent 3.** Golden input/output pairs in `api/tests/fixtures/gap/`.
- **CI.** Every push runs the tests, the web build and the Docker build.

## Deployment

One container: the `Dockerfile` builds the React app, then FastAPI serves it next to `/api`.
`render.yaml` describes a free Render web service that redeploys on every push to `main`, with
`/api/health` as its health check.

1. On Render, choose **New → Blueprint** and pick this repository.
2. Deploy. The site starts in demo mode.
3. Add `GEMINI_API_KEY` under the service's **Environment** tab to use the model.

Run the production image locally:

```bash
docker build -t skillsync .
docker run -p 8000:8000 skillsync
```

## Roadmap

- [x] CV upload and PDF text extraction, including Arabic
- [x] Agent 1: skill extraction with automatic evidence verification
- [x] Agent 2: requirements from pasted postings, verified and counted
- [x] Agent 3: gap evaluation, golden tests
- [x] Landing page and full Arabic / English site
- [x] Deployment on Render, CI, per-visitor limit
- [x] Fictional CV cases with an expectations file
- [ ] Agent 4: learning plan, approve / edit / reject
- [ ] Saved runs and accounts
- [ ] Agent 1: short skill check for skills without evidence

## Author

Ahmed Ababtain. SWE 485, Advanced Software Engineering with AI, King Saud University.

## License

Course project, not licensed for reuse yet. SkillSync uses PyMuPDF, which is licensed under the
AGPL; the source of the deployed site is this public repository.
