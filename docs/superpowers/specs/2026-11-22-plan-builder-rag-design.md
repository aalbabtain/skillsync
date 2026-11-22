# Agent 4: Plan Builder with retrieval (RAG): design

Date: 2026-11-22
Step: Agent 4 of the SkillSync roadmap

## Intent

After the gap (Agent 3), the student gets a learning plan: which skills to learn first, what to
study for each one, and a small project that will prove it on their CV. The plan's topics are
not written from the model's memory. Each topic comes from a curated library of learning
sources, retrieved for that skill and that student, and every topic shows the source it came
from. The student approves, edits or rejects each skill before the plan is final.

## Goals

- A plan for every skill in `missing` and `needs_proof`, in an order and phases set by code.
- Every topic carries a source from the library; code drops any topic whose source was not
  retrieved for that skill.
- Retrieval is real: the query uses the skill, the student's related skills and the postings'
  own lines, so two students missing Docker can get different topics.
- Streams card by card, like Agents 1 and 2.
- Approve, edit (weeks, topics) or reject per skill; one button approves the whole plan.
- Works without a Gemini key (demo mode) and without the embedding service (keyword fallback).
- Arabic and English, right to left, every string in `i18n.tsx`.

## Non-goals

- Saving plans or accounts. The approved plan lives in the page; printing or PDF comes from
  the browser.
- Paid courses, affiliate links, course recommendations. Only official documentation and open
  learning material, by link.
