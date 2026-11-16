import { useRef, useState } from "react";

import {
  ApiRequestError,
  createRun,
  extractSkills,
  type RunResult,
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
  | { kind: "running"; stage: "extracting" | "verifying" }
  | ({ kind: "error" } & Failure);

const MAX_BYTES = 5 * 1024 * 1024;
const VERIFY_DELAY_MS = 1200;

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
    if (file.type !== "application/pdf") {
      setState({ kind: "error", code: "NOT_A_PDF", message: "" });
      return;
    }

    if (file.size > MAX_BYTES) {
      setState({ kind: "error", code: "PDF_TOO_LARGE", message: "" });
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
    setExtraction({ kind: "running", stage: "extracting" });

    try {
      const result = await extractSkills(state.result.text);
      setExtraction({ kind: "running", stage: "verifying" });
      await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
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
          <p className="upload-status" role="status">
            {extraction.stage === "extracting" ? t("extracting_skills") : t("verifying")}
          </p>
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
        accept="application/pdf,.pdf"
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
