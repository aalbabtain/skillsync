export type RunResult = {
  run_id: string;
  filename: string;
  pages: number;
  characters: number;
  text: string;
};

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

export async function createRun(file: File): Promise<RunResult> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/runs", { method: "POST", body });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "The upload failed.",
    );
  }

  return payload as RunResult;
}

export type Skill = {
  name: string;
  category: string;
  evidence: string;
  verified?: boolean;
};

export type SkillsResult = {
  skills: Skill[];
  dropped_count: number;
};

/**
 * Reads a streamed answer: one JSON object per line. Refusals before the stream starts (too
 * short, rate limit) are ordinary JSON errors and are thrown as such.
 */
async function readJsonLines(response: Response, fallback: string, onLine: (line: any) => boolean): Promise<void> {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new ApiRequestError(payload?.detail?.code ?? "UNKNOWN", payload?.detail?.message ?? fallback);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = done ? "" : (lines.pop() ?? "");
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const line = JSON.parse(raw);
      if (line.type === "error") throw new ApiRequestError(line.code, line.message);
      if (onLine(line)) return;
    }
    if (done) break;
  }
  // The connection closed without the closing line: the answer is incomplete.
  throw new ApiRequestError("UNKNOWN", "The extraction stopped before it finished.");
}

type StreamLine =
  | ({ type: "skill" } & Skill)
  | { type: "done"; dropped_count: number }
  | { type: "error"; code: string; message: string };

/**
 * Agent 1, streamed: calls onSkill for each verified skill the moment the server proves it,
 * then resolves with the whole list. The server sends one JSON object per line.
 */
export async function streamSkills(text: string, onSkill: (skill: Skill) => void): Promise<SkillsResult> {
  const response = await fetch("/api/skills/extract/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const skills: Skill[] = [];
  let result: SkillsResult | null = null;
  await readJsonLines(response, "Skill extraction failed.", (line: StreamLine) => {
    if (line.type === "skill") {
      const skill = { name: line.name, category: line.category, evidence: line.evidence };
      skills.push(skill);
      onSkill(skill);
      return false;
    }
    if (line.type === "done") result = { skills, dropped_count: line.dropped_count };
    return result !== null;
  });
  return result as unknown as SkillsResult;
}

export type Health = {
  status: string;
  model: string;
  extractor: string;
  /** GoatCounter site code; empty when counting is off. */
  analytics?: string;
};

export async function getHealth(): Promise<Health> {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new ApiRequestError("UNKNOWN", "The API is not reachable.");
  }

  return (await response.json()) as Health;
}

export type PostingInput = {
  title: string;
  text: string;
};

export type RequirementSource = {
  posting: number;
  level: "required" | "preferred";
  evidence: string;
};

export type Requirement = {
  name: string;
  category: string;
  level: "required" | "preferred";
  frequency: number;
  sources: RequirementSource[];
};

export type RequirementsResult = {
  postings_count: number;
  requirements: Requirement[];
  dropped_count: number;
};

export type RequirementEvent =
  | { type: "posting"; posting: number }
  | { type: "requirement"; posting: number; name: string; level: "required" | "preferred" }
  | { type: "posting_done"; posting: number; count: number };

/**
 * Agent 2, streamed: postings are read in turn and onEvent hears each requirement the moment
 * its quote is found. Resolves with the counted result, the same as /api/requirements/extract.
 */
export async function streamRequirements(
  postings: PostingInput[],
  onEvent: (event: RequirementEvent) => void,
): Promise<RequirementsResult> {
  const response = await fetch("/api/requirements/extract/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postings }),
  });
  let result: RequirementsResult | null = null;
  await readJsonLines(response, "Requirements extraction failed.", (line) => {
    if (line.type === "done") {
      result = line.result as RequirementsResult;
      return true;
    }
    onEvent(line as RequirementEvent);
    return false;
  });
  return result as unknown as RequirementsResult;
}

export type GapItem = Requirement & { cv_evidence?: string };

export type GapResult = {
  summary: {
    postings_count: number;
    required_total: number;
    required_proven: number;
    preferred_total: number;
    preferred_proven: number;
    have_count: number;
    needs_proof_count: number;
    missing_count: number;
  };
  have: GapItem[];
  needs_proof: GapItem[];
  missing: GapItem[];
};

export async function evaluateGap(
  skills: Skill[],
  requirements: RequirementsResult,
): Promise<GapResult> {
  const response = await fetch("/api/gap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skills: skills.map((skill) => ({
        name: skill.name,
        category: skill.category,
        evidence: skill.evidence,
        verified: Boolean(skill.verified),
      })),
      requirements: requirements.requirements,
      postings_count: requirements.postings_count,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "Gap evaluation failed.",
    );
  }

  return payload as GapResult;
}

