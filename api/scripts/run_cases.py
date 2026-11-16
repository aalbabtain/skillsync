"""Runs every CV case and writes reports.

Usage: python scripts/run_cases.py [--extractor mock|gemini] [--cases DIR] [--out DIR]

Each case is also checked against expected.json in the cases folder; the script exits
with status 1 when any case misses its expectation.
"""

import argparse
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

from app import cases, expectations  # noqa: E402
from app.agents import cv_skills  # noqa: E402

CASES_DIR = API_DIR / "tests" / "fixtures" / "cases"
POSTINGS_DIR = API_DIR / "tests" / "fixtures" / "postings"
REPORTS_DIR = API_DIR.parent / "reports"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run every CV case and write reports.")
    parser.add_argument("--extractor", choices=[cv_skills.MOCK, cv_skills.GEMINI], default=None)
    parser.add_argument("--cases", type=Path, default=CASES_DIR)
    parser.add_argument("--out", type=Path, default=REPORTS_DIR)
    args = parser.parse_args()

    extractor = args.extractor or cv_skills.extractor_mode()
    print(f"extractor: {extractor}")
    print(f"cases:     {args.cases}")

    results = cases.run_all(args.cases, extractor=extractor)

    expected_path = args.cases / "expected.json"
    expected = expectations.load(expected_path) if expected_path.exists() else {}
    misses = 0

    for result in results:
        if result.status == cases.FAILED:
            line = f"  {result.name:<18} rejected {result.code}"
        else:
            line = f"  {result.name:<18} {len(result.skills):>2} skills  {result.dropped_count} dropped"

        if result.name not in expected:
            print(f"{line}   (no expectation)")
            continue

        problems = expectations.check_case(result, expected[result.name], extractor)
        if "gap" in expected[result.name] and result.status == cases.OK:
            problems += expectations.check_gap(
                result, expected[result.name]["gap"], POSTINGS_DIR, extractor
            )

        print(f"{line}   {'PASS' if not problems else 'FAIL'}")
        for problem in problems:
            print(f"      - {problem}")
        misses += bool(problems)

    cases.write_reports(results, args.out)
    print(f"reports:   {args.out}")
    if expected:
        print(f"expected:  {len(results) - misses} of {len(results)} cases pass")

    return 1 if misses else 0


if __name__ == "__main__":
    raise SystemExit(main())
