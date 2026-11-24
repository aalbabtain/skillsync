import logging

from fastapi.testclient import TestClient

from app.agents import cv_skills
from app.main import app

client = TestClient(app)

CV_TEXT = """Example Candidate
Skills: Python, ReactJS, TypeScript
Project: SkillSync pipeline built with FastAPI and ReactJS
"""


def extract(monkeypatch, candidates):
    monkeypatch.setattr(cv_skills, "extract", lambda text: candidates)


def test_extracts_skills_and_reports_dropped(monkeypatch):
    extract(
        monkeypatch,
        [
            {
                "name": "Python",
                "category": "Programming languages",
                "evidence": "Skills: Python, ReactJS, TypeScript",
            },
            {
                "name": "Kubernetes",
                "category": "Cloud & DevOps",
                "evidence": "Deployed Kubernetes clusters",
            },
        ],
    )

    response = client.post("/api/skills/extract", json={"text": CV_TEXT})

    assert response.status_code == 200
    body = response.json()
    assert [skill["name"] for skill in body["skills"]] == ["Python"]
    assert body["skills"][0]["category"] == "Programming languages"
    assert body["dropped_count"] == 1


def test_reports_malformed_model_output(monkeypatch):
    def fail(text):
        raise cv_skills.SkillExtractionError("SKILLS_MALFORMED", "Unusable output.")

    monkeypatch.setattr(cv_skills, "extract", fail)

    response = client.post("/api/skills/extract", json={"text": CV_TEXT})

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "SKILLS_MALFORMED"


def test_reports_an_unavailable_model(monkeypatch):
    def fail(text):
        raise cv_skills.SkillExtractionError("SKILLS_UNAVAILABLE", "No key.")

    monkeypatch.setattr(cv_skills, "extract", fail)

    response = client.post("/api/skills/extract", json={"text": CV_TEXT})

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "SKILLS_UNAVAILABLE"


def test_reports_an_exhausted_quota(monkeypatch):
    def fail(text):
        raise cv_skills.SkillExtractionError("SKILLS_QUOTA_EXCEEDED", "Quota used up.")

    monkeypatch.setattr(cv_skills, "extract", fail)

    response = client.post("/api/skills/extract", json={"text": CV_TEXT})

    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "SKILLS_QUOTA_EXCEEDED"


def test_rejects_text_that_is_too_short(monkeypatch):
    extract(monkeypatch, [])

    response = client.post("/api/skills/extract", json={"text": "Python"})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "TEXT_TOO_SHORT"


def test_never_logs_the_cv_text(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    extract(monkeypatch, [])

    client.post("/api/skills/extract", json={"text": CV_TEXT + "MARKER-7731"})

    assert "MARKER-7731" not in caplog.text
