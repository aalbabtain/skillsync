# CV Builder: design

Date: 2026-11-22
Feature: a standalone CV builder, reached from its own button, apart from the five-step journey

## Intent

Anyone can build a professional, ATS-friendly CV through a short conversation: one question
at a time, with examples, skips and a way back. The same builder also updates an existing CV
(upload it, answer only what is new) and, later, tailors a CV to one job posting. The CV never
says anything the person did not say: code checks every line the model writes.

## Goals

- Own entry: a "Build your CV" button in the header and on the landing, its own route
  (`#cv-builder`), no dependency on the journey's steps.
- Three ways in, one engine: **from scratch**, **update my CV** (upload, fields prefilled),
  **tailor to a posting** (second release).
- A conversation driven by code: questions, order, skips, validation and progress live in the
  page; the model only judges vague answers, writes the summary and turns answers into bullets.
- Every model-written line is grounded: each tool, number, date, organisation and link in it
  appears in the person's answers or uploaded CV, or the line is rejected.
- The CV follows the owner's reference layout (single column, centred name, ruled section
  headings, dates at the line's end) and downloads as Word; PDF through the browser's print.
- The CV is always in English, the language most ATS read. The conversation follows the site's
  language (Arabic or English), and the person may answer in either: the model writes the CV in
  English. Names (the person's, universities, companies, projects) are asked for in English
  letters, as they should appear, because a translated name cannot be checked.
- The CV builds itself while the person types: the preview shows the template from the first
  question, each answer appears in it as it is typed, and the summary and bullets stream into it
  word by word.
- Progress survives leaving and coming back, in that browser only.

## Non-goals

- Storing CVs or answers on the server, or accounts. Progress lives in the browser.
- Photos, templates with columns, skill bars or icons in the CV.
- Writing cover letters or LinkedIn text.
- Promising that a CV passes every ATS.

## Anti-goals

- A line with a tool, number, company, date or link the person never gave.
- A skill in the CV that the person did not confirm.
- Contact details (phone, email) sent to the model. They go only into the document.
- A fully model-driven chat: about 40 model calls per CV would exhaust the free per-minute
  quota with the first visitor.

## Approaches considered

1. **Scripted conversation with model help at three points (chosen).** Natural feel, about 5
   model calls per CV, testable, works in demo mode.
2. Fully model-driven chat. Most flexible, but costly in calls, hard to test, and harder to keep
   from inventing.
3. A long form. Cheapest, but the owner asked for a conversation, and forms lose people.

## Design

### Entry and modes

- Header: "Build your CV" next to "How it works". Landing hero: a second button under "Start
  with your CV".
- Welcome screen: a short note instead of a language choice (the CV comes out in English,
  answers may be in Arabic or English, names in English letters), then three cards:
  - **From scratch**: the full conversation, starting empty.
  - **Update my CV**: upload a PDF or Word CV; `/api/runs` reads it, `/api/cv/import` fills the
    resume from it (every value checked against the CV text), the conversation then asks only
    for missing sections and "what is new since this CV" (new projects, skills, certificates).
    If the person approved a learning plan in this visit, its projects are offered as new
    projects.
  - **Tailor to a posting** (second release, shown as "Coming soon" until then): upload a CV,
    paste a posting; Agent 2 extracts its requirements, code compares them with the CV and
    shows which keywords the CV already proves and where they could appear, rewrites bullets
    to use the posting's words only where the meaning is the same, reorders sections and
    skills; requirements the CV cannot prove are listed with a link to the learning plan.

### The conversation (frontend, `web/src/cvbuilder/`)

- `script.ts`: the steps and questions, in order: 1 personal (name, field, target title,
  optional), 2 contact (email, phone, city and country, LinkedIn, GitHub or portfolio,
  optional), 3 summary (background, level, interests, strengths), 4 experience (yes/no, then
  per job: company, title, dates, responsibilities, results, tools), 5 education (institution,
  degree, major, dates, GPA optional, achievements optional), 6 skills, 7 projects (name,
  description, tools, role, features or results, link optional), 8 certifications (optional),
  9 additional (languages, volunteering, awards; optional). Each question has its example,
  its validator and whether it can be skipped. Strings in `i18n.tsx`.
- `engine.ts`: a state machine over the script. One question at a time; answers go into the
  resume JSON; skip, back (edits the earlier answer and returns to where the person was) and a
  progress rail with done, current and skipped steps. Repeating groups (jobs, projects) ask
  "Add another?".
- Validation in code: email, phone (digits, +, spaces), URLs (https), dates (`MMM YYYY` or
  "Present"), GPA (number up to its scale), and English letters for names (no Arabic letters in
  the name, institution, company and project name). A failed check explains and asks again.
- Skipping: optional questions have a Skip button, and typing "skip" or "تخطي" does the same. On a
  required question it explains that the answer is needed. A typed "skip" never reaches the CV.
- Persistence: the resume JSON and the position in the script, versioned, in `localStorage`;
  "Start over" clears it. Nothing is sent to the server until a model step or the download.

### The resume JSON

```
{ "answers_language": "en" | "ar",
  "personal": { "name", "field", "target_title" },
  "contact": { "email", "phone", "location", "linkedin", "github" },
  "summary": "",
  "experience": [{ "company", "title", "start", "end", "bullets": [], "tools": [] }],
  "education": [{ "institution", "degree", "major", "end", "gpa", "achievements": [] }],
  "skills": { "<category>": [] },
  "projects": [{ "name", "url", "start", "end", "role_line", "bullets": [] }],
  "certifications": [{ "name", "issuer", "date", "url" }],
  "languages": [], "volunteering": [], "awards": [],
  "sources": { "<field path>": "the person's own words for it" } }
```

Skill categories are the catalog's (`Programming languages` plural), shown translated.

### The three model steps (backend, `api/app/agents/cv_writer.py`)

`POST /api/cv/assist` with one of:

- `follow_up`: an answer to a responsibilities, results or project question. Returns one
  short follow-up question when the answer is too vague to write a concrete bullet ("You said
  you built the dashboard. What could users do with it?"), or none.
- `bullets`: the answers for one job or project. Returns 2 to 4 action-led bullets in English,
  streamed.
- `summary`: the step 3 answers plus the confirmed skills and target title. Returns a 2 to 3
  sentence summary in English, streamed.
- `translate`: short Arabic answers that go into the CV as they are (field, degree, target title,
  city, languages). Returns their English form, checked the same way.

Answers may be in Arabic; every written line is in English. Tool names, numbers and links keep
their form across languages, so the grounding check still applies to them.

Contact details are never in these requests. Same Gemini fallback chain, minimal thinking,
demo mode (templates built from the answers), rate limit 1 per call. Prompt:
`api/app/prompts/cv_writer.md`. `POST /api/cv/import` (update mode) extracts the resume JSON
from CV text with the same rules.

### Grounding check (code, `api/app/cv_check.py`)

For every model-written line, code collects the facts it states: tool and skill names (catalog
spellings and aliases), numbers and percentages (Western and Arabic digits), dates, capitalised
names (organisations, products), and links. Each must appear in the source text: the person's
answers for that item, plus the uploaded CV text in update mode, using the same `normalize` as
verification. A line with an unsupported fact is dropped; when all bullets of an item are
dropped, the model is asked once more with the rejected facts named, then the person's own
words are offered as the bullet. The page shows which facts were checked, as in the mockup.

### ATS checklist (code)

Name, email and phone present; at least one of experience, projects or education; dates in one
format; no bullet over 2 lines (about 200 characters); each bullet starts with a verb
(English list); no first person ("I", "my"); skills not empty;
links are https. Missing items become suggestions. The page never says "passes all ATS".

### Template and export

- The reference layout: name centred, bold, large; target title under it; one contact line
  joined by "|"; section headings in bold capitals with a rule under them; each project or job
  title in bold with its link after "|", dates at the end of the same line (a right tab stop,
  not a table); an italic role and tools line; then bullets. Single column, Calibri or Arial,
  10.5 to 11 pt.
- English only, so the document is left to right. An Arabic CV is out of scope for now; if it
  comes later, phone numbers, emails and links need their own left-to-right runs, or
  "+966 50 000 0000" prints as "0000 000 50 966+".
- `POST /api/cv/docx` builds the .docx from the resume JSON with the standard library (the same
  zip and XML approach as the Word reader), no new dependency, and returns the file. Nothing is
  kept.
- PDF: the preview is the same layout in HTML with print CSS; "Download PDF" opens the print
  dialog on the CV alone.

### Frontend pages

- `CvBuilderPage.tsx`: welcome, then three columns: progress rail, the conversation (question
  and answer bubbles, input with Send, Skip and Back) and the live preview. The preview is an
  English page, left to right, on the inline end (left on the Arabic site). It updates on every
  keystroke with no server call; the text being typed is highlighted until sent, and Arabic
  text waiting for translation is marked. Written lines stream into the page, and a line the
  grounding check rejects is removed. On phones the preview sits under the conversation.
- Final screen: the preview with "Edit" and "Rewrite" per section, the ATS checklist, Word and
  PDF.

## Rules carried over

- The model never decides what is true: code checks every fact against the person's words.
- The CV text and answers are never logged or stored on the server.
- Every string in `i18n.tsx`; logical CSS properties only.

## Testing

- Engine: order, skips, back and edit, repeating groups, validation, persistence (unit tests).
- Grounding: tools, numbers (both digit sets), dates, names and links, accepted and rejected.
- Assist and import routes: demo mode, model fallback, rejection and retry, no contact data in
  the model request.
- DOCX: opens and validates, matches the template's structure.
- Language: Arabic answers produce English lines; Arabic letters in a name are refused; a typed
  "skip" skips and never reaches the CV.
- ATS checklist: each rule.

## Risks

- **Grounding is strict.** A correct paraphrase ("built" for "made") passes, but a fact said in
  a different form (a company's short name) can be rejected; the person can always edit.
- **Translation.** A translated phrase can drift in meaning; tools, numbers and names are
  checked, and the person can edit any line.
- **Free-tier quota.** About 5 calls per CV; demo mode keeps the builder usable without one.

## Release order

1. From scratch and Update my CV, with the template, Word and PDF.
2. Tailor to a posting.
