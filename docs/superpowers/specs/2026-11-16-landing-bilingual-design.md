# Landing page and Arabic/English site: design

Date: 2026-11-16
Approved mockup: Option B, version 2 (shared as a claude.ai page during the session).

## Intent

SkillSync is going to be deployed publicly after Agent 3. A visitor should first understand the
idea, then press one button to use it. The audience is anyone in the tech job market (students,
graduates, career changers, working professionals), not only students. The site must work fully
in Arabic, right to left, with correct Arabic, and in English.

## Goals

- A landing page: logo header, hero with the headline, a short explanation, a "Start with your CV"
  button and a sample result card (two verified skills with their CV quote, one gap); a four-step
  strip; a "Who it's for" section (students and graduates, career changers, working
  professionals); a closing call to action; a footer with the logo and the Vision 2030 line.
- "Start" opens the service: a step bar (Your CV, Your skills, Job postings, The gap, Your plan)
  above the existing flow. Done steps can be revisited; The gap and Your plan show as not yet
  available until Agents 3 and 4 exist. The logo returns to the landing page.
- One language switch in the header flips the whole site: text, `dir`, `lang`, and font.
- Same colors and logo as today.

## Non-goals

- Agent 3 or 4 functionality; deployment; a translation library; more than two languages.
- Translating user content: skill names, quotes, CV text and posting text stay as written.

## Anti-goals

- Any Arabic grammar or spelling error, or any element that keeps an English direction in Arabic
  (mirrored arrows, borders, padding, text alignment, popovers).
- Mixed-direction text that renders garbled (an English quote inside an Arabic page).

## Approaches

1. **Own dictionary + React context (chosen).** One typed file with every string in `en` and
   `ar`; no dependency; TypeScript fails the build if a key is missing in one language.
2. react-i18next: worth it for many languages; extra dependency and setup for two.

## Decisions

- Arabic copy is Modern Standard Arabic, plain and short, for a public site (the mockup used Gulf
  dialect; changed to avoid informal or incorrect forms). Western digits.
- Arabic counts avoid number-agreement forms by using label-and-number phrasing
  ("المهارات المؤكدة: 5") instead of "5 مهارات".
- Error messages are translated on the client by error code; the server message is the fallback.
- Category names are translated for display only; the data label stays `Programming languages`.
- Default language: Arabic when the browser's language starts with `ar`, otherwise English; the
  choice is remembered in `localStorage` (wrapped in try/catch).
- CSS uses logical properties (`inset-inline-start`, `border-inline-start`, `text-align: start`);
  the arrow glyph is mirrored in RTL; the logo wordmark stays left to right.
- Font: IBM Plex Sans Arabic for Arabic, loaded from Google Fonts next to Inter and Manrope.
- User content gets `dir="auto"` so each quote takes its own direction.

## Verification

Screenshots of the landing page and every step, in both languages, at desktop and phone width;
no horizontal scroll, no console errors; the full flow runs in Arabic. Arabic copy is reread line
by line before commit. `npm run build` and `pytest` pass.