- A vector database service. The library is small enough for a file in the repository.
- Retrieval for Agents 1 and 2. Their inputs (one CV, one posting) fit in a single call.
- Writing CV lines (that is the later CV-builder agent; the plan's projects feed it).

## Anti-goals

- A topic with no source, or with a source that was not retrieved for that skill.
- A link the model wrote. Links come only from the library.
- Copying documentation text into the repository. Library entries are short notes in our own
  words that point to the official page.
- Market numbers, salaries or promises ("job ready") anywhere in the plan.

## Approaches considered

1. **Curated library + Gemini embeddings + an index file in the repo (chosen).** Real
   semantic retrieval, no extra service, free on Render, vectors built once by a script.
2. Keyword retrieval only (BM25). Simple and deterministic, but it misses meaning ("ship the
   API in a container" does not match "Dockerfile"). Kept as the fallback and for demo mode.
3. Live web search at plan time. Unvetted pages, unstable results, blocked by many sites.
4. A hosted vector database (Pinecone, pgvector). Adds a service and a key for about 250
   short entries; no benefit at this size.

## Design

### The pipeline

```
gap (Agent 3) ──► 1. order and phases (code)
                  2. retrieve sources per skill (embeddings, keyword fallback)
                  3. write the cards (Gemini, one streamed call, only from the sources)
                  4. verify every topic's source (code)
                  5. stream card by card ──► approve / edit / reject (student)
```

### 1. Order and phases (code, `api/app/plan.py`)

Input: the gap's `missing` and `needs_proof` items (name, category, level, frequency, posting
evidence lines) and the student's proven skills.

- Priority, highest first: required before preferred; then more postings asking; then skills
  related to a proven skill (from `RELATED` in `skills_catalog.py`); then catalog order.
- `builds_on`: the first proven skill related to it, or none.
- Phases: **Quick wins** = required, asked in at least half the postings, and has `builds_on`.
  **Core** = the other required skills. **Extras** = preferred. **Prove what you know** =
  every `needs_proof` skill, last.
- At most 12 skills in a plan (the 12 highest); the rest are listed as "later" without cards.
- Golden tests in `api/tests/fixtures/plan/`, like the gap's.

### 2. The library (`api/app/library/`)

- `sources.json`: one entry per source note.
  `{"id": "docker-01", "skill": "Docker", "title": "Writing a Dockerfile",
  "note": "Two or three sentences in our own words on what this covers.",
  "url": "https://docs.docker.com/...", "publisher": "Docker Docs", "lang": "en"}`.
  Notes are English; the plan is written in the student's language from them.
- First release covers the skills postings ask for most (about 30 from the catalog), 5 to 10
  notes each, about 250 notes. Every skill in the catalog without notes falls back to its
  official documentation home page and a plan without sources is never shown: that skill's
  card says the library does not cover it yet.
- The vectors (Gemini `gemini-embedding-001`, 768 dimensions) are built by the server the first
  time a plan needs them, in batches of up to 100 notes, and kept in memory until it restarts.
  No vector file to rebuild by hand when a note changes; a restart picks the change up. Without
  a key, or if that call fails, retrieval uses keywords.
- Tests: every note has an `https` URL, a skill in `CATALOG`, a title and a note under 400
  characters; ids are unique.
- A weekly CI job checks that every URL still answers (GitHub Actions can reach the sites this
  environment cannot).

### 3. Retrieval (`api/app/agents/retrieval.py`)

- Query per skill: the skill name, `builds_on`, the student's related proven skills, and up to
  three posting lines that asked for it. Example: "Docker. Builds on FastAPI. Asked for:
  'containerized deployment with Docker', 'Docker and CI pipelines'."
- All queries are embedded in one batch call. Similarity is cosine against the notes of that
  skill and of skills listed as related to it; top 6 notes are kept.
- No key, demo mode, or the embedding call fails or runs out of quota: BM25 over the same
  notes, logged as `retrieval fell back to keywords`. The plan still works.
- Pure Python (about 250 × 768 multiplications per query), no numpy.

### 4. Writing the cards (Gemini, `api/app/agents/plan_builder.py`)

- One streamed call for all skills (two model calls per plan in total: embeddings and this),
  so the per-minute limits are not hit. Same fallback chain, minimal thinking, demo mode.
- Prompt: `api/app/prompts/plan_builder.md`, the approved draft plus: each skill arrives with
  its retrieved notes as `{"source_id", "title", "note"}`; each topic in the answer is
  `{"source_id", "text"}`, and its `text` may only restate what that note covers.
- Output per skill: `id`, `topics` (3 to 5, `[]` for prove), `project_title`,
  `project_summary`, `weeks`.

### 5. Verification (code, `api/app/plan.py`)

- A topic is kept only when its `source_id` is one of the notes retrieved for that skill.
- Topic text: at most 80 characters, URLs removed, duplicates by source removed.
- Fewer than 2 topics left for a learn skill: the card uses the titles of its top 3 retrieved
  notes instead, marked as taken from the sources.
- `weeks` clamped to 1 to 8 (1 to 2 for prove); a missing project gets a plain template.
- The student-facing link for a topic is the library URL of its source, never model text.

### API

- `POST /api/plan/stream` takes `{"language", "gap": {missing, needs_proof}, "skills",
  "postings_count"}` (the same shapes Agent 3 returns and takes).
- Lines: `{"type": "skill", ...card}` per card in plan order, then `{"type": "done",
  "later": [...], "retrieval": "embeddings" | "keywords"}`, or `{"type": "error", "code",
  "message"}`.
- Card: `id`, `name`, `phase`, `level`, `frequency`, `builds_on`, `weeks`, `topics:
  [{text, source: {title, publisher, url}}]`, `project: {title, summary}`, `docs_url`.
- Codes: `PLAN_EMPTY` (no gap), `PLAN_INVALID`, `PLAN_BUSY`, `PLAN_QUOTA_EXCEEDED`,
  `PLAN_UNAVAILABLE`, `PLAN_MALFORMED`, `RATE_LIMITED` (counts 1).

### Frontend (`web/src/components/PlanPanel.tsx`)

As in the approved mockup: summary with hours a week (5, 10, 20), a timeline with phases,
cards that stream in, approve / edit / reject per card, one "Approve the plan" button, and the
states for building, error and no gap. New: under each topic, its source (publisher and title,
linked); a "How this plan was built" note: order by code from your gap, topics from the
library, and which retrieval ran. The stepper's fifth step loses "Coming soon". Week ranges
are computed in the page from `weeks` and the hours chosen. Approving enables Print.

### Evaluation

- `api/tests/fixtures/plan/`: golden gaps with the expected order and phases.
- Retrieval tests with fixed fake vectors: the right notes rank first; keyword fallback
  returns the same skill's notes.
- A topic citing a note from another skill, or no note, is dropped (test).
- `run_cases.py --plan`: builds a plan for every CV case with an expected gap and checks that
  every topic has a source and every source belongs to its skill.

## Rules carried over

- The CV and posting text are never logged or stored; the retrieval query holds posting lines
  in memory only. Logs carry counts, model names and timings.
- The model never decides what is verified, the order, the phase or a link: code does.

## Risks

- **Library quality decides plan quality.** The notes are drafted with the model's help and
  must be read by a person before release; the first release is reviewed skill by skill.
- **Links rot.** The weekly link check opens an issue for a dead URL.
- **Embedding quota.** One batch call per plan; on failure the keyword fallback runs.

## Left to the builder

- Exact BM25 parameters and the similarity cut-off below which a note is not kept.
- Whether "later" skills get a one-line mention or nothing.
