"""Runs every CV case and writes reports.

Usage: python scripts/run_cases.py [--extractor mock|gemini] [--cases DIR] [--out DIR]
"""

import argparse
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

from app import cases  # noqa: E402
from app.agents import cv_skills  # noqa: E402

CASES_DIR = API_DIR / "tests" / "fixtures" / "cases"
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

    for result in results:
        if result.status == cases.FAILED:
            print(f"  {result.name:<14} FAILED   {result.code}: {result.message}")
        else:
            print(f"  {result.name:<14} {len(result.skills):>2} skills   {result.dropped_count} dropped")

    cases.write_reports(results, args.out)
    print(f"reports:   {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
