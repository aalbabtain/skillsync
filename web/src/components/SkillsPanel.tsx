import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { getSkillCatalog } from "../api";
import type { CatalogSkill, Skill, SkillCatalog } from "../api";
import { useI18n } from "../i18n";
import SkillPicker from "./SkillPicker";

const CATEGORY_ORDER = [
  "Programming languages",
  "Frameworks",
  "Databases",
  "Cloud & DevOps",
  "AI/ML",
  "Tools",
  "Soft skills",
  "Other",
];

const MAX_SUGGESTIONS = 8;

export type Entry = Skill & { source: "verified" | "user" };

type Props = {
  entries: Entry[];
  onEntriesChange: (update: (current: Entry[]) => Entry[]) => void;
  droppedCount: number;
  onConfirm: (skills: Skill[]) => void;
  onBack: () => void;
};

function groupOf(entry: Entry) {
  return CATEGORY_ORDER.includes(entry.category) ? entry.category : "Other";
}

/** Skills often asked for alongside the ones already listed, most connected first. */
function suggestionsFor(entries: Entry[], catalog: SkillCatalog | null): CatalogSkill[] {
  if (!catalog) return [];
  const taken = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const votes = new Map<string, number>();
  for (const entry of entries) {
    for (const related of catalog.related[entry.name] ?? []) {
      if (!taken.has(related.toLowerCase())) votes.set(related, (votes.get(related) ?? 0) + 1);
    }
  }
  const order = new Map(catalog.skills.map((skill, index) => [skill.name, index]));
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .slice(0, MAX_SUGGESTIONS)
    .map(([name]) => catalog.skills.find((skill) => skill.name === name))
    .filter((skill): skill is CatalogSkill => Boolean(skill));
}

export default function SkillsPanel({
  entries,
  onEntriesChange,
  droppedCount,
  onConfirm,
  onBack,
}: Props) {
  const { t, category } = useI18n();
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const order = new Map(entries.map((entry, index) => [entry.name, index]));

  const loadCatalog = useCallback(() => {
    setCatalogFailed(false);
    getSkillCatalog()
      .then(setCatalog)
      .catch(() => setCatalogFailed(true));
  }, []);

  useEffect(loadCatalog, [loadCatalog]);

  const verified = entries.filter((entry) => entry.source === "verified").length;
  const selfReported = entries.length - verified;
  const taken = useMemo(() => new Set(entries.map((entry) => entry.name.toLowerCase())), [entries]);
  const suggestions = useMemo(() => suggestionsFor(entries, catalog), [entries, catalog]);

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    skills: entries.filter((entry) => groupOf(entry) === category),
  })).filter((group) => group.skills.length > 0);

  function add(skill: CatalogSkill) {
    onEntriesChange((current) =>
      current.some((entry) => entry.name.toLowerCase() === skill.name.toLowerCase())
        ? current
        : [...current, { name: skill.name, category: skill.category, evidence: "", source: "user" }],
    );
  }

  function remove(name: string) {
    // Let the chip shrink away before it leaves the list.
    setLeaving((current) => new Set(current).add(name));
    window.setTimeout(() => {
      onEntriesChange((current) => current.filter((entry) => entry.name !== name));
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }, 180);
  }

  return (
    <div className="skills">
      <div className="skills-head">
        <div>
          <h2 id="skills-title">{t("skills_h")}</h2>
          <p className="skills-count">{t("skills_count", { verified, self: selfReported })}</p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          {t("back")}
        </button>
      </div>

      {droppedCount > 0 && (
        <p className="skills-note">{t("skills_dropped", { n: droppedCount })}</p>
      )}

      {entries.length === 0 ? (
        <p className="skills-empty">{t("skills_empty")}</p>
      ) : (
        <div className="skills-groups">
          {groups.map((group) => (
            <section className="chip-group" key={group.category}>
              <h3>{category(group.category)}</h3>
              <ul className="chips">
                {group.skills.map((skill) => (
                  <li
                    className={leaving.has(skill.name) ? "chip is-leaving" : "chip"}
                    key={skill.name}
                    style={{ "--i": Math.min(order.get(skill.name) ?? 0, 14) } as CSSProperties}
                  >
                    <span className="chip-name" dir="auto">
                      {skill.name}
                    </span>
                    {skill.source === "verified" ? (
                      <span className="chip-badge" tabIndex={0}>
                        <svg
                          viewBox="0 0 16 16"
                          width="11"
                          height="11"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M3 8.5l3.2 3.2L13 5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {t("verified")}
                        <span className="chip-evidence" dir="auto">
                          {skill.evidence}
                        </span>
                      </span>
                    ) : (
                      <span className="chip-badge chip-badge-user">{t("self_badge")}</span>
                    )}
                    <button
                      className="chip-remove"
                      onClick={() => remove(skill.name)}
                      aria-label={t("remove_skill", { name: skill.name })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <SkillPicker
        catalog={catalog?.skills ?? null}
        failed={catalogFailed}
        onRetry={loadCatalog}
        taken={taken}
        onPick={add}
      />

      {suggestions.length > 0 && (
        <section className="suggest" aria-labelledby="suggest-title">
          <h3 id="suggest-title">{t("suggest_h")}</h3>
          <p>{t("suggest_lead")}</p>
          <ul className="suggest-list">
            {suggestions.map((skill) => (
              <li key={skill.name}>
                <button
                  type="button"
                  className="suggest-chip"
                  onClick={() => add(skill)}
                  aria-label={t("suggest_add", { name: skill.name })}
                >
                  <span dir="ltr">{skill.name}</span>
                  <Plus size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="skills-actions">
        <button
          className="btn btn-primary"
          disabled={entries.length === 0}
          onClick={() =>
            onConfirm(
              entries
                .filter((entry) => !leaving.has(entry.name))
                .map(({ name, category, evidence, source }) => ({
                  name,
                  category,
                  evidence,
                  verified: source === "verified",
                })),
            )
          }
        >
          {t("confirm_skills")}
        </button>
      </div>
    </div>
  );
}
