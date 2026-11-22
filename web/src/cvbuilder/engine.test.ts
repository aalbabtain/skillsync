import { test } from "node:test";
import assert from "node:assert/strict";

import { addAnother, answer, back, cancelEdit, current, load, replaceLines, saveItem, skip, start, toResume } from "./engine.ts";
import { indexOf, SCRIPT } from "./script.ts";
import type { State } from "./types.ts";

function say(state: State, ...texts: string[]): State {
  for (const text of texts) {
    const result = answer(state, text);
    assert.equal(result.error, undefined, `"${text}" at ${current(state)?.key}: ${result.error}`);
    state = result.state;
  }
  return state;
}

test("order follows the script", () => {
  let state = start("scratch");
  assert.equal(current(state)?.key, "name");
  state = say(state, "Sara Alharbi");
  assert.equal(current(state)?.key, "field");
  assert.deepEqual(state.log.slice(-3).map((entry) => entry.kind), ["ask", "answer", "ask"]);
});

test("skip word on an optional question skips and never stores skip", () => {
  let state = say(start("scratch"), "Sara Alharbi", "Software Engineering student");
  const result = answer(state, "skip");
  assert.equal(result.error, undefined);
  assert.equal(result.state.answers.target, undefined);
  assert.equal(result.state.skipped.target, true);
  assert.equal(current(result.state)?.key, "email");
  state = result.state;
  assert.equal(answer(state, "تخطي").error, "needed");
});

test("skip on a required question returns error needed", () => {
  const state = start("scratch");
  assert.equal(skip(state).error, "needed");
  assert.equal(current(skip(state).state)?.key, "name");
});

test("Arabic letters in name are refused with latin", () => {
  assert.equal(answer(start("scratch"), "سارة الحربي").error, "latin");
});

test("background asks for the summary", () => {
  let state = say(start("scratch"), "Sara Alharbi", "SE student", "skip", "s@x.io", "+966 50 000 0000", "Riyadh", "skip", "skip");
  const result = answer(state, "final-year student who likes APIs");
  assert.equal(result.needs, "summary");
});

test("back edits an earlier answer and resumes where the person was", () => {
  let state = say(start("scratch"), "Sara Alharbi", "SE student", "skip", "s@x.io");
  state = back(state, "field");
  assert.equal(current(state)?.key, "field");
  state = say(state, "Software Engineering");
  assert.equal(state.answers.field, "Software Engineering");
  assert.equal(current(state)?.key, "phone");
});

test("back with no key goes to the previous question", () => {
  const state = back(say(start("scratch"), "Sara Alharbi"), undefined);
  assert.equal(current(state)?.key, "name");
});

function atKey(key: string, extra: Partial<State> = {}): State {
  return { ...start("scratch"), at: indexOf(key), ...extra };
}

test("no to hasJob skips the job questions", () => {
  const state = say(atKey("hasJob"), "no");
  assert.equal(current(state)?.key, "school");
  assert.ok(state.log.some((entry) => entry.kind === "note" && entry.id === "no_job"));
});

test("a finished project waits for its bullets, then add another repeats it", () => {
  let state = say(atKey("projName"), "SkillSync", "Jan 2026 - Present", "built an API with FastAPI", "FastAPI", "Backend");
  const result = skip(state);
  assert.equal(result.needs, "project");
  state = result.state;
  assert.equal(current(state), null);
  state = saveItem(state, "project", ["Built the API with FastAPI"]);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].answers.projName, "SkillSync");
  assert.equal(state.answers.projName, undefined);
  state = addAnother(state, true);
  assert.equal(current(state)?.key, "projName");
  state = say(state, "Portfolio", "Mar 2025 - Jun 2025", "a site for my work", "skip", "skip", "https://sara.dev");
  state = addAnother(saveItem(state, "project", ["Built a personal site"]), false);
  assert.equal(state.projects.length, 2);
  assert.equal(current(state)?.key, "skills");
});

test("update mode asks only what is missing", () => {
  const state = start("update", { answers: { name: "Sara Alharbi", field: "SE student", email: "s@x.io", phone: "+966 50 000 0000", location: "Riyadh" } });
  assert.equal(current(state)?.key, "target");
  assert.equal(current(say(state, "skip"))?.key, "linkedin");
});

test("load returns null for version 0 or bad JSON", () => {
  assert.equal(load(null), null);
  assert.equal(load("{not json"), null);
  assert.equal(load(JSON.stringify({ ...start("scratch"), version: 0 })), null);
  assert.equal(load(JSON.stringify({ ...start("scratch"), log: [{ kind: "ask", key: "major" }] })), null);
  const saved = say(start("scratch"), "Sara Alharbi");
  assert.deepEqual(load(JSON.stringify(saved)), saved);
});

test("toResume uses English values, items and skill categories", () => {
  let state = { ...start("scratch"), answers: { name: "Sara Alharbi", field: "طالبة هندسة", skills: "Python, FastAPI، Teamwork", school: "King Saud University", degree: "B.Sc.", grad: "Jun 2027", langs: "Arabic, English" }, english: { field: "Software Engineering student" } };
  state = { ...state, summary: "A summary.", projects: [{ answers: { projName: "SkillSync", projTools: "FastAPI", projRole: "Backend", projLink: "https://x.dev" }, lines: ["Built it"] }] };
  const resume = toResume(state, (name) => (name === "Teamwork" ? "Soft skills" : "Programming languages"));
  assert.equal(resume.personal.field, "Software Engineering student");
  assert.deepEqual(resume.skills, { "Programming languages": ["Python", "FastAPI"], "Soft skills": ["Teamwork"] });
  assert.deepEqual(resume.projects[0], { name: "SkillSync", url: "https://x.dev", start: "", end: "", role_line: "Backend | FastAPI", bullets: ["Built it"] });
  assert.equal(resume.education[0].end, "Jun 2027");
  assert.deepEqual(resume.languages, ["Arabic", "English"]);
  assert.equal(resume.summary, "A summary.");
});

