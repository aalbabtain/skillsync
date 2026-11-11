import { useRef, useState } from "react";

import {
  ApiRequestError,
  createRun,
  extractSkills,
  type RunResult,
  type SkillsResult,
} from "../api";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result: RunResult };

type Extraction =
  | { kind: "idle" }
  | { kind: "running"; stage: "extracting" | "verifying" }
  | { kind: "error"; message: string };

const MAX_BYTES = 5 * 1024 * 1024;
const VERIFY_DELAY_MS = 1200;

type Props = {
  onSkills: (result: SkillsResult) => void;
};

export default function UploadPanel({ onSkills }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [extraction, setExtraction] = useState<Extraction>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const runningRef = useRef(false);

  async function start(file: File) {
    if (file.type !== "application/pdf") {
      setState({ kind: "error", message: "Only PDF files are accepted." });
      return;
    }

    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "The PDF is larger than 5 MB." });
      return;
    }

    setExtraction({ kind: "idle" });
    setState({ kind: "uploading", filename: file.name });

    try {
      const result = await createRun(file);
      setState({ kind: "done", result });
    } catch (error) {
      const message =
        error instanceof ApiRequestError ? error.message : "Could not reach the server.";
      setState({ kind: "error", message });
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
      const message =
        error instanceof ApiRequestError ? error.message : "Could not reach the server.";
      setExtraction({ kind: "error", message });
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
            {state.result.filename} · {state.result.pages} page
            {state.result.pages === 1 ? "" : "s"} · {state.result.characters} characters
          </span>
          <div className="upload-actions">
            <button
              className="btn btn-primary"
              onClick={() => void runExtraction()}
              disabled={running}
              aria-busy={running}
            >
              {running && <span className="spinner" aria-hidden="true" />}
              Extract skills
            </button>
            <button className="btn btn-ghost" onClick={startOver} disabled={running}>
              Start over
            </button>
          </div>
        </div>

        {extraction.kind === "running" && (
          <p className="upload-status" role="status">
            {extraction.stage === "extracting" ? "Extracting skills…" : "Verifying…"}
          </p>
        )}

        {extraction.kind === "error" && (
          <div className="upload-error" role="alert">
            <span>{extraction.message}</span>
            <button className="btn btn-ghost" onClick={() => void runExtraction()}>
              Retry
            </button>
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
            <p className="dropzone-title">Extracting text…</p>
            <p className="dropzone-hint">{state.filename}</p>
          </>
        ) : (
          <>
            <p className="dropzone-title">Drop your CV here</p>
            <p className="dropzone-hint">PDF only, up to 5 MB and 10 pages.</p>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              Choose a PDF
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
          {state.message}
        </p>
      )}
    </div>
  );
}
