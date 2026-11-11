"""Deterministic verification of extracted skills against the CV text."""

import re
import unicodedata
from dataclasses import dataclass

# Harakat, Quranic marks, the superscript alef and tatweel carry no matching value.
ARABIC_MARKS = re.compile(r"[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]")
# Keep + and # so "C++" and "C#" stay distinct.
PUNCTUATION = re.compile(r"[^\w\s+#]|_", re.UNICODE)
SPACES = re.compile(r"\s+")

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
