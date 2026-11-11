import { useState, type FormEvent } from "react";

import type { Skill } from "../api";

const CATEGORY_ORDER = [
  "Languages",
  "Frameworks",
  "Databases",
  "Cloud & DevOps",
  "AI/ML",
  "Tools",
  "Soft skills",
  "Other",
];

type Entry = Skill & { source: "verified" | "user" };

type Props = {
  initial: Skill[];
  droppedCount: number;
  onConfirm: (skills: Skill[]) => void;
  onBack: () => void;
};

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function SkillsPanel({ initial, droppedCount, onConfirm, onBack }: Props) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    initial.map((skill) => ({ ...skill, source: "verified" })),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const verified = entries.filter((entry) => entry.source === "verified").length;
  const selfReported = entries.length - verified;

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    skills: entries.filter((entry) => entry.category === category),
  })).filter((group) => group.skills.length > 0);

  function remove(name: string) {
    setEntries((current) => current.filter((entry) => entry.name !== name));
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.trim();

    if (!name) {
      setError("Type a skill name first.");
      return;
    }

    if (entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      setError(`${name} is already in the list.`);
      return;
    }

    setEntries((current) => [
      ...current,
      { name, category: "Other", evidence: "", source: "user" },
    ]);
    setDraft("");
    setError("");
  }

  return (
    <div className="skills">
      <div className="skills-head">
        <div>
          <h2 id="skills-title">Your verified skills</h2>
          <p className="skills-count">
            {verified} verified · {selfReported} self-reported
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>

      {droppedCount > 0 && (
        <p className="skills-note">
          {droppedCount} {droppedCount === 1 ? "skill" : "skills"} removed: no supporting evidence
          in your CV.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="skills-empty">
          No skills left. Add one below, or go back and upload a different CV.
        </p>
      ) : (
        <div className="skills-groups">
          {groups.map((group) => (
            <section className="chip-group" key={group.category}>
              <h3>{group.category}</h3>
              <ul className="chips">
                {group.skills.map((skill) => (
                  <li className="chip" key={skill.name}>
                    <span className="chip-name">{skill.name}</span>
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
                        Verified
                        <span className="chip-evidence">{skill.evidence}</span>
                      </span>
                    ) : (
                      <span className="chip-badge chip-badge-user">Self-reported</span>
                    )}
                    <button
                      className="chip-remove"
                      onClick={() => remove(skill.name)}
                      aria-label={`Remove ${skill.name}`}
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

      <form className="add-skill" onSubmit={add}>
        <label htmlFor="add-skill">Add a missing skill</label>
        <div className="add-skill-row">
          <input
            id="add-skill"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError("");
            }}
            placeholder="e.g. Docker"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "add-skill-error" : undefined}
          />
          <button className="btn btn-ghost" type="submit">
            Add
          </button>
        </div>
        {error && (
          <p className="upload-error" id="add-skill-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <div className="skills-actions">
        <button
          className="btn btn-primary"
          disabled={entries.length === 0}
          onClick={() =>
            onConfirm(
              entries.map(({ name, category, evidence }) => ({ name, category, evidence })),
            )
          }
        >
          Confirm skills
        </button>
      </div>
    </div>
  );
}
