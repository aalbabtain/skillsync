import pytest

from app.agents import cv_skills

CV_TEXT = "Built the SkillSync pipeline in Python and FastAPI"


class FakeSettings:
    gemini_api_key = "test-key"
    gemini_model = "test-model"


class MissingKeySettings:
    gemini_api_key = ""
    gemini_model = "test-model"


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


def fake_client(response: FakeResponse):
    def build(**kwargs):
        models = type("Models", (), {"generate_content": lambda self, **_: response})()
        return type("Client", (), {"models": models})()

    return build


def test_prompt_is_loaded_from_the_prompt_file():
    assert cv_skills.PROMPT_PATH.name == "cv_assessor.md"
    prompt = cv_skills.load_prompt()

    assert prompt == cv_skills.PROMPT_PATH.read_text(encoding="utf-8").strip()
    assert "verbatim" in prompt.lower()
    assert "5 and 25 words" in prompt
    assert "Cloud & DevOps" in prompt


def test_returns_candidate_skills(monkeypatch):
    parsed = cv_skills.Extraction(
        skills=[
            cv_skills.ExtractedSkill(
                name="  Python ",
                category="Programming languages",
                evidence="Built the SkillSync pipeline in Python and FastAPI",
            )
        ]
    )
    monkeypatch.setattr(cv_skills, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(cv_skills.genai, "Client", fake_client(FakeResponse(parsed=parsed)))

    assert cv_skills.extract(CV_TEXT) == [
        {
            "name": "Python",
            "category": "Programming languages",
            "evidence": "Built the SkillSync pipeline in Python and FastAPI",
        }
    ]


def test_maps_an_unknown_category_to_other(monkeypatch):
    parsed = cv_skills.Extraction(
        skills=[
            cv_skills.ExtractedSkill(
                name="Figma",
                category="Design",
                evidence="Designed the dashboard in Figma",
            )
        ]
    )
    monkeypatch.setattr(cv_skills, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(cv_skills.genai, "Client", fake_client(FakeResponse(parsed=parsed)))

    assert cv_skills.extract(CV_TEXT)[0]["category"] == "Other"


def test_rejects_malformed_model_output(monkeypatch):
    monkeypatch.setattr(cv_skills, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(cv_skills.genai, "Client", fake_client(FakeResponse(text="not json")))

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        cv_skills.extract(CV_TEXT)

    assert error.value.code == "SKILLS_MALFORMED"


def test_reports_a_missing_api_key(monkeypatch):
    monkeypatch.setattr(cv_skills, "get_settings", lambda: MissingKeySettings())

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        cv_skills.extract(CV_TEXT)

    assert error.value.code == "SKILLS_UNAVAILABLE"
