import { Check, Circle, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { track } from "../analytics";
import { ApiRequestError, createRun, cvDocx, cvFollowUp, cvImport, cvTranslate, getSkillCatalog, streamCvLines } from "../api";
import type { CvLine } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { checklist } from "./ats";
import CvPreview from "./CvPreview";
import { addAnother, addDetail, answer, back, canEdit, current, done, load, replaceLines, saveItem, skip, start, toResume } from "./engine";
import { FOLLOW_UP_KEYS, groupKeys, SCRIPT, STEPS, TRANSLATED_KEYS } from "./script";
import type { Group, Item, LogEntry, State } from "./types";
import { hasArabic, isSkipWord } from "./validate";

const STORAGE_KEY = "skillsync-cv";
const WORD_MS = 55;
const FOLLOW_UP_MIN_WORDS = 8;

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
  const { t, errorMessage } = useI18n();
  const [state, setState] = useState<State | null>(readSaved);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [importing, setImporting] = useState<"idle" | "choose" | "reading">("idle");
  const [importError, setImportError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
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
          const withEnglish = { ...s, english: { ...translated.english, ...s.english }, log: [...s.log, entry] };
          return saveItem(withEnglish, group, texts);
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

  // At the end, the short Arabic answers left get their English form once.
  useEffect(() => {
    if (!state || !done(state) || writing) return;
    const left = TRANSLATED_KEYS.filter((key) => state.answers[key] && hasArabic(state.answers[key]) && !state.english[key]);
    if (!left.length) return;
    let active = true;
    translateNeeded(state, left).then((next) => {
      if (active && next !== state) setState((s) => (s ? { ...s, english: { ...next.english, ...s.english } } : s));
    });
    return () => {
      active = false;
    };
  }, [state, writing, translateNeeded]);

  // ---------- The conversation ----------

  async function submit(text: string) {
    if (!state || writing) return;
    setError("");

    if (followKey) {
      setState(addDetail(state, followKey, text));
      setFollowKey(null);
      setDraft("");
      return;
    }

    const question = current(state);
    const result = answer(state, text);
    if (result.error) {
      setError(t(`cvb_bad_${result.error}` as MessageKey));
      return;
    }
    setDraft("");
    setState(result.state);

    if (result.needs === "summary") return writeSummary(result.state);
    if (result.needs === "job" || result.needs === "project") return writeItem(result.state, result.needs);

    // One follow-up per job or project when its description is too thin to write from.
    if (question && FOLLOW_UP_KEYS.includes(question.key) && !isSkipWord(text)) {
      let follow: string | null = null;
      if (!demoMode) {
        try {
          follow = await cvFollowUp(text);
        } catch {
          follow = null;
        }
      }
      if (!follow && text.trim().split(/\s+/).length < FOLLOW_UP_MIN_WORDS) follow = t("cvb_follow_up");
      if (follow) {
        const entry: LogEntry = { kind: "follow", key: question.key, text: follow };
        setState((s) => (s ? { ...s, log: [...s.log, entry] } : s));
        setFollowKey(question.key);
      }
    }
  }

  function onSkip() {
    if (!state || writing) return;
    setError("");
    if (followKey) {
      setFollowKey(null);
      return;
    }
    const result = skip(state);
    if (result.error) {
      setError(t(`cvb_bad_${result.error}` as MessageKey));
      return;
    }
    setDraft("");
    setState(result.state);
    if (result.needs === "job" || result.needs === "project") writeItem(result.state, result.needs);
  }

  function onBack(key?: string) {
    if (!state || writing) return;
    const next = back(state, key);
    if (next === state) return;
    setError("");
    setFollowKey(null);
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
    setFollowKey(null);
  }

  async function importCv(file: File) {
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
      put("email", contact.email);
      put("phone", contact.phone);
      put("linkedin", contact.linkedin);
      put("github", contact.github);
      put("school", hasArabic(resume.school) ? "" : resume.school);
      put("degree", resume.degree);
      put("grad", resume.grad);
      put("gpa", resume.gpa);
      put("skills", resume.skills.join(", "));
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
    return toResume(live, categoryOf);
  }, [state, draft, question, followKey, writing, categoryOf]);

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
            <div className="cvb-upload">
              <label htmlFor="cvb-file">{t("cvb_upload_label")}</label>
              <input
                id="cvb-file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={importing === "reading"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importCv(file);
                }}
              />
              {importing === "reading" && (
                <p role="status">
                  <span className="spinner spinner-sm" aria-hidden="true" /> {t("cvb_reading")}
                </p>
              )}
              {importError && (
                <p className="cvb-error" role="alert">
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
        const example = t(`cvb_ex_${entry.key}` as MessageKey);
        return (
          <p className="cvb-msg is-bot" key={index}>
            {t(`cvb_q_${entry.key}` as MessageKey)}
            {q?.optional && <span className="cvb-ex">{t("cvb_optional")}</span>}
            {example && <span className="cvb-ex">{example}</span>}
          </p>
        );
      }
      case "answer": {
        const shown = entry.key === "hasJob" ? t(entry.text === "yes" ? "cvb_choice_yes" : "cvb_choice_no") : entry.text;
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
        <div className="cvb-row">
          {question.choices?.map((choice) => (
            <button className="btn btn-ghost" type="button" key={choice} onClick={() => submit(choice)}>
              {t(`cvb_choice_${choice}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (question) {
    composer = (
      <div className="cvb-composer">
        <label className="visually-hidden" htmlFor="cvb-answer">
          {t("cvb_answer_label")}
        </label>
        <textarea
          id="cvb-answer"
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
        <div className="cvb-row">
          <button className="btn btn-ghost" type="button" disabled={!state.log.some((e) => e.kind === "answer" || e.kind === "skipped")} onClick={() => onBack()}>
            {t("cvb_back")}
          </button>
          {(question.optional || followKey) && (
            <button className="btn btn-ghost" type="button" onClick={onSkip}>
              {t("cvb_skip")}
            </button>
          )}
          <button className="btn btn-primary cvb-send" type="button" onClick={() => submit(draft)}>
            {t("cvb_send")}
          </button>
        </div>
      </div>
    );
  }

  const ats = finished && resume ? checklist(resume) : [];

  async function downloadWord() {
    if (!resume) return;
    setDownloadError("");
    try {
      const blob = await cvDocx(resume);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resume.personal.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "CV"}-CV.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      track("cv-download");
    } catch {
      setDownloadError(t("cvb_download_failed"));
    }
  }

  function printPdf() {
    document.body.classList.add("print-cv");
    const clear = () => {
      document.body.classList.remove("print-cv");
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    track("cv-download");
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
              <p className="cvb-written cvb-typing" dir="auto">
                {writingLabel}
              </p>
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
          {resume && <CvPreview resume={resume} live={followKey ? undefined : draft} fresh={fresh} translatingLabel={t("cvb_translating")} />}
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
                <button className="btn btn-primary" type="button" onClick={downloadWord}>
                  {t("cvb_word")}
                </button>
                <button className="btn btn-ghost" type="button" onClick={printPdf}>
                  {t("cvb_pdf")}
                </button>
              </div>
              <p className="cvb-hint">{t("cvb_pdf_hint")}</p>
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
