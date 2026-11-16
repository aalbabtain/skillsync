"""Serve the built React app from the API, so one service hosts the whole site."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def register_frontend(app: FastAPI, directory: Path) -> None:
    """Serve `directory` (the Vite build) at the root. Call after every API route."""
    root = directory.resolve()
    index = root / "index.html"

    if not index.is_file():
        return

    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)

        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)

        return FileResponse(index)
