import { test } from "node:test";
import assert from "node:assert/strict";

import { checklist } from "./ats.ts";
import type { Resume } from "./types.ts";

const GOOD: Resume = {
  personal: { name: "Example Candidate", field: "Student", target_title: "" },
  contact: { email: "s@x.io", phone: "+966 50 000 0000", location: "Riyadh", linkedin: "https://linkedin.com/in/s", github: "" },
  summary: "Final-year student who builds APIs.",
  experience: [],
  education: [{ institution: "King Saud University", degree: "B.Sc.", major: "", end: "Jun 2027", gpa: "", achievements: [] }],
  skills: { "Programming languages": ["Python"] },
  projects: [{ name: "SkillSync", url: "", start: "Jan 2026", end: "Present", role_line: "", bullets: ["Built the API with FastAPI", "Wrote the tests"] }],
  certifications: [],
  languages: [],
  volunteering: [],
  awards: [],
};

function failing(resume: Resume): string[] {
  return checklist(resume).filter((item) => !item.ok).map((item) => item.id);
}

test("a complete CV passes every item", () => {
  assert.deepEqual(failing(GOOD), []);
  assert.deepEqual(checklist(GOOD).map((item) => item.id), ["contact", "content", "dates", "length", "verbs", "first_person", "skills", "https"]);
});

test("ats flags first person and a 201-character bullet", () => {
  const long = `Built ${"x".repeat(195)}`;
  const resume = { ...GOOD, summary: "I built APIs.", projects: [{ ...GOOD.projects[0], bullets: [long] }] };
  assert.deepEqual(failing(resume), ["length", "first_person"]);
});

test("ats flags a bullet without a verb, mixed dates, no skills and http links", () => {
  const resume = {
    ...GOOD,
    skills: {},
    contact: { ...GOOD.contact, linkedin: "http://linkedin.com/in/s" },
    projects: [{ ...GOOD.projects[0], start: "2026", bullets: ["The API with FastAPI"] }],
  };
  assert.deepEqual(failing(resume), ["dates", "verbs", "skills", "https"]);
});

test("ats flags missing contact and content", () => {
  const resume = { ...GOOD, contact: { ...GOOD.contact, phone: "" }, education: [], projects: [], experience: [] };
  assert.deepEqual(failing(resume), ["contact", "content"]);
});
