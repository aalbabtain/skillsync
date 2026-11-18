import pytest

from app.agents import cv_skills, gemini

CV = "Built the SkillSync pipeline in Python and FastAPI, and a dashboard in React."


class ServerError(Exception):
    def __init__(self, code):
        super().__init__(f"server error {code}")
        self.code = code


class Settings:
    gemini_api_key = "test-key"
    gemini_model = "main-model"
    gemini_fallback_model = "spare-model"
    skillsync_extractor = "gemini"


def piece(text):
    return type("Chunk", (), {"text": text})()


def client_with(script, log):
    """script maps a model name to a list of pieces; an Exception in the list is raised there."""
    def build(**kwargs):
        def stream(self, model, **request):
            log.append(("start", model))
            for item in script[model]:
                if isinstance(item, Exception):
                    raise item
                log.append(("piece", model))
                yield piece(item)

        models = type("Models", (), {"generate_content_stream": stream})()
        return type("Client", (), {"models": models})()

    return build


@pytest.fixture(autouse=True)
def gemini_settings(monkeypatch):
    monkeypatch.setattr(cv_skills, "get_settings", lambda: Settings())
    monkeypatch.setattr(gemini, "sleep", lambda seconds: None)


PYTHON = '{"name": "Python", "category": "Programming languages", "evidence": "in Python and FastAPI"}'
REACT = '{"name": "React", "category": "Frameworks", "evidence": "a dashboard in React"}'


def test_each_skill_comes_out_before_the_answer_ends(monkeypatch):
    log = []
    script = {"main-model": ['{"skills": [', PYTHON, ", ", REACT, "]}"]}
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, log))

    found = cv_skills.stream(CV)
    first = next(found)

    assert first["name"] == "Python"
    # React's piece has not been read yet when Python is handed over.
    assert log.count(("piece", "main-model")) == 2
    assert [skill["name"] for skill in found] == ["React"]


def test_a_used_up_quota_before_the_answer_moves_to_the_spare(monkeypatch):
    log = []
    script = {"main-model": [ServerError(429)], "spare-model": ['{"skills": [', PYTHON, "]}"]}
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, log))

    assert [skill["name"] for skill in cv_skills.stream(CV)] == ["Python"]


def test_a_model_that_stops_mid_answer_is_replaced_from_the_start(monkeypatch):
    log = []
    script = {
        "main-model": ['{"skills": [', PYTHON, ", {\"name\": \"Rea", ServerError(503)],
        "spare-model": ['{"skills": [', PYTHON, ", ", REACT, "]}"],
    }
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, log))

    # Python comes twice (once from each model); the route's verifier keeps one.
    assert [skill["name"] for skill in cv_skills.stream(CV)] == ["Python", "Python", "React"]


def test_an_empty_list_is_a_fair_answer(monkeypatch):
    script = {"main-model": ['{"skills": ', "[]}"]}
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, []))

    assert list(cv_skills.stream(CV)) == []


def test_an_unusable_answer_is_reported(monkeypatch):
    script = {"main-model": ["Sorry, I cannot help with that."]}
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, []))

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        list(cv_skills.stream(CV))
    assert error.value.code == "SKILLS_MALFORMED"


def test_every_model_out_of_quota_is_reported(monkeypatch):
    script = {"main-model": [ServerError(429)], "spare-model": [ServerError(429)]}
    monkeypatch.setattr(cv_skills.genai, "Client", client_with(script, []))

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        list(cv_skills.stream(CV))
    assert error.value.code == "SKILLS_QUOTA_EXCEEDED"


def test_demo_mode_streams_too(monkeypatch):
    monkeypatch.setattr(cv_skills, "get_settings", lambda: type("S", (), {"gemini_api_key": "", "skillsync_extractor": ""})())

    names = [skill["name"] for skill in cv_skills.stream(CV)]
    assert "Python" in names and "React" in names
