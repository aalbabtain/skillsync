// The ATS checklist: plain checks on the finished resume. Failing items become suggestions;
// the page never claims a CV passes every ATS.
import type { Resume } from "./types.ts";
import { isDate } from "./validate.ts";

export type CheckId = "contact" | "content" | "dates" | "length" | "verbs" | "first_person" | "skills" | "https";

const MAX_BULLET_CHARS = 200;
// Past-tense action verbs that do not end in "ed".
const IRREGULAR = new Set(["built", "led", "wrote", "ran", "won", "taught", "made", "drove", "grew", "set", "cut", "held", "sold", "began", "found", "gave", "kept", "met", "took", "brought", "chose", "spoke", "lent", "rebuilt", "rewrote", "oversaw", "undertook"]);
const FIRST_PERSON = /\b(i|my|me|mine|myself)\b/i;

function startsWithVerb(line: string): boolean {
  const first = line.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z-]/g, "") ?? "";
  return first.endsWith("ed") || IRREGULAR.has(first);
}

export function checklist(resume: Resume): { id: CheckId; ok: boolean }[] {
  const bullets = [...resume.experience.flatMap((job) => job.bullets), ...resume.projects.flatMap((project) => project.bullets)];
  const dates = [
    ...resume.experience.flatMap((job) => [job.start, job.end]),
    ...resume.projects.flatMap((project) => [project.start, project.end]),
    ...resume.education.map((school) => school.end),
  ].filter(Boolean);
  const links = [resume.contact.linkedin, resume.contact.github, ...resume.projects.map((project) => project.url)].filter(Boolean);
  const written = [resume.summary, ...bullets].join(" ");
  const c = resume.contact;
  return [
    { id: "contact", ok: !!(resume.personal.name && c.email && c.phone) },
    { id: "content", ok: resume.experience.length + resume.projects.length + resume.education.length > 0 },
    { id: "dates", ok: dates.every(isDate) },
    { id: "length", ok: bullets.every((line) => line.length <= MAX_BULLET_CHARS) },
    { id: "verbs", ok: bullets.every(startsWithVerb) },
    { id: "first_person", ok: !FIRST_PERSON.test(written) },
    { id: "skills", ok: Object.values(resume.skills).some((items) => items.length > 0) },
    { id: "https", ok: links.every((link) => link.startsWith("https://")) },
  ];
}
