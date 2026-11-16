# Agent 2 — Requirements Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Student pastes 1–10 job postings; the API returns the verified, normalized, counted skills they ask for, shown on the "Job postings" step.

**Architecture:** `app/agents/requirements.py` mirrors `cv_skills.py` (Gemini or demo mode, one call per posting). `app/verification.py` gains per-posting verification with `level` and a deterministic cross-posting aggregation. `POST /api/requirements/extract` wires them; `PostingsPanel.tsx` replaces the placeholder.

**Tech Stack:** FastAPI, Pydantic, google-genai, pytest; React + Vite + TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-16-requirements-extractor-design.md`

## Global Constraints

- Category label is `Programming languages` (plural) everywhere; the eight categories equal `cv_skills.CATEGORIES`.
- Posting text and CV text are never logged and never written to disk. Logs carry counts only.
- The model never decides what is verified or how often a skill appears; code does.
- Levels: exactly `required` | `preferred`; unknown → `required`.
- Limits: 1–10 postings; text 80–20,000 chars after trim; title ≤ 120 chars; ≤ 40 skills per posting.
- Error envelope `{"detail": {"code", "message"}}`; codes and statuses exactly as in the spec.
- Agent 1 output and tests are unchanged.

## Review Focus

- A skill appearing twice in one posting under aliases (`JS`, `JavaScript`) counts once for that posting → test `test_aggregate_counts_a_posting_once`.
- A posting that is whitespace-only or only a title → `POSTING_TOO_SHORT` naming the posting number → route test.
- Arabic posting with harakat/tatweel quotes → verification still matches (reuses `normalize`) → test with Arabic fixture.
- Preferred in one posting, required in another → merged level `required` → aggregation test.
- Model call fails on the second of three postings → whole request fails with that code, no partial result → route test.

---

### Task 1: Agent module with demo mode

**Files:**
- Create: `api/app/agents/requirements.py`
- Modify: `api/app/agents/mock_extractor.py` (add `extract_requirements`)
- Test: `api/tests/test_requirements_agent.py`, `api/tests/test_mock_extractor.py`

**Interfaces:**
- Produces: `requirements.extract(posting_text: str, extractor: str | None = None) -> list[dict[str, str]]` with keys `name, category, level, evidence`; `requirements.RequirementsError(code, message)`; `requirements.PROMPT_PATH` → `prompts/requirements_extractor.md`; `requirements.LEVELS = ("required", "preferred")`.
- Produces: `mock_extractor.extract_requirements(text: str) -> list[dict[str, str]]`.
- Consumes: `cv_skills.CATEGORIES`, `cv_skills.extractor_mode()`, `mock_extractor.SKILLS`.

- [ ] Tests (fake Gemini client as in `test_cv_skills_agent.py`): prompt loaded from file and mentions `"3 and 25 words"`, `"preferred"`; valid response returned cleaned; unknown category → `Other`; unknown level → `required`; >40 skills truncated to 40; malformed → `REQUIREMENTS_MALFORMED`; 429 → `REQUIREMENTS_QUOTA_EXCEEDED`; other exception → `REQUIREMENTS_UNAVAILABLE`; missing key with `gemini` mode → `REQUIREMENTS_UNAVAILABLE`; mock mode never builds a client.
- [ ] Mock tests: line `"Nice to have: Docker"` → Docker `preferred`; `"Must know Python"` → `required`; Arabic `"يفضل معرفة Docker"` → `preferred`.
- [ ] Run, see fail; implement; `cd api && .venv/bin/python -m pytest -q` passes.
- [ ] Commit `feat: add Agent 2 requirements extraction with demo mode`.

Mock level rule: `preferred` iff the normalized evidence line contains one of `preferred, nice to have, plus, bonus, advantage, يفضل, ميزة, مفضل` as whole words.

### Task 2: Verification and aggregation

**Files:**
- Modify: `api/app/verification.py`
- Test: `api/tests/test_requirements_verification.py`

**Interfaces:**
- Produces: `VerifiedRequirement(name, category, level, evidence)`; `verify_requirements(candidates, posting_text) -> tuple[list[VerifiedRequirement], int]` (dropped count); `Source(posting: int, level: str, evidence: str)`; `Requirement(name, category, level, frequency, sources: list[Source])`; `aggregate(per_posting: list[list[VerifiedRequirement]]) -> list[Requirement]`.

- [ ] Tests: unquoted candidate dropped; alias in one posting (`JS` then `JavaScript`) kept once; `test_aggregate_counts_a_posting_once`; frequency across 3 postings; preferred+required → `required`; sort by frequency desc, then required first, then name; Arabic quote with tatweel matches.
- [ ] Implement by reusing `normalize`, `canonical_name`, `_contains`; keep `verify_skills` untouched. Within one posting, if the same skill repeats, keep the first source but upgrade level to `required` if any repeat is required.
- [ ] Tests pass; commit `feat: verify and aggregate posting requirements`.

### Task 3: Route and fixtures

**Files:**
- Modify: `api/app/main.py`
- Create: `api/tests/fixtures/postings/backend_en.txt`, `arabic.txt`, `mixed_preferred.txt` (written for the project)
- Test: `api/tests/test_requirements_route.py`

**Interfaces:**
- Consumes: Tasks 1–2. Response shape exactly as in the spec (`postings_count`, `requirements[name, category, level, frequency, sources[posting, level, evidence]]`, `dropped_count`).

- [ ] Tests: three fixtures in demo mode → expected skills and frequencies; every error code/status (`POSTINGS_EMPTY` 422, `POSTINGS_TOO_MANY` 422, `POSTING_TOO_SHORT` 422 with "Posting 2" in message, `POSTING_TOO_LONG` 413, title > 120 → 422 `POSTING_TITLE_TOO_LONG`, upstream codes 502/503/429); failure on 2nd posting gives no partial result; `caplog` contains no posting text.
- [ ] Implement; full suite passes; commit `feat: add requirements extraction route`.

### Task 4: Frontend panel

**Files:**
- Create: `web/src/components/PostingsPanel.tsx`
- Modify: `web/src/api.ts` (`extractRequirements(postings: {title: string; text: string}[]): Promise<RequirementsResult>`), `web/src/App.tsx`, `web/src/index.css`

- [ ] Panel per the spec sketch: posting cards (title input, textarea, remove when >1), "Add another posting" disabled at 10, Back, "Extract requirements" (disabled while any text is empty or loading, spinner), error line like `UploadPanel`, results table with "N of M", level badge, expandable quotes (`<details>`). Results are kept in App state for Agent 3.
- [ ] Update the pipeline card detail for Agent 2 to "Pulls required skills from the postings you paste."
- [ ] `cd web && npm run build` passes; drive it in Chromium with a fixture posting and check the table renders.
- [ ] Commit `feat: paste job postings and show extracted requirements`.

### Task 5: Docs

- [ ] README: API table row, `POST /api/requirements/extract` paragraph with codes, roadmap tick for Agent 2. AGENTS.md: test count, layout rows for `requirements.py` and the prompt. Commit `docs: document Agent 2`.
