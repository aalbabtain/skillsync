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

Open <http://localhost:5173>, drop a PDF, press **Extract skills**. A "Demo mode" note appears
above the page when no key is configured.

Requirements: Python 3.11+ and Node.js 20+.

## Run the tests

```powershell
.\run.ps1 -Tests
```

Runs `pytest` in `api` (53 tests, no network, no key). The frontend check is
`cd web; npm run build`.

## Run every CV case

```powershell
.\run.ps1 -Cases
```

Runs every PDF in `api/tests/fixtures/cases/` through parsing, extraction and
verification, prints one line per case, and writes:

- `reports/<case>.md` — one table per CV: skill, category, the CV line that proves it.
- `reports/summary.json` — every case with counts, and the error code for failures.

The cases are `arabic_cv`, `backend_cv`, `english_cv`, `graduate_cv` and `scanned`
(a PDF with no text layer, expected to fail with `PDF_NO_TEXT_LAYER`).

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
| `api/app/main.py` | FastAPI routes: upload, extract skills, health |
| `api/app/agents/cv_skills.py` | Agent 1, extraction: model call or demo mode |
| `api/app/agents/mock_extractor.py` | Offline skill dictionary used in demo mode |
| `api/app/verification.py` | Deterministic evidence check, runs in both modes |
| `api/app/parsers/pdf.py` | PDF text extraction, including Arabic line order |
| `api/app/cases.py` | Case runner logic and report rendering |
| `api/scripts/run_cases.py` | Case runner CLI |
| `api/tests/fixtures/cases/` | The CVs used by the case runner and the tests |
| `web/src/` | React + Vite frontend |

## Rules that must not break

- The CV text is never logged and never written to disk.
- The model never decides what is verified: `api/app/verification.py` does, by matching
  each quoted evidence string against the CV text.
- The skill category label is `Programming languages` (plural) in the prompt, the backend,
  the frontend and the tests.
