// The conversation as a state machine over SCRIPT. Pure functions: each returns a new State,
// and the page renders it. No React, no DOM, no network.
import { DEGREE_TEXT, groupKeys, indexOf, SCRIPT } from "./script.ts";
import { STATE_VERSION } from "./types.ts";
import type { Group, Item, LogEntry, Mode, Question, Resume, State } from "./types.ts";
import { isSkipWord, normalizeDate, normalizeRange, validate, westernDigits } from "./validate.ts";
import type { Problem } from "./validate.ts";

export type Result = {
  state: State;
  error?: Problem | "needed";
  // The page writes the summary, or the bullets of the job or project just finished.
  needs?: "summary" | Group;
};

export function start(mode: Mode, imported?: { answers?: Record<string, string>; jobs?: Item[]; projects?: Item[] }): State {
  const state: State = {
    version: STATE_VERSION,
    mode,
    at: -1,
    answers: { ...(imported?.answers ?? {}) },
    skipped: {},
    resumeAt: null,
    pending: null,
    summary: "",
    jobs: imported?.jobs ?? [],
    projects: imported?.projects ?? [],
    english: {},
    log: [{ kind: "note", id: mode === "update" ? "imported" : "welcome" }],
  };
  return moveTo(state, nextIndex(state, -1));
}

export function current(state: State): Question | null {
  return state.pending ? null : SCRIPT[state.at] ?? null;
}

export function done(state: State): boolean {
  return !state.pending && state.at >= SCRIPT.length;
}

function nextIndex(state: State, from: number): number {
  for (let i = from + 1; i < SCRIPT.length; i++) {
    const question = SCRIPT[i];
    if (question.group === "job" && state.answers.hasJob === "no") continue;
    if (question.group === "project" && state.answers.hasProject === "no") continue;
    // In update mode, what the CV already says is not asked again; jobs and projects are,
    // so new ones can be added.
    if (state.mode === "update" && !question.group && state.answers[question.key]) continue;
    return i;
  }
  return SCRIPT.length;
}

function moveTo(state: State, at: number): State {
  const log: LogEntry[] = at < SCRIPT.length ? [...state.log, { kind: "ask", key: SCRIPT[at].key }] : [...state.log, { kind: "note", id: "done" }];
  return { ...state, at, log };
}

function advance(state: State, question: Question): Result {
  const groupDone = question.group && SCRIPT[state.at + 1]?.group !== question.group;
  if (state.resumeAt !== null) {
    // Back from an edit: return to the question the person was on, already asked.
    return { state: { ...state, at: state.resumeAt, resumeAt: null }, needs: question.writes };
  }
  if (groupDone && question.group) {
    return { state: { ...state, pending: question.group }, needs: question.group };
  }
  let next = { ...state };
  if (question.key === "hasJob" && state.answers.hasJob === "no") {
    next = { ...next, log: [...next.log, { kind: "note", id: "no_job" }] };
  }
  if (question.key === "hasProject" && state.answers.hasProject === "no") {
    next = { ...next, log: [...next.log, { kind: "note", id: "no_project" }] };
  }
  return { state: moveTo(next, nextIndex(next, state.at)), needs: question.writes };
}

// An edit replaces the earlier answer where it is in the conversation; a new answer is added.
function logAnswer(state: State, entry: LogEntry & { key: string }): LogEntry[] {
  if (state.resumeAt === null) return [...state.log, entry];
  let index = -1;
  state.log.forEach((e, i) => {
    if ((e.kind === "answer" || e.kind === "skipped") && e.key === entry.key) index = i;
  });
  if (index < 0) return [...state.log, entry];
  return state.log.map((e, i) => (i === index ? entry : e));
}

/** `shown` is what the conversation shows when it differs from what is stored, such as the
 * detail given after a follow-up question, stored joined to the first answer. */
export function answer(state: State, text: string, shown?: string): Result {
  const question = current(state);
  if (!question) return { state };
  if (isSkipWord(text)) return skip(state);
  const value = text.trim();
  if (question.kind === "choice") {
    if (!question.choices?.includes(value)) return { state, error: "empty" };
  } else {
    const problem = validate(question.kind, value);
    if (problem) return { state, error: problem };
  }
  const stored =
    question.kind === "date" ? normalizeDate(value) ?? value
    : question.kind === "range" ? normalizeRange(value) ?? value
    : question.kind === "gpa" ? westernDigits(value)
    : value;
  const skipped = { ...state.skipped };
  delete skipped[question.key];
  // A changed answer needs its English form again.
  const english = { ...state.english };
  delete english[question.key];
  const next: State = {
    ...state,
    answers: { ...state.answers, [question.key]: stored },
    english,
    skipped,
    log: logAnswer(state, { kind: "answer", key: question.key, text: (shown ?? value).trim() }),
  };
  return advance(next, question);
}

export function skip(state: State): Result {
  const question = current(state);
  if (!question) return { state };
  if (!question.optional) return { state, error: "needed" };
  const answers = { ...state.answers };
  delete answers[question.key];
  const next: State = {
    ...state,
    answers,
    skipped: { ...state.skipped, [question.key]: true },
    log: logAnswer(state, { kind: "skipped", key: question.key }),
  };
  return advance(next, question);
}

