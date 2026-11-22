import type { Question } from "./types.ts";

// The nine steps of the conversation, in order. Question text and examples live in i18n.tsx
// as cvb_q_<key> and cvb_ex_<key>. The last question of a group closes one job or project.
export const STEPS = ["personal", "contact", "summary", "experience", "education", "projects", "skills", "certifications", "additional"] as const;

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
  { key: "degree", step: 4, kind: "choice", choices: ["highschool", "diploma", "bachelor", "master", "phd"] },
  { key: "grad", step: 4, kind: "date" },
  { key: "gpa", step: 4, kind: "gpa", optional: true },

  { key: "hasProject", step: 5, kind: "choice", choices: ["yes", "no"] },
  { key: "projName", step: 5, kind: "latin", group: "project" },
  { key: "projWhat", step: 5, kind: "long", group: "project" },
  { key: "projTools", step: 5, kind: "text", group: "project", optional: true },
  { key: "projRole", step: 5, kind: "text", group: "project", optional: true },
  { key: "projLink", step: 5, kind: "url", group: "project", optional: true },

  // Offered from the tools and skills named in the jobs and projects; the person keeps or adds.
  { key: "skills", step: 6, kind: "skills" },

  { key: "certs", step: 7, kind: "long", optional: true },

  { key: "langs", step: 8, kind: "text", optional: true },
  { key: "volunteering", step: 8, kind: "long", optional: true },
  { key: "awards", step: 8, kind: "long", optional: true },
];

// Short answers that go into the CV as written, so an Arabic one is translated first.
export const TRANSLATED_KEYS = ["field", "target", "location", "jobTitle", "langs", "projRole"];

// The degree as the CV writes it, by the choice the person picked.
export const DEGREE_TEXT: Record<string, string> = {
  highschool: "High School Diploma",
  diploma: "Diploma",
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  phd: "PhD",
};

// Answers the page asks a follow-up about when they are too vague to write from.
export const FOLLOW_UP_KEYS = ["jobWhat", "projWhat"];

export function indexOf(key: string): number {
  return SCRIPT.findIndex((question) => question.key === key);
}

export function groupKeys(group: "job" | "project"): string[] {
  return SCRIPT.filter((question) => question.group === group).map((question) => question.key);
}
