# Agent 2 — Requirements Extractor: design

Date: 2026-11-16
Step: Agent 2 of the SkillSync roadmap

## Intent

After the student confirms their verified skills (Agent 1), they paste one or more real job
postings they are interested in. Agent 2 returns the skills those postings ask for, with
normalized names, how many of the pasted postings ask for each skill, whether it is required or
preferred, and the posting line that proves it. This output is what Agent 3 (Gap Evaluator) will
compare against the student's verified skills.

## Goals

- Student pastes 1–10 postings (English, Arabic or both) on the existing "Job postings" step.
- Every returned requirement is backed by a verbatim quote from a posting, checked by code.
- Counting and ranking are done by code, never by the model.
- Works without a Gemini key (demo mode), like Agent 1.

## Non-goals

- Comparing requirements with the student's skills (Agent 3).
- Fetching or scraping postings from job sites; a built-in postings dataset.
- RAG / embeddings. With at most 10 postings each one fits in a single model call.
- Storing postings. The posting text is not logged or written to disk, same rule as the CV.

## Anti-goals

- A requirement shown without a quote from the posting.
- The same skill counted twice because it is spelled differently in the CV and the posting
  (`JS` vs `JavaScript`): Agent 2 must use the same normalization as Agent 1.

## Approaches considered

1. **Student pastes the postings** — chosen by the student/owner. Realistic, no external
   dependency, deterministic tests. Frequency is over the pasted postings only.
2. Curated postings dataset in the repo, grouped by role — stable counts, but the data has to be
   gathered and kept current.
3. Live scraping of job sites — fragile and usually against the sites' terms.

## Design

### Prompt

`api/app/prompts/requirements_extractor.md` (approved). One posting per model call. Output per
skill: `name`, `category` (the same eight categories as Agent 1, `Programming languages`
plural), `level` (`required` | `preferred`), `evidence`.

### Backend

- `api/app/agents/requirements.py` — mirrors `cv_skills.py`: `extract(posting_text)` returns
  candidates; demo mode or Gemini chosen by the same `extractor_mode()` / `SKILLSYNC_EXTRACTOR`
  setting; temperature 0, JSON schema response; unknown category → `Other`, unknown level →
  `required`; at most 40 skills per posting; same quota / outage error handling with
  `REQUIREMENTS_*` codes.
- Demo mode reuses the skill dictionary in `mock_extractor.py` over the posting text. Level is
  `preferred` when the matched line contains a preferred marker (`preferred`, `nice to have`,
  `plus`, `bonus`, `advantage`, `يفضل`, `ميزة`, `مفضل`), otherwise `required`.
- Verification reuses `verification.py` (`normalize`, `canonical_name`, whole-word evidence
  match) per posting, carrying `level` through. Agent 1's output does not change.
- Aggregation (plain code, new function, unit-tested): group verified skills across postings by
  canonical name; `frequency` = number of postings that ask for it; `level` = `required` if any
  posting requires it, else `preferred`. Sort by frequency desc, then required before preferred,
  then name.
- Route `POST /api/requirements/extract`:
  - Request: `{"postings": [{"title": "optional", "text": "..."}]}`
  - Limits: 1–10 postings; each text 80–20,000 characters after trimming; title ≤ 120 chars.
  - Response:
    ```json
    {
      "postings_count": 2,
      "requirements": [
        {
          "name": "PostgreSQL",
          "category": "Databases",
          "level": "required",
          "frequency": 2,
          "sources": [
            {"posting": 0, "level": "required", "evidence": "Strong experience with PostgreSQL"}
          ]
        }
      ],
      "dropped_count": 1
    }
    ```
  - Errors (`{"detail": {"code", "message"}}`): `POSTINGS_EMPTY` (422), `POSTINGS_TOO_MANY`
    (422), `POSTING_TOO_SHORT` (422, message names the posting number), `POSTING_TOO_LONG` (413),
    `REQUIREMENTS_MALFORMED` (502), `REQUIREMENTS_UNAVAILABLE` (503),
    `REQUIREMENTS_QUOTA_EXCEEDED` (429). If any posting's model call fails, the whole request
    fails with that error.
  - Logs counts only (postings, kept, dropped), never text.

### Frontend

Replace the "Job postings" placeholder in `web/src/App.tsx` with a `PostingsPanel`:

```
Job postings
Paste the postings you want to apply for (up to 10).
┌ Posting 1 ─────────────── [remove] ┐
│ Title (optional) [______________]  │
│ [ textarea: paste posting text   ] │
└────────────────────────────────────┘
[+ Add another posting]
[Back]                [Extract requirements]

Requirements from 2 postings · 1 dropped without proof
Skill        Category    Asked in    Level
PostgreSQL   Databases   2 of 2      Required   ▸ show quotes
Docker       Cloud&DevOps 1 of 2     Preferred  ▸ show quotes
```

Same dark theme and component style as `SkillsPanel`. Errors shown like `UploadPanel` does.
The confirmed CV skills stay in state for Agent 3; this panel does not compare them.

### Tests

- Recorded sample postings (written for the project, not copied from real ads) in
  `api/tests/fixtures/postings/`: one English backend, one Arabic, one mixed with a
  "nice to have" section.
- Unit tests: demo extractor and level markers; Gemini path with a fake client (valid, malformed,
  quota, outage, unknown category/level); verification drops unquoted skills; aggregation
  frequency, level merge, alias merge (`JS` + `JavaScript`), ordering.
- Route tests: success, every error code, no posting text in logs.
- `npm run build` passes.

### Docs

README API table and roadmap, AGENTS.md test count and layout table.

## Left to the builder

File-internal structure, exact CSS, test names, and whether aggregation lives in
`verification.py` or a new module.
