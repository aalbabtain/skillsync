import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../i18n";
import { MONTH_NAMES } from "./validate";

type GridProps = {
  // Called with "Jun 2027", or "Present" when allowed and chosen.
  onPick: (value: string) => void;
  allowPresent: boolean;
  // The value already chosen, marked in the grid.
  selected?: string;
  // The year shown first when nothing is chosen yet.
  startYear?: number;
};

/**
 * A month-and-year grid in the site's colours, always open: dates are picked, not typed, and
 * a CV needs no day. The year arrows point back and forward in the reading direction.
 */
export function MonthGrid({ onPick, allowPresent, selected = "", startYear }: GridProps) {
  const { t, lang } = useI18n();
  const [picked, pickedYear] = selected.split(" ");
  const [year, setYear] = useState(() => Number(pickedYear) || startYear || new Date().getFullYear());
  const names = MONTH_NAMES.map((_, i) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { month: "short" }).format(new Date(2000, i, 1)),
  );

  return (
    <div className="cvb-picker-panel" role="group" aria-label={t("cvb_pick_month")}>
      <div className="cvb-picker-year">
        <button className="cvb-year-step" type="button" aria-label={t("cvb_prev_year")} onClick={() => setYear((y) => y - 1)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <output dir="ltr" aria-live="polite">
          {year}
        </output>
        <button className="cvb-year-step" type="button" aria-label={t("cvb_next_year")} onClick={() => setYear((y) => y + 1)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="cvb-months">
        {names.map((name, i) => {
          const value = `${MONTH_NAMES[i]} ${year}`;
          return (
            <button
              className="cvb-month"
              type="button"
              key={i}
              aria-pressed={picked === MONTH_NAMES[i] && Number(pickedYear) === year}
              onClick={() => onPick(value)}
            >
              {name}
            </button>
          );
        })}
      </div>
      {allowPresent && (
        <button className="btn btn-ghost cvb-present" type="button" aria-pressed={selected === "Present"} onClick={() => onPick("Present")}>
          {t("cvb_present")}
        </button>
      )}
    </div>
  );
}

type RangeProps = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
};

/** Start and end in one answer: pick the start, then the end (or Present). */
export function RangePicker({ from, to, onChange }: RangeProps) {
  const { t } = useI18n();
  const [side, setSide] = useState<"from" | "to">(from ? "to" : "from");

  return (
    <div className="cvb-range">
      <div className="cvb-range-tabs" role="group">
        {(["from", "to"] as const).map((which) => (
          <button
            key={which}
            type="button"
            className="cvb-range-tab"
            aria-pressed={side === which}
            onClick={() => setSide(which)}
          >
            <CalendarDays size={15} aria-hidden="true" />
            <span>{t(which === "from" ? "cvb_from" : "cvb_to")}</span>
            <bdi dir="ltr">{(which === "from" ? from : to) || "…"}</bdi>
          </button>
        ))}
      </div>
      <MonthGrid
        key={side}
        allowPresent={side === "to"}
        selected={side === "from" ? from : to}
        startYear={side === "to" ? Number(from.split(" ")[1]) || undefined : undefined}
        onPick={(value) => {
          if (side === "from") {
            onChange(value, to);
            setSide("to");
          } else {
            onChange(from, value);
          }
        }}
      />
    </div>
  );
}
