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
