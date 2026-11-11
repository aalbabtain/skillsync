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
};

export type SkillsResult = {
  skills: Skill[];
  dropped_count: number;
};

export async function extractSkills(text: string): Promise<SkillsResult> {
  const response = await fetch("/api/skills/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.detail?.code ?? "UNKNOWN",
      payload?.detail?.message ?? "Skill extraction failed.",
    );
  }

  return payload as SkillsResult;
}
