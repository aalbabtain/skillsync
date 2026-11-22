// The CV builder's data. Resume mirrors api/app/cv_docx.py's Resume, which /api/cv/docx takes.

export type QuestionKind = "text" | "latin" | "long" | "email" | "phone" | "url" | "date" | "gpa" | "choice" | "skills" | "range";

export type Group = "job" | "project";

export type Question = {
  key: string;
  step: number;
  kind: QuestionKind;
  optional?: boolean;
  writes?: "summary";
  group?: Group;
  choices?: string[];
};

export type Item = { answers: Record<string, string>; lines: string[] };

export type LogEntry =
  | { kind: "ask"; key: string }
  | { kind: "answer"; key: string; text: string }
  | { kind: "skipped"; key: string }
  | { kind: "written"; target: "summary" | Group; lines: string[]; facts: string[]; fallback?: boolean }
  | { kind: "note"; id: string }
  | { kind: "follow"; key: string; text: string }
  | { kind: "another"; group: Group };

export type Mode = "scratch" | "update";

// Raised whenever the questions change, so a conversation saved under other questions is
// started over instead of being read against the wrong script.
export const STATE_VERSION = 4;

export type State = {
  version: typeof STATE_VERSION;
  mode: Mode;
  // Position in SCRIPT; SCRIPT.length means the conversation is over.
  at: number;
  answers: Record<string, string>;
  skipped: Record<string, true>;
  // Where to return after going back to edit an earlier answer.
  resumeAt: number | null;
  // A finished job or project waiting for its bullets, then for "add another?".
  pending: Group | null;
  summary: string;
  jobs: Item[];
  projects: Item[];
  // English for answers given in Arabic, from /api/cv/translate.
  english: Record<string, string>;
  // English for any text still in Arabic in the finished CV, by its Arabic text.
  textEnglish?: Record<string, string>;
  // A category for each skill the catalog does not know, from the writer.
  skillCategories?: Record<string, string>;
  log: LogEntry[];
};

export type Personal = { name: string; field: string; target_title: string };
export type Contact = { email: string; phone: string; location: string; linkedin: string; github: string };
export type Job = { company: string; title: string; start: string; end: string; role_line: string; bullets: string[] };
export type Education = { institution: string; degree: string; major: string; end: string; gpa: string; achievements: string[] };
export type Project = { name: string; url: string; start: string; end: string; role_line: string; bullets: string[] };
export type Certification = { name: string; issuer: string; date: string; url: string };

export type Resume = {
  personal: Personal;
  contact: Contact;
  summary: string;
  experience: Job[];
  education: Education[];
  skills: Record<string, string[]>;
  projects: Project[];
  certifications: Certification[];
  languages: string[];
  volunteering: string[];
  awards: string[];
  activities: string[];
};
