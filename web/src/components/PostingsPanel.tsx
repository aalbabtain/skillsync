import { useState } from "react";

import { ApiRequestError, extractRequirements } from "../api";
import type { PostingInput, RequirementsResult } from "../api";

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
  const [error, setError] = useState("");

  const ready = drafts.every((draft) => draft.text.trim().length >= MIN_POSTING_CHARS);

  function update(id: number, field: "title" | "text", value: string) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft)),
    );
    if (error) setError("");
  }

  async function submit() {
    setRunning(true);
    setError("");

    try {
      const postings = drafts.map(({ title, text }) => ({ title: title.trim(), text }));
      const extracted = await extractRequirements(postings);
      setTitles(postings.map((posting, index) => posting.title || `Posting ${index + 1}`));
      setResult(extracted);
      onResult(extracted);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "The API is not reachable. Check that the backend is running.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="postings">
      <div className="skills-head">
        <div>
          <p className="eyebrow">Agent 2 · Requirements Extractor</p>
          <h2 id="postings-title">Job postings</h2>
          <p className="skills-count">
            {confirmedCount} {confirmedCount === 1 ? "skill" : "skills"} confirmed. Paste the
            postings you want to apply for, up to {MAX_POSTINGS}.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>

      <ol className="posting-list">
        {drafts.map((draft, index) => {
          const short =
            draft.text.trim().length > 0 && draft.text.trim().length < MIN_POSTING_CHARS;
          return (
            <li className="posting-card" key={draft.id}>
              <div className="posting-card-head">
                <h3>Posting {index + 1}</h3>
                {drafts.length > 1 && (
                  <button
                    className="chip-remove"
                    onClick={() =>
                      setDrafts((current) => current.filter((item) => item.id !== draft.id))
                    }
                    aria-label={`Remove posting ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
              <label className="posting-label" htmlFor={`title-${draft.id}`}>
                Title (optional)
              </label>
              <input
                id={`title-${draft.id}`}
                className="posting-input"
                value={draft.title}
                maxLength={120}
                dir="auto"
                placeholder="e.g. Backend Developer at a Riyadh fintech"
                onChange={(event) => update(draft.id, "title", event.target.value)}
              />
              <label className="posting-label" htmlFor={`text-${draft.id}`}>
                Posting text
              </label>
              <textarea
                id={`text-${draft.id}`}
                className="posting-input posting-text"
                value={draft.text}
                dir="auto"
                rows={7}
                placeholder="Paste the full posting: responsibilities, requirements, nice to have…"
                aria-invalid={short}
                onChange={(event) => update(draft.id, "text", event.target.value)}
              />
              {short && (
                <p className="posting-hint">
                  At least {MIN_POSTING_CHARS} characters. Paste the whole posting.
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
          + Add another posting
        </button>
        <button className="btn btn-primary" disabled={!ready || running} onClick={submit}>
          {running && <span className="spinner" aria-hidden="true" />}
          {running ? "Extracting…" : "Extract requirements"}
        </button>
      </div>

      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="req-results" aria-labelledby="req-title">
          <h3 id="req-title" className="req-title">
            Requirements from {result.postings_count}{" "}
            {result.postings_count === 1 ? "posting" : "postings"}
          </h3>
          {result.dropped_count > 0 && (
            <p className="skills-note">
              {result.dropped_count} {result.dropped_count === 1 ? "skill" : "skills"} removed: no
              supporting quote in the posting.
            </p>
          )}

          {result.requirements.length === 0 ? (
            <p className="skills-empty">No skills found in these postings.</p>
          ) : (
            <ul className="req-list">
              <li className="req-row req-row-head" aria-hidden="true">
                <span>Skill</span>
                <span>Category</span>
                <span>Asked in</span>
                <span>Level</span>
              </li>
              {result.requirements.map((item) => (
                <li className="req-row" key={item.name}>
                  <span className="req-name">{item.name}</span>
                  <span className="req-category">{item.category}</span>
                  <span className="req-freq">
                    {item.frequency} of {result.postings_count}
                  </span>
                  <span className={`req-level req-level-${item.level}`}>
                    {item.level === "required" ? "Required" : "Preferred"}
                  </span>
                  <details className="req-quotes">
                    <summary>Show {item.sources.length === 1 ? "quote" : "quotes"}</summary>
                    <ul>
                      {item.sources.map((source) => (
                        <li key={source.posting}>
                          <span className="req-source">{titles[source.posting]}</span>
                          <q dir="auto">{source.evidence}</q>
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
