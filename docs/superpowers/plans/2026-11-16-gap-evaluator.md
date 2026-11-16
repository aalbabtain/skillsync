# Agent 3 — Gap Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic comparison of the confirmed skills with Agent 2's requirements, shown as three groups on the "The gap" step.

**Architecture:** `api/app/gap.py` (pure Python, no model) groups each requirement into `have`, `needs_proof` or `missing`; `POST /api/gap` exposes it; `GapPanel.tsx` shows it in both languages.

**Tech Stack:** FastAPI, pytest golden fixtures; React + TypeScript.

**Spec (approved in conversation, 2026-11-16):** have = a verified skill with CV evidence matches the requirement; needs_proof = only a self-reported skill matches; missing = nothing matches. Matching uses `canonical_name` + `normalize` from `verification.py`. Order inside each group: frequency desc, required before preferred, name. Summary: required proven of required total, preferred proven of preferred total, group counts. No percentage. Out of scope: the plan (Agent 4), skills no posting asked for.

## Global Constraints

- No model call; same input always yields the same output.
- No CV or posting text in logs.
- All UI strings in `web/src/i18n.tsx`, both languages; logical CSS only.
- Commits are signed (SSH signing key configured for this session) and pushed to `main`.

## Review Focus

- A skill both verified and self-reported under aliases (`JS` self-reported, `JavaScript` verified) → counts as have → golden case `verified_beats_self`.
- No confirmed skills at all → every requirement is missing → golden case `no_skills`.
- Student goes back, edits skills, returns to the gap → the gap is recomputed → GapPanel refetches on mount.
- Requirements with `frequency` larger than `postings_count` → rejected with `GAP_INVALID`.
- Empty requirements → `GAP_NO_REQUIREMENTS`.

---

### Task 1: Gap logic and golden tests
- [ ] `api/tests/fixtures/gap/{basic,self_reported,aliases,verified_beats_self,no_skills}.json`, each `{"input": {...}, "expected": {...}}`; `api/tests/test_gap.py` runs every file through `evaluate_gap`.
- [ ] `api/app/gap.py`: `evaluate_gap(skills: list[dict], requirements: list[dict]) -> dict` returning `{"summary", "have", "needs_proof", "missing"}`; each item `{name, category, level, frequency, sources}` plus `cv_evidence` for `have`.

### Task 2: Route
- [ ] `POST /api/gap` body `{"skills": [{name, category, evidence, verified}], "requirements": [...Agent 2 items], "postings_count": n}`; errors `GAP_NO_REQUIREMENTS` (422), `GAP_INVALID` (422); tests in `api/tests/test_gap_route.py`.

### Task 3: Frontend
- [ ] Keep the verified flag when skills are confirmed; `evaluateGap` in `api.ts`; PostingsPanel "Find the gap" button; `GapPanel.tsx`; stepper enables "The gap"; "Build my plan" disabled with "Coming soon".
- [ ] Build, Playwright run in both languages at desktop and phone width.

### Task 4: Docs and ship
- [ ] README API table, roadmap, AGENTS.md; signed commit pushed to `main`.
