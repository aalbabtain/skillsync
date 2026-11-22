import { Check, Circle, FileUp, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { track } from "../analytics";
import { ApiRequestError, createRun, cvDocx, cvFollowUp, cvImport, cvTranslate, getSkillCatalog, streamCvLines } from "../api";
import type { CvLine } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { checklist } from "./ats";
import { applyEnglish, arabicTexts } from "./english";
import CvPreview from "./CvPreview";
import { MonthGrid, RangePicker } from "./MonthPicker";
import { suggestSkills } from "./skills";
import type { CatalogEntry } from "./skills";
import { addAnother, answer, back, cancelEdit, canEdit, current, done, load, replaceLines, saveItem, skip, start, toResume } from "./engine";
import { FOLLOW_UP_KEYS, groupKeys, SCRIPT, STEPS, TRANSLATED_KEYS } from "./script";
import type { Group, Item, LogEntry, State } from "./types";
import { hasArabic, isSkipWord, normalizeDate } from "./validate";

const STORAGE_KEY = "skillsync-cv";
const WORD_MS = 55;
const FOLLOW_UP_MIN_WORDS = 8;
// With nothing new for this long while writing, the page says the model is slow.
const SLOW_AFTER_MS = 8000;
// Arabic texts translated per request (the server takes up to 30).
const TRANSLATE_BATCH = 30;
// The printed CV's body size in points, largest first, and the extra room between sections;
// the same steps as the Word file (api/app/cv_docx.py).
const PRINT_SIZES = [13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5];
const PRINT_SPREADS = [2.5, 2, 1.6, 1.3, 1];
const A4_HEIGHT_MM = 297;

// The largest size, then the widest spacing, at which the CV stays on one A4 sheet.
function fitToPage(sheet: HTMLElement) {
  const paper = sheet.querySelector<HTMLElement>(".cv-paper");
  if (!paper) return;
  const probe = document.createElement("div");
  probe.style.height = `${A4_HEIGHT_MM}mm`;
  document.body.appendChild(probe);
  const pageHeight = probe.getBoundingClientRect().height;
  probe.remove();
  const fits = () => sheet.getBoundingClientRect().height <= pageHeight;
  let size = PRINT_SIZES[PRINT_SIZES.length - 1];
  for (const candidate of PRINT_SIZES) {
    paper.style.fontSize = `${candidate}pt`;
    paper.style.setProperty("--cv-gap", "1");
    if (fits()) {
      size = candidate;
      break;
    }
  }
  paper.style.fontSize = `${size}pt`;
  for (const spread of PRINT_SPREADS) {
    paper.style.setProperty("--cv-gap", String(spread));
    if (fits()) return;
  }
  paper.style.setProperty("--cv-gap", "1");
}

type Writing = { target: "summary" | Group; lines: string[]; shown: string };
type Failure = { message: string; retry: () => void; skip: () => void };

function readSaved(): State | null {
  try {
    return load(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Shows a line word by word, as the model's stream would, then resolves.
function typeOut(text: string, show: (shown: string) => void): Promise<void> {
  if (reducedMotion()) {
    show(text);
    return Promise.resolve();
  }
  const words = text.split(" ");
  return new Promise((resolve) => {
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      show(words.slice(0, n).join(" "));
      if (n >= words.length) {
        window.clearInterval(timer);
        resolve();
      }
    }, WORD_MS);
  });
}

export default function CvBuilderPage({ demoMode }: { demoMode: boolean }) {
  const { t, lang, errorMessage } = useI18n();
  const [state, setState] = useState<State | null>(readSaved);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // A follow-up question waiting for its answer, and the description it asked about.
  const [follow, setFollow] = useState<{ key: string; first: string } | null>(null);
  const followKey = follow?.key ?? null;
  const [thinking, setThinking] = useState(false);
  const [slow, setSlow] = useState(false);
  const [importing, setImporting] = useState<"idle" | "choose" | "reading">("idle");
  const [importError, setImportError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloadError, setDownloadError] = useState("");
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  // Skills offered at the skills question that the person turned off.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    track("cv-builder");
    getSkillCatalog()
      .then((catalog) => {
        const map = new Map<string, string>();
        for (const skill of catalog.skills) {
          for (const spelling of [skill.name, ...skill.aliases]) map.set(spelling.toLowerCase(), skill.category);
        }
        setCategories(map);
        setCatalog(catalog.skills.map((skill) => ({ name: skill.name, aliases: skill.aliases })));
      })
      .catch(() => setCategories(new Map()));
  }, []);

  useEffect(() => {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be blocked; the conversation still works for this visit.
    }
  }, [state]);

  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [state?.log.length, writing?.shown, error, followKey]);

  const categoryOf = useCallback((skill: string) => categories.get(skill.toLowerCase()) ?? "Other skills", [categories]);

  // A long wait while writing (a busy model, a switch to the next one) is said, not left silent.
  const writingKey = writing ? `${writing.lines.length}:${writing.shown.length > 0}` : "";
  useEffect(() => {
    setSlow(false);
    if (!writing) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingKey]);

  // ---------- Writing with the model ----------

  const translateNeeded = useCallback(async (base: State, keys: string[]): Promise<State> => {
    const items = Object.fromEntries(keys.filter((key) => base.answers[key] && hasArabic(base.answers[key]) && !base.english[key]).map((key) => [key, base.answers[key]]));
    if (!Object.keys(items).length) return base;
    try {
      const english = await cvTranslate(items);
      return { ...base, english: { ...base.english, ...english } };
    } catch {
      // Untranslated values stay as written, marked in the preview; the person can edit them.
      return base;
    }
  }, []);

  const write = useCallback(
    async (target: "summary" | Group, answers: Record<string, string>): Promise<{ lines: CvLine[]; fallback?: string }> => {
      const lines: CvLine[] = [];
      let typing = Promise.resolve();
      setWriting({ target, lines: [], shown: "" });
      const result = await streamCvLines(target === "summary" ? "summary" : "bullets", answers, (line) => {
        lines.push(line);
        typing = typing.then(() =>
          typeOut(line.text, (shown) => setWriting((w) => (w ? { ...w, shown } : w))).then(() =>
            setWriting((w) => (w ? { ...w, lines: [...w.lines, line.text], shown: "" } : w)),
          ),
        );
      });
      await typing;
      setWriting(null);
      return { lines, fallback: result.fallback };
    },
    [],
  );

  const failed = useCallback(
    (caught: unknown, retry: () => void, skip: () => void) => {
      setWriting(null);
      const message =
        caught instanceof ApiRequestError ? errorMessage(caught.code, t("cvb_write_failed")) : t("cvb_write_failed");
      setFailure({ message, retry, skip });
    },
    [errorMessage, t],
  );

  const english = (s: State, key: string) => s.english[key] || s.answers[key] || "";

  const writeSummary = useCallback(
    async (base: State) => {
      setFailure(null);
      try {
        const translated = await translateNeeded(base, ["field", "target"]);
        const answers = {
          field: english(translated, "field"),
          target: english(translated, "target"),
          background: translated.answers.background ?? "",
          skills: translated.answers.skills ?? "",
        };
        const { lines, fallback } = await write("summary", Object.fromEntries(Object.entries(answers).filter(([, v]) => v)));
        const text = lines.map((line) => line.text).join(" ") || fallback || "";
        const entry: LogEntry = { kind: "written", target: "summary", lines: [text], facts: lines.flatMap((line) => line.facts), fallback: !lines.length };
        setState((s) => (s ? { ...s, english: { ...translated.english, ...s.english }, summary: text, log: [...s.log, entry] } : s));
      } catch (caught) {
        // Without the model the conversation goes on; the summary can be written at the end.
        failed(caught, () => writeSummary(stateRef.current ?? base), () => setFailure(null));
      }
    },
    [failed, translateNeeded, write],
  );

  const writeItem = useCallback(
    async (base: State, group: Group) => {
      setFailure(null);
      try {
        const translated = await translateNeeded(base, group === "job" ? ["jobTitle"] : ["projRole"]);
        const answers = Object.fromEntries(groupKeys(group).filter((key) => translated.answers[key]).map((key) => [key, english(translated, key)]));
        const { lines, fallback } = await write(group, answers);
        const texts = lines.length ? lines.map((line) => line.text) : [fallback ?? ""].filter(Boolean);
        const entry: LogEntry = { kind: "written", target: group, lines: texts, facts: [...new Set(lines.flatMap((line) => line.facts))], fallback: !lines.length };
        setState((s) => {
          if (!s) return s;
          const english = { ...translated.english, ...s.english };
          // The item keeps the English form of what was translated (job title, role).
          const answers = { ...s.answers };
          for (const key of groupKeys(group)) if (english[key]) answers[key] = english[key];
          return saveItem({ ...s, answers, english, log: [...s.log, entry] }, group, texts);
        });
      } catch (caught) {
        // Without the model, the person's own description becomes the item's line.
        failed(
          caught,
          () => writeItem(stateRef.current ?? base, group),
          () => {
            setFailure(null);
            setState((s) => {
              if (!s) return s;
              const own = (s.answers[group === "job" ? "jobWhat" : "projWhat"] ?? "").trim();
              return saveItem(s, group, own ? [own] : []);
            });
          },
        );
      }
    },
    [failed, translateNeeded, write],
  );

  const rewriteItem = useCallback(
    async (group: Group, index: number) => {
      const base = stateRef.current;
      const item: Item | undefined = base ? (group === "job" ? base.jobs : base.projects)[index] : undefined;
      if (!base || !item) return;
      setFailure(null);
      try {
        const { lines, fallback } = await write(group, item.answers);
        const texts = lines.length ? lines.map((line) => line.text) : [fallback ?? ""].filter(Boolean);
        setState((s) => (s ? replaceLines(s, group, index, texts) : s));
      } catch (caught) {
        failed(caught, () => rewriteItem(group, index), () => setFailure(null));
      }
    },
    [failed, write],
  );

  // When a step is finished, its short Arabic answers get their English form in one call, so
  // the CV turns English as the person goes rather than only at the end.
  const stepNow = state ? (current(state)?.step ?? (done(state) ? STEPS.length : -1)) : -1;
  useEffect(() => {
    if (!state || writing || stepNow < 1) return;
    const left = TRANSLATED_KEYS.filter((key) => state.answers[key] && hasArabic(state.answers[key]) && !state.english[key]);
    if (!left.length) return;
    let active = true;
    translateNeeded(state, left).then((next) => {
      if (active && next !== state) setState((s) => (s ? { ...s, english: { ...next.english, ...s.english } } : s));
    });
    return () => {
      active = false;
    };
    // Only when the step changes, not on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNow]);

  // ---------- The conversation ----------

  // After an edit or a written step, the next question is already in the log; the box is empty.
  function applied(result: ReturnType<typeof answer>) {
    setDraft("");
    setState(result.state);
    if (result.needs === "summary") return writeSummary(result.state);
    if (result.needs === "job" || result.needs === "project") return writeItem(result.state, result.needs);
  }

  async function submit(input: string) {
    let text = input;
    if (!state || writing || thinking) return;
    setError("");

    // The answer to a follow-up joins the description it was about.
    if (follow) {
      if (!text.trim()) return setError(t("cvb_bad_empty"));
      const result = answer(state, `${follow.first.replace(/[.،\s]+$/, "")}. ${text.trim()}`, text);
      setFollow(null);
      if (result.error) return setError(t(`cvb_bad_${result.error}` as MessageKey));
      return applied(result);
    }

    const question = current(state);
    if (question?.kind === "skills") {
      // The offered skills the person kept, then the ones they typed.
      const kept = offered.filter((skill) => !dropped.has(skill));
      text = [...kept, ...text.split(/[,،\n]/).map((part) => part.trim()).filter(Boolean)].join(", ");
    }

    // One follow-up per job or project when its description is too thin to write from. It is
    // asked before the conversation moves on, so the next answer always goes to the right place.
    if (question && FOLLOW_UP_KEYS.includes(question.key) && state.resumeAt === null && !isSkipWord(text) && text.trim()) {
      let asked: string | null = null;
      if (!demoMode) {
        setThinking(true);
        try {
          asked = await cvFollowUp(text, lang);
        } catch {
          asked = null;
        }
        setThinking(false);
      }
      if (!asked && text.trim().split(/\s+/).length < FOLLOW_UP_MIN_WORDS) {
        asked = t(question.key === "jobWhat" ? "cvb_follow_up_job" : "cvb_follow_up");
      }
      if (asked) {
        const entries: LogEntry[] = [
          { kind: "answer", key: question.key, text: text.trim() },
          { kind: "follow", key: question.key, text: asked },
        ];
        setState((s) => (s ? { ...s, log: [...s.log, ...entries] } : s));
        setFollow({ key: question.key, first: text.trim() });
        setDraft("");
        return;
      }
    }

    const result = answer(state, text);
    if (result.error) return setError(t(`cvb_bad_${result.error}` as MessageKey));
    return applied(result);
  }

  function onSkip() {
    if (!state || writing || thinking) return;
    setError("");
    if (follow) {
      // No more detail: the first description stands, and it is already in the conversation.
      const result = answer(state, follow.first, t("cvb_no_more"));
      setFollow(null);
      return applied(result);
    }
    const result = skip(state);
    if (result.error) return setError(t(`cvb_bad_${result.error}` as MessageKey));
    return applied(result);
  }

  function onCancelEdit() {
    if (!state) return;
    setError("");
    setDraft("");
    setState(cancelEdit(state));
  }

  function onBack(key?: string) {
    if (!state || writing) return;
    const next = back(state, key);
    if (next === state) return;
    setError("");
    setFollow(null);
    setState(next);
    setDraft(next.answers[current(next)?.key ?? ""] ?? "");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function startOver() {
    if (!window.confirm(t("cvb_restart_confirm"))) return;
    setState(null);
    setDraft("");
    setError("");
    setFailure(null);
    setFollow(null);
  }

  async function importCv(file: File) {
    setFileName(file.name);
    setImporting("reading");
    setImportError("");
    try {
      const run = await createRun(file);
      const { resume, contact } = await cvImport(run.text);
      const answers: Record<string, string> = {};
      const put = (key: string, value: string) => {
        if (value.trim()) answers[key] = value.trim();
      };
      put("name", hasArabic(resume.name) ? "" : resume.name);
      put("field", resume.field);
      if (resume.projects.length) answers.hasProject = "yes";
      put("email", contact.email);
      put("phone", contact.phone);
      put("linkedin", contact.linkedin);
      put("github", contact.github);
      put("school", hasArabic(resume.school) ? "" : resume.school);
      put("degree", resume.degree);
      put("skills", resume.skills.join(", "));
      put("grad", normalizeDate(resume.grad) ?? resume.grad);
      put("gpa", resume.gpa);
      put("certs", resume.certs.join("\n"));
      put("langs", resume.langs.join(", "));
      const projects: Item[] = resume.projects.map((project) => ({ answers: { projName: project.name }, lines: project.lines }));
      setState(start("update", { answers, projects }));
      setImporting("idle");
    } catch (caught) {
      setImporting("choose");
      setImportError(caught instanceof ApiRequestError ? errorMessage(caught.code, caught.message) : t("err_network"));
    }
  }

  // ---------- What the page shows ----------

  const question = state ? current(state) : null;
  const finished = state ? done(state) : false;

  // At the skills question: the tools named in jobs and projects, and catalog skills in what
  // the person wrote about them.
  const offered = useMemo(() => {
    if (!state || question?.kind !== "skills") return [];
    const items = [...state.jobs, ...state.projects];
    const tools = items.map((item) => [item.answers.tools, item.answers.projTools].filter(Boolean).join(", ")).join(", ");
    const texts = [...items.flatMap((item) => [item.answers.jobWhat ?? "", item.answers.projWhat ?? "", ...item.lines]), state.answers.background ?? ""];
    return suggestSkills([tools, ...texts], catalog);
  }, [state, question, catalog]);

  const resume = useMemo(() => {
    if (!state) return null;
    const answers = { ...state.answers };
    if (question && question.kind !== "choice" && draft.trim() && !followKey) answers[question.key] = draft;
    let live: State = { ...state, answers };
    // The job or project still being answered shows in the CV as it is typed.
    const group = state.pending ?? question?.group;
    if (group) {
      const keys = groupKeys(group);
      const item: Item = { answers: Object.fromEntries(keys.filter((key) => answers[key]).map((key) => [key, answers[key]])), lines: writing?.target === group ? [...writing.lines, writing.shown].filter(Boolean) : [] };
      if (Object.keys(item.answers).length) live = group === "job" ? { ...live, jobs: [...live.jobs, item] } : { ...live, projects: [...live.projects, item] };
    }
    if (writing?.target === "summary") live = { ...live, summary: [...writing.lines, writing.shown].join(" ").trim() };
    return applyEnglish(toResume(live, categoryOf), state.textEnglish ?? {});
  }, [state, draft, question, followKey, writing, categoryOf]);

  // The finished CV is English only: whatever is still Arabic is translated in one pass.
  const [englishing, setEnglishing] = useState(false);
  const englishTried = useRef("");
  const leftArabic = useMemo(() => (resume && finished ? arabicTexts(resume) : []), [resume, finished]);

  const translateLeft = useCallback(async (texts: string[]) => {
    if (!texts.length) return true;
    setEnglishing(true);
    try {
      const found: Record<string, string> = {};
      for (let i = 0; i < texts.length; i += TRANSLATE_BATCH) {
        const batch = texts.slice(i, i + TRANSLATE_BATCH);
        const english = await cvTranslate(Object.fromEntries(batch.map((text, j) => [`t${j}`, text])));
        batch.forEach((text, j) => {
          const value = english[`t${j}`];
          if (value && !hasArabic(value)) found[text] = value;
        });
      }
      setState((s) => (s ? { ...s, textEnglish: { ...(s.textEnglish ?? {}), ...found } } : s));
      return texts.every((text) => found[text]);
    } catch {
      return false;
    } finally {
      setEnglishing(false);
    }
  }, []);

  useEffect(() => {
    const key = leftArabic.join("\n");
    if (!leftArabic.length || writing || englishTried.current === key) return;
    englishTried.current = key;
    translateLeft(leftArabic);
  }, [leftArabic, writing, translateLeft]);

  // Before any download: nothing Arabic may be left in the CV.
  async function readyInEnglish(): Promise<boolean> {
    if (!leftArabic.length) return true;
    if (await translateLeft(leftArabic)) return true;
    setDownloadError(`${t("cvb_still_arabic")} ${leftArabic.join("، ")}`);
    return false;
  }

  const fresh = writing ? [...writing.lines, writing.shown, [...writing.lines, writing.shown].join(" ").trim()] : [];

  if (!state) {
    return (
      <main className="cvb wrap" aria-labelledby="cvb-title">
        <section className="cvb-welcome">
          <p className="eyebrow">{t("cvb_eyebrow")}</p>
          <h2 id="cvb-title">{t("cvb_title")}</h2>
          <p className="cvb-lead">{t("cvb_lead")}</p>
          <p className="cvb-english">{t("cvb_english")}</p>
          <div className="cvb-modes">
            <button className="cvb-mode" type="button" onClick={() => setState(start("scratch"))}>
              <strong>{t("cvb_mode_scratch")}</strong>
              <span>{t("cvb_mode_scratch_body")}</span>
            </button>
            <button className="cvb-mode" type="button" aria-expanded={importing !== "idle"} onClick={() => setImporting(importing === "idle" ? "choose" : "idle")}>
              <strong>{t("cvb_mode_update")}</strong>
              <span>{t("cvb_mode_update_body")}</span>
            </button>
            <button className="cvb-mode" type="button" disabled aria-describedby="cvb-soon">
              <strong>{t("cvb_mode_tailor")}</strong>
              <span>{t("cvb_mode_tailor_body")}</span>
              <span className="cvb-soon" id="cvb-soon">
                <Lock size={12} aria-hidden="true" /> {t("cvb_soon")}
              </span>
            </button>
          </div>
          {importing !== "idle" && (
            <div className="upload cvb-upload">
              {/* The same drop zone as the CV step (Agent 1), so both ways in look alike. */}
              <div
                className={dragging ? "dropzone dropzone-active" : "dropzone"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file && importing !== "reading") importCv(file);
                }}
              >
                {importing === "reading" ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    <p className="dropzone-title" role="status">
                      {t("cvb_reading")}
                    </p>
                    <p className="dropzone-hint">
                      <bdi>{fileName}</bdi>
                    </p>
                  </>
                ) : (
                  <>
                    <span className="dropzone-icon" aria-hidden="true">
                      <FileUp size={26} />
                    </span>
                    <p className="dropzone-title">{t("drop")}</p>
                    <p className="dropzone-hint">{t("drop_hint")}</p>
                    <button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()}>
                      {t("choose")}
                    </button>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importCv(file);
                  event.target.value = "";
                }}
              />
              {importError && (
                <p className="upload-error" role="alert">
                  {importError}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    );
  }

  const currentStep = question ? question.step : state.pending ? SCRIPT.find((q) => q.group === state.pending)!.step : STEPS.length;
  const stepKeys = (step: number) => SCRIPT.filter((q) => q.step === step).map((q) => q.key);
  const stepClass = (step: number) => {
    if (step === currentStep) return "is-current";
    if (step > currentStep) return "";
    const keys = stepKeys(step);
    return keys.every((key) => state.skipped[key]) ? "is-skipped" : "is-done";
  };

  const writtenTitle = (target: "summary" | Group): MessageKey =>
    target === "summary" ? "cvb_wrote_summary" : target === "job" ? "cvb_wrote_job" : "cvb_wrote_project";

  // Items read from an uploaded CV have no written entry in the log, and come first.
  const writtenFor = (group: Group) => state.log.filter((entry) => entry.kind === "written" && entry.target === group).length;
  let jobIndex = state.jobs.length - writtenFor("job");
  let projectIndex = state.projects.length - writtenFor("project");
  const log: ReactNode[] = state.log.map((entry, index) => {
    switch (entry.kind) {
      case "note":
        return (
          <p className="cvb-msg is-bot" key={index}>
            {t(`cvb_note_${entry.id}` as MessageKey)}
          </p>
        );
      case "ask": {
        const q = SCRIPT.find((item) => item.key === entry.key);
        const example = entry.key === "skills" && offered.length > 0 ? "" : t(`cvb_ex_${entry.key}` as MessageKey);
        return (
          <p className="cvb-msg is-bot" key={index}>
            {entry.key === "skills" && offered.length > 0 ? t("cvb_q_skills_found") : t(`cvb_q_${entry.key}` as MessageKey)}
            {q?.optional && <span className="cvb-ex">{t("cvb_optional")}</span>}
            {example && <span className="cvb-ex">{example}</span>}
          </p>
        );
      }
      case "answer": {
        const asked = SCRIPT.find((item) => item.key === entry.key);
        const shown = asked?.kind === "choice" ? choiceLabel(entry.key, entry.text) : entry.text;
        return (
          <p className="cvb-msg is-me" dir="auto" key={index}>
            {shown}
            {canEdit(state, entry.key) && !writing && (
              <button className="cvb-edit" type="button" onClick={() => onBack(entry.key)}>
                {t("cvb_edit")}
              </button>
            )}
          </p>
        );
      }
      case "skipped":
        return (
          <p className="cvb-msg is-skip" key={index}>
            {t("cvb_skipped")}
          </p>
        );
      case "follow":
        return (
          <p className="cvb-msg is-bot" key={index}>
            {entry.text}
          </p>
        );
      case "another":
        return null;
      case "written": {
        const itemIndex = entry.target === "job" ? jobIndex++ : entry.target === "project" ? projectIndex++ : -1;
        const group = entry.target === "summary" ? null : entry.target;
        return (
          <div className={entry.fallback ? "cvb-written is-fallback" : "cvb-written"} key={index}>
            <h4>{entry.fallback ? t("cvb_fallback") : t(writtenTitle(entry.target))}</h4>
            {entry.lines.length > 1 ? (
              <ul dir="ltr">
                {entry.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p dir="auto">{entry.lines[0]}</p>
            )}
            {entry.facts.length > 0 && (
              <p className="cvb-facts">
                {t("cvb_checked")}
                {entry.facts.map((fact) => (
                  <bdi key={fact} dir="ltr">
                    {fact}
                  </bdi>
                ))}
              </p>
            )}
            {finished && !writing && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => (group ? rewriteItem(group, itemIndex) : writeSummary(state))}
              >
                {t("cvb_rewrite")}
              </button>
            )}
          </div>
        );
      }
    }
  });

  const writingLabel = writing && (writing.target === "summary" ? t("cvb_writing_summary") : t("cvb_writing_bullets"));

  // A choice can have its own wording for one question ("No experience yet").
  function choiceLabel(key: string, choice: string): string {
    return t(`cvb_choice_${key}_${choice}` as MessageKey) || t(`cvb_choice_${choice}` as MessageKey);
  }

  // When an earlier answer is being changed, the box says which one, with a way back.
  const editing =
    state.resumeAt !== null && question ? (
      <p className="cvb-editing">
        <span>
          {t("cvb_editing")} <b>{t(`cvb_q_${question.key}` as MessageKey)}</b>
        </span>
        <button className="cvb-edit" type="button" onClick={onCancelEdit}>
          {t("cvb_cancel")}
        </button>
      </p>
    ) : null;

  // The two halves of a from–to answer, as picked or typed so far.
  const rangeParts = draft.split(" – ").map((part) => part.trim());
  while (rangeParts.length < 2) rangeParts.push("");

  let composer: ReactNode = null;
  if (writing) {
    composer = null;
  } else if (failure) {
    composer = (
      <div className="cvb-composer">
        <p className="cvb-error" role="alert">
          {failure.message}
        </p>
        <div className="cvb-row">
          <button className="btn btn-primary" type="button" onClick={failure.retry}>
            {t("cvb_retry")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={failure.skip}>
            {t("cvb_go_on")}
          </button>
        </div>
      </div>
    );
  } else if (state.pending) {
    const group = state.pending;
    composer = (
      <div className="cvb-composer">
        <p>{t(group === "job" ? "cvb_another_job" : "cvb_another_project")}</p>
        <div className="cvb-row">
          <button className="btn btn-ghost" type="button" onClick={() => setState(addAnother(state, true))}>
            {t("cvb_add_another")}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setState(addAnother(state, false))}>
            {t("cvb_continue")}
          </button>
        </div>
      </div>
    );
  } else if (question?.kind === "choice") {
    composer = (
      <div className="cvb-composer">
        {editing}
        <div className="cvb-row">
          {question.choices?.map((choice) => (
            <button className="btn btn-ghost" type="button" key={choice} onClick={() => submit(choice)}>
              {choiceLabel(question.key, choice)}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (question) {
    composer = (
      <div className="cvb-composer">
        {editing}
        {/* Dates are picked from the grid, never typed. */}
        {question.kind === "date" && <MonthGrid key={question.key} allowPresent={false} selected={draft} onPick={(value) => submit(value)} />}
        {question.kind === "range" && (
          <RangePicker key={question.key} from={rangeParts[0]} to={rangeParts[1]} onChange={(from, to) => setDraft(`${from} – ${to}`)} />
        )}
        <label className="visually-hidden" htmlFor="cvb-answer">
          {t("cvb_answer_label")}
        </label>
        {question.kind === "skills" && offered.length > 0 && (
          <div className="cvb-offered" role="group" aria-label={t("cvb_q_skills_found")}>
            {offered.map((skill) => (
              <button
                key={skill}
                type="button"
                className="cvb-chip"
                aria-pressed={!dropped.has(skill)}
                onClick={() =>
                  setDropped((current) => {
                    const next = new Set(current);
                    if (next.has(skill)) next.delete(skill);
                    else next.add(skill);
                    return next;
                  })
                }
              >
                {!dropped.has(skill) && <Check size={13} aria-hidden="true" />}
                <bdi dir="ltr">{skill}</bdi>
              </button>
            ))}
          </div>
        )}
        {question.kind !== "date" && question.kind !== "range" && (
        <textarea
          id="cvb-answer"
          placeholder={question.kind === "skills" && offered.length > 0 ? t("cvb_skills_more") : undefined}
          ref={inputRef}
          dir="auto"
          rows={2}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        )}
        <div className="cvb-row">
          <button className="btn btn-ghost" type="button" disabled={!state.log.some((e) => e.kind === "answer" || e.kind === "skipped")} onClick={() => onBack()}>
            {t("cvb_back")}
          </button>
          {(question.optional || followKey) && (
            <button className="btn btn-ghost" type="button" onClick={onSkip}>
              {t("cvb_skip")}
            </button>
          )}
          {question.kind !== "date" && (
            <button
              className="btn btn-primary cvb-send"
              type="button"
              disabled={thinking || (question.kind === "range" && !(rangeParts[0] && rangeParts[1]))}
              onClick={() => submit(draft)}
            >
              {thinking ? <span className="spinner" aria-hidden="true" /> : null}
              {t("cvb_send")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const ats = finished && resume ? checklist(resume) : [];

  async function downloadWord() {
    if (!resume) return;
    setDownloadError("");
    if (!(await readyInEnglish())) return;
    try {
      const blob = await cvDocx(resume);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resume.personal.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "CV"}-CV.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      track("cv-built");
    } catch {
      setDownloadError(t("cvb_download_failed"));
    }
  }

  async function printPdf() {
    setDownloadError("");
    if (!(await readyInEnglish())) return;
    const page = document.querySelector(".cvb-preview .cv-paper");
    if (!page) return;
    // A copy of the CV alone, sized to fill one A4 sheet (see #cv-print in index.css).
    const sheet = document.createElement("div");
    sheet.id = "cv-print";
    sheet.innerHTML = page.outerHTML;
    document.body.appendChild(sheet);
    fitToPage(sheet);
    document.body.classList.add("print-cv");
    const clear = () => {
      document.body.classList.remove("print-cv");
      sheet.remove();
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    track("cv-built");
    window.print();
    window.setTimeout(clear, 1000);
  }

  return (
    <main className="cvb wrap" aria-labelledby="cvb-chat-title">
      <h2 id="cvb-chat-title" className="visually-hidden">
        {t("cvb_title")}
      </h2>
      <div className="cvb-builder">
        <aside className="cvb-rail" aria-labelledby="cvb-rail-title">
          <h3 id="cvb-rail-title">{t("cvb_progress")}</h3>
          <ol>
            {STEPS.map((step, i) => {
              const cls = stepClass(i);
              return (
                <li className={cls} key={step} aria-current={cls === "is-current" ? "step" : undefined}>
                  <span className="cvb-dot" aria-hidden="true">
                    {cls === "is-done" ? <Check size={12} /> : i + 1}
                  </span>
                  {t(`cvb_step_${step}` as MessageKey)}
                </li>
              );
            })}
          </ol>
          <p className="cvb-hint">{t("cvb_saved")}</p>
          <button className="btn btn-ghost" type="button" onClick={startOver}>
            {t("cvb_restart")}
          </button>
        </aside>

        <section className="cvb-chat" aria-label={t("cvb_title")}>
          <div className="cvb-log" ref={logRef} aria-live="polite">
            {log}
            {writing && (
              <div className="cvb-written cvb-working" role="status">
                <p>
                  <span className="spinner spinner-sm" aria-hidden="true" /> {writingLabel}
                </p>
                {slow && <p className="cvb-hint">{t("cvb_slow")}</p>}
              </div>
            )}
            {error && (
              <p className="cvb-msg is-bot is-error" role="alert">
                {error}
              </p>
            )}
          </div>
          {composer}
        </section>

        <aside className="cvb-preview" aria-labelledby="cvb-preview-title">
          <h3 id="cvb-preview-title" className="cvb-preview-head">
            {t("cvb_preview")}
          </h3>
          {resume && (
            <CvPreview
              resume={resume}
              live={followKey ? undefined : draft}
              fresh={fresh}
              writing={writing && !writing.lines.length && !writing.shown ? writing.target : undefined}
              translatingLabel={t("cvb_translating")}
              final={finished}
            />
          )}
          {finished && (
            <div className="cvb-ats">
              <h4>{t("cvb_ats_title")}</h4>
              <ul>
                {ats.map((item) => (
                  <li key={item.id} className={item.ok ? "is-ok" : "is-todo"}>
                    {item.ok ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
                    {t(`cvb_ats_${item.id}` as MessageKey)}
                  </li>
                ))}
              </ul>
              <p className="cvb-hint">{t("cvb_ats_note")}</p>
              <div className="cvb-downloads">
                <button className="btn btn-primary" type="button" disabled={englishing} onClick={downloadWord}>
                  {t("cvb_word")}
                </button>
                <button className="btn btn-ghost" type="button" disabled={englishing} onClick={printPdf}>
                  {t("cvb_pdf")}
                </button>
              </div>
              <p className="cvb-hint">{t("cvb_pdf_hint")}</p>
              {englishing && (
                <p className="cvb-hint" role="status">
                  <span className="spinner spinner-sm" aria-hidden="true" /> {t("cvb_englishing")}
                </p>
              )}
              {downloadError && (
                <p className="cvb-error" role="alert">
                  {downloadError}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
