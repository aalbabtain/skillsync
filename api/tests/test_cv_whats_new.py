import pytest
from fastapi.testclient import TestClient

from app.agents import cv_skills, cv_writer
from app.main import app, rate_limiter

client = TestClient(app)

TEXT = (
    "I finished the AWS Cloud Practitioner certificate in March 2026, built a chatbot called "
    "StudyBot with RAG and LangChain that answers questions from course notes, and learned Docker. "
    "I also joined the Google Developer Student Club."
)


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def test_changes_keep_only_what_the_person_said(monkeypatch):
    answer = {
        "projects": [
            {"name": "StudyBot", "what": "a chatbot with RAG and LangChain that answers questions from course notes", "tools": "RAG, LangChain"},
            {"name": "Invented App", "what": "a mobile app"},
        ],
        "skills": ["Docker", "LangChain", "Kubernetes"],
        "certs": ["AWS Cloud Practitioner, March 2026", "Azure Fundamentals"],
        "activities": ["Member, Google Developer Student Club"],
    }
    monkeypatch.setattr(cv_writer, "_ask", lambda prompt, schema, contents: schema.model_validate(answer))
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: "gemini")
    changes = client.post("/api/cv/whats-new", json={"text": TEXT}).json()["changes"]
    assert [p["name"] for p in changes["projects"]] == ["StudyBot"]
    assert changes["projects"][0]["tools"] == "RAG, LangChain"
    assert changes["skills"] == ["Docker", "LangChain"]
    assert changes["certs"] == ["AWS Cloud Practitioner, March 2026"]
    assert changes["activities"] == ["Member, Google Developer Student Club"]


def test_demo_mode_finds_skills_and_a_project_written_with_its_label(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    text = "New project: StudyBot. It answers questions from course notes.\nNew skills: Docker, Python"
    changes = client.post("/api/cv/whats-new", json={"text": text}).json()["changes"]
    assert changes["projects"][0]["name"] == "StudyBot"
    assert set(changes["skills"]) >= {"Docker", "Python"}


def test_an_empty_text_is_refused():
    assert client.post("/api/cv/whats-new", json={"text": "  "}).status_code == 422


def test_an_activity_title_the_person_did_not_give_is_refused(monkeypatch):
    monkeypatch.setattr(cv_writer, "_ask", lambda prompt, schema, contents: schema.model_validate({"activities": ["Founder, Google Developer Student Club"]}))
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: "gemini")
    assert client.post("/api/cv/whats-new", json={"text": TEXT}).json()["changes"]["activities"] == []
