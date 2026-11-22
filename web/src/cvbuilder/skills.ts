// Skills offered at the skills question: the tools the person named, then catalog skills found
// in what they wrote about their jobs and projects. They keep what they use and add the rest.

export type CatalogEntry = { name: string; aliases: string[] };

const MAX_TOOL_CHARS = 40;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, spelling: string, caseSensitive: boolean): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}+#])${escape(spelling)}(?=$|[^\\p{L}\\p{N}+#])`, caseSensitive ? "u" : "iu");
  return pattern.test(text);
}

/** `tools` are comma-separated answers taken as they are; `texts` are free descriptions. */
export function suggestSkills([tools, ...texts]: string[], catalog: CatalogEntry[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(name);
    }
  };
  for (const tool of tools.split(/[,،\n]/)) {
    const name = tool.trim();
    if (!name || name.length > MAX_TOOL_CHARS) continue;
    const known = catalog.find((skill) => [skill.name, ...skill.aliases].some((s) => s.toLowerCase() === name.toLowerCase()));
    add(known ? known.name : name);
  }
  const text = texts.join("\n");
  for (const skill of catalog) {
    // Short names ("Go", "R") only count when written as a name, not as an everyday word.
    const hit =
      mentions(text, skill.name, skill.name.length < 3) ||
      skill.aliases.some((alias) => alias.length >= 3 && mentions(text, alias, false));
    if (hit) add(skill.name);
  }
  return found;
}

/** The skills in what the person typed: one per comma. A part with no comma is split further
 * only when it is wholly made of known skills ("python teamwork" is Python and Teamwork;
 * "machine learning" stays one); anything else stays as typed. */
export function splitSkills(text: string, catalog: CatalogEntry[]): string[] {
  const spellings = new Map<string, string>();
  for (const skill of catalog) {
    for (const spelling of [skill.name, ...skill.aliases]) spellings.set(spelling.toLowerCase(), skill.name);
  }
  const out: string[] = [];
  for (const part of splitList(text)) {
    const words = part.split(/\s+/);
    if (words.length < 2) {
      out.push(part);
      continue;
    }
    // Longest known skill first at each position; if any word is left over, keep the part whole.
    const found: string[] = [];
    let i = 0;
    while (i < words.length) {
      let matched = 0;
      for (let end = words.length; end > i; end--) {
        const name = spellings.get(words.slice(i, end).join(" ").toLowerCase());
        if (name) {
          found.push(name);
          matched = end - i;
          break;
        }
      }
      if (!matched) break;
      i += matched;
    }
    if (i === words.length && found.length > 1) out.push(...found);
    else out.push(part);
  }
  return out;
}

export type KnownSkill = { name: string; category: string };
export type SkillIndex = Map<string, KnownSkill>;

/** How a skill is compared: no capitals, hyphens as spaces, and no trailing "skills"
 * ("Problem-Solving" and "Communication Skills" match "problem solving" and "communication"). */
export function skillKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+skills?$/, "");
}

export function skillIndex(catalog: { name: string; category: string; aliases: string[] }[]): SkillIndex {
  const index: SkillIndex = new Map();
  for (const skill of catalog) {
    for (const spelling of [skill.name, ...skill.aliases]) index.set(skillKey(spelling), { name: skill.name, category: skill.category });
  }
  return index;
}

export function resolveSkill(text: string, index: SkillIndex): KnownSkill | null {
  const exact = index.get(skillKey(text));
  if (exact) return exact;
  // "Firebase (Auth, Firestore)" and "TypeScript/JavaScript" are known by their first part,
  // and keep the name the person wrote.
  const base = text.replace(/\([^)]*\)/g, "").trim();
  const first = base.split("/")[0].trim();
  const known = index.get(skillKey(base)) ?? index.get(skillKey(first));
  return known ? { name: text.trim(), category: known.category } : null;
}

/** A list split at its commas, but not at commas inside brackets. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "," || char === "،" || char === "\n")) {
      out.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  out.push(part);
  return out.map((item) => item.trim()).filter(Boolean);
}
