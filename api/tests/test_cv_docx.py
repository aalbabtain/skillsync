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


def body_size(data: bytes) -> float:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        styles = archive.read("word/styles.xml").decode("utf-8")
    import re

    return int(re.search(r'<w:rPrDefault><w:rPr>.*?<w:sz w:val="(\d+)"', styles).group(1)) / 2


def test_a_short_cv_gets_a_larger_font_to_fill_the_page():
    assert body_size(build_docx(Resume.model_validate(SAMPLE))) == 13


def test_a_long_cv_gets_a_smaller_font_to_stay_on_one_page():
    long_project = {**SAMPLE["projects"][0], "bullets": ["Built " + "and tested a service " * 9] * 4}
    resume = Resume.model_validate({**SAMPLE, "projects": [long_project] * 6})
    assert 9.5 <= body_size(build_docx(resume)) < 11


def test_layout_follows_the_reference_cv():
    xml = document_xml(build_docx(Resume.model_validate(SAMPLE)))
    assert '<w:pgMar w:top="640" w:right="900" w:bottom="560" w:left="900"' in xml
    assert 'w:pos="10106"' in xml
    assert 'Calibri' in zipfile.ZipFile(io.BytesIO(build_docx(Resume.model_validate(SAMPLE)))).read("word/styles.xml").decode()


def test_activities_have_their_section_with_dates_at_the_line_end():
    resume = Resume.model_validate({**SAMPLE, "activities": ["Member, Artificial Intelligence Club – King Saud University, Mar 2026 – Present"]})
    xml = document_xml(build_docx(resume))
    text = docx.extract(build_docx(resume)).text
    assert "ACTIVITIES & MEMBERSHIPS" in text
    assert "Member, Artificial Intelligence Club – King Saud University" in text
    assert '<w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Mar 2026 – Present</w:t>' in xml


def test_links_are_clickable():
    data = build_docx(Resume.model_validate(SAMPLE))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        rels = archive.read("word/_rels/document.xml.rels").decode("utf-8")
    xml = document_xml(data)
    for target in ("mailto:sara@example.com", "https://linkedin.com/in/sara-a", "https://github.com/sara-a/skillsync"):
        assert f'Target="{target}" TargetMode="External"' in rels
    assert xml.count("<w:hyperlink ") == 3
    assert xml.count('<w:color w:val="0563C1"/>') == 3
    assert "link:" not in xml


def test_a_bare_link_opens_over_https():
    data = build_docx(Resume.model_validate({**SAMPLE, "projects": [{**SAMPLE["projects"][0], "url": "nakhlahsa.com"}]}))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        rels = archive.read("word/_rels/document.xml.rels").decode("utf-8")
    assert 'Target="https://nakhlahsa.com"' in rels
    assert ">nakhlahsa.com<" in document_xml(data)
