import type { QuestionKind } from "./types.ts";

export type Problem = "" | "empty" | "latin" | "email" | "phone" | "url" | "date" | "gpa";

const ARABIC = /[؀-ۿ]/;
const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DATE = new RegExp(`^(?:(?:${MONTHS}) \\d{4}|Present)$`, "i");
const SKIP_WORDS = new Set(["skip", "تخطي", "تخطى", "تخط", "تخطَّ", "-"]);

export function westernDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

export function isSkipWord(text: string): boolean {
  return SKIP_WORDS.has(text.trim().toLowerCase());
}

export function isDate(text: string): boolean {
  return DATE.test(westernDigits(text.trim()));
}

export function validate(kind: QuestionKind, raw: string): Problem {
  const text = westernDigits(raw.trim());
  if (!text) return "empty";
  switch (kind) {
    case "latin":
      return hasArabic(text) ? "latin" : "";
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? "" : "email";
    case "phone":
      return /^\+?[\d\s()-]{7,20}$/.test(text) && (text.match(/\d/g) ?? []).length >= 7 ? "" : "phone";
    case "url":
      return /^https:\/\/\S+\.\S+$/.test(text) ? "" : "url";
    case "date":
      return isDate(text) ? "" : "date";
    case "gpa": {
      const match = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/.exec(text);
      if (!match) return "gpa";
      const scale = match[2] === undefined ? Infinity : Number(match[2]);
      return Number(match[1]) <= scale ? "" : "gpa";
    }
    default:
      return "";
  }
}
