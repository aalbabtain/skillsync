# CV Builder, release 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone CV builder at `#cv-builder`, in two modes: "From scratch" and "Update my CV". It is a scripted conversation. A live English preview fills in while the person types. Lines the model writes are checked against the person's own words. The CV downloads as Word, and as PDF through the browser's print.

**Architecture:**
- **The conversation runs in the browser.** The script, the engine, validation, the preview and the ATS checklist are plain TypeScript, with no server calls.
- **The server takes part in four places only:**
  - writing the summary and bullets, streamed as NDJSON;
  - follow-up questions and translation;
  - importing a CV;
  - building the .docx.
- **Code checks every model line** in `cv_check.py` before the line leaves the server.

**Tech Stack:**
- FastAPI and Pydantic.
- Gemini, through the existing `gemini.generate` and `generate_stream`, with fallback and `MINIMAL_THINKING`.
- The Python standard library (`zipfile`, `xml`) for the .docx.
- React 19 with TypeScript.
- Node's built-in test runner (`node --test`, type stripping in Node 22) for the frontend logic.
- No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-cv-builder-design.md`

## Global Constraints

- **The CV is always in English.** Answers may be Arabic or English. Names are in English letters: the person's name, the institution, the company and the project name.
- **The model never decides what is true.** A written line is sent to the page only after `cv_check.check_line` finds every fact in it in the person's words.
- **Contact details never reach the model:** email, phone and links. Code strips them from every model request, including CV text on import.
- **CV text and answers are never logged or stored on the server.** Progress lives in `localStorage` only.
- **Every user-facing string lives in `web/src/i18n.tsx`**, in both languages. Use logical CSS properties only. The CV page itself is English and left to right.
- **The skill category label is `Programming languages`** (plural).
- **About 5 model calls per CV.** Each assist or import call takes 1 unit from the existing `_rate_limited`.
- **Demo mode** (no key, or `SKILLSYNC_EXTRACTOR=mock`) works for every model step, building its output from the answers.
- **Commits** go to `main`, authored `aalbabtain`, SSH-signed, with no co-author lines. Each task is its own commit.

## Decision made in this plan

- **Checked lines only.** The spec allowed streamed lines to appear and then be removed. Instead, the server sends each line only once it is complete and checked (`{"type":"line"}`). The page then types it out word by word. The person sees streaming, and a rejected line never shows.

## Review Focus

1. **Arabic answers with Western or Arabic digits** ("٣ مشاريع", "3 projects"). A number in a written line must match either form. This is tested in Task 1.
2. **A short company name** ("STC" for "Saudi Telecom Company"). The check rejects it, and the person's own words are offered instead, so the CV is never empty. Tested in Task 3.
3. **An email or phone inside free text** ("contact me at candidate@x.com"). It is stripped before the model call. Tested in Task 3.
4. **Reloading mid-conversation, or a stored state from an older version.** The page resumes, or starts clean on a version mismatch, and never crashes. Tested in Task 6.
5. **A model answer cut off mid-stream (the RESTART sentinel).** Lines already sent are not sent twice. Tested in Task 2.

---

### Task 1: Grounding check

**Files:**
- Create: `api/app/cv_check.py`
- Test: `api/tests/test_cv_check.py`

**Interfaces:**
- Consumes:
  - `verification.normalize(text) -> str`
  - `skills_catalog.CATALOG`, a list of `(name, category, aliases)`.
- Produces:
  - `facts(line: str) -> list[str]`: the facts a line states, in its own spelling. These are:
    - catalog skill names and aliases;
    - numbers and percentages;
    - years and `MMM YYYY` dates;
    - capitalised words that are not the first word and are not on the `COMMON_WORDS` list;
    - links.
  - `unsupported(line: str, source: str) -> list[str]`: the facts that do not appear in `source`.
  - `check_line(line: str, source: str) -> bool`: true when `unsupported` is empty.

- [ ] **Step 1: Write the failing tests**

```python
from app.cv_check import check_line, facts, unsupported

SOURCE = "بنيت لوحة بـ React و FastAPI، استخدمها ٣٠٠ طالب في King Saud University عام 2025"

def test_tools_numbers_names_found():
    assert check_line("Built a dashboard with React and FastAPI used by 300 students at King Saud University in 2025", SOURCE)

