"""Every CV in fixtures/cases must produce what expected.json says, in demo mode."""

from pathlib import Path

import pytest

from app import cases, expectations
from app.agents import cv_skills

FIXTURES = Path(__file__).parent / "fixtures"
CASES_DIR = FIXTURES / "cases"
EXPECTED = expectations.load(CASES_DIR / "expected.json")


def test_every_pdf_has_an_expectation_and_back():
    pdfs = {path.stem for path in CASES_DIR.glob("*.pdf")}

    assert pdfs == set(EXPECTED)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_case_meets_its_expectation(name):
    result = cases.run_case(CASES_DIR / f"{name}.pdf", extractor=cv_skills.MOCK)

    assert expectations.check_case(result, EXPECTED[name], cv_skills.MOCK) == []


@pytest.mark.parametrize("name", sorted(n for n, e in EXPECTED.items() if "gap" in e))
def test_case_gap_meets_its_expectation(name):
    result = cases.run_case(CASES_DIR / f"{name}.pdf", extractor=cv_skills.MOCK)

    problems = expectations.check_gap(
        result, EXPECTED[name]["gap"], FIXTURES / "postings", cv_skills.MOCK
    )

    assert problems == []


def test_model_traps_are_checked_only_outside_demo_mode():
    result = cases.run_case(CASES_DIR / "traps_en.pdf", extractor=cv_skills.MOCK)
    expected = EXPECTED["traps_en"]

    assert expectations.check_case(result, expected, cv_skills.MOCK) == []
    assert "should not have Kubernetes" in expectations.check_case(
        result, expected, cv_skills.GEMINI
    )


def test_reports_what_went_wrong():
    result = cases.run_case(CASES_DIR / "english_cv.pdf", extractor=cv_skills.MOCK)
    expected = {"status": "ok", "pages": 3, "must_have": ["Rust"], "must_not_have": ["Python"]}

    assert expectations.check_case(result, expected, cv_skills.MOCK) == [
        "pages is 1, expected 3",
        "missing Rust",
        "should not have Python",
    ]
