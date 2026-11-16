import json
from pathlib import Path

from app import cases

FIXTURES = Path(__file__).parent / "fixtures" / "cases"


def test_runs_a_case_through_extraction_and_verification():
    result = cases.run_case(FIXTURES / "english_cv.pdf", extractor="mock")

    names = {skill["name"] for skill in result.skills}

    assert result.status == cases.OK
    assert result.pages == 1
    assert {"Python", "FastAPI", "React", "TypeScript"} <= names
    assert result.dropped_count == 0


def test_reports_a_pdf_without_a_text_layer_as_failed():
    result = cases.run_case(FIXTURES / "scanned.pdf", extractor="mock")

    assert result.status == cases.FAILED
    assert result.code == "PDF_NO_TEXT_LAYER"
    assert result.skills == ()


def test_runs_every_pdf_in_the_cases_directory():
    results = cases.run_all(FIXTURES, extractor="mock")

    files = sorted(p for p in FIXTURES.iterdir() if p.suffix in cases.CV_SUFFIXES)
    assert [result.name for result in results] == [p.stem for p in files]
    failed = {result.name for result in results if result.status == cases.FAILED}
    assert failed == {"encrypted", "scanned"}


def test_markdown_report_lists_skills_with_evidence():
    result = cases.run_case(FIXTURES / "backend_cv.pdf", extractor="mock")
    markdown = cases.render_markdown(result)

    assert "# backend_cv" in markdown
    assert "| Skill | Category | Evidence |" in markdown
    assert "| Django | Frameworks | Skills: Python, Django, PostgreSQL, Docker, AWS |" in markdown


def test_failed_case_markdown_names_the_reason():
    result = cases.run_case(FIXTURES / "scanned.pdf", extractor="mock")
    markdown = cases.render_markdown(result)

    assert "**Failed**" in markdown
    assert "PDF_NO_TEXT_LAYER" in markdown


def test_writes_one_markdown_file_per_case_and_a_summary(tmp_path):
    results = cases.run_all(FIXTURES, extractor="mock")

    written = cases.write_reports(results, tmp_path)

    assert (tmp_path / "english_cv.md").exists()
    assert (tmp_path / "summary.json") in written

    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    by_case = {entry["case"]: entry for entry in summary}
    assert by_case["english_cv"]["status"] == cases.OK
    assert by_case["scanned"]["code"] == "PDF_NO_TEXT_LAYER"
    assert {"name": "Python", "category": "Programming languages"} in by_case["english_cv"]["skills"]
