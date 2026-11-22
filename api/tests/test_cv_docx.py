import io
import zipfile

from fastapi.testclient import TestClient

from app.cv_docx import TEXT_WIDTH, Resume, build_docx
from app.main import app
from app.parsers import docx

client = TestClient(app)

SAMPLE = {
    "personal": {"name": "Sara Alharbi", "field": "Software Engineering student", "target_title": "Backend Developer"},
    "contact": {"email": "sara@example.com", "phone": "+966 50 000 0000", "location": "Riyadh, Saudi Arabia",
                "linkedin": "https://linkedin.com/in/sara-a", "github": ""},
    "summary": "Final-year Software Engineering student who builds APIs with FastAPI.",
    "education": [{"institution": "King Saud University", "degree": "B.Sc.", "major": "Software Engineering",
                   "end": "Jun 2027", "gpa": "4.6/5", "achievements": []}],
    "skills": {"Programming languages": ["Python", "SQL"], "Frameworks": ["FastAPI"]},
    "projects": [{"name": "SkillSync", "url": "https://github.com/sara-a/skillsync", "start": "Jan 2026", "end": "Present",
                  "role_line": "Backend developer | Python, FastAPI", "bullets": ["Built the API with FastAPI", "Wrote the tests with pytest"]}],
}


def document_xml(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read("word/document.xml").decode("utf-8")


def test_docx_opens_with_our_reader():
    text = docx.extract(build_docx(Resume.model_validate(SAMPLE))).text
    for expected in ("Sara Alharbi", "Backend Developer", "sara@example.com", "PROFESSIONAL SUMMARY", "EDUCATION",
                     "PROJECTS", "TECHNICAL SKILLS", "King Saud University", "Built the API with FastAPI",
                     "Programming languages: Python, SQL"):
        assert expected in text


def test_heading_has_bottom_border():
    xml = document_xml(build_docx(Resume.model_validate(SAMPLE)))
    assert '<w:bottom w:val="single" w:sz="6"' in xml


def test_dates_use_right_tab_stop():
    xml = document_xml(build_docx(Resume.model_validate(SAMPLE)))
    assert f'<w:tab w:val="right" w:pos="{TEXT_WIDTH}"/>' in xml
    assert "Jan 2026 – Present" in xml


def test_empty_sections_left_out():
    text = docx.extract(build_docx(Resume.model_validate(SAMPLE))).text
    assert "EXPERIENCE" not in text and "CERTIFICATIONS" not in text


def test_markup_in_answers_is_escaped():
    resume = Resume.model_validate({**SAMPLE, "summary": "Built <b>tools</b> & tests"})
    assert "Built <b>tools</b> & tests" in docx.extract(build_docx(resume)).text


def test_route_returns_attachment():
    response = client.post("/api/cv/docx", json=SAMPLE)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert response.headers["content-disposition"] == 'attachment; filename="Sara-Alharbi-CV.docx"'
    assert zipfile.is_zipfile(io.BytesIO(response.content))


def test_route_refuses_a_resume_without_a_name():
    assert client.post("/api/cv/docx", json={**SAMPLE, "personal": {"name": ""}}).status_code == 422
