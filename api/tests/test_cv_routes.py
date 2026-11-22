import json

import pytest
from fastapi.testclient import TestClient

from app.agents import cv_skills, cv_writer
from app.main import app, rate_limiter

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def read(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_write_stream_demo_mode(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    body = {"task": "bullets", "answers": {"projWhat": "built the API with FastAPI. wrote the tests"}}
    lines = read(client.post("/api/cv/write/stream", json=body))
    assert [line["type"] for line in lines] == ["line", "line", "done"]
    assert lines[0] == {"type": "line", "text": "Built the API with FastAPI", "facts": ["FastAPI"]}


def test_unsupported_line_is_not_sent(monkeypatch):
    monkeypatch.setattr(cv_writer, "write_lines", lambda task, answers: iter(["Built the API with FastAPI", "Deployed it with Docker"]))
    lines = read(client.post("/api/cv/write/stream", json={"task": "bullets", "answers": {"projWhat": "built the API with FastAPI"}}))
    assert [line.get("text") for line in lines if line["type"] == "line"] == ["Built the API with FastAPI"]
    assert {"type": "rejected", "count": 1} in lines


def test_all_rejected_retries_once_then_falls_back(monkeypatch):
    calls = []

    def write(task, answers):
        calls.append(dict(answers))
        return iter(["Deployed it with Docker"])

    monkeypatch.setattr(cv_writer, "write_lines", write)
    answers = {"projWhat": "made a small app for my class"}
    lines = read(client.post("/api/cv/write/stream", json={"task": "bullets", "answers": answers}))
    assert len(calls) == 2 and calls[1]["rejected"] == "Docker"
    assert lines[-2] == {"type": "fallback", "text": "made a small app for my class"}
    assert lines[-1]["type"] == "done"


def test_short_company_name_falls_back_to_own_words(monkeypatch):
    monkeypatch.setattr(cv_writer, "write_lines", lambda task, answers: iter(["Interned at STC"]))
    answers = {"company": "Saudi Telecom Company", "jobWhat": "helped the network team test new routers"}
    lines = read(client.post("/api/cv/write/stream", json={"task": "bullets", "answers": answers}))
    assert not [line for line in lines if line["type"] == "line"]
    assert lines[-2] == {"type": "fallback", "text": "helped the network team test new routers"}


def test_model_error_ends_with_its_code(monkeypatch):
    def failing(task, answers):
        raise cv_writer.CvWriterError("CV_BUSY", "busy")
        yield  # pragma: no cover

    monkeypatch.setattr(cv_writer, "write_lines", failing)
    lines = read(client.post("/api/cv/write/stream", json={"task": "summary", "answers": {"background": "student"}}))
    assert lines == [{"type": "error", "code": "CV_BUSY", "message": "busy"}]


def test_contact_in_answers_is_never_passed_on(monkeypatch):
    seen = []
    monkeypatch.setattr(cv_writer, "write_lines", lambda task, answers: seen.append(answers) or iter([]))
    client.post("/api/cv/write/stream", json={"task": "summary", "answers": {"background": "student, sara@example.com"}})
    assert "sara@example.com" not in json.dumps(seen[0])


def test_bad_task_is_refused():
    response = client.post("/api/cv/write/stream", json={"task": "poem", "answers": {"a": "b"}})
    assert response.status_code == 422


def test_follow_up_route(monkeypatch):
    asked = []
    monkeypatch.setattr(cv_writer, "follow_up", lambda answer, language="en": asked.append(language) or "ماذا يفعل؟")
    response = client.post("/api/cv/follow-up", json={"answer": "built it", "language": "ar"})
    assert response.json() == {"question": "ماذا يفعل؟"} and asked == ["ar"]


def test_translate_keeps_original_when_digits_lost(monkeypatch):
    monkeypatch.setattr(cv_writer, "translate", lambda items: {"field": "Software Engineering", "gpa": "high GPA"})
    response = client.post("/api/cv/translate", json={"items": {"field": "هندسة البرمجيات", "gpa": "٤.٦ من ٥"}})
    assert response.json() == {"items": {"field": "Software Engineering", "gpa": "٤.٦ من ٥"}}


def test_rate_limited_returns_429(monkeypatch):
    monkeypatch.setattr(cv_writer, "follow_up", lambda answer, language="en": None)
    monkeypatch.setattr(rate_limiter, "take", lambda key, units=1: 60)
    response = client.post("/api/cv/follow-up", json={"answer": "built it"})
    assert response.status_code == 429
