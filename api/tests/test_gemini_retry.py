import pytest

from app.agents import cv_skills, gemini, requirements

CV = "Built the SkillSync pipeline in Python and FastAPI"


class ServerError(Exception):
    def __init__(self, code):
        super().__init__(f"server error {code}")
        self.code = code


class Settings:
    gemini_api_key = "test-key"
    gemini_model = "main-model"
    gemini_fallback_model = ""
    skillsync_extractor = "gemini"


class WithFallback(Settings):
    gemini_fallback_model = "spare-model"


def scripted(outcomes, calls):
    """A fake client whose calls fail or succeed in the given order, recording the model used."""
    def build(**kwargs):
        def generate(self, model, **_):
            calls.append(model)
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        models = type("Models", (), {"generate_content": generate})()
        return type("Client", (), {"models": models})()

    return build


def ok():
    return type("Response", (), {"parsed": None, "text": '{"skills": []}'})()


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    waits = []
    monkeypatch.setattr(gemini, "sleep", waits.append)
    return waits


def use(monkeypatch, module, settings, outcomes, calls):
    monkeypatch.setattr(module, "get_settings", lambda: settings())
    monkeypatch.setattr(cv_skills, "get_settings", lambda: settings())
    monkeypatch.setattr(module.genai, "Client", scripted(outcomes, calls))


def test_retries_a_busy_model_then_succeeds(monkeypatch, no_waiting):
    calls = []
    use(monkeypatch, cv_skills, Settings, [ServerError(503), ServerError(503), ok()], calls)

    assert cv_skills.extract(CV) == []
    assert calls == ["main-model"] * 3
    assert no_waiting == [1.0, 2.0]


def test_reports_busy_after_the_last_attempt(monkeypatch):
    calls = []
    use(monkeypatch, cv_skills, Settings, [ServerError(503)] * 3, calls)

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        cv_skills.extract(CV)

    assert error.value.code == "SKILLS_BUSY"
    assert len(calls) == 3


def test_moves_to_the_fallback_model(monkeypatch):
    calls = []
    use(monkeypatch, cv_skills, WithFallback, [ServerError(503)] * 3 + [ok()], calls)

    assert cv_skills.extract(CV) == []
    assert calls == ["main-model"] * 3 + ["spare-model"]


def test_does_not_retry_errors_that_will_not_pass(monkeypatch):
    calls = []
    use(monkeypatch, cv_skills, WithFallback, [ServerError(400)], calls)

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        cv_skills.extract(CV)

    assert error.value.code == "SKILLS_UNAVAILABLE"
    assert calls == ["main-model"]


def test_quota_is_not_retried(monkeypatch):
    calls = []
    use(monkeypatch, cv_skills, Settings, [ServerError(429)], calls)

    with pytest.raises(cv_skills.SkillExtractionError) as error:
        cv_skills.extract(CV)

    assert error.value.code == "SKILLS_QUOTA_EXCEEDED"
    assert calls == ["main-model"]


def test_requirements_retry_and_report_busy(monkeypatch):
    calls = []
    use(monkeypatch, requirements, Settings, [ServerError(502), ok()], calls)
    assert requirements.extract("Requirements: Python") == []

    calls.clear()
    use(monkeypatch, requirements, Settings, [ServerError(504)] * 3, calls)
    with pytest.raises(requirements.RequirementsError) as error:
        requirements.extract("Requirements: Python")
    assert error.value.code == "REQUIREMENTS_BUSY"