export type CatalogSkill = {
  name: string;
  category: string;
  aliases: string[];
};

export type SkillCatalog = {
  skills: CatalogSkill[];
  related: Record<string, string[]>;
};

let catalogRequest: Promise<SkillCatalog> | null = null;

/** The list the skill picker offers. Fetched once per visit; a failed fetch can be retried. */
export function getSkillCatalog(): Promise<SkillCatalog> {
  if (!catalogRequest) {
    catalogRequest = fetch("/api/skills/catalog")
      .then((response) => {
        if (!response.ok) throw new ApiRequestError("UNKNOWN", "The skill list could not be loaded.");
        return response.json() as Promise<SkillCatalog>;
      })
      .catch((error) => {
        catalogRequest = null;
        throw error;
      });
  }
  return catalogRequest;
}

export type PlanTopic = { text: string; source: { title: string; publisher: string; url: string } };

export type PlanCard = {
  id: string;
  name: string;
  kind: "learn" | "prove";
  phase: "quick" | "core" | "extra" | "prove";
  level: "required" | "preferred";
  frequency: number;
  postings_count: number;
  builds_on: string | null;
  weeks: number;
  topics: PlanTopic[];
  project: { title: string; summary: string };
  docs_url: string | null;
};

export type PlanDone = { later: string[]; retrieval: "embeddings" | "keywords" };

/**
 * Agent 4, streamed: onCard hears each plan card as soon as the model finishes it and code has
 * checked its sources. Resolves with what comes after the cards.
 */
export async function streamPlan(
  body: { language: "en" | "ar"; gap: { missing: GapItem[]; needs_proof: GapItem[] }; skills: Skill[]; postings_count: number },
  onCard: (card: PlanCard) => void,
): Promise<PlanDone> {
  const response = await fetch("/api/plan/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let done: PlanDone | null = null;
  await readJsonLines(response, "The plan could not be built.", (line) => {
    if (line.type === "skill") {
      const { type: _type, ...card } = line;
      onCard(card as PlanCard);
      return false;
    }
    if (line.type === "done") done = { later: line.later, retrieval: line.retrieval };
    return done !== null;
  });
  return done as unknown as PlanDone;
}

// ---------- CV builder (Agent 5) ----------

export type CvLine = { text: string; facts: string[] };

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(payload?.detail?.code ?? "UNKNOWN", payload?.detail?.message ?? fallback);
  }
  return payload as T;
}

/**
 * Agent 5, streamed: the summary or one job's or project's bullets. Each line arrives only
 * after the server found every fact in it in the answers. When no line survived, resolves with
 * the person's own words as `fallback`.
 */
export async function streamCvLines(
  task: "summary" | "bullets",
  answers: Record<string, string>,
  onLine: (line: CvLine) => void,
): Promise<{ fallback?: string }> {
  const response = await fetch("/api/cv/write/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, answers }),
  });
  let fallback: string | undefined;
  await readJsonLines(response, "The CV lines could not be written.", (line) => {
    if (line.type === "line") onLine({ text: line.text, facts: line.facts ?? [] });
    if (line.type === "fallback") fallback = line.text;
    return line.type === "done";
  });
  return { fallback };
}

export async function cvFollowUp(answer: string, language: "en" | "ar"): Promise<string | null> {
  const { question } = await postJson<{ question: string | null }>("/api/cv/follow-up", { answer, language }, "No follow-up question.");
  return question;
}

export async function cvTranslate(items: Record<string, string>): Promise<Record<string, string>> {
  const result = await postJson<{ items: Record<string, string> }>("/api/cv/translate", { items }, "The translation failed.");
  return result.items;
}

export type CvImported = {
  resume: {
    name: string; field: string; school: string; degree: string; grad: string; gpa: string;
    skills: string[]; projects: { name: string; lines: string[] }[]; certs: string[]; langs: string[];
  };
  contact: { email: string; phone: string; linkedin: string; github: string };
};

export function cvImport(text: string): Promise<CvImported> {
  return postJson<CvImported>("/api/cv/import", { text }, "The CV could not be read.");
}

export async function cvDocx(resume: unknown): Promise<Blob> {
  const response = await fetch("/api/cv/docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resume),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiRequestError(payload?.detail?.code ?? "UNKNOWN", "The Word file could not be built.");
  }
  return response.blob();
}

/** Agent 5, at the end: short fields tidied and in English, in the order given. */
export async function cvPolish(items: { text: string; kind: "text" | "langs" | "cert" }[]): Promise<string[]> {
  const result = await postJson<{ items: string[] }>("/api/cv/polish", { items }, "The CV could not be tidied.");
  return result.items;
}
