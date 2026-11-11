import { useRef, useState } from "react";

import { ApiRequestError, createRun, type RunResult } from "../api";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result: RunResult };

const MAX_BYTES = 5 * 1024 * 1024;

export default function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function start(file: File) {
    if (file.type !== "application/pdf") {
      setState({ kind: "error", message: "Only PDF files are accepted." });
      return;
    }

    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "The PDF is larger than 5 MB." });
      return;
    }

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

  if (state.kind === "done") {
    return (
      <div className="upload">
        <div className="upload-meta">
          <span>
            {state.result.filename} · {state.result.pages} page
            {state.result.pages === 1 ? "" : "s"} · {state.result.characters} characters
          </span>
          <button className="btn btn-ghost" onClick={() => setState({ kind: "idle" })}>
            Start over
          </button>
        </div>
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
