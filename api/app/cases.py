"""Runs every CV case through parsing, extraction and verification."""

import json
from dataclasses import dataclass
from pathlib import Path

from app.agents import cv_skills
from app.parsers import extract_document
from app.parsers.pdf import PdfExtractionError
from app.verification import verify_skills

OK = "ok"
CV_SUFFIXES = {".pdf", ".docx"}
FAILED = "failed"


@dataclass(frozen=True)
class CaseResult:
    name: str
    status: str
    pages: int = 0
    characters: int = 0
    skills: tuple[dict[str, str], ...] = ()
    dropped_count: int = 0
    code: str = ""
    message: str = ""


def run_case(path: Path, extractor: str | None = None) -> CaseResult:
    try:
        document = extract_document(path.read_bytes())
    except PdfExtractionError as error:
        return CaseResult(name=path.stem, status=FAILED, code=error.code, message=error.message)

    try:
        candidates = cv_skills.extract(document.text, extractor=extractor)
    except cv_skills.SkillExtractionError as error:
        return CaseResult(
            name=path.stem,
            status=FAILED,
            pages=document.pages,
            characters=document.characters,
            code=error.code,
            message=error.message,
        )

    verified = verify_skills(candidates, document.text)

    return CaseResult(
        name=path.stem,
        status=OK,
        pages=document.pages,
        characters=document.characters,
        skills=tuple(
            {"name": skill.name, "category": skill.category, "evidence": skill.evidence}
            for skill in verified.skills
        ),
        dropped_count=verified.dropped_count,
    )


def run_all(cases_dir: Path, extractor: str | None = None) -> list[CaseResult]:
    paths = sorted(p for p in cases_dir.iterdir() if p.suffix in CV_SUFFIXES)
    return [run_case(path, extractor=extractor) for path in paths]


def render_markdown(result: CaseResult) -> str:
    if result.status == FAILED:
        return f"# {result.name}\n\n**Failed** — `{result.code}`: {result.message}\n"

    lines = [
        f"# {result.name}",
        "",
        f"- Pages: {result.pages}",
        f"- Characters: {result.characters}",
        f"- Verified skills: {len(result.skills)}",
        f"- Dropped: {result.dropped_count}",
        "",
        "| Skill | Category | Evidence |",
        "| --- | --- | --- |",
    ]
    for skill in result.skills:
        evidence = skill["evidence"].replace("|", "\\|")
        lines.append(f"| {skill['name']} | {skill['category']} | {evidence} |")

    return "\n".join(lines) + "\n"


def summary(results: list[CaseResult]) -> list[dict[str, object]]:
    return [
        {
            "case": result.name,
            "status": result.status,
            "pages": result.pages,
            "characters": result.characters,
            "verified": len(result.skills),
            "dropped": result.dropped_count,
            "code": result.code,
            "message": result.message,
            "skills": [{"name": s["name"], "category": s["category"]} for s in result.skills],
        }
        for result in results
    ]


def write_reports(results: list[CaseResult], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []

    for result in results:
        path = out_dir / f"{result.name}.md"
        path.write_text(render_markdown(result), encoding="utf-8")
        written.append(path)

    summary_path = out_dir / "summary.json"
    summary_path.write_text(
        json.dumps(summary(results), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    written.append(summary_path)

    return written
