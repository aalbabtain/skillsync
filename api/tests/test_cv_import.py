import json

import pytest
from fastapi.testclient import TestClient

from app.agents import cv_skills, cv_writer
from app.cv_check import mentions
from app.main import app, rate_limiter
from app.parsers import extract_document

client = TestClient(app)

CV = """Sara Alharbi
sara@example.com | +966 50 000 0000 | linkedin.com/in/sara-a | github.com/sara-a
King Saud University, B.Sc. in Software Engineering, Jun 2027
Skills: Python, FastAPI, Docker
SkillSync: built the API with FastAPI and tested it with pytest"""


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def test_contact_found_by_code():
    assert cv_writer.contact_from(CV) == {
        "email": "sara@example.com",
        "phone": "+966 50 000 0000",
        "linkedin": "https://linkedin.com/in/sara-a",
        "github": "https://github.com/sara-a",
    }


def test_mentions_reads_catalog_spellings():
    assert mentions("PostgreSQL", "we used postgres")
    assert mentions("King Saud University", CV)
    assert not mentions("MIT", CV)


def fake_import(monkeypatch, answer, seen):
    def ask(prompt, schema, contents):
        seen.append(contents)
        return schema.model_validate(answer)

    monkeypatch.setattr(cv_writer, "_ask", ask)
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: "gemini")


def test_model_never_sees_contact(monkeypatch):
    seen = []
    fake_import(monkeypatch, {"name": "Sara Alharbi"}, seen)
    cv_writer.import_resume(CV)
    for gone in ("sara@example.com", "000 0000", "linkedin.com", "github.com"):
        assert gone not in seen[0]


def test_invented_value_dropped(monkeypatch):
    answer = {
        "name": "Sara Alharbi", "school": "MIT", "degree": "B.Sc. in Software Engineering",
        "skills": ["Python", "Kubernetes"],
        "projects": [{"name": "SkillSync", "lines": ["Built the API with FastAPI", "Deployed it on AWS"]}],
    }
    fake_import(monkeypatch, answer, [])
    resume = cv_writer.import_resume(CV)
    assert resume["school"] == "" and resume["degree"] == "B.Sc. in Software Engineering"
    assert resume["skills"] == ["Python"]
    assert resume["projects"] == [{"name": "SkillSync", "lines": ["Built the API with FastAPI"]}]


def test_demo_import_backend_cv():
    text = extract_document(open("tests/fixtures/cases/backend_cv.pdf", "rb").read()).text
    resume = cv_writer.import_resume(text, extractor=cv_skills.MOCK)
    assert resume["name"] == "Sara Alharbi"
    assert len(resume["skills"]) >= 3


def test_import_route(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    body = client.post("/api/cv/import", json={"text": CV}).json()
    assert body["resume"]["name"] == "Sara Alharbi"
    assert body["contact"]["email"] == "sara@example.com"


def test_import_route_refuses_short_text():
    assert client.post("/api/cv/import", json={"text": "hi"}).status_code == 422
