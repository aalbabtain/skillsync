import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiRequestError, streamRequirements } from "../api";
import type { PostingInput, RequirementsResult } from "../api";
import { useI18n } from "../i18n";

const MAX_POSTINGS = 10;
const MIN_POSTING_CHARS = 80;
// With nothing new for this long, the page says the model is slow rather than look stuck.
const SLOW_AFTER_MS = 8000;

type Draft = PostingInput & { id: number };

type Props = {
  confirmedCount: number;
  onBack: () => void;
  onResult: (result: RequirementsResult, titles: string[]) => void;
  onNext: () => void;
};

let nextId = 1;

function emptyDraft(): Draft {
  return { id: nextId++, title: "", text: "" };
}

export default function PostingsPanel({ confirmedCount, onBack, onResult, onNext }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => [emptyDraft()]);
  const [titles, setTitles] = useState<string[]>([]);
  const [result, setResult] = useState<RequirementsResult | null>(null);
  const [running, setRunning] = useState(false);
  // What each posting has turned up so far while the model is still reading.
  const [live, setLive] = useState<{ title: string; names: string[]; done: boolean; started: boolean }[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [slow, setSlow] = useState(false);
  const lastEvent = useRef(0);
  const { t, category, errorMessage } = useI18n();

  useEffect(() => {
    if (!running) {
      setSlow(false);
      return;
    }
    const timer = window.setInterval(() => setSlow(Date.now() - lastEvent.current > SLOW_AFTER_MS), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const ready = drafts.every((draft) => draft.text.trim().length >= MIN_POSTING_CHARS);

  function update(id: number, field: "title" | "text", value: string) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft)),
    );
    if (error) setError(null);
  }

  async function submit() {
    lastEvent.current = Date.now();
    setRunning(true);
    setError(null);

    try {
      const postings = drafts.map(({ title, text }) => ({ title: title.trim(), text }));
      setResult(null);
      setLive(postings.map((posting) => ({ title: posting.title, names: [], done: false, started: false })));
      const extracted = await streamRequirements(postings, (event) => {
        lastEvent.current = Date.now();
        setSlow(false);
        setLive((current) =>
          current.map((row, index) => {
            if (index !== event.posting) return row;
            if (event.type === "posting") return { ...row, started: true };
            if (event.type === "requirement") return { ...row, names: [...row.names, event.name] };
            return { ...row, done: true };
          }),
        );
      });
      setTitles(postings.map((posting) => posting.title));
      setResult(extracted);
      onResult(
        extracted,
        postings.map((posting) => posting.title),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? { code: caught.code, message: caught.message }
          : { code: "network", message: "" },
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="postings">
      <div className="skills-head">
        <div>
          <p className="eyebrow">{t("postings_eyebrow")}</p>
          <h2 id="postings-title">{t("postings_h")}</h2>
          <p className="skills-count">
            {t("postings_lead", { n: confirmedCount })}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          {t("back")}
        </button>
      </div>

      <ol className="posting-list">
        {drafts.map((draft, index) => {
          const short =
            draft.text.trim().length > 0 && draft.text.trim().length < MIN_POSTING_CHARS;
          return (
            <li className="posting-card" key={draft.id}>
              <div className="posting-card-head">
                <h3>{t("posting_n", { n: index + 1 })}</h3>
                {drafts.length > 1 && (
                  <button
                    className="chip-remove"
                    onClick={() =>
                      setDrafts((current) => current.filter((item) => item.id !== draft.id))
                    }
                    aria-label={t("remove_posting", { n: index + 1 })}
                  >
                    ×
                  </button>
                )}
              </div>
              <label className="posting-label" htmlFor={`title-${draft.id}`}>
                {t("title_label")}
              </label>
              <input
                id={`title-${draft.id}`}
                className="posting-input"
                value={draft.title}
                maxLength={120}
                dir={draft.title ? "auto" : undefined}
                placeholder={t("title_ph")}
                onChange={(event) => update(draft.id, "title", event.target.value)}
              />
              <label className="posting-label" htmlFor={`text-${draft.id}`}>
                {t("text_label")}
              </label>
              <textarea
                id={`text-${draft.id}`}
                className="posting-input posting-text"
                value={draft.text}
                dir={draft.text ? "auto" : undefined}
                rows={7}
                placeholder={t("text_ph")}
                aria-invalid={short}
                onChange={(event) => update(draft.id, "text", event.target.value)}
              />
              {short && (
                <p className="posting-hint">
                  {t("short_hint")}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="skills-actions">
        <button
          className="btn btn-ghost"
          disabled={drafts.length >= MAX_POSTINGS || running}
          onClick={() => setDrafts((current) => [...current, emptyDraft()])}
        >
          {t("add_posting")}
        </button>
        <button className="btn btn-primary" disabled={!ready || running} onClick={submit}>
          {running && <span className="spinner" aria-hidden="true" />}
          {running ? t("extracting_req") : t("extract_req")}
        </button>
      </div>

      {running && live.length > 0 && (
        <ol className="live-postings" aria-label={t("req_live_label")}>
          {live.map((row, index) => (
            <li key={index} className={row.done ? "is-done" : row.started ? "is-active" : ""}>
              <p className="live-posting-head">
                <span className="stage-mark" aria-hidden="true">
                  {row.done ? <Check size={13} /> : row.started ? <span className="spinner spinner-sm" /> : null}
                </span>
                <span>
                  {t("req_live_posting", { n: index + 1 })}
                  {row.title && <bdi> · {row.title}</bdi>}
                </span>
                {row.started && (
                  <span className="live-count" aria-live="polite">
                    {t("req_live_found", { n: row.names.length })}
                  </span>
                )}
              </p>
              {row.names.length > 0 && (
                <ul>
                  {row.names.map((name) => (
                    <li className="live-chip" key={name}>
                      <Check size={12} aria-hidden="true" />
                      <span dir="ltr">{name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {running && slow && (
        <p className="live-slow" role="status">
          {t("req_live_slow")}
        </p>
      )}

      {error && (
        <p className="upload-error" role="alert">
          {errorMessage(error.code, error.message || t("err_network"))}
        </p>
      )}

      {result && (
        <section className="req-results" aria-labelledby="req-title">
          <h3 id="req-title" className="req-title">
            {t("req_h", { n: result.postings_count })}
          </h3>
          {result.dropped_count > 0 && (
            <p className="skills-note">
              {t("req_dropped", { n: result.dropped_count })}
            </p>
          )}

          {result.requirements.length === 0 ? (
            <p className="skills-empty">{t("req_empty")}</p>
          ) : (
            <ul className="req-list">
              <li className="req-row req-row-head" aria-hidden="true">
                <span>{t("col_skill")}</span>
                <span>{t("col_category")}</span>
                <span>{t("col_asked")}</span>
                <span>{t("col_level")}</span>
              </li>
              {result.requirements.map((item) => (
                <li className="req-row" key={item.name}>
                  <span className="req-name" dir="auto">
                    {item.name}
                  </span>
                  <span className="req-category">{category(item.category)}</span>
                  <span className="req-freq">
                    {t("asked", { n: item.frequency, total: result.postings_count })}
                  </span>
                  <span className={`req-level req-level-${item.level}`}>
                    {item.level === "required" ? t("level_required") : t("level_preferred")}
                  </span>
                  <details className="req-quotes">
                    <summary>{t("show_evidence")}</summary>
                    <ul>
                      {item.sources.map((source) => (
                        <li key={source.posting}>
                          <span className="req-source" dir="auto">
                            {titles[source.posting] || t("posting_n", { n: source.posting + 1 })}
                          </span>
                          <span className="req-quote" dir="auto">
                            {source.evidence}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}

          {result.requirements.length > 0 && (
            <div className="skills-actions">
              <button className="btn btn-primary" onClick={onNext}>
                {t("next_gap")} <span className="arrow" aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