def test_arabic_digits_match_western():
    assert unsupported("Served 300 students", SOURCE) == []

def test_invented_tool_rejected():
    assert unsupported("Built a dashboard with React and Docker", SOURCE) == ["Docker"]

def test_invented_number_rejected():
    assert unsupported("Improved load time by 40%", SOURCE) == ["40%"]

def test_invented_organisation_rejected():
    assert unsupported("Interned at Aramco", SOURCE) == ["Aramco"]

def test_sentence_start_and_common_words_are_not_facts():
    assert facts("Developed the API") == []

def test_link_must_appear():
    assert unsupported("Code at https://github.com/x/y", SOURCE) == ["https://github.com/x/y"]
```

- [ ] **Step 2: Run them and confirm they fail.** Run `cd api && .venv/bin/python -m pytest tests/test_cv_check.py -q`. Expected: ImportError.

- [ ] **Step 3: Implement `facts`, `unsupported` and `check_line`.**
  - Before comparing, map Arabic-Indic digits (`٠`–`٩`) to Western digits in both strings.
  - Match against `normalize(source)` with word boundaries, as `verification._contains` does.
  - A skill alias found in the source supports the skill's canonical name, and the other way round.
  - `COMMON_WORDS` holds the action verbs and words that are often capitalised: API, CV, UI, the months, and the verbs the prompt allows. Keep it in the same file.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the whole suite: `.venv/bin/python -m pytest -q`.

- [ ] **Step 5: Commit.** Message: "Add the CV grounding check".

### Task 2: CV writer agent (model and demo)

**Files:**
- Create: `api/app/agents/cv_writer.py`
- Create: `api/app/prompts/cv_writer.md`
- Test: `api/tests/test_cv_writer.py`

**Interfaces:**
- Consumes:
  - `gemini.generate`, `gemini.generate_stream`, `gemini.RESTART`, `gemini.MINIMAL_THINKING`, `gemini.models_to_try`;
  - `ObjectScanner` from `json_stream`;
  - `settings`.
- Produces:
  - `strip_contact(text: str) -> str`: removes emails, phone numbers (7 or more digits, with `+` and spaces) and URLs.
  - `write_lines(task: Literal["summary","bullets"], answers: dict[str, str], extractor: str | None = None) -> Iterator[str]`: yields each complete English line.
    - Model schema: `{"lines": [{"text": str}]}`, read with `ObjectScanner`.
    - On `RESTART`, reset and skip the lines already yielded, compared by text.
  - `follow_up(answer: str, extractor=None) -> str | None`: one English question, or `None`.
    - Demo mode always returns `None`. The site then asks its own fixed follow-up for short answers (Task 8).
  - `translate(items: dict[str, str], extractor=None) -> dict[str, str]`: the English form of each short value.
    - Values without Arabic letters pass through untouched.
    - Demo mode returns the value unchanged.
  - `CvWriterError(code, message)`, with codes `CV_BUSY`, `CV_QUOTA` and `CV_UNAVAILABLE`, mapped as in `requirements._upstream_failure`.
- Prompt rules, in `cv_writer.md`:
  - Write in English, whatever the language of the answers.
  - Start each bullet with a past-tense action verb, at most 200 characters.
  - No first person.
  - Use only the tools, numbers, names and dates given.
  - 2 to 4 bullets; a 2 to 3 sentence summary.
  - If `rejected` facts are given, do not use them.
- Demo `summary`: `"{field}. {background}."` with the first letter capitalised, plus `" Seeking a {target} role."` when there is a target.
- Demo `bullets`: the answer split on `.`, `،` or `;`, keeping parts over 3 characters, capitalised, at most 3.

- [ ] **Step 1: Write the failing tests.** Use a fake client, as in `test_gemini_retry.py`, whose `generate_content_stream` yields chunks.
  - `test_demo_summary_from_answers`
  - `test_demo_bullets_split`
  - `test_model_lines_streamed_one_by_one`
  - `test_restart_does_not_repeat_lines`: the first model yields one line and then raises 503; the second yields the same line and a new one. Expect 2 lines in total.
  - `test_strip_contact_removes_email_phone_url`
  - `test_model_request_has_no_contact`: an answer containing `candidate@example.com` and `+966 50 000 0000`; assert that neither appears in the `contents` the fake client received.
  - `test_translate_passes_latin_through`

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** Follow `requirements.stream` for the model call shape. Settings: temperature 0.3, `response_mime_type="application/json"`, and a Pydantic schema.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full suite.

- [ ] **Step 5: Commit.** Message: "Add the CV writer agent".

### Task 3: Assist routes

**Files:**
- Modify: `api/app/main.py`, adding routes before `register_frontend`.
- Test: `api/tests/test_cv_routes.py`

**Interfaces:**
- Consumes:
  - `cv_writer.write_lines`, `follow_up`, `translate`, `strip_contact`;
  - `cv_check.unsupported`;
  - `_rate_limited`, `_line`, `_error`.
- Produces:
  - `POST /api/cv/write/stream`
    - Body: `{"task": "summary"|"bullets", "answers": {str: str ≤ 1500 chars, ≤ 20 keys}}`.
    - NDJSON lines:
      - `{"type":"line","text","facts":[...]}`
      - `{"type":"rejected","count"}`
      - `{"type":"fallback","text"}`
      - `{"type":"done"}`
      - `{"type":"error","code","message"}`
    - The source for the check is all answer values joined, after `strip_contact`.
    - If every line is rejected, ask the model once more with `answers["rejected"]` set to the unsupported facts.
    - If those lines are rejected too, send `fallback` with the person's own words (the longest answer), trimmed to 200 characters.
  - `POST /api/cv/follow-up`
    - Body: `{"answer": str ≤ 1500}`.
    - Returns `{"question": str | null}`.
  - `POST /api/cv/translate`
    - Body: `{"items": {str: str ≤ 200, ≤ 10 keys}}`.
    - Returns `{"items": {...}}`.
    - Only values that keep every digit and Latin word of the original are accepted; any other value falls back to the original.
  - Each route takes 1 rate-limit unit. Malformed bodies get 422, as other routes do.

- [ ] **Step 1: Write the failing tests.** Use `TestClient` with monkeypatched `cv_writer` functions.
  - `test_write_stream_demo_mode`: lines arrive, then `done`.
  - `test_unsupported_line_is_not_sent`
  - `test_all_rejected_retries_once_then_falls_back`: the fake is called twice, and the second call includes `rejected`.
  - `test_short_company_name_falls_back_to_own_words`: answers say "Saudi Telecom Company", and the model writes "Interned at STC". Expect `fallback`.
  - `test_translate_keeps_original_when_digits_lost`
  - `test_rate_limited_returns_429`

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement the three routes.** Use the same response headers as `/api/plan/stream`.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full suite.

- [ ] **Step 5: Commit.** Message: "Add the CV writing routes".

### Task 4: Import for "Update my CV"

**Files:**
- Modify: `api/app/agents/cv_writer.py`, adding `import_resume`.
- Modify: `api/app/main.py`, adding `POST /api/cv/import`.
- Test: `api/tests/test_cv_import.py`, which uses `api/tests/fixtures/cases/backend_cv.pdf` through `extract_document`.

**Interfaces:**
- Produces:
  - `contact_from(text: str) -> dict` with keys `email`, `phone`, `linkedin` and `github`, found by regex in code.
  - `import_resume(cv_text: str, extractor=None) -> dict` with keys `name`, `field`, `school`, `degree`, `grad`, `gpa`, `skills: list[str]`, `projects: list[{"name", "lines": list[str]}]`, `certs: list[str]` and `langs: list[str]`.
    - The model sees `strip_contact(cv_text)` only.
    - Every string value is kept only when `normalize(value)` appears in `normalize(cv_text)`. Project lines go through `check_line` instead.
    - Demo mode: the name is the first non-empty line; skills come from `mock_extractor` matching; the other keys are left empty.
  - `POST /api/cv/import`
    - Body: `{"text": str ≤ 60000}`. This is the `text` that `/api/runs` already returns.
    - Returns `{"resume": {...}, "contact": {...}}`.
    - Takes 1 rate-limit unit.

- [ ] **Step 1: Write the failing tests.**
  - `test_contact_found_by_code`
  - `test_model_never_sees_contact`
  - `test_invented_value_dropped`: the fake model returns `school: "MIT"`, which is not in the CV. Expect `""`.
  - `test_demo_import_backend_cv`: the name and at least 3 skills.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit.** Message: "Add CV import for update mode".

### Task 5: Word document

**Files:**
- Create: `api/app/cv_docx.py`
- Modify: `api/app/main.py`, adding `POST /api/cv/docx`.
- Test: `api/tests/test_cv_docx.py`

**Interfaces:**
- Produces:
  - Pydantic `Resume`, the spec's resume JSON minus `sources`, with English strings and length limits matching the assist routes.
  - `build_docx(resume: Resume) -> bytes`.
  - `POST /api/cv/docx` returns `application/vnd.openxmlformats-officedocument.wordprocessingml.document` with `Content-Disposition: attachment; filename="<Name>-CV.docx"`, where the name is ASCII with spaces turned into `-`. Nothing is logged except the size.
- Layout, from the spec, with exact values:
  - Calibri, 11 pt body.
  - Name: 18 pt, bold, centred.
  - Target title: 11 pt, bold, centred.
  - Contact: one centred line joined by `" | "`.
  - Headings: bold capitals with a bottom border (`w:pBdr/w:bottom w:val="single" w:sz="6"`).
  - Title rows: bold title, then `" | "` and the link when there is one, a tab, then dates, with a right tab stop at the text width (`w:tab w:val="right" w:pos="10466"` for A4 with 0.7 inch margins).
  - Role and tools line in italics.
  - Bullets are a `w:numPr` list defined in `numbering.xml`.
  - Margins of 0.7 inch.

- [ ] **Step 1: Write the failing tests.**
  - `test_docx_opens_with_our_reader`: `parsers.docx.extract(build_docx(sample)).text` contains the name, every heading and every bullet.
  - `test_heading_has_bottom_border`
  - `test_dates_use_right_tab_stop`
  - `test_route_returns_attachment`
  - `test_empty_sections_left_out`

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement with `zipfile` and string templates escaped with `xml.sax.saxutils.escape`.** The package holds `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`, `word/numbering.xml` and `word/_rels/document.xml.rels`.

- [ ] **Step 4: Run the tests and confirm they pass.** Then open one sample with the docx skill's validator (`anthropic-skills:docx`) and confirm it reports no errors.

- [ ] **Step 5: Commit.** Message: "Build the CV as a Word document".

### Task 6: Conversation engine (frontend logic)

**Files:**
- Create: `web/src/cvbuilder/types.ts`, `script.ts`, `engine.ts`, `validate.ts`, `ats.ts`
- Test: `web/src/cvbuilder/engine.test.ts`, `validate.test.ts`, `ats.test.ts`
- Modify:
  - `web/tsconfig.json`: add `"allowImportingTsExtensions": true`. Imports inside `cvbuilder/` use `.ts` extensions so `node --test` runs them.
  - `web/package.json`: add `"test": "node --test src/cvbuilder/"`.
  - `.github/workflows/ci.yml`: add `- run: npm test` to the web job.

**Interfaces:**
- Produces:
  - In `types.ts`:
    - `QuestionKind = "text" | "latin" | "long" | "email" | "phone" | "url" | "date" | "gpa" | "choice"`.
    - `Question = { key: string; step: number; kind: QuestionKind; optional?: boolean; writes?: "summary" | "bullets"; repeat?: "job" | "project"; choices?: string[] }`.
    - `State = { version: 1; mode: "scratch" | "update"; at: number; answers: Record<string, string>; skipped: Record<string, true>; resumeAt: number | null; summary: string; jobs: Item[]; projects: Item[]; log: LogEntry[] }`.
    - `Item = { answers: Record<string, string>; lines: string[] }`.
  - In `script.ts`: `SCRIPT: Question[]`, holding the spec's 9 steps in order. Its keys:
    - name, field, target;
    - email, phone, location, linkedin, github;
    - background;
    - hasJob, then company, jobTitle, jobStart, jobEnd, jobWhat, tools (repeat job);
    - school, degree, major, grad, gpa;
    - skills;
    - projName, projWhat, projTools, projRole, projLink (repeat project);
    - certs;
    - langs, volunteering, awards.
  - In `validate.ts`: `validate(kind: QuestionKind, text: string): "" | "empty" | "latin" | "email" | "phone" | "url" | "date" | "gpa"`. A GPA is a number with an optional scale, such as `4.6/5`, and is never above its scale, and `isSkipWord(text: string): boolean`, which matches `skip`, `تخطي`, `تخطى`, `تخط` and `-`.
  - In `engine.ts`:
    - `start(mode, imported?) -> State`;
    - `answer(state, text) -> { state; error?: string; needs?: "summary" | "bullets" }`;
    - `skip(state) -> { state; error?: "needed" }`;
    - `back(state, key?) -> State`;
    - `addAnother(state, yes: boolean) -> State`;
    - `load(raw: string | null) -> State | null`, which returns null on bad JSON or the wrong version;
    - `toResume(state) -> Resume`.
  - In `ats.ts`: `checklist(resume) -> { id: string; ok: boolean }[]`. Its ids, from the spec:
    - `contact`, `content`, `dates`, `length` (bullets of 200 characters or fewer), `verbs`, `first_person`, `skills`, `https`.

- [ ] **Step 1: Write the failing tests** (`node:test` with `node:assert/strict`).
  - `order follows the script`.
  - `skip word on an optional question skips and never stores "skip"`.
  - `skip on a required question returns error needed`.
  - `Arabic letters in name are refused with latin`.
  - `back edits an earlier answer and resumes where the person was`.
  - `"no" to hasJob skips the job questions`.
  - `add another project repeats projName…projLink`.
  - `load returns null for version 0 or bad JSON`.
  - `ats flags "I built" and a 201-character bullet`.
  - `date accepts Jun 2027 and Present, refuses next summer`.
  - `gpa accepts 4.6/5 and 3.2, refuses 6/5`.

- [ ] **Step 2: Run `cd web && npm test` and confirm the tests fail.**

- [ ] **Step 3: Implement the five files.** Keep them free of React and the DOM.

- [ ] **Step 4: Run `npm test` and `npm run build`, and confirm both pass.**

- [ ] **Step 5: Commit.** Message: "Add the CV builder conversation engine".

### Task 7: Preview, print and API client

**Files:**
- Create: `web/src/cvbuilder/CvPreview.tsx`
- Modify: `web/src/api.ts`, `web/src/index.css`

**Interfaces:**
- Consumes: `Resume` and `State` from Task 6, and `readJsonLines` from `api.ts`.
- Produces:
  - `CvPreview({ resume, typing?: { key: string; text: string }, writing?: { target: "summary" | { project: number } | { job: number }; text: string } })`.
    - It renders the spec's layout as an English page (`dir="ltr" lang="en"`).
    - Placeholders: `[Your name]` and `[Email | Phone | City]`.
    - Text being typed sits in `<span className="cv-live">`.
    - Arabic text waiting for translation sits in `<span className="cv-tr">`.
    - Written text being typed out sits in `.cv-fresh`.
  - In `api.ts`:
    - `streamCvLines(task, answers, onLine) -> Promise<{ fallback?: string }>`;
    - `cvFollowUp(answer) -> Promise<string | null>`;
    - `cvTranslate(items) -> Promise<Record<string, string>>`;
    - `cvImport(text) -> Promise<{ resume; contact }>`;
    - `cvDocx(resume) -> Promise<Blob>`.
  - In CSS:
    - `.cv-paper`, white with ink colours, mirroring the mockup;
    - `@media print`, which hides everything except `.cv-paper`, prints A4 with 0.7 inch margins, and uses black text.

- [ ] **Step 1: Build the components and API functions.**

- [ ] **Step 2: Run `npm run build` and confirm it passes.** The page is checked visually in Task 8.

- [ ] **Step 3: Commit.** Message: "Add the CV preview and builder API client".

### Task 8: The builder page, entry buttons and strings

**Files:**
- Create: `web/src/cvbuilder/CvBuilderPage.tsx`
- Modify: `web/src/App.tsx`, `web/src/components/Landing.tsx`, `web/src/i18n.tsx`, `web/src/index.css`, `web/src/analytics.ts`

**Interfaces:**
- Consumes: everything from Tasks 6 and 7.
- Behaviour, as in the approved mockup at `https://claude.ai/artifact/LW4A5Va3ja27VsBjG2wv2L`:
  - **Route and entry:**
    - The `#cv-builder` route is a third `view` in `App.tsx`, next to `landing` and `service`.
    - The header has a "Build your CV" button (`nav_build`) on every view.
    - The landing hero has a second button under "Start with your CV".
  - **Welcome screen:**
    - It shows the English-CV note (`cvb_english_note`).
    - Three mode cards; Tailor is disabled with "Coming soon".
    - Update mode uploads through `/api/runs` and then calls `cvImport`.
    - Approved plan projects from this visit, if any are passed from `App`, are offered as extra projects.
  - **The builder:**
    - Three columns: progress rail, chat, preview. The preview sits at the inline end.
    - On phones it is one column, with the preview under the chat.
    - The preview updates on every keystroke.
  - **Model steps:**
    - A `writes` answer calls `streamCvLines`, and each line types into the preview at 55 ms a word. With reduced motion the line appears at once.
    - A "Checked against your answers" chip row shows each line's `facts`.
    - A `fallback` shows the person's words with an Edit button.
  - **Follow-up:**
    - For `jobWhat` and `projWhat` answers, call `cvFollowUp` once per item.
    - In demo mode, or when the call returns null and the answer has fewer than 8 words, ask the fixed follow-up string `cvb_follow_up`.
  - **Translation:** Arabic values of field, target, location, degree, major and langs are sent in one `cvTranslate` call before the summary, and one at the end.
  - **Final screen:**
    - Each section has an Edit button, and summary and bullets also have Rewrite.
    - The ATS checklist uses the `cvb_ats_*` strings.
    - Word calls `cvDocx` and downloads the file; PDF calls `window.print()`.
  - **Persistence:**
    - The state saves to `localStorage["skillsync-cv"]` after every change, in try/catch.
    - "Start over" clears it.
  - **Analytics:** `track("cv-builder")` on open and `track("cv-download")` on Word or PDF.
