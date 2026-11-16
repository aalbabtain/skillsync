"""Checks case results against tests/fixtures/cases/expected.json.

Used by the test suite (demo mode) and by scripts/run_cases.py (demo mode or Gemini).
"""

import json
from dataclasses import asdict
from pathlib import Path

from app import cases
from app.agents import cv_skills, requirements
from app.gap import evaluate_gap
from app.verification import aggregate, canonical_name, normalize, verify_requirements


def load(path: Path) -> dict[str, dict]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def _key(name: str) -> str:
    return normalize(canonical_name(name))


def _found(wanted: str, names: set[str]) -> bool:
    """`wanted` may list alternatives as "A|B"."""
    return any(_key(option) in names for option in wanted.split("|"))


def check_case(result: cases.CaseResult, expected: dict, extractor: str) -> list[str]:
    problems: list[str] = []

    if result.status != expected["status"]:
        detail = f" ({result.code})" if result.code else ""
        return [f"status is {result.status}{detail}, expected {expected['status']}"]

    if "code" in expected and result.code != expected["code"]:
        problems.append(f"code is {result.code}, expected {expected['code']}")

    if "pages" in expected and result.pages != expected["pages"]:
        problems.append(f"pages is {result.pages}, expected {expected['pages']}")

    names = {_key(skill["name"]) for skill in result.skills}

    for wanted in expected.get("must_have", []):
        if not _found(wanted, names):
            problems.append(f"missing {wanted}")

    forbidden = list(expected.get("must_not_have", []))
    if extractor != cv_skills.MOCK:
        forbidden += expected.get("model_must_not_have", [])

    for unwanted in forbidden:
        if _found(unwanted, names):
            problems.append(f"should not have {unwanted}")

    return problems


def check_gap(
    result: cases.CaseResult,
    expected: dict,
    postings_dir: Path,
    extractor: str,
) -> list[str]:
    """Run the CV's skills through Agents 2 and 3 against the named postings."""
    per_posting = []
    for name in expected["postings"]:
        text = (postings_dir / name).read_text(encoding="utf-8")
        candidates = requirements.extract(text, extractor)
        kept, _ = verify_requirements(candidates, text)
        per_posting.append(kept)

    required = [asdict(item) for item in aggregate(per_posting)]
    skills = [{**skill, "verified": True} for skill in result.skills]
    gap = evaluate_gap(skills, required, len(per_posting))

    problems: list[str] = []
    for group, field in (("have", "have_includes"), ("missing", "missing_includes")):
        names = {_key(item["name"]) for item in gap[group]}
        for wanted in expected.get(field, []):
            if not _found(wanted, names):
                problems.append(f"gap: {wanted} not in {group}")

    return problems
