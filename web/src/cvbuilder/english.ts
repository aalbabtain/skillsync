// The finished CV is English only: every text still in Arabic is found here, sent once for
// translation, and replaced wherever it appears.
import type { Resume } from "./types.ts";
import { hasArabic } from "./validate.ts";

function walk(value: unknown, visit: (text: string) => string): unknown {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, visit));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, visit)]));
  }
  return value;
}

export function arabicTexts(resume: Resume): string[] {
  const found = new Set<string>();
  walk(resume, (text) => {
    if (hasArabic(text)) found.add(text);
    return text;
  });
  return [...found];
}

export function applyEnglish(resume: Resume, english: Record<string, string>): Resume {
  return walk(resume, (text) => english[text] ?? text) as Resume;
}

export type PolishKind = "text" | "langs" | "cert";

/** The short fields the person typed, to be tidied and put in English at the end. Names of
 * people and projects, links, dates and the lines the writer wrote are left as they are. */
export function polishable(resume: Resume): { text: string; kind: PolishKind }[] {
  const items = new Map<string, PolishKind>();
  const add = (text: string, kind: PolishKind) => {
    if (text.trim() && !items.has(text)) items.set(text, kind);
  };
  add(resume.personal.field, "text");
  add(resume.personal.target_title, "text");
  add(resume.contact.location, "text");
  for (const job of resume.experience) [job.title, job.company, job.role_line].forEach((text) => add(text, "text"));
  for (const school of resume.education) [school.institution, school.major].forEach((text) => add(text, "text"));
  for (const project of resume.projects) add(project.role_line, "text");
  for (const items of Object.values(resume.skills)) items.forEach((text) => add(text, "text"));
  for (const cert of resume.certifications) add(cert.name, "cert");
  resume.languages.forEach((text) => add(text, "langs"));
  [...resume.volunteering, ...resume.awards].forEach((text) => add(text, "text"));
  // Anything else still in Arabic is translated too.
  for (const text of arabicTexts(resume)) add(text, "text");
  return [...items].map(([text, kind]) => ({ text, kind }));
}

// Headings typed as if they were skills.
const NOT_SKILLS = /^((technical|soft|hard|other|key|core)\s+)?skills?$|^(other|none|n\/a)$/i;

/** After the polish: a skill item that became a list is split; each skill takes its catalog
 * name and category, else the category the writer gave it, else "Other skills"; headings typed
 * as skills are dropped. A certificate line that named two certificates becomes two lines. */
export function regroup(
  resume: Resume,
  resolve: (skill: string) => { name: string; category: string } | null,
  writerCategories: Record<string, string> = {},
): Resume {
  const skills: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const item of Object.values(resume.skills).flat()) {
    for (const typed of item.split(/[,،]/).map((part) => part.trim()).filter(Boolean)) {
      if (NOT_SKILLS.test(typed)) continue;
      const known = resolve(typed);
      const name = known?.name ?? typed;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const category = known?.category ?? writerCategories[typed] ?? "Other skills";
      (skills[category] ??= []).push(name);
    }
  }
  const certifications = resume.certifications.flatMap((cert) =>
    cert.name.split(" | ").map((name) => ({ ...cert, name: name.trim() })).filter((cert) => cert.name),
  );
  return { ...resume, skills, certifications };
}
