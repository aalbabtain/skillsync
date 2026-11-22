import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError, streamPlan } from "../api";
import type { GapItem, PlanCard, PlanDone, Skill } from "../api";
import { useI18n } from "../i18n";
import type { Lang, MessageKey } from "../i18n";

type Props = {
  gap: { missing: GapItem[]; needs_proof: GapItem[] };
  skills: Skill[];
  postingsCount: number;
  onBack: () => void;
};

type Decision = {
  status: "pending" | "approved" | "rejected";
  editing: boolean;
  weeks: number;
  removed: number[];
  checked: number[];
};

const PHASES = ["quick", "core", "extra", "prove"] as const;
const HOURS = [5, 10, 20];
const BASE_HOURS = 10;

/** Which form of a counted word to use. Arabic: 1 and 2 have their own forms, 3 to 10 take
 *  the plural, 11 and up the singular; English only tells 1 from the rest. */
function countForm(n: number): "1" | "2" | "few" | "many" {
  if (n === 1) return "1";
  if (n === 2) return "2";
  const lastTwo = n % 100;
  return lastTwo >= 3 && lastTwo <= 10 ? "few" : "many";
}

export default function PlanPanel({ gap, skills, postingsCount, onBack }: Props) {
  const { t, lang, errorMessage } = useI18n();
  const [cards, setCards] = useState<PlanCard[]>([]);
  const [done, setDone] = useState<PlanDone | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [planLang, setPlanLang] = useState<Lang>(lang);
  const [hours, setHours] = useState(BASE_HOURS);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [approved, setApproved] = useState(false);
  const total = gap.missing.length + gap.needs_proof.length;
  const run = useRef(0);

  const count = (base: "plan_skills" | "plan_hours" | "plan_weeks", n: number) => {
    const form = countForm(n);
    const key = (base === "plan_hours" && (form === "1" || form === "2") ? `${base}_many` : `${base}_${form}`) as MessageKey;
    return t(key, { n });
  };

  const build = useCallback(
    (language: Lang) => {
      const id = ++run.current;
      setCards([]);
      setDone(null);
      setError(null);
      setApproved(false);
      setDecisions({});
      setPlanLang(language);
      streamPlan({ language, gap, skills, postings_count: postingsCount }, (card) => {
        if (run.current !== id) return;
        setCards((current) => [...current, card]);
        setDecisions((current) => ({
          ...current,
          [card.id]: { status: "pending", editing: false, weeks: card.weeks, removed: [], checked: [] },
        }));
      })
        .then((result) => {
          if (run.current === id) setDone(result);
        })
        .catch((caught) => {
          if (run.current !== id) return;
          setError(
            caught instanceof ApiRequestError
              ? { code: caught.code, message: caught.message }
              : { code: "network", message: "" },
          );
        });
    },
    [gap, skills, postingsCount],
  );

  useEffect(() => {
    build(lang);
    return () => {
      run.current += 1;
    };
    // The plan is written once in the language of the moment; a later switch offers a rewrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  const decide = (id: string, change: (d: Decision) => Partial<Decision>) => {
    setApproved(false);
    setDecisions((current) => ({ ...current, [id]: { ...current[id], ...change(current[id]) } }));
  };

  // Week ranges in plan order, skipping rejected skills; the hours chosen stretch or shrink them.
  const ranges: Record<string, [number, number]> = {};
  let week = 1;
  for (const card of cards) {
    const decision = decisions[card.id];
    if (!decision || decision.status === "rejected") continue;
    const span = Math.max(1, Math.ceil((decision.weeks * BASE_HOURS) / hours));
    ranges[card.id] = [week, week + span - 1];
    week += span;
  }
  const totalWeeks = week - 1;
  const kept = cards.filter((card) => decisions[card.id]?.status !== "rejected");
  const decided = cards.filter((card) => decisions[card.id]?.status !== "pending").length;
  const streaming = !done && !error;
  const weekRange = ([a, b]: [number, number]) => (a === b ? t("plan_week", { a }) : t("plan_weeks_range", { a, b }));

  return (
    <div className="plan">
      <div className="skills-head">
        <div>
          <p className="eyebrow">{t("plan_eyebrow")}</p>
          <h2 id="plan-title">{t("plan_h")}</h2>
          <p className="skills-count">{t("plan_lead")}</p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          {t("back")}
        </button>
      </div>

      {planLang !== lang && cards.length > 0 && !streaming && (
        <p className="plan-rewrite">
          <button className="btn btn-ghost" type="button" onClick={() => build(lang)}>
            {t("plan_rewrite")}
          </button>
        </p>
      )}

      {cards.length > 0 && (
        <>
          <details className="plan-how">
            <summary>{t("plan_how_title")}</summary>
            <ol>
              <li>{t("plan_how_1")}</li>
              <li>{t(done?.retrieval === "keywords" ? "plan_how_2_keywords" : "plan_how_2")}</li>
              <li>{t("plan_how_3")}</li>
            </ol>
          </details>

          <div className="plan-summary">
            <p className="plan-totals">
              {count("plan_skills", kept.length)} · {count("plan_hours", hours)} ·{" "}
              <span>{t("plan_about", { weeks: count("plan_weeks", totalWeeks) })}</span>
            </p>
            <div className="plan-hours">
              <span id="plan-hours-label">{t("plan_hours")}</span>
              <div className="plan-seg" role="group" aria-labelledby="plan-hours-label">
                {HOURS.map((h) => (
                  <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="plan-timeline">
        {PHASES.map((phase) => {
          const inPhase = cards.filter((card) => card.phase === phase);
          if (!inPhase.length) return null;
          const live = inPhase.filter((card) => ranges[card.id]);
          return (
            <section className="plan-phase" key={phase} aria-labelledby={`plan-${phase}`}>
              <div className="plan-phase-head">
                <h3 id={`plan-${phase}`}>{t(`plan_phase_${phase}` as MessageKey)}</h3>
                {phase !== "prove" && live.length > 0 && (
                  <span className="plan-range">
                    {weekRange([ranges[live[0].id][0], ranges[live[live.length - 1].id][1]])}
                  </span>
                )}
                <p>{t(`plan_phase_${phase}_d` as MessageKey)}</p>
              </div>
              <div className="plan-cards">
                {inPhase.map((card) => (
                  <PlanCardView
                    key={card.id}
                    card={card}
                    decision={decisions[card.id]}
                    range={ranges[card.id]}
                    streaming={streaming}
                    weekRange={weekRange}
                    count={count}
                    decide={(change) => decide(card.id, change)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {streaming && (
        <p className="plan-building" role="status">
          <span className="spinner spinner-sm" aria-hidden="true" />
          {t("plan_building", { a: cards.length, b: Math.min(total, 12) })}
        </p>
      )}

      {error && (
        <div className="upload-error" role="alert">
          <span>{errorMessage(error.code, error.message || t("err_network"))}</span>
          {!["PLAN_QUOTA_EXCEEDED", "RATE_LIMITED", "PLAN_EMPTY"].includes(error.code) && (
            <button className="btn btn-ghost" onClick={() => build(lang)}>
              {t("retry")}
            </button>
          )}
        </div>
      )}

      {done && (
        <>
          {done.later.length > 0 && (
            <p className="skills-note">
              {t("plan_later", { names: done.later.join(lang === "ar" ? "، " : ", ") })}
            </p>
          )}
          <div className="skills-actions plan-finish">
            <p role="status">{t("plan_decided", { a: decided, b: cards.length })}</p>
            <button
              className="btn btn-primary"
              type="button"
              disabled={decided < cards.length || kept.length === 0}
              onClick={() => setApproved(true)}
            >
              {t("plan_approve_all")}
            </button>
          </div>
          {approved && (
            <div className="plan-approved" role="status">
              <p>
                <strong>{t("plan_done_title")}</strong> {t("plan_done_body")}
              </p>
              <button className="btn btn-ghost" type="button" onClick={() => window.print()}>
                {t("plan_print")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type CardProps = {
  card: PlanCard;
  decision: Decision | undefined;
  range: [number, number] | undefined;
  streaming: boolean;
  weekRange: (range: [number, number]) => string;
  count: (base: "plan_skills" | "plan_hours" | "plan_weeks", n: number) => string;
  decide: (change: (d: Decision) => Partial<Decision>) => void;
};

function PlanCardView({ card, decision, range, streaming, weekRange, count, decide }: CardProps) {
  const { t } = useI18n();
  if (!decision) return null;

  if (decision.status === "rejected") {
    return (
      <article className="plan-card is-rejected">
        <p>
          <s dir="ltr">{card.name}</s> · {t("plan_rejected", { name: card.name })}
        </p>
        <button className="plan-link" type="button" onClick={() => decide(() => ({ status: "pending" }))}>
          {t("plan_undo")}
        </button>
      </article>
    );
  }

  const tag =
    card.kind === "prove"
      ? { className: "proof", text: t("grp_proof_h") }
      : card.level === "required"
        ? { className: "required", text: t("plan_required", { n: card.frequency, total: card.postings_count }) }
        : { className: "preferred", text: t("plan_preferred", { n: card.frequency, total: card.postings_count }) };
  const toggle = (list: number[], index: number) =>
    list.includes(index) ? list.filter((i) => i !== index) : [...list, index];

  return (
    <article
      className={decision.status === "approved" ? "plan-card is-approved" : "plan-card"}
      aria-labelledby={`card-${card.id}`}
    >
      <div className="plan-card-head">
        <h4 id={`card-${card.id}`} dir="ltr">
          {card.name}
        </h4>
        <span className={`plan-tag ${tag.className}`}>{tag.text}</span>
        {range && <span className="plan-weeks">{weekRange(range)}</span>}
      </div>
      {card.builds_on && <p className="plan-why">{t("plan_builds_on", { name: card.builds_on })}</p>}

      <div className={card.topics.length ? "plan-body" : "plan-body is-single"}>
        {card.topics.length > 0 && (
          <div className="plan-topics">
            <h5>{t("plan_topics")}</h5>
            <ul>
              {card.topics.map((topic, index) =>
                decision.removed.includes(index) ? null : (
                  <li key={topic.source.url + index}>
                    <label>
                      <input
                        type="checkbox"
                        checked={decision.checked.includes(index)}
                        onChange={() => decide((d) => ({ checked: toggle(d.checked, index) }))}
                      />
                      <span dir="auto">{topic.text}</span>
                      {decision.editing && (
                        <button
                          className="plan-remove"
                          type="button"
                          aria-label={t("plan_remove_topic", { topic: topic.text })}
                          onClick={(event) => {
                            event.preventDefault();
                            decide((d) => ({ removed: [...d.removed, index] }));
                          }}
                        >
                          ×
                        </button>
                      )}
                    </label>
                    <a className="plan-source" href={topic.source.url} target="_blank" rel="noreferrer" dir="ltr">
                      {topic.source.publisher} · {topic.source.title} ↗
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
        <div className="plan-project">
          <h5>{t("plan_project")}</h5>
          <strong dir="auto">{card.project.title}</strong>
          <p dir="auto">{card.project.summary}</p>
          <p className="plan-proves">{t("plan_proves")}</p>
        </div>
      </div>

      {card.docs_url ? (
        <a className="plan-docs" href={card.docs_url} target="_blank" rel="noreferrer">
          {t("plan_docs")} ↗
        </a>
      ) : (
        <p className="plan-why">{t("plan_no_library")}</p>
      )}

      {!streaming && decision.editing && (
        <div className="plan-edit">
          <span>{t("plan_weeks_label")}</span>
          <span className="plan-stepper">
            <button
              type="button"
              aria-label={t("plan_less")}
              disabled={decision.weeks <= 1}
              onClick={() => decide((d) => ({ weeks: Math.max(1, d.weeks - 1) }))}
            >
              −
            </button>
            <output>{count("plan_weeks", decision.weeks)}</output>
            <button
              type="button"
              aria-label={t("plan_more")}
              disabled={decision.weeks >= 8}
              onClick={() => decide((d) => ({ weeks: Math.min(8, d.weeks + 1) }))}
            >
              +
            </button>
          </span>
          <span>{t("plan_at_hours")}</span>
        </div>
      )}

      {!streaming && (
        <div className="plan-actions">
          <button
            className={decision.status === "approved" ? "btn btn-ghost is-on" : "btn btn-ghost"}
            type="button"
            aria-pressed={decision.status === "approved"}
            onClick={() => decide((d) => ({ status: d.status === "approved" ? "pending" : "approved", editing: false }))}
          >
            {decision.status === "approved" && <Check size={15} aria-hidden="true" />}
            {decision.status === "approved" ? t("plan_approved") : t("plan_approve")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            aria-expanded={decision.editing}
            onClick={() =>
              decide((d) => ({ editing: !d.editing, status: d.status === "approved" ? "pending" : d.status }))
            }
          >
            {decision.editing ? t("plan_done_editing") : t("plan_edit")}
          </button>
          <button
            className="btn btn-ghost plan-reject"
            type="button"
            onClick={() => decide(() => ({ status: "rejected", editing: false }))}
          >
            {t("plan_reject")}
          </button>
        </div>
      )}
    </article>
  );
}
