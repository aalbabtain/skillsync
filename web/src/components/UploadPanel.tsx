import { Check, FileUp } from "lucide-react";
import { useRef, useState } from "react";

import {
  ApiRequestError,
  createRun,
  streamSkills,
  type RunResult,
  type Skill,
  type SkillsResult,
} from "../api";
import { useI18n } from "../i18n";

type Failure = { code: string; message: string };

type State =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | ({ kind: "error" } & Failure)
  | { kind: "done"; result: RunResult };

type Extraction =
  | { kind: "idle" }
  | { kind: "running"; found: Skill[]; finished: boolean }
  | ({ kind: "error" } & Failure);

const MAX_BYTES = 5 * 1024 * 1024;
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPT = `.pdf,.docx,application/pdf,${DOCX_TYPE}`;

// The server reads the file's bytes to decide; this only catches obvious mistakes early.
function fileProblem(file: File): string | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (extension === "doc") return "WORD_LEGACY_OR_PROTECTED";
  const known = ["pdf", "docx"].includes(extension) || [DOCX_TYPE, "application/pdf"].includes(file.type);
  if (!known) return "UNSUPPORTED_FILE";
  if (file.size > MAX_BYTES) return "FILE_TOO_LARGE";
  return null;
}
// A short pause on the finished list, so the last skills are seen before the page moves on.
const FINISHED_PAUSE_MS = 700;

type Props = {
  onSkills: (result: SkillsResult) => void;
};

function failureOf(error: unknown): Failure {
  return error instanceof ApiRequestError
    ? { code: error.code, message: error.message }
    : { code: "network", message: "" };
}

export default function UploadPanel({ onSkills }: Props) {
  const { t, errorMessage } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [extraction, setExtraction] = useState<Extraction>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const runningRef = useRef(false);

  const describe = (failure: Failure) =>
    errorMessage(failure.code, failure.message || t("err_network"));

  async function start(file: File) {
    const problem = fileProblem(file);
    if (problem) {
      setState({ kind: "error", code: problem, message: "" });
      return;
    }

    setExtraction({ kind: "idle" });
    setState({ kind: "uploading", filename: file.name });

    try {
      const result = await createRun(file);
      setState({ kind: "done", result });
    } catch (error) {
      setState({ kind: "error", ...failureOf(error) });
    }
  }

  async function runExtraction() {
    if (state.kind !== "done" || runningRef.current) {
      return;
    }

    runningRef.current = true;
    setExtraction({ kind: "running", found: [], finished: false });

    try {
      // Each skill shows up as soon as the server has checked its quote against the CV.
      const result = await streamSkills(state.result.text, (skill) =>
        setExtraction((current) =>
          current.kind === "running" ? { ...current, found: [...current.found, skill] } : current,
        ),
      );
      setExtraction({ kind: "running", found: result.skills, finished: true });
      await new Promise((resolve) => setTimeout(resolve, FINISHED_PAUSE_MS));
      setExtraction({ kind: "idle" });
      onSkills(result);
    } catch (error) {
      setExtraction({ kind: "error", ...failureOf(error) });
    } finally {
      runningRef.current = false;
    }
  }

  function startOver() {
    setExtraction({ kind: "idle" });
    setState({ kind: "idle" });
  }

  if (state.kind === "done") {
    const running = extraction.kind === "running";

    return (
      <div className="upload">
        <div className="upload-meta">
          <span>
            <bdi>{state.result.filename}</bdi> ·{" "}
            {t("upload_meta", {
              pages: state.result.pages,
              chars: state.result.characters,
            })}
          </span>
          <div className="upload-actions">
            <button
              className="btn btn-primary"
              onClick={() => void runExtraction()}
              disabled={running}
              aria-busy={running}
            >
              {running && <span className="spinner" aria-hidden="true" />}
              {t("extract_skills")}
            </button>
            <button className="btn btn-ghost" onClick={startOver} disabled={running}>
              {t("start_over")}
            </button>
          </div>
        </div>

        {extraction.kind === "running" && (
          <>
            <ol className="stages" role="status" aria-live="polite">
              {(["stage_read", "stage_find", "stage_check"] as const).map((key, index) => {
                // Finding and checking run together now: each skill is checked as it is found.
                const done = index === 0 || extraction.finished;
                const active = !done && (index === 1 || extraction.found.length > 0);
                return (
                  <li className={done ? "is-done" : active ? "is-active" : ""} key={key}>
                    <span className="stage-mark" aria-hidden="true">
                      {done ? <Check size={13} /> : active ? <span className="spinner spinner-sm" /> : null}
                    </span>
                    {t(key)}
                  </li>
                );
              })}
            </ol>
            {extraction.found.length > 0 && (
              <div className="live-skills">
                <p className="live-count" aria-live="polite">
                  {t("found_so_far", { n: extraction.found.length })}
                </p>
                <ul>
                  {extraction.found.map((skill) => (
                    <li className="live-chip" key={skill.name}>
                      <Check size={12} aria-hidden="true" />
                      <span dir="auto">{skill.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {extraction.kind === "error" && (
          <div className="upload-error" role="alert">
            <span>{describe(extraction)}</span>
            {!["SKILLS_QUOTA_EXCEEDED", "RATE_LIMITED"].includes(extraction.code) && (
              <button className="btn btn-ghost" onClick={() => void runExtraction()}>
                {t("retry")}
              </button>
            )}
          </div>
        )}

        <pre className="upload-text" dir="auto">
          {state.result.text}
        </pre>
      </div>
    );
  }

  return (
    <div className="upload">
      <div
        className={dragging ? "dropzone dropzone-active" : "dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void start(file);
        }}
      >
        {state.kind === "uploading" ? (
          <>
            <p className="dropzone-title">{t("extracting_text")}</p>
            <p className="dropzone-hint">
              <bdi>{state.filename}</bdi>
            </p>
          </>
        ) : (
          <>
            <span className="dropzone-icon" aria-hidden="true">
              <FileUp size={26} />
            </span>
            <p className="dropzone-title">{t("drop")}</p>
            <p className="dropzone-hint">{t("drop_hint")}</p>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              {t("choose")}
            </button>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void start(file);
          event.target.value = "";
        }}
      />

      {state.kind === "error" && (
        <p className="upload-error" role="alert">
          {describe(state)}
        </p>
      )}
    </div>
  );
}