// Keep the finished job or project with its written lines, and ask whether to add another.
export function saveItem(state: State, group: Group, lines: string[]): State {
  const keys = groupKeys(group);
  const item: Item = { answers: Object.fromEntries(keys.filter((key) => state.answers[key]).map((key) => [key, state.answers[key]])), lines };
  const answers = { ...state.answers };
  const skipped = { ...state.skipped };
  for (const key of keys) {
    delete answers[key];
    delete skipped[key];
  }
  const list = group === "job" ? "jobs" : "projects";
  return { ...state, answers, skipped, [list]: [...state[list], item], log: [...state.log, { kind: "another", group }] };
}

export function addAnother(state: State, yes: boolean): State {
  const group = state.pending;
  if (!group) return state;
  const keys = groupKeys(group);
  const first = indexOf(keys[0]);
  const last = indexOf(keys[keys.length - 1]);
  const next = { ...state, pending: null };
  return moveTo(next, yes ? first : nextIndex(next, last));
}

export function replaceLines(state: State, group: Group, index: number, lines: string[]): State {
  const list = group === "job" ? "jobs" : "projects";
  const items = state[list].map((item, i) => (i === index ? { ...item, lines } : item));
  return { ...state, [list]: items };
}

// Ask an earlier question again (the previous one when no key is given), then come back here.
export function back(state: State, key: string | undefined): State {
  const target = key ? indexOf(key) : previousAsked(state);
  if (target < 0 || target >= state.at || state.pending) return state;
  // Nothing is added to the conversation: the page shows which answer is being changed.
  return { ...state, resumeAt: state.resumeAt ?? state.at, at: target };
}

export function cancelEdit(state: State): State {
  if (state.resumeAt === null) return state;
  return { ...state, at: state.resumeAt, resumeAt: null };
}

function previousAsked(state: State): number {
  for (let i = state.at - 1; i >= 0; i--) {
    const key = SCRIPT[i].key;
    if (state.answers[key] !== undefined || state.skipped[key]) return i;
  }
  return -1;
}

export function canEdit(state: State, key: string): boolean {
  const index = indexOf(key);
  return !state.pending && index >= 0 && index < state.at && (state.answers[key] !== undefined || !!state.skipped[key]);
}

export function load(raw: string | null): State | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as State;
    if (state?.version !== STATE_VERSION || !Array.isArray(state.log) || typeof state.answers !== "object") return null;
    // Every question the log refers to must still be in the script.
    const keys = new Set(SCRIPT.map((question) => question.key));
    const known = state.log.every((entry) => !("key" in entry) || keys.has(entry.key));
    if (!known || typeof state.at !== "number" || state.at < 0 || state.at > SCRIPT.length) return null;
    return state;
  } catch {
    return null;
  }
}

function list(text: string | undefined): string[] {
  return (text ?? "").split(/[,،\n]/).map((part) => part.trim()).filter(Boolean);
}

function lines(text: string | undefined): string[] {
  return (text ?? "").split(/\n|؛|;/).map((part) => part.trim()).filter(Boolean);
}

export function toResume(state: State, categoryOf: (skill: string) => string = () => "Technical skills"): Resume {
  const a = state.answers;
  const en = (key: string) => state.english[key] || a[key] || "";
  const skills: Record<string, string[]> = {};
  for (const skill of list(a.skills)) (skills[categoryOf(skill)] ??= []).push(skill);
  return {
    personal: { name: a.name ?? "", field: en("field"), target_title: en("target") },
    contact: { email: a.email ?? "", phone: a.phone ?? "", location: en("location"), linkedin: a.linkedin ?? "", github: a.github ?? "" },
    summary: state.summary,
    experience: state.jobs.map(({ answers, lines: bullets }) => ({
      company: answers.company ?? "",
      title: answers.jobTitle ?? "",
      start: (answers.jobDates ?? "").split(" – ")[0] ?? "",
      end: (answers.jobDates ?? "").split(" – ")[1] ?? "",
      role_line: answers.tools ?? "",
      bullets,
    })),
    education: a.school
      ? [{ institution: a.school, degree: DEGREE_TEXT[a.degree] ?? a.degree ?? "", major: en("field"), end: a.grad ?? "", gpa: a.gpa ?? "", achievements: [] }]
      : [],
    skills,
    projects: state.projects.map(({ answers, lines: bullets }) => ({
      name: answers.projName ?? "",
      url: answers.projLink ?? "",
      start: (answers.projDates ?? "").split(" – ")[0] ?? "",
      end: (answers.projDates ?? "").split(" – ")[1] ?? "",
      role_line: [answers.projRole, answers.projTools].filter(Boolean).join(" | "),
      bullets,
    })),
    certifications: lines(a.certs).map((name) => ({ name, issuer: "", date: "", url: "" })),
    languages: list(en("langs")),
    volunteering: lines(a.volunteering),
    awards: lines(a.awards),
  };
}
