"""Deterministic stand-in for the model, used when no Gemini key is configured.

Matches a fixed skill dictionary against the CV text, so the rest of the pipeline
can run offline. The evidence is the CV line the skill was found in, which keeps the
verification step meaningful.
"""

from app.skills_catalog import CATALOG
from app.verification import normalize

MAX_EVIDENCE_CHARS = 300

SKILLS = CATALOG


def _mentions(line: str, alias: str) -> bool:
    return f" {alias} " in f" {line} "


def extract(cv_text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in cv_text.splitlines() if line.strip()]
    folded = [normalize(line) for line in lines]
    found: list[dict[str, str]] = []

    for name, category, aliases in SKILLS:
        needles = [normalize(alias) for alias in aliases]

        for line, folded_line in zip(lines, folded):
            if any(_mentions(folded_line, needle) for needle in needles):
                found.append(
                    {
                        "name": name,
                        "category": category,
                        "evidence": line[:MAX_EVIDENCE_CHARS],
                    }
                )
                break

    return found


PREFERRED_MARKERS = tuple(
    normalize(marker)
    for marker in (
        "preferred",
        "nice to have",
        "plus",
        "bonus",
        "advantage",
        "يفضل",
        "ميزة",
        "مفضل",
    )
)


def _is_preferred(line: str) -> bool:
    folded = normalize(line)
    return any(_mentions(folded, marker) for marker in PREFERRED_MARKERS)


def _preferred_lines(posting_text: str) -> set[str]:
    """Lines that sit under a heading such as "Nice to have:", until the next heading."""
    preferred: set[str] = set()
    in_preferred_section = False

    for raw in posting_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.endswith(":"):
            in_preferred_section = _is_preferred(line)
        elif in_preferred_section:
            preferred.add(line[:MAX_EVIDENCE_CHARS])

    return preferred


def extract_requirements(posting_text: str) -> list[dict[str, str]]:
    """Match the skill dictionary against a posting and guess each skill's level."""
    under_preferred_heading = _preferred_lines(posting_text)
    found = []

    for item in extract(posting_text):
        line = item["evidence"]
        preferred = line in under_preferred_heading or _is_preferred(line)
        found.append({**item, "level": "preferred" if preferred else "required"})

    return found
