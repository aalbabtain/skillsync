import json

from fastapi.testclient import TestClient

from app.agents import cv_skills, requirements
from app.main import app

client = TestClient(app)

POSTING_A = "Backend developer. Requirements: strong Python and Docker experience. Nice to have: Kubernetes knowledge for our clusters."
POSTING_B = "Data engineer role. You must know Python and SQL well, and be comfortable with Airflow pipelines every day."


def read(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_requirements_stream_per_posting_and_end_with_the_counted_result(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    body = {"postings": [{"title": "A", "text": POSTING_A}, {"title": "B", "text": POSTING_B}]}

    lines = read(client.post("/api/requirements/extract/stream", json=body))
    streamed = client.post("/api/requirements/extract", json=body).json()

    kinds = [line["type"] for line in lines]
    assert kinds[0] == "posting" and kinds[-1] == "done"
    assert kinds.index("posting_done") < [i for i, k in enumerate(kinds) if k == "posting"][1]
    assert {line["name"] for line in lines if line["type"] == "requirement" and line["posting"] == 0} >= {"Python", "Docker"}
    # The final line carries exactly what the whole-answer route returns.
    assert lines[-1]["result"] == streamed


def test_a_skill_named_twice_in_one_posting_is_sent_once(monkeypatch):
    found = [
        {"name": "Python", "category": "Programming languages", "level": "preferred", "evidence": "strong Python and Docker experience"},
        {"name": "Python", "category": "Programming languages", "level": "required", "evidence": "strong Python and Docker experience"},
    ]
    monkeypatch.setattr(requirements, "stream", lambda text: iter(found))

    lines = read(client.post("/api/requirements/extract/stream", json={"postings": [{"title": "A", "text": POSTING_A}]}))

    assert [line["name"] for line in lines if line["type"] == "requirement"] == ["Python"]
    # The stronger level still wins in the counted result.
    assert lines[-1]["result"]["requirements"][0]["level"] == "required"


def test_an_error_ends_the_stream_with_its_code(monkeypatch):
    def failing(text):
        raise requirements.RequirementsError("REQUIREMENTS_QUOTA_EXCEEDED", "The Gemini request limit is used up.")
        yield

    monkeypatch.setattr(requirements, "stream", failing)

    lines = read(client.post("/api/requirements/extract/stream", json={"postings": [{"title": "A", "text": POSTING_A}]}))
    assert lines[-1]["type"] == "error" and lines[-1]["code"] == "REQUIREMENTS_QUOTA_EXCEEDED"


def test_bad_postings_are_refused_before_streaming():
    response = client.post("/api/requirements/extract/stream", json={"postings": []})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "POSTINGS_EMPTY"


def test_gemini_requirements_come_out_as_they_close(monkeypatch):
    class Settings:
        gemini_api_key = "test-key"
        gemini_model = "main-model"
        gemini_fallback_model = ""
        skillsync_extractor = "gemini"

    log = []
    pieces = ['{"skills": [', '{"name": "Docker", "category": "Cloud & DevOps", "level": "required", "evidence": "Docker experience"}', "]}"]

    def build(**kwargs):
        def stream(self, model, **request):
            for text in pieces:
                log.append(text)
                yield type("Chunk", (), {"text": text})()

        return type("Client", (), {"models": type("Models", (), {"generate_content_stream": stream})()})()

    monkeypatch.setattr(requirements, "get_settings", lambda: Settings())
    monkeypatch.setattr(cv_skills, "get_settings", lambda: Settings())
    monkeypatch.setattr(requirements.genai, "Client", build)

    found = requirements.stream(POSTING_A)
    first = next(found)
    assert first["name"] == "Docker" and len(log) == 2
    assert list(found) == []