- Strings:
  - Every string from the mockup goes into `i18n.tsx` under `cvb_*` keys, in both languages.
  - The question texts are `cvb_q_<key>` and their examples `cvb_ex_<key>`.
  - The optional hint reads "Optional: press Skip, or type skip." and «اختياري: اضغط «تخطَّ» أو اكتب: تخطي».

- [ ] **Step 1: Build the page and wire the route, buttons and strings.**

- [ ] **Step 2: Run `npm test && npm run build`.** Expected: both pass.

- [ ] **Step 3: Run the Playwright check against the built site served by the API in demo mode** (`SKILLSYNC_EXTRACTOR=mock SKILLSYNC_STATIC_DIR=../web/dist`), in Arabic and English. It passes when:
  - the name typed shows in `.cv-paper` before Send;
  - an Arabic name is refused;
  - typing `skip` on the target question skips it;
  - the summary appears in English;
  - "no" to experience skips it;
  - a project's lines appear;
  - the checklist renders;
  - the Word download is a .docx over 2 KB;
  - after a reload, the conversation resumes at the same question;
  - on an iPhone 13 there is no horizontal scroll;
  - the console shows no errors.

- [ ] **Step 4: Run the antislop Delivery Gate** on the page (`anthropic-skills:antislop` with ui, copywriting and layoutmobile) and fix what it flags.

- [ ] **Step 5: Commit.** Message: "Add the CV builder page".

### Task 9: Docs and live check

**Files:**
- Modify: `README.md` and `AGENTS.md`, covering:
  - the new layout rows: `cv_check.py`, `cv_writer.py`, `cv_docx.py`, `web/src/cvbuilder/`;
  - the new test count;
  - the frontend test command;
  - a rule: "In the CV builder, a written line reaches the page only when every fact in it is in the person's answers, and contact details never reach the model."

- [ ] **Step 1: Update both files.** Run `cd api && .venv/bin/python -m pytest -q` and use the count it prints.

- [ ] **Step 2: Commit and push to `main`.** Then confirm CI is green (tests, web build with `npm test`, image).

- [ ] **Step 3: After the Render deploy,** build one CV on the live site with the Gemini key. Read the Render logs for model timings and for any `retry` or `fallback` from the writer, and report them to the owner.
