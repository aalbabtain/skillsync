import json

from fastapi.testclient import TestClient

from app.agents import cv_skills, plan_builder, retrieval
from app.main import app

client = TestClient(app)


def requirement(name, level="required", frequency=2, evidence=None):
    return {"name": name, "category": "Cloud & DevOps", "level": level, "frequency": frequency,
            "sources": [{"posting": 0, "level": level, "evidence": evidence or f"experience with {name}"}]}


BODY = {
    "language": "en",
    "postings_count": 3,
    "skills": [{"name": "FastAPI", "category": "Frameworks", "evidence": "REST APIs in FastAPI", "verified": True}],
    "gap": {
        "missing": [requirement("Docker", evidence="containerized deployment with Docker Compose"), requirement("Kubernetes", frequency=3)],
        "needs_proof": [requirement("AWS")],
    },
}


def read(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


def demo(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)


def test_demo_plan_streams_every_card_with_sourced_topics(monkeypatch):
    demo(monkeypatch)
    lines = read(client.post("/api/plan/stream", json=BODY))

    cards = [line for line in lines if line["type"] == "skill"]
    assert [card["name"] for card in cards] == ["Kubernetes", "Docker", "AWS"]
    assert [card["phase"] for card in cards] == ["core", "quick", "prove"]
    docker = cards[1]
    assert docker["builds_on"] == "FastAPI"
    assert docker["topics"] and all(t["source"]["url"].startswith("https://docs.docker.com/") for t in docker["topics"])
    assert cards[2]["topics"] == [] and cards[2]["project"]["title"]
    assert lines[-1] == {"type": "done", "later": [], "retrieval": "keywords"}


def test_the_model_cannot_cite_a_note_it_was_not_given(monkeypatch):
    demo(monkeypatch)

    def model(items, notes, known, language):
        for item in items:
            given = notes[item["id"]]
            yield {"id": item["id"], "weeks": 3, "project_title": "P", "project_summary": "S",
                   "topics": [{"source_id": "made-up-99", "text": "Invented"},
                              *[{"source_id": n["id"], "text": f"About {n['title']}"} for n in given[:3]]]}

    monkeypatch.setattr(plan_builder, "stream", model)
    cards = [line for line in read(client.post("/api/plan/stream", json=BODY)) if line["type"] == "skill"]

    learn = [card for card in cards if card["kind"] == "learn"]
    assert all("Invented" not in [t["text"] for t in card["topics"]] for card in learn)
    assert all(len(card["topics"]) == 3 for card in learn)


def test_a_skill_the_model_skipped_still_gets_a_card(monkeypatch):
    demo(monkeypatch)

    def model(items, notes, known, language):
        yield {"id": items[0]["id"], "topics": [], "project_title": "P", "project_summary": "S", "weeks": 2}

    monkeypatch.setattr(plan_builder, "stream", model)
    cards = [line for line in read(client.post("/api/plan/stream", json=BODY)) if line["type"] == "skill"]

    assert len(cards) == 3


def test_a_model_error_ends_the_stream_with_its_code(monkeypatch):
    demo(monkeypatch)

    def model(items, notes, known, language):
        raise plan_builder.PlanError("PLAN_QUOTA_EXCEEDED", "The Gemini request limit is used up.")
        yield

    monkeypatch.setattr(plan_builder, "stream", model)
    lines = read(client.post("/api/plan/stream", json=BODY))

    assert lines[-1]["type"] == "error" and lines[-1]["code"] == "PLAN_QUOTA_EXCEEDED"


def test_an_empty_gap_is_refused_before_streaming():
    response = client.post("/api/plan/stream", json={**BODY, "gap": {"missing": [], "needs_proof": []}})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "PLAN_EMPTY"


def test_a_malformed_body_is_refused_with_plan_invalid():
    response = client.post("/api/plan/stream", json={"gap": {"missing": [{"name": "x"}]}, "postings_count": 1})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "PLAN_INVALID"


def test_the_model_input_carries_each_skills_sources():
    items = [{"id": "s1", "name": "Docker", "kind": "learn", "level": "required", "frequency": 2,
              "postings_count": 3, "builds_on": "FastAPI"}]
    notes = {"s1": [{"id": "docker-02", "title": "Writing a Dockerfile", "note": "How images are built."}]}

    sent = json.loads(plan_builder.model_input(items, notes, ["FastAPI"], "ar"))

    assert sent["language"] == "ar"
    assert sent["skills"][0]["sources"] == [{"source_id": "docker-02", "title": "Writing a Dockerfile", "note": "How images are built."}]


class GeminiSettings:
    gemini_api_key = "test-key"
    gemini_model = "main-model"
    gemini_fallback_model = ""
    skillsync_extractor = "gemini"


def fake_stream_client(pieces, log):
    def build(**kwargs):
        def stream(self, model, **request):
            for text in pieces:
                log.append(text)
                yield type("Chunk", (), {"text": text})()
        return type("Client", (), {"models": type("Models", (), {"generate_content_stream": stream})()})()
    return build


ITEMS = [{"id": "s1", "name": "Docker", "kind": "learn", "level": "required", "frequency": 2, "postings_count": 3, "builds_on": None},
         {"id": "s2", "name": "AWS", "kind": "prove", "level": "required", "frequency": 2, "postings_count": 3, "builds_on": None}]


def test_gemini_cards_come_out_as_each_closes(monkeypatch):
    card1 = '{"id": "s1", "topics": [{"source_id": "docker-01", "text": "Images"}], "project_title": "P", "project_summary": "S", "weeks": 2}'
    card2 = '{"id": "s2", "topics": [], "project_title": "Q", "project_summary": "T", "weeks": 1}'
    log = []
    monkeypatch.setattr(plan_builder, "get_settings", lambda: GeminiSettings())
    monkeypatch.setattr(cv_skills, "get_settings", lambda: GeminiSettings())
    monkeypatch.setattr(plan_builder.genai, "Client", fake_stream_client(['{"skills": [', card1, ", ", card2, "]}"], log))

    cards = plan_builder.stream(ITEMS, {}, [], "en")
    first = next(cards)

    assert first["id"] == "s1" and len(log) == 2
    assert [card["id"] for card in cards] == ["s2"]


def test_an_unusable_gemini_answer_is_reported(monkeypatch):
    monkeypatch.setattr(plan_builder, "get_settings", lambda: GeminiSettings())
    monkeypatch.setattr(cv_skills, "get_settings", lambda: GeminiSettings())
    monkeypatch.setattr(plan_builder.genai, "Client", fake_stream_client(["not json"], []))

    try:
        list(plan_builder.stream(ITEMS, {}, [], "en"))
    except plan_builder.PlanError as error:
        assert error.code == "PLAN_MALFORMED"
    else:
        raise AssertionError("expected PLAN_MALFORMED")
