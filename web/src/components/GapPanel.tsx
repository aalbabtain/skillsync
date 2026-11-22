import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiRequestError, evaluateGap } from "../api";
import type { GapItem, GapResult, RequirementsResult, Skill } from "../api";
import { useI18n } from "../i18n";
import { useCountUp, useReducedMotion } from "../motion";
import type { MessageKey } from "../i18n";

type Props = {
  skills: Skill[];
  requirements: RequirementsResult;
  postingTitles: string[];
  onBack: () => void;
  /** "I have this skill" on a missing skill: adds it by hand, so it moves to needs proof. */
  onClaim: (item: GapItem) => void;
  onUnclaim: (name: string) => void;
  /** Opens the learning plan for the gap as it stands now. */
  onPlan: (result: GapResult) => void;
};

type Group = {
  id: "missing" | "needs_proof" | "have";
  title: MessageKey;
  description: MessageKey;
  items: GapItem[];
};

export default function GapPanel({
  skills,
  requirements,
  postingTitles,
  onBack,
  onClaim,
  onUnclaim,
  onPlan,
}: Props) {
  const { t, category, errorMessage } = useI18n();
  const [result, setResult] = useState<GapResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;

    evaluateGap(skills, requirements)
      .then((gap) => {
        if (active) setResult(gap);
      })
      .catch((caught) => {
        if (!active) return;
        setError(
          caught instanceof ApiRequestError
            ? { code: caught.code, message: caught.message }
            : { code: "network", message: "" },
        );
      });

    return () => {
      active = false;
    };
  }, [skills, requirements]);

  const reduced = useReducedMotion();
  const requiredProven = useCountUp(result?.summary.required_proven ?? 0, reduced);
  const preferredProven = useCountUp(result?.summary.preferred_proven ?? 0, reduced);
  const total = requirements.postings_count;
  const postingName = (index: number) =>
    postingTitles[index] || t("posting_n", { n: index + 1 });

  const groups: Group[] = result
    ? [
        { id: "missing", title: "grp_missing_h", description: "grp_missing_d", items: result.missing },
        {
          id: "needs_proof",
          title: "grp_proof_h",
          description: "grp_proof_d",
          items: result.needs_proof,
        },
        { id: "have", title: "grp_have_h", description: "grp_have_d", items: result.have },
      ]
    : [];

  return (
    <div className="gap">
      <div className="skills-head">
        <div>
          <p className="eyebrow">{t("gap_eyebrow")}</p>
          <h2 id="gap-title">{t("gap_h")}</h2>
          <p className="skills-count">{t("gap_lead")}</p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          {t("back")}
        </button>
      </div>

      {!result && !error && (
        <p className="upload-status" role="status">
          {t("gap_loading")}
        </p>
      )}

      {error && (
        <p className="upload-error" role="alert">
          {errorMessage(error.code, error.message || t("err_network"))}
        </p>
      )}

      {result && (
        <>
          <dl className="gap-summary">
            <div>
              <dt>{t("gap_required")}</dt>
              <dd>
                {t("asked", {
                  n: requiredProven,
                  total: result.summary.required_total,
                })}
              </dd>
            </div>
            {result.summary.preferred_total > 0 && (
              <div>
                <dt>{t("gap_preferred")}</dt>
                <dd>
                  {t("asked", {
                    n: preferredProven,
                    total: result.summary.preferred_total,
                  })}
                </dd>
              </div>
            )}
          </dl>

          {groups.map((group) => (
            <section
              className={`gap-group gap-${group.id}`}
              key={group.id}
              aria-labelledby={`gap-${group.id}-title`}
            >
              <div className="gap-group-head">
                <h3 id={`gap-${group.id}-title`}>
                  {t(group.title)} <span className="gap-count">{group.items.length}</span>
                </h3>
                <p>{t(group.description)}</p>
                {group.id === "needs_proof" && <p>{t("gap_added_note")}</p>}
              </div>

              {group.items.length === 0 ? (
                <p className="skills-empty">{t("grp_empty")}</p>
              ) : (
                <ul className="req-list">
                  {group.items.map((item) => (
                    <li className="req-row" key={item.name}>
                      <span className="req-name" dir="auto">
                        {item.name}
                      </span>
                      <span className="req-category">{category(item.category)}</span>
                      <span className="req-freq">
                        {t("asked", { n: item.frequency, total })}
                      </span>
                      <span className={`req-level req-level-${item.level}`}>
                        {item.level === "required" ? t("level_required") : t("level_preferred")}
                      </span>
                      <div className="req-foot">
                      <details className="req-quotes">
                        <summary>{t("show_evidence")}</summary>
                        <ul>
                          {item.cv_evidence && (
                            <li className="gap-cv">
                              <span className="req-source">{t("cv_quote")}</span>
                              <span className="req-quote" dir="auto">
                                {item.cv_evidence}
                              </span>
                            </li>
                          )}
                          {item.sources.map((source) => (
                            <li key={source.posting}>
                              <span className="req-source" dir="auto">
                                {postingName(source.posting)}
                              </span>
                              <span className="req-quote" dir="auto">
                                {source.evidence}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      {group.id === "missing" && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm gap-action"
                          onClick={() => onClaim(item)}
                          aria-label={t("claim_btn_for", { name: item.name })}
                        >
                          <Plus size={14} aria-hidden="true" /> {t("claim_btn")}
                        </button>
                      )}
                      {group.id === "needs_proof" && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm gap-action"
                          onClick={() => onUnclaim(item.name)}
                          aria-label={t("remove_skill", { name: item.name })}
                        >
                          {t("claim_remove")}
                        </button>
                      )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <div className="skills-actions gap-next">
            {result.missing.length + result.needs_proof.length > 0 ? (
              <button className="btn btn-primary" onClick={() => onPlan(result)}>
                {t("build_plan")}
              </button>
            ) : (
              <p className="skills-note">{t("plan_nothing")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
