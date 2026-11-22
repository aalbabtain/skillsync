import json

import pytest

from app.agents import cv_skills, cv_writer, gemini


class ServerError(Exception):
    def __init__(self, code):
        super().__init__(f"server error {code}")
        self.code = code


class Settings:
    gemini_api_key = "test-key"
    gemini_model = "main-model"
    gemini_fallback_model = "spare-model"
    skillsync_extractor = "gemini"


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(gemini, "sleep", lambda seconds: None)


def fake_model(monkeypatch, answers_by_model, seen=None, whole=None):
    """A client whose streamed answer per model is a list of text pieces or an exception
    raised after them; `seen` collects each request's contents."""
    def build(**kwargs):
        def stream(self, model, **request):
            if seen is not None:
                seen.append(request["contents"])
            for piece in answers_by_model[model]:
                if isinstance(piece, Exception):
                    raise piece
                yield type("Chunk", (), {"text": piece})()

        def generate(self, model, **request):
            if seen is not None:
                seen.append(request["contents"])
            return type("Response", (), {"parsed": None, "text": whole})()

        models = type("Models", (), {"generate_content_stream": stream, "generate_content": generate})()
        return type("Client", (), {"models": models})()

    monkeypatch.setattr(cv_writer, "get_settings", lambda: Settings())
    monkeypatch.setattr(cv_skills, "get_settings", lambda: Settings())
    monkeypatch.setattr(cv_writer.genai, "Client", build)


def line(text):
    return json.dumps({"text": text})


def test_demo_summary_from_answers():
    answers = {"field": "software engineering student", "background": "final-year student who likes APIs", "target": "Backend Developer"}
    assert list(cv_writer.write_lines("summary", answers, extractor=cv_skills.MOCK)) == [
        "Software engineering student. Final-year student who likes APIs. Seeking a Backend Developer role."
    ]


def test_demo_bullets_split():
    answers = {"projWhat": "reads a CV. compares it with postings; built the API with FastAPI. ok"}
    assert list(cv_writer.write_lines("bullets", answers, extractor=cv_skills.MOCK)) == [
        "Reads a CV",
        "Compares it with postings",
        "Built the API with FastAPI",
    ]


def test_demo_bullets_come_from_the_description_only():
    answers = {"projName": "SkillSync", "projWhat": "reads a CV. lists its skills", "projTools": "FastAPI, React"}
    assert list(cv_writer.write_lines("bullets", answers, extractor=cv_skills.MOCK)) == ["Reads a CV", "Lists its skills"]


def test_model_lines_streamed_one_by_one(monkeypatch):
    pieces = ['{"lines": [', line("Built the API with FastAPI"), ",", line("Deployed it on Render"), "]}"]
    fake_model(monkeypatch, {"main-model": pieces})
    lines = cv_writer.write_lines("bullets", {"projWhat": "built the API with FastAPI, deployed on Render"})
    assert next(lines) == "Built the API with FastAPI"
    assert list(lines) == ["Deployed it on Render"]


def test_restart_does_not_repeat_lines(monkeypatch):
    fake_model(monkeypatch, {
        "main-model": ['{"lines": [', line("Built the API with FastAPI"), ",", ServerError(503)],
        "spare-model": ['{"lines": [', line("Built the API with FastAPI"), ",", line("Wrote the tests"), "]}"],
    })
    assert list(cv_writer.write_lines("bullets", {"projWhat": "x"})) == ["Built the API with FastAPI", "Wrote the tests"]


def test_strip_contact_removes_email_phone_url():
    text = "Reach me at sara@example.com or +966 50 000 0000, code at https://github.com/sara/app."
    cleaned = cv_writer.strip_contact(text)
    for gone in ("sara@example.com", "+966", "000 0000", "github.com"):
        assert gone not in cleaned
    assert cleaned.startswith("Reach me at")


def test_strip_contact_keeps_year_ranges_and_removes_local_numbers():
    assert cv_writer.strip_contact("worked there 2023-2025") == "worked there 2023-2025"
    assert "0500" not in cv_writer.strip_contact("call 0500000000")


def test_model_request_has_no_contact(monkeypatch):
    seen = []
    fake_model(monkeypatch, {"main-model": ['{"lines": []}']}, seen)
    answers = {"background": "student, email sara@example.com, phone +966 50 000 0000"}
    list(cv_writer.write_lines("summary", answers))
    assert "sara@example.com" not in seen[0] and "000 0000" not in seen[0]


def test_rejected_facts_reach_the_model_as_things_to_avoid(monkeypatch):
    seen = []
    fake_model(monkeypatch, {"main-model": ['{"lines": []}']}, seen)
    list(cv_writer.write_lines("bullets", {"projWhat": "made an app", "rejected": "Docker, 40%"}))
    sent = json.loads(seen[0])
    assert sent["avoid"] == ["Docker", "40%"] and "rejected" not in sent["answers"]


def test_translate_passes_latin_through_and_asks_only_for_arabic(monkeypatch):
    seen = []
    fake_model(monkeypatch, {}, seen, whole=json.dumps({"items": [{"key": "field", "text": "Software Engineering"}]}))
    result = cv_writer.translate({"field": "هندسة البرمجيات", "target": "Backend Developer"})
    assert result == {"field": "Software Engineering", "target": "Backend Developer"}
    assert "Backend Developer" not in seen[0]


def test_translate_in_demo_mode_returns_values_unchanged():
    items = {"field": "هندسة البرمجيات"}
    assert cv_writer.translate(items, extractor=cv_skills.MOCK) == items


def test_follow_up_in_demo_mode_is_none():
    assert cv_writer.follow_up("built it with Python", extractor=cv_skills.MOCK) is None


def test_follow_up_from_the_model(monkeypatch):
    fake_model(monkeypatch, {}, whole=json.dumps({"question": "What could people do with it?"}))
    assert cv_writer.follow_up("built it with Python") == "What could people do with it?"


def test_busy_model_becomes_cv_busy(monkeypatch):
    fake_model(monkeypatch, {"main-model": [ServerError(503)], "spare-model": [ServerError(503)]})
    with pytest.raises(cv_writer.CvWriterError) as error:
        list(cv_writer.write_lines("summary", {"background": "x"}))
    assert error.value.code == "CV_BUSY"


def test_follow_up_is_asked_in_the_sites_language(monkeypatch):
    seen = []
    fake_model(monkeypatch, {}, seen, whole=json.dumps({"question": "ماذا يستطيع الناس فعله به؟"}))
    assert cv_writer.follow_up("بنيته بـ Python", language="ar") == "ماذا يستطيع الناس فعله به؟"
    assert "Arabic" in seen[0]
