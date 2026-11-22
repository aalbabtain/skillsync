import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n";
import { MONTH_NAMES } from "./validate";

type Props = {
  // Called with "Jun 2027", or "Present" when the person still works there.
  onPick: (value: string) => void;
  allowPresent: boolean;
};

/**
 * A month-and-year picker in the site's colours, opened from a button under the answer box.
 * No day: a CV only needs the month. Escape or picking a month closes it.
 */
export default function MonthPicker({ onPick, allowPresent }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const names = MONTH_NAMES.map((_, i) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { month: "short" }).format(new Date(2000, i, 1)),
  );

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button.cvb-month")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(value: string) {
    setOpen(false);
    onPick(value);
  }

  return (
    <div className="cvb-picker">
      <button
        ref={toggle}
        className="btn btn-ghost"
        type="button"
        aria-expanded={open}
        aria-controls="cvb-month-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarDays size={16} aria-hidden="true" />
        {t("cvb_pick_month")}
      </button>
      {open && (
        <div className="cvb-picker-panel" id="cvb-month-panel" ref={panel} role="group" aria-label={t("cvb_pick_month")}>
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
            {names.map((name, i) => (
              <button className="cvb-month" type="button" key={i} onClick={() => pick(`${MONTH_NAMES[i]} ${year}`)}>
                {name}
              </button>
            ))}
          </div>
          {allowPresent && (
            <button className="btn btn-ghost cvb-present" type="button" onClick={() => pick("Present")}>
              {t("cvb_present")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
