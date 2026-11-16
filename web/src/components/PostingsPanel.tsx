import { useState } from "react";

import { ApiRequestError, extractRequirements } from "../api";
import type { PostingInput, RequirementsResult } from "../api";
import { useI18n } from "../i18n";

const MAX_POSTINGS = 10;
const MIN_POSTING_CHARS = 80;

type Draft = PostingInput & { id: number };

type Props = {
  confirmedCount: number;
  onBack: () => void;
  onResult: (result: RequirementsResult) => void;
};

let nextId = 1;

function emptyDraft(): Draft {
  return { id: nextId++, title: "", text: "" };
}

export default function PostingsPanel({ confirmedCount, onBack, onResult }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => [emptyDraft()]);
  const [titles, setTitles] = useState<string[]>([]);
  const [result, setResult] = useState<RequirementsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const { t, category, errorMessage } = useI18n();

  const ready = drafts.every((draft) => draft.text.trim().length >= MIN_POSTING_CHARS);

  function update(id: number, field: "title" | "text", value: string) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft)),
    );
    if (error) setError(null);
  }

  async function submit() {
    setRunning(true);
    setError(null);

    try {
      const postings = drafts.map(({ title, text }) => ({ title: title.trim(), text }));
      const extracted = await extractRequirements(postings);
      setTitles(postings.map((posting) => posting.title));
      setResult(extracted);
      onResult(extracted);
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
        </section>
      )}
    </div>
  );
}
