# Landing page and Arabic/English site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual (Arabic RTL / English) SkillSync site with a landing page that leads into the existing flow.

**Architecture:** `web/src/i18n.tsx` holds the dictionary, a `LanguageProvider` and `useI18n()`. `Landing.tsx` and `Stepper.tsx` are new; `App.tsx` switches between landing and service views; every existing panel reads its text through `t()`.

**Tech Stack:** React + Vite + TypeScript, plain CSS. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-16-landing-bilingual-design.md`

## Global Constraints

- No hard-coded user-facing English left in components; every string comes from `t()`.
- `messages.ar` must have exactly the keys of `messages.en` (enforced by type).
- `document.documentElement` carries `lang` and `dir`; components use logical CSS properties.
- Category data label stays `Programming languages`.

## Review Focus

- English quote or skill name inside an Arabic page renders in its own direction → `dir="auto"` on user content.
- Evidence popover on a skill chip opens off-screen in RTL → logical `inset-inline-start`.
- Back/arrow glyphs pointing the wrong way in RTL → mirrored arrow class.
- Long Arabic headline overflowing at 390px → screenshot check.
- Language switch mid-flow keeps the student's progress → state lives in App, not reset on switch.

---

### Task 1: i18n core
- [ ] Create `web/src/i18n.tsx`: `type Lang = "en" | "ar"`, `messages` (en/ar), `LanguageProvider`, `useI18n(): { lang, dir, t(key, vars?), setLang, category(name), errorMessage(code, fallback) }`.
- [ ] Wrap `<App />` in `main.tsx`; add the Arabic font to `index.html`; set `lang`/`dir` on `<html>`.

### Task 2: Landing and stepper
- [ ] `Landing.tsx` per the approved mockup; `Stepper.tsx`; shared `Logo` keeps LTR wordmark.
- [ ] `App.tsx`: `view: "landing" | "service"`, logo returns to landing, language switch in header.

### Task 3: Translate the flow
- [ ] `UploadPanel`, `SkillsPanel`, `PostingsPanel`, demo note: all text through `t()`, errors via `errorMessage`, categories via `category`.
- [ ] CSS: convert directional properties to logical ones; RTL font; mirrored arrow.

### Task 4: Verify and ship
- [ ] `npm run build`, `pytest`; Playwright screenshots of every view in both languages at 1280 and 390 wide; reread all Arabic strings.
- [ ] Commit and push to `main`.