test("the script has nine steps in order", () => {
  const steps = SCRIPT.map((question) => question.step);
  assert.deepEqual([...new Set(steps)], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("an answer can be logged with other words than it stores (a follow-up detail)", () => {
  const state = say(atKey("projName"), "SkillSync", "Jan 2026 - Present");
  const result = answer(state, "built it with Python. it reads a CV", "it reads a CV");
  assert.equal(result.state.answers.projWhat, "built it with Python. it reads a CV");
  assert.deepEqual(result.state.log.at(-2), { kind: "answer", key: "projWhat", text: "it reads a CV" });
});

test("editing an earlier answer changes it in place, without asking anything twice", () => {
  let state = say(start("scratch"), "Sara Alharbi", "SE", "skip", "s@x.io");
  const before = state.log.length;
  state = back(state, "name");
  assert.equal(state.log.length, before);
  assert.equal(current(state)?.key, "name");
  state = say(state, "Sara Al-Harbi");
  assert.equal(state.log.length, before);
  assert.equal(state.log.filter((e) => e.kind === "answer" && e.key === "name").length, 1);
  assert.ok(state.log.some((e) => e.kind === "answer" && e.text === "Sara Al-Harbi"));
  assert.equal(current(state)?.key, "phone");
});

test("cancelling an edit returns to the current question unchanged", () => {
  const state = say(start("scratch"), "Sara Alharbi", "SE");
  const edited = cancelEdit(back(state, "name"));
  assert.equal(current(edited)?.key, "target");
  assert.equal(edited.answers.name, "Sara Alharbi");
  assert.equal(edited.log.length, state.log.length);
});

test("job dates are one answer, from and to", () => {
  const state = say(atKey("jobDates"), "march 2025 - present");
  assert.equal(state.answers.jobDates, "Mar 2025 – Present");
  assert.equal(answer(atKey("jobDates"), "Jun 2026 - Jan 2025").error, "range");
  const resume = toResume({ ...state, jobs: [{ answers: { company: "STC", jobTitle: "Intern", jobDates: "Mar 2025 – Present" }, lines: [] }] });
  assert.equal(resume.experience[0].start, "Mar 2025");
  assert.equal(resume.experience[0].end, "Present");
});

test("rewritten lines replace an item's lines", () => {
  let state = say(atKey("projName"), "SkillSync", "Jan 2026 - Present", "built an API", "skip", "skip");
  state = addAnother(saveItem(skip(state).state, "project", ["Built an API"]), false);
  state = replaceLines(state, "project", 0, ["Built the SkillSync API"]);
  assert.deepEqual(state.projects[0].lines, ["Built the SkillSync API"]);
});

test("no to hasProject skips the project questions", () => {
  const state = say(atKey("hasProject"), "no");
  assert.equal(current(state)?.key, "skills");
  assert.ok(state.log.some((entry) => entry.kind === "note" && entry.id === "no_project"));
});

test("projects come before skills, and the degree is a choice", () => {
  assert.ok(indexOf("projName") < indexOf("skills"));
  assert.equal(indexOf("major"), -1);
  assert.equal(answer(atKey("degree"), "B.Sc.").error, "empty");
  assert.equal(current(say(atKey("degree"), "bachelor"))?.key, "grad");
});

test("a loosely written date is stored as Mmm YYYY", () => {
  const state = say(atKey("grad"), "june 2027");
  assert.equal(state.answers.grad, "Jun 2027");
});

test("the CV says the degree in words and the field as the major", () => {
  const state = { ...start("scratch"), answers: { name: "Sara", field: "Software Engineering", school: "KSU", degree: "bachelor", grad: "Jun 2027" } };
  const school = toResume(state).education[0];
  assert.equal(school.degree, "Bachelor's degree");
  assert.equal(school.major, "Software Engineering");
});

test("a conversation saved by an earlier version of the questions is not loaded", () => {
  const older = { ...start("scratch"), version: 1 };
  assert.equal(load(JSON.stringify(older)), null);
});

test("a project has its dates, from and to", () => {
  const state = say(atKey("projDates"), "Jan 2026 - Present");
  assert.equal(state.answers.projDates, "Jan 2026 – Present");
  const resume = toResume({ ...state, projects: [{ answers: { projName: "SkillSync", projDates: "Jan 2026 – Present" }, lines: [] }] });
  assert.equal(resume.projects[0].start, "Jan 2026");
  assert.equal(resume.projects[0].end, "Present");
});

test("a name typed in small letters is written with capitals", () => {
  const resume = toResume({ ...start("scratch"), answers: { name: "omar al-qahtani" } });
  assert.equal(resume.personal.name, "Omar Al-Qahtani");
  assert.equal(toResume({ ...start("scratch"), answers: { name: "Sara AlHarbi" } }).personal.name, "Sara AlHarbi");
});

test("the major leaves out a word like student from the specialization", () => {
  const state = { ...start("scratch"), answers: { name: "Sara", field: "Software Engineering student", school: "KSU", degree: "bachelor" } };
  assert.equal(toResume(state).education[0].major, "Software Engineering");
  assert.equal(toResume(state).personal.field, "Software Engineering student");
});
