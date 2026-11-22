# SkillSync — run it here

SkillSync turns a CV into verified skills. This file is the entry point for anyone
(including a DevAI Desktop agent) who opens this repo and wants to run it.

No Gemini API key is needed. Without a key the app runs in **demo mode**: skills are
matched from a built-in list in `api/app/agents/mock_extractor.py` instead of the model.
Verification is unchanged, so the flow you see is the real one.

## Run the app

```powershell
.\run.ps1
```

The script creates `api\.venv`, installs the backend and frontend dependencies, starts the API
on <http://localhost:8000> and the web app on <http://localhost:5173>, and stops both when
you press Enter.

Open <http://localhost:5173>, press **Start with your CV**, drop a PDF or Word (.docx) CV, press **Extract skills**.
The header button switches the whole site between English and Arabic. A "Demo mode" note appears
above the page when no key is configured.

Requirements: Python 3.11+ and Node.js 20+.

## Run the tests

```powershell
.\run.ps1 -Tests
```

Runs `pytest` in `api` (298 tests, no network, no key). The frontend checks are
`cd web; npm test` (the CV builder's engine) and `cd web; npm run build`.

## Run every CV case

```powershell
.\run.ps1 -Cases
```

Runs every PDF in `api/tests/fixtures/cases/` through parsing, extraction and
verification, prints one line per case, and writes:

- `reports/<case>.md` — one table per CV: skill, category, the CV line that proves it.
- `reports/summary.json` — every case with counts, and the error code for failures.

Every case is also checked against `api/tests/fixtures/cases/expected.json`, which says what
each CV must and must not produce, and for some, the expected gap against sample postings.
Each line ends in PASS or FAIL, and the script exits with 1 if any case fails. Run it with
`--extractor gemini` to check the model's quality on the same CVs: traps such as "I want to
learn Kubernetes" are only checked against the model.

The 12 cases (all fictional) cover English, Arabic and mixed CVs, CVs printed by Chrome like
browser and Google Docs exports, a Word (.docx) CV, a two-page CV, a career changer, a CV with trap mentions, a
scanned PDF (`PDF_NO_TEXT_LAYER`) and a password-protected PDF (`PDF_ENCRYPTED`). To add a
case, drop a PDF or .docx in the folder and add its entry to `expected.json`; a test fails until both
exist.

By hand:

```powershell
cd api
.venv\Scripts\python scripts\run_cases.py --extractor mock
```

`--extractor gemini` uses the model instead, and needs a key.

## Use a Gemini key

Put the key in `api\.env` (`GEMINI_API_KEY=...`), then run `.\run.ps1 -Gemini`.
Check it first with `cd api; .venv\Scripts\python scripts\check_gemini.py`.

## Layout

| Path | What it is |
|------|------------|
| `api/app/main.py` | FastAPI routes: upload, skills, requirements, gap, health |
| `api/requirements.txt`, `api/requirements-dev.txt` | Runtime dependencies, and the test tools on top |
| `.github/workflows/ci.yml` | CI: tests, web build and image build on every push |
| `api/app/agents/cv_skills.py` | Agent 1, extraction: model call or demo mode, whole or streamed skill by skill |
| `api/app/agents/json_stream.py` | Pulls each complete skill or requirement out of the model's JSON answer while it is still arriving |
| `api/app/agents/requirements.py` | Agent 2, requirements from pasted job postings: model call or demo mode, whole or streamed |
| `api/app/agents/gemini.py` | The Gemini call: on a busy model or a used-up quota moves through `GEMINI_FALLBACK_MODEL` at once; only the last model is retried |
| `api/app/skills_catalog.py` | Every known skill with its category and spellings, and related skills: feeds the skill picker, suggestions and demo mode |
| `api/app/agents/mock_extractor.py` | Demo mode: matches the skill catalog against CV and posting text |
| `api/app/prompts/` | Agent prompts: `cv_assessor.md`, `requirements_extractor.md`, `plan_builder.md` |
| `api/app/plan.py` | Agent 4, the code half: order and phases of the plan, and the check that every topic cites a retrieved note |
| `api/app/agents/plan_builder.py` | Agent 4, the model half: one streamed call writes every card from its notes |
| `api/app/agents/retrieval.py` | Agent 4's retrieval (RAG): ranks library notes per skill by embeddings, or BM25 keywords as a fallback |
| `api/scripts/library_notes.py`, `api/app/library/sources.json` | The learning library: reviewed notes, and the file the server reads (rebuild with `scripts/build_library.py`) |
| `api/tests/fixtures/postings/` | Sample job postings written for the tests |
| `api/app/rate_limit.py` | Per-visitor limit on model requests (`SKILLSYNC_RATE_LIMIT`, default 20 an hour) |
| `api/app/expectations.py` | Checks CV cases against `api/tests/fixtures/cases/expected.json` |
| `api/app/frontend.py` | Serves the built React app from the API in production |
| `Dockerfile`, `render.yaml` | One-container production build, deployed on Render from `main` |
| `api/app/gap.py` | Agent 3, gap evaluation: plain code, no model, golden tests in `api/tests/fixtures/gap/` |
| `api/app/verification.py` | Deterministic evidence check, runs in both modes |
| `api/app/parsers/` | Reads the upload: detects PDF or Word from its bytes; `pdf.py` handles both Arabic layouts, `docx.py` reads .docx with the standard library |
| `api/app/cases.py` | Case runner logic and report rendering |
| `api/scripts/run_cases.py` | Case runner CLI |
| `api/tests/fixtures/cases/` | The CVs used by the case runner and the tests |
| `web/src/` | React + Vite frontend |
| `web/src/i18n.tsx` | Every user-facing string, in English and Arabic (right to left) |
| `web/src/components/Landing.tsx` | The landing page: five full-screen chapters around a particle object, with a motion button |
| `web/src/particles.ts`, `web/src/chapters.ts` | The landing's three.js particle field (loaded only on the landing) and the one-scroll-per-chapter glide |
| `api/app/agents/cv_writer.py` | Agent 5, the CV writer: summary and bullets in English, streamed line by line; follow-up question; translation; import |
| `api/app/cv_check.py` | Agent 5's grounding check: the tools, numbers, dates, names and links a line states, and which are not in the answers; and `polished_ok`, what a tidied field may change |
| `api/app/cv_docx.py` | The CV as a Word file in the reference layout, standard library only |
| `web/src/cvbuilder/` | The CV builder page (`#cv-builder`): script, engine, validation, ATS checklist, live preview |
| `web/src/components/PlanPanel.tsx` | The plan page: streamed cards with sourced topics, hours a week, approve / edit / reject, print |
| `web/src/analytics.ts` | Anonymous GoatCounter visit and step counts, on only when `GOATCOUNTER_CODE` is set |

## Rules that must not break

- The CV text is never logged and never written to disk.
- The model never decides what is verified: `api/app/verification.py` does, by matching
  each quoted evidence string against the CV or posting text. Counting how many postings
  ask for a skill is also plain code.
- In the plan, the model never chooses the order, the phases or a link: code does, and a
  topic is kept only when it cites a note retrieved for that skill.
- In the CV builder, a written line reaches the page only when every fact in it is in the
  person's answers (`api/app/cv_check.py`), and contact details never reach the model. The CV
  itself is always in English.
- The skill category label is `Programming languages` (plural) in the prompt, the backend,
  the frontend and the tests. The Arabic site only translates it for display.
- Every user-facing string lives in `web/src/i18n.tsx`, in both languages. Use logical CSS
  properties (`inline-start`, `inline-end`), never `left`/`right`, so Arabic stays right to left.
