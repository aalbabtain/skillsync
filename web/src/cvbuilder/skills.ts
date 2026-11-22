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
