import type { Question } from "./types.ts";

// The nine steps of the conversation, in order. Question text and examples live in i18n.tsx
// as cvb_q_<key> and cvb_ex_<key>. The last question of a group closes one job or project.
export const STEPS = ["personal", "contact", "summary", "experience", "education", "skills", "projects", "certifications", "additional"] as const;

export const SCRIPT: Question[] = [
  { key: "name", step: 0, kind: "latin" },
  { key: "field", step: 0, kind: "text" },
  { key: "target", step: 0, kind: "text", optional: true },

  { key: "email", step: 1, kind: "email" },
  { key: "phone", step: 1, kind: "phone" },
  { key: "location", step: 1, kind: "text" },
  { key: "linkedin", step: 1, kind: "url", optional: true },
  { key: "github", step: 1, kind: "url", optional: true },

  { key: "background", step: 2, kind: "long", writes: "summary" },

  { key: "hasJob", step: 3, kind: "choice", choices: ["yes", "no"] },
  { key: "company", step: 3, kind: "latin", group: "job" },
  { key: "jobTitle", step: 3, kind: "text", group: "job" },
  { key: "jobStart", step: 3, kind: "date", group: "job" },
  { key: "jobEnd", step: 3, kind: "date", group: "job" },
  { key: "jobWhat", step: 3, kind: "long", group: "job" },
  { key: "tools", step: 3, kind: "text", group: "job", optional: true },

  { key: "school", step: 4, kind: "latin" },
  { key: "degree", step: 4, kind: "text" },
  { key: "major", step: 4, kind: "text", optional: true },
  { key: "grad", step: 4, kind: "date" },
  { key: "gpa", step: 4, kind: "gpa", optional: true },

  { key: "skills", step: 5, kind: "long" },

  { key: "projName", step: 6, kind: "latin", group: "project" },
  { key: "projWhat", step: 6, kind: "long", group: "project" },
  { key: "projTools", step: 6, kind: "text", group: "project", optional: true },
  { key: "projRole", step: 6, kind: "text", group: "project", optional: true },
  { key: "projLink", step: 6, kind: "url", group: "project", optional: true },

  { key: "certs", step: 7, kind: "long", optional: true },

  { key: "langs", step: 8, kind: "text", optional: true },
  { key: "volunteering", step: 8, kind: "long", optional: true },
  { key: "awards", step: 8, kind: "long", optional: true },
];

// Short answers that go into the CV as written, so an Arabic one is translated first.
export const TRANSLATED_KEYS = ["field", "target", "location", "jobTitle", "degree", "major", "langs", "projRole"];

// Answers the page asks a follow-up about when they are too vague to write from.
export const FOLLOW_UP_KEYS = ["jobWhat", "projWhat"];

export function indexOf(key: string): number {
  return SCRIPT.findIndex((question) => question.key === key);
}

export function groupKeys(group: "job" | "project"): string[] {
  return SCRIPT.filter((question) => question.group === group).map((question) => question.key);
}
