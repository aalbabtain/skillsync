import json

from fastapi.testclient import TestClient

import app.main as main
from app.agents import cv_skills
from app.main import app

client = TestClient(app)
CV = "Built the SkillSync pipeline in Python and FastAPI, and a dashboard in React."


def read(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_verified_skills_stream_one_line_each(monkeypatch):
    found = [
        {"name": "Python", "category": "Programming languages", "evidence": "in Python and FastAPI"},
        {"name": "Python", "category": "Programming languages", "evidence": "in Python and FastAPI"},
        {"name": "Kubernetes", "category": "Cloud & DevOps", "evidence": "ran Kubernetes clusters"},
        {"name": "React", "category": "Frameworks", "evidence": "a dashboard in React"},
    ]
    monkeypatch.setattr(cv_skills, "stream", lambda text: iter(found))

    response = client.post("/api/skills/extract/stream", json={"text": CV})

    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = read(response)
    assert [line.get("name") for line in lines if line["type"] == "skill"] == ["Python", "React"]
    # The made-up quote is dropped; the repeated skill is skipped without counting as dropped.
    assert lines[-1] == {"type": "done", "dropped_count": 1}


def test_an_extraction_error_ends_the_stream_with_its_code(monkeypatch):
    def failing(text):
        yield {"name": "Python", "category": "Programming languages", "evidence": "in Python and FastAPI"}
        raise cv_skills.SkillExtractionError("SKILLS_BUSY", "The AI model is busy right now.")

    monkeypatch.setattr(cv_skills, "stream", failing)

    lines = read(client.post("/api/skills/extract/stream", json={"text": CV}))
    assert lines[0]["name"] == "Python"
    assert lines[-1] == {"type": "error", "code": "SKILLS_BUSY", "message": "The AI model is busy right now."}


def test_short_text_is_refused_before_streaming():
    response = client.post("/api/skills/extract/stream", json={"text": "too short"})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "TEXT_TOO_SHORT"


def test_demo_mode_streams_end_to_end(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)

    lines = read(client.post("/api/skills/extract/stream", json={"text": CV}))
    names = [line["name"] for line in lines if line["type"] == "skill"]
    assert "Python" in names and lines[-1]["type"] == "done"
