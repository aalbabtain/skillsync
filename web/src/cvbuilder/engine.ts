// The conversation as a state machine over SCRIPT. Pure functions: each returns a new State,
// and the page renders it. No React, no DOM, no network.
import { DEGREE_TEXT, groupKeys, indexOf, SCRIPT } from "./script.ts";
import { splitList } from "./skills.ts";
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
  // Updating a CV starts from what is new, not from the first question.
  if (mode === "update") return { ...state, at: SCRIPT.length, phase: "news", log: [...state.log, { kind: "note", id: "news" }] };
  return moveTo(state, nextIndex(state, -1));
}

export function current(state: State): Question | null {
  return state.pending || state.phase ? null : SCRIPT[state.at] ?? null;
}

export function done(state: State): boolean {
  return !state.pending && !state.phase && state.at >= SCRIPT.length;
}

function nextIndex(state: State, from: number): number {
  for (let i = from + 1; i < SCRIPT.length; i++) {
    const question = SCRIPT[i];
    if (question.group === "job" && state.answers.hasJob === "no") continue;
    if (question.group === "project" && state.answers.hasProject === "no") continue;
    // A new project or job from "what is new" skips what was already said.
    if (state.newsItem && question.group && state.answers[question.key]) continue;
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
  const groupDone = question.group && SCRIPT[nextIndex(state, state.at)]?.group !== question.group;
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
  const saved: State = { ...state, answers, skipped, [list]: [...state[list], item], log: [...state.log, { kind: "another", group }] };
  // A new item from "what is new" does not ask "add another?": the next one, or what else is new.
  return state.newsItem ? nextNews({ ...saved, pending: null, newsItem: false }) : saved;
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

// "omar al-qahtani" is written "Omar Al-Qahtani"; a name with any capital stays as typed.
function nameCase(name: string): string {
  if (name !== name.toLowerCase()) return name.trim();
  return name.trim().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

// "Software Engineering student" is the person; the degree's major is "Software Engineering".
function asMajor(field: string): string {
  return field.replace(/\s*\b(student|graduate|undergraduate|major)\b\s*/gi, " ").trim() || field;
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
  // A degree read from a CV may already name its major ("B.Sc. in Software Engineering").
  const degreeText = DEGREE_TEXT[a.degree] ?? a.degree ?? "";
  const skills: Record<string, string[]> = {};
  for (const skill of splitList(a.skills ?? "")) (skills[categoryOf(skill)] ??= []).push(skill);
  return {
    personal: { name: nameCase(a.name ?? ""), field: en("field"), target_title: en("target") },
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
      ? [{ institution: a.school, degree: degreeText, major: / in /i.test(degreeText) ? "" : asMajor(en("field")), end: a.grad ?? "", gpa: a.gpa ?? "", achievements: [] }]
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
    activities: (a.activities ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
  };
}

// ---------- Update mode: what is new ----------

export type News = {
  projects: { name: string; what: string; tools: string; role: string; start: string; end: string; url: string }[];
  jobs: { company: string; title: string; what: string; start: string; end: string }[];
  skills: string[];
  certs: string[];
  langs: string[];
  activities: string[];
};

function joined(before: string | undefined, added: string[], separator: string): string {
  return [...(before ?? "").split(separator).map((part) => part.trim()).filter(Boolean), ...added].join(separator === "\n" ? "\n" : ", ");
}

/** The changes the person approved: lists are added to at once; each new project or job is
 * asked about, only for what is missing, one after the other. */
export function applyNews(state: State, news: News): State {
  const range = (start: string, end: string) => [start, end].filter(Boolean).map((part) => normalizeDate(part) ?? part).join(" – ");
  const answers = { ...state.answers };
  if (news.skills.length) answers.skills = joined(answers.skills, news.skills, ",");
  if (news.langs.length) answers.langs = joined(answers.langs, news.langs, ",");
  if (news.certs.length) answers.certs = joined(answers.certs, news.certs, "\n");
  if (news.activities.length) answers.activities = joined(answers.activities, news.activities, "\n");
  const clean = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
  const queue = [
    ...news.projects.map((p) => ({
      group: "project" as Group,
      answers: clean({ projName: p.name, projWhat: p.what, projTools: p.tools, projRole: p.role, projLink: p.url, projDates: p.start && p.end ? range(p.start, p.end) : "" }),
    })),
    ...news.jobs.map((j) => ({
      group: "job" as Group,
      answers: clean({ company: j.company, jobTitle: j.title, jobWhat: j.what, jobDates: j.start && j.end ? range(j.start, j.end) : "" }),
    })),
  ];
  return nextNews({ ...state, answers, queue: [...(state.queue ?? []), ...queue] });
}

/** The next new project or job to ask about, at its first missing answer; or, with none left,
 * back to "anything else new?". */
export function nextNews(state: State): State {
  const [next, ...rest] = state.queue ?? [];
  if (!next) {
    return { ...state, queue: [], phase: "news", log: [...state.log, { kind: "note", id: "news_more" }] };
  }
  const keys = groupKeys(next.group);
  const answers = { ...state.answers };
  for (const key of keys) delete answers[key];
  Object.assign(answers, next.answers);
  const base: State = { ...state, answers, queue: rest, phase: null, newsItem: true, pending: null };
  const first = keys.map((key) => indexOf(key)).find((i) => !answers[SCRIPT[i].key]);
  // Everything already said: the last question of the item closes it, so its lines get written.
  return moveTo(base, first ?? indexOf(keys[keys.length - 1]));
}

export function finishNews(state: State): State {
  return { ...state, phase: "summary", log: [...state.log, { kind: "note", id: "summary_ask" }] };
}

export function keepSummary(state: State): State {
  return { ...state, phase: null, at: SCRIPT.length, log: [...state.log, { kind: "note", id: "done" }] };
}
