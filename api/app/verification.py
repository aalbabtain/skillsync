"""Deterministic verification of extracted skills against the CV text."""

import re
import unicodedata
from dataclasses import dataclass

# Harakat, Quranic marks, the superscript alef and tatweel carry no matching value.
ARABIC_MARKS = re.compile(r"[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]")
# Keep + and # so "C++" and "C#" stay distinct.
PUNCTUATION = re.compile(r"[^\w\s+#]|_", re.UNICODE)
SPACES = re.compile(r"\s+")
# PDF extraction can drop the space where Arabic meets Latin text ("علىKubernetes").
SCRIPT_BOUNDARY = re.compile(
    r"(?<=[\u0600-\u06ff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u0600-\u06ff])"
)

CANONICAL_NAMES = {
    "react": "React",
    "reactjs": "React",
    "react js": "React",
    "nextjs": "Next.js",
    "next js": "Next.js",
    "node": "Node.js",
    "nodejs": "Node.js",
    "node js": "Node.js",
    "vue": "Vue",
    "vuejs": "Vue",
    "vue js": "Vue",
    "ts": "TypeScript",
    "typescript": "TypeScript",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "mongo": "MongoDB",
    "mongodb": "MongoDB",
    "mongo db": "MongoDB",
    "fastapi": "FastAPI",
    "fast api": "FastAPI",
    "py": "Python",
    "python": "Python",
    "golang": "Go",
    "go": "Go",
    "sql": "SQL",
    "ml": "Machine Learning",
    "machine learning": "Machine Learning",
    "html css": "HTML/CSS",
}


def normalize(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text).lower()
    folded = ARABIC_MARKS.sub("", folded)
    folded = PUNCTUATION.sub(" ", folded)
    folded = SCRIPT_BOUNDARY.sub(" ", folded)
    return SPACES.sub(" ", folded).strip()


def canonical_name(name: str) -> str:
    cleaned = SPACES.sub(" ", name.strip())
    return CANONICAL_NAMES.get(normalize(cleaned), cleaned)


def _contains(haystack: str, needle: str) -> bool:
    return f" {needle} " in f" {haystack} "


@dataclass(frozen=True)
class VerifiedSkill:
    name: str
    category: str
    evidence: str


@dataclass(frozen=True)
class VerificationResult:
    skills: list[VerifiedSkill]
    dropped_count: int


def verify_skills(
    candidates: list[dict[str, str]],
    cv_text: str,
) -> VerificationResult:
    haystack = normalize(cv_text)
    seen: set[str] = set()
    skills: list[VerifiedSkill] = []
    dropped = 0

    for candidate in candidates:
        name = str(candidate.get("name", "")).strip()
        evidence = str(candidate.get("evidence", "")).strip()
        category = str(candidate.get("category", "")).strip() or "Other"
        needle = normalize(evidence)

        if not name or not needle or not _contains(haystack, needle):
            dropped += 1
            continue

        display = canonical_name(name)
        key = normalize(display)
        if key in seen:
            continue

        seen.add(key)
        skills.append(VerifiedSkill(name=display, category=category, evidence=evidence))

    return VerificationResult(skills=skills, dropped_count=dropped)


@dataclass(frozen=True)
class VerifiedRequirement:
    name: str
    category: str
    level: str
    evidence: str


@dataclass(frozen=True)
class Source:
    posting: int
    level: str
    evidence: str


@dataclass(frozen=True)
class Requirement:
    name: str
    category: str
    level: str
    frequency: int
    sources: list[Source]


REQUIRED = "required"
PREFERRED = "preferred"


def _stronger(first: str, second: str) -> str:
    return REQUIRED if REQUIRED in (first, second) else PREFERRED


def verify_requirements(
    candidates: list[dict[str, str]],
    posting_text: str,
) -> tuple[list[VerifiedRequirement], int]:
    """Keep each requirement whose evidence is quoted in the posting, one per skill."""
    haystack = normalize(posting_text)
    kept: dict[str, VerifiedRequirement] = {}
    dropped = 0

    for candidate in candidates:
        name = str(candidate.get("name", "")).strip()
        evidence = str(candidate.get("evidence", "")).strip()
        category = str(candidate.get("category", "")).strip() or "Other"
        level = str(candidate.get("level", "")).strip().lower()
        level = level if level in (REQUIRED, PREFERRED) else REQUIRED
        needle = normalize(evidence)

        if not name or not needle or not _contains(haystack, needle):
            dropped += 1
            continue

        display = canonical_name(name)
        key = normalize(display)
        if key in kept:
            first = kept[key]
            kept[key] = VerifiedRequirement(
                first.name, first.category, _stronger(first.level, level), first.evidence
            )
            continue

        kept[key] = VerifiedRequirement(display, category, level, evidence)

    return list(kept.values()), dropped


def aggregate(per_posting: list[list[VerifiedRequirement]]) -> list[Requirement]:
    """Count how many postings ask for each skill and rank the result. No model involved."""
    merged: dict[str, dict] = {}

    for index, items in enumerate(per_posting):
        for item in items:
            display = canonical_name(item.name)
            key = normalize(display)
            entry = merged.setdefault(
                key,
                {"name": display, "category": item.category, "level": PREFERRED, "sources": []},
            )

            if entry["sources"] and entry["sources"][-1].posting == index:
                last = entry["sources"][-1]
                entry["sources"][-1] = Source(index, _stronger(last.level, item.level), last.evidence)
            else:
                entry["sources"].append(Source(index, item.level, item.evidence))

            entry["level"] = _stronger(entry["level"], item.level)

    results = [
        Requirement(
            name=entry["name"],
            category=entry["category"],
            level=entry["level"],
            frequency=len(entry["sources"]),
            sources=entry["sources"],
        )
        for entry in merged.values()
    ]
    results.sort(key=lambda r: (-r.frequency, r.level != REQUIRED, r.name.lower()))
    return results
