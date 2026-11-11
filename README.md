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
      models/           DB models and Pydantic schemas
    tests/
    requirements.txt
  web/                  React + Vite frontend
    src/
    package.json
  schemas/              shared JSON contracts between agents
  .env.example
  README.md
```

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Gemini API key from Google AI Studio

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
| `DATABASE_URL` | SQLite path, e.g. `sqlite:///./skillsync.db`. |
| `JWT_SECRET` | Signing key for auth tokens. |

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create a student or instructor account |
| `POST` | `/api/auth/login` | Get a JWT |
| `POST` | `/api/runs` | Upload a CV and start the pipeline |
| `GET` | `/api/runs/{id}/events` | Stream pipeline progress (SSE) |
| `GET` | `/api/runs/{id}` | Fetch the run result |
| `POST` | `/api/runs/{id}/approve` | Approve, edit, or reject the draft plan |

## Testing

```bash
cd api
pytest
```

Agent tests use recorded fixtures in `api/tests/fixtures/` so they run without a Gemini key.
The Gap Evaluator is covered by golden tests against the same input/output pairs.

## Roadmap

- [ ] Repo scaffolding, `.env.example`, CI
- [ ] CV upload and PDF text extraction
- [ ] Agent 1 — CV & Fit Assessor
- [ ] Agent 2 — Requirements Extractor (RAG over postings)
- [ ] Agent 3 — Gap Evaluator (deterministic, tested)
- [ ] Agent 4 — Plan Builder
- [ ] Human-in-the-loop approve / edit / reject
- [ ] Deploy frontend and backend

## Author

Ahmed Ababtain — SWE 485, Advanced Software Engineering with AI, King Saud University.

## License

Course project, not licensed for reuse yet.
