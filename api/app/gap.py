"""Agent 3, Gap Evaluator: compares confirmed skills with posting requirements.

Plain code, no model. The same input always yields the same gap.
"""

from copy import deepcopy

from app.verification import canonical_name, normalize

REQUIRED = "required"


def _key(name: str) -> str:
    return normalize(canonical_name(name))


def _order(item: dict) -> tuple:
    return (-int(item["frequency"]), item["level"] != REQUIRED, item["name"].lower())


def evaluate_gap(
    skills: list[dict],
    requirements: list[dict],
    postings_count: int,
) -> dict:
    """Sort every requirement into have, needs_proof or missing.

    A skill counts as proven only when it is verified and carries CV evidence. A skill the
    student added by hand, with no evidence, only moves a requirement to needs_proof.
    """
    proven: dict[str, str] = {}
    claimed: set[str] = set()

    for skill in skills:
        key = _key(str(skill.get("name", "")))
        if not key:
            continue
        evidence = str(skill.get("evidence", "")).strip()
        if skill.get("verified") and evidence:
            proven.setdefault(key, evidence)
        else:
            claimed.add(key)

    have: list[dict] = []
    needs_proof: list[dict] = []
    missing: list[dict] = []

    for requirement in requirements:
        item = deepcopy(requirement)
        key = _key(item["name"])

        if key in proven:
            have.append({**item, "cv_evidence": proven[key]})
        elif key in claimed:
            needs_proof.append(item)
        else:
            missing.append(item)

    for group in (have, needs_proof, missing):
        group.sort(key=_order)

    def count(level: str, groups: list[list[dict]]) -> int:
        return sum(1 for group in groups for item in group if item["level"] == level)

    everything = [have, needs_proof, missing]
    return {
        "summary": {
            "postings_count": postings_count,
            "required_total": count(REQUIRED, everything),
            "required_proven": count(REQUIRED, [have]),
            "preferred_total": count("preferred", everything),
            "preferred_proven": count("preferred", [have]),
            "have_count": len(have),
            "needs_proof_count": len(needs_proof),
            "missing_count": len(missing),
        },
        "have": have,
        "needs_proof": needs_proof,
        "missing": missing,
    }
