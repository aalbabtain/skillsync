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

  if (!response.ok || !response.body) {
    // Refusals before the stream starts (too short, rate limit) are ordinary JSON errors.
    const payload = await response.json().catch(() => null);
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "Skill extraction failed.",
    );
  }

  const skills: Skill[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  const handle = (raw: string): SkillsResult | null => {
    if (!raw.trim()) return null;
    const line = JSON.parse(raw) as StreamLine;
    if (line.type === "skill") {
      const skill = { name: line.name, category: line.category, evidence: line.evidence };
      skills.push(skill);
      onSkill(skill);
      return null;
    }
    if (line.type === "error") throw new ApiRequestError(line.code, line.message);
    return { skills, dropped_count: line.dropped_count };
  };

  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = done ? "" : (lines.pop() ?? "");
    for (const raw of lines) {
      const finished = handle(raw);
      if (finished) return finished;
    }
    if (done) break;
  }

  // The connection closed without the closing line: the answer is incomplete.
  throw new ApiRequestError("UNKNOWN", "The extraction stopped before it finished.");
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

export async function extractRequirements(
  postings: PostingInput[],
): Promise<RequirementsResult> {
  const response = await fetch("/api/requirements/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postings }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "Requirements extraction failed.",
    );
  }

  return payload as RequirementsResult;
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
