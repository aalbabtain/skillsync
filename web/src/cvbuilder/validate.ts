import type { QuestionKind } from "./types.ts";

export type Problem = "" | "empty" | "latin" | "email" | "phone" | "url" | "date" | "gpa" | "range";

const ARABIC = /[؀-ۿ]/;
const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DATE = new RegExp(`^(?:(?:${MONTHS}) \\d{4}|Present)$`, "i");
export const MONTH_NAMES = MONTHS.split("|");
// Month names people write, English and Arabic, each to its month number.
const MONTH_WORDS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, sept: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, إبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};
const PRESENT = new Set(["present", "now", "current", "currently", "الآن", "حتى الآن", "حاليا", "حاليًا", "الان", "حتى الان"]);

function monthYear(month: number, year: number): string | null {
  if (month < 1 || month > 12 || year < 1950 || year > 2100) return null;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** A month and year however it was written ("june 2027", "06/2027", "يونيو ٢٠٢٧"), as
 * "Jun 2027"; "Present" for a job still held; null when it is not a month and year. */
export function normalizeDate(raw: string): string | null {
  const text = westernDigits(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (PRESENT.has(text)) return "Present";
  let match = /^([a-z\u0600-\u06ff]+)\.?,? (\d{4})$/.exec(text);
  if (match && MONTH_WORDS[match[1]]) return monthYear(MONTH_WORDS[match[1]], Number(match[2]));
  match = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(text);
  if (match) return monthYear(Number(match[1]), Number(match[2]));
  match = /^(\d{4})\s*[/.-]\s*(\d{1,2})$/.exec(text);
  if (match) return monthYear(Number(match[2]), Number(match[1]));
  return null;
}
function monthIndex(date: string): number {
  if (date === "Present") return Infinity;
  const [month, year] = date.split(" ");
  return Number(year) * 12 + MONTH_NAMES.indexOf(month);
}

/** Two dates, from and to ("Mar 2025 - Present", "مارس 2025 إلى أغسطس 2025"), as
 * "Mar 2025 – Aug 2025"; null when either is not a date or the end comes first. */
export function normalizeRange(raw: string): string | null {
  const parts = westernDigits(raw).split(/\s+(?:-|–|—|to|until|till|إلى|الى|حتى)\s+|\s*[–—]\s*/i);
  if (parts.length !== 2) return null;
  const start = normalizeDate(parts[0]);
  const end = normalizeDate(parts[1]);
  if (!start || !end || start === "Present" || monthIndex(start) > monthIndex(end)) return null;
  return `${start} – ${end}`;
}

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
      return normalizeDate(text) ? "" : "date";
    case "range":
      return normalizeRange(text) ? "" : "range";
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
