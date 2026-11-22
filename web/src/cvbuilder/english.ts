// The finished CV is English only: every text still in Arabic is found here, sent once for
// translation, and replaced wherever it appears.
import type { Resume } from "./types.ts";
import { splitList } from "./skills.ts";
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

// A catalog category, and the words a CV's own skill heading uses for it.
const GROUP_WORDS: Record<string, RegExp> = {
  "Programming languages": /language|programming/i,
  Frameworks: /framework|librar/i,
  Databases: /database|backend|\bdata\b/i,
  "Cloud & DevOps": /cloud|devops|infra|tool|practice/i,
  "AI/ML": /\bai\b|\bml\b|machine|agent|intelligen/i,
  Tools: /tool|practice/i,
  "Soft skills": /soft|personal|interpersonal/i,
};

export type SkillGroup = { name: string; items: string[] };

/** After the polish: a skill item that became a list is split (not at commas in brackets).
 * With the CV's own skill groups (update mode), a skill already in one stays there and a new
 * one joins the group whose heading fits its category. Otherwise each skill takes its catalog
 * category, else the writer's. Anything left, and the catalog's "Other", is "Other skills".
 * Headings typed as skills are dropped. A certificate line naming two becomes two lines. */
export function regroup(
  resume: Resume,
  resolve: (skill: string) => { name: string; category: string } | null,
  writerCategories: Record<string, string> = {},
  groups: SkillGroup[] = [],
): Resume {
  const order = groups.map((group) => group.name);
  const inGroup = new Map<string, string>();
  for (const group of groups) for (const item of group.items) inGroup.set(item.toLowerCase(), group.name);
  const placed: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const item of Object.values(resume.skills).flat()) {
    for (const typed of splitList(item)) {
      if (NOT_SKILLS.test(typed)) continue;
      const known = resolve(typed);
      // A skill from the CV's own heading keeps the person's spelling; others take the catalog's.
      const own = inGroup.has(typed.toLowerCase());
      const name = own ? typed : known?.name ?? typed;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const category = known?.category ?? writerCategories[typed];
      let heading = inGroup.get(typed.toLowerCase()) ?? inGroup.get(name.toLowerCase());
      if (!heading && groups.length && category && GROUP_WORDS[category]) {
        heading = order.find((group) => GROUP_WORDS[category].test(group));
      }
      if (!heading) heading = groups.length || !category || category === "Other" ? "Other skills" : category;
      (placed[heading] ??= []).push(name);
    }
  }
  // Inside a CV's own heading, its own items keep their order; new ones follow.
  const rank = (heading: string, name: string) => {
    const items = groups.find((group) => group.name === heading)?.items.map((item) => item.toLowerCase()) ?? [];
    const at = items.indexOf(name.toLowerCase());
    return at < 0 ? items.length : at;
  };
  for (const heading of order) placed[heading]?.sort((a, b) => rank(heading, a) - rank(heading, b));
  // The CV's own headings first, in its order; the rest after.
  const skills: Record<string, string[]> = {};
  for (const heading of [...order, ...Object.keys(placed)]) if (placed[heading] && !skills[heading]) skills[heading] = placed[heading];
  const certifications = resume.certifications.flatMap((cert) =>
    cert.name.split(" | ").map((name) => ({ ...cert, name: name.trim() })).filter((cert) => cert.name),
  );
  return { ...resume, skills, certifications };
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.? ";
const TRAILING_DATES = new RegExp(`[,\\s]*((?:${MONTH})?\\d{4}\\s*[–-]\\s*(?:Present|(?:${MONTH})?\\d{4})|${MONTH}\\d{4})\\s*$`);

/** An activity line and its dates at the end, so the dates sit at the line's end as in every
 * other section (the same rule as split_dates in api/app/cv_docx.py). */
export function splitDates(line: string): [string, string] {
  const match = TRAILING_DATES.exec(line);
  if (!match || match.index === 0) return [line.trim(), ""];
  return [line.slice(0, match.index).trim().replace(/^[,–\s-]+|[,–\s-]+$/g, ""), match[1].replace(" - ", " – ")];
}
