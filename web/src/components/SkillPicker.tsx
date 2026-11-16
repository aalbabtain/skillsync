import { useId, useMemo, useState } from "react";

import type { CatalogSkill } from "../api";
import { useI18n } from "../i18n";

const MAX_OPTIONS = 8;

type Props = {
  catalog: CatalogSkill[] | null;
  failed: boolean;
  onRetry: () => void;
  /** Lowercase names already on the list; they are not offered again. */
  taken: Set<string>;
  onPick: (skill: CatalogSkill) => void;
};

const words = (text: string) => text.split(/[\s/.\-&()]+/).filter(Boolean);

/** Lower is better. Matches only at the start of a word, as LinkedIn does: "pr" finds
 *  Project Management but not Express. */
function rank(skill: CatalogSkill, query: string): number | null {
  const name = skill.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (words(name).some((word) => word.startsWith(query))) return 1;
  // Aliases match as a whole spelling ("js" finds JavaScript), never by an inner word,
  // or "pr" would find R through "r programming".
  if (skill.aliases.some((alias) => alias.startsWith(query))) return 2;
  return null;
}

export function searchSkills(catalog: CatalogSkill[], text: string, taken: Set<string>) {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  return catalog
    .filter((skill) => !taken.has(skill.name.toLowerCase()))
    .map((skill) => ({ skill, score: rank(skill, query) }))
    .filter((item): item is { skill: CatalogSkill; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.skill.name.length - b.skill.name.length)
    .slice(0, MAX_OPTIONS)
    .map((item) => item.skill);
}

/** Shows the matched part of a name in bold. */
function Highlight({ name, query }: { name: string; query: string }) {
  const at = name.toLowerCase().indexOf(query.trim().toLowerCase());
  if (!query.trim() || at < 0) return <>{name}</>;
  const end = at + query.trim().length;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, end)}</mark>
      {name.slice(end)}
    </>
  );
}

export default function SkillPicker({ catalog, failed, onRetry, taken, onPick }: Props) {
  const { t, category } = useI18n();
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(
    () => (catalog ? searchSkills(catalog, query, taken) : []),
    [catalog, query, taken],
  );
  const typed = query.trim().length > 0;
  const notEnglish = /[^\x00-\x7F]/.test(query);
  const showList = open && typed && !notEnglish && options.length > 0;
  const noMatch = typed && !notEnglish && catalog !== null && options.length === 0;
  // When the only matches are already listed, say so instead of "no match".
  const alreadyListed = useMemo(
    () => (noMatch && catalog ? searchSkills(catalog, query, new Set())[0] : undefined),
    [noMatch, catalog, query],
  );

  function pick(skill: CatalogSkill) {
    onPick(skill);
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showList && options[active]) pick(options[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const listId = `${id}-options`;
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const message = failed
    ? t("add_catalog_error")
    : catalog === null
      ? t("add_catalog_loading")
      : notEnglish
        ? t("add_english_only")
        : alreadyListed
          ? t("add_already", { name: alreadyListed.name })
          : noMatch
            ? t("add_no_match")
            : "";

  return (
    <div className="add-skill">
      <label htmlFor={`${id}-input`}>{t("add_label")}</label>
      <p className="add-skill-hint" id={hintId}>
        {t("add_hint")}
      </p>

      <div className="picker">
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-describedby={message ? `${hintId} ${messageId}` : hintId}
          aria-invalid={notEnglish || noMatch}
          value={query}
          disabled={catalog === null}
          placeholder={t("add_placeholder")}
          dir="ltr"
          lang="en"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />

        {showList && (
          <ul className="picker-list" id={listId} role="listbox" aria-label={t("picker_options")}>
            {options.map((skill, index) => (
              <li
                key={skill.name}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? "is-active" : undefined}
                // Keep focus in the field so the list does not close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(skill)}
              >
                <span className="picker-name" dir="ltr">
                  <Highlight name={skill.name} query={query} />
                </span>
                <span className="picker-category">{category(skill.category)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && (
        <p
          className={failed || notEnglish || (noMatch && !alreadyListed) ? "upload-error" : "upload-status"}
          id={messageId}
          role={failed || notEnglish ? "alert" : "status"}
        >
          {message}
          {failed && (
            <button className="btn btn-ghost" type="button" onClick={onRetry}>
              {t("retry")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
