import { GB, SA } from "country-flag-icons/react/3x2";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n";
import type { Lang } from "../i18n";

// Each language is named in itself, so a reader finds theirs whatever the page shows.
const LANGUAGES: { lang: Lang; name: string; short: string; Flag: typeof GB }[] = [
  { lang: "en", name: "English", short: "EN", Flag: GB },
  { lang: "ar", name: "العربية", short: "ع", Flag: SA },
];

export default function LanguageMenu() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((item) => item.lang === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={root}>
      <button
        className="lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("lang_menu_label")}
        onClick={() => setOpen((value) => !value)}
      >
        <current.Flag className="flag" aria-hidden="true" />
        <span lang={current.lang}>{current.short}</span>
        <ChevronDown className="lang-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <ul className="lang-list" role="menu" aria-label={t("lang_menu_label")}>
          {LANGUAGES.map((item) => (
            <li key={item.lang} role="none">
              <button
                role="menuitemradio"
                aria-checked={item.lang === lang}
                lang={item.lang}
                autoFocus={item.lang === lang}
                onClick={() => {
                  setLang(item.lang);
                  setOpen(false);
                }}
              >
                <item.Flag className="flag" aria-hidden="true" />
                <span>{item.name}</span>
                {item.lang === lang && <Check size={15} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
