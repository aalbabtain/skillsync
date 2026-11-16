import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";

export type StepId = "cv" | "skills" | "postings" | "gap" | "plan";

const STEPS: { id: StepId; label: MessageKey }[] = [
  { id: "cv", label: "st_cv" },
  { id: "skills", label: "st_skills" },
  { id: "postings", label: "st_postings" },
  { id: "gap", label: "st_gap" },
  { id: "plan", label: "st_plan" },
];

type Props = {
  current: StepId;
  reachable: StepId[];
  soon: StepId[];
  onSelect: (step: StepId) => void;
};

export default function Stepper({ current, reachable, soon, onSelect }: Props) {
  const { t } = useI18n();

  return (
    <nav className="stepper wrap" aria-label={t("stepper_label")}>
      <ol>
        {STEPS.map((step, index) => {
          const isCurrent = step.id === current;
          const isSoon = soon.includes(step.id);
          const canGo = !isCurrent && !isSoon && reachable.includes(step.id);
          const className = [
            "stepper-item",
            isCurrent && "is-current",
            canGo && "is-done",
            isSoon && "is-soon",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={step.id}>
              <button
                className={className}
                onClick={() => onSelect(step.id)}
                disabled={!canGo}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className="stepper-n" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{t(step.label)}</span>
                {isSoon && <span className="stepper-soon">{t("st_soon")}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
