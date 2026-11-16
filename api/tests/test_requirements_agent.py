import pytest

from app.agents import requirements

POSTING = "Requirements: Strong experience with PostgreSQL and query optimization"


class FakeSettings:
    gemini_api_key = "test-key"
    gemini_model = "test-model"
    skillsync_extractor = "gemini"


class MissingKeySettings:
    gemini_api_key = ""
    gemini_model = "test-model"
    skillsync_extractor = "gemini"


class MockSettings:
    gemini_api_key = ""
    gemini_model = "test-model"
    skillsync_extractor = "mock"


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


class QuotaError(Exception):
    code = 429


def fake_client(response=None, error=None):
    def generate(self, **_):
        if error:
            raise error
        return response

    def build(**kwargs):
        models = type("Models", (), {"generate_content": generate})()
        return type("Client", (), {"models": models})()

    return build


def use_gemini(monkeypatch, response=None, error=None):
    monkeypatch.setattr(requirements, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(requirements.cv_skills, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(requirements.genai, "Client", fake_client(response, error))


def skill(name="PostgreSQL", category="Databases", level="required", evidence=None):
    return requirements.ExtractedRequirement(
        name=name,
        category=category,
        level=level,
        evidence=evidence or "Strong experience with PostgreSQL and query optimization",
    )


def test_prompt_is_loaded_from_the_prompt_file():
    assert requirements.PROMPT_PATH.name == "requirements_extractor.md"
    prompt = requirements.load_prompt()

    assert "3 and 25 words" in prompt
    assert "preferred" in prompt
    assert "Programming languages" in prompt


def test_returns_cleaned_requirements(monkeypatch):
    parsed = requirements.Extraction(skills=[skill(name="  PostgreSQL ")])
    use_gemini(monkeypatch, FakeResponse(parsed=parsed))

    assert requirements.extract(POSTING) == [
        {
            "name": "PostgreSQL",
            "category": "Databases",
            "level": "required",
            "evidence": "Strong experience with PostgreSQL and query optimization",
        }
    ]


def test_maps_unknown_category_and_level(monkeypatch):
    parsed = requirements.Extraction(skills=[skill(category="Design", level="must")])
    use_gemini(monkeypatch, FakeResponse(parsed=parsed))

    [result] = requirements.extract(POSTING)
    assert result["category"] == "Other"
    assert result["level"] == "required"


def test_keeps_a_preferred_level(monkeypatch):
    parsed = requirements.Extraction(skills=[skill(level="Preferred")])
    use_gemini(monkeypatch, FakeResponse(parsed=parsed))

    assert requirements.extract(POSTING)[0]["level"] == "preferred"


def test_truncates_to_forty_skills(monkeypatch):
    parsed = requirements.Extraction(skills=[skill(name=f"Skill {n}") for n in range(45)])
    use_gemini(monkeypatch, FakeResponse(parsed=parsed))

    assert len(requirements.extract(POSTING)) == 40


def test_parses_json_text_when_parsed_is_missing(monkeypatch):
    text = (
        '{"skills": [{"name": "Docker", "category": "Cloud & DevOps", '
        '"level": "preferred", "evidence": "Docker is a plus"}]}'
    )
    use_gemini(monkeypatch, FakeResponse(text=text))

    assert requirements.extract(POSTING)[0]["name"] == "Docker"


def test_reports_malformed_output(monkeypatch):
    use_gemini(monkeypatch, FakeResponse(text="not json"))

    with pytest.raises(requirements.RequirementsError) as error:
        requirements.extract(POSTING)

    assert error.value.code == "REQUIREMENTS_MALFORMED"


def test_reports_an_exhausted_quota(monkeypatch):
    use_gemini(monkeypatch, error=QuotaError("quota"))

    with pytest.raises(requirements.RequirementsError) as error:
        requirements.extract(POSTING)

    assert error.value.code == "REQUIREMENTS_QUOTA_EXCEEDED"


def test_reports_an_outage(monkeypatch):
    use_gemini(monkeypatch, error=RuntimeError("down"))

    with pytest.raises(requirements.RequirementsError) as error:
        requirements.extract(POSTING)

    assert error.value.code == "REQUIREMENTS_UNAVAILABLE"


def test_reports_a_missing_key(monkeypatch):
    monkeypatch.setattr(requirements, "get_settings", lambda: MissingKeySettings())
    monkeypatch.setattr(requirements.cv_skills, "get_settings", lambda: MissingKeySettings())

    with pytest.raises(requirements.RequirementsError) as error:
        requirements.extract(POSTING)

    assert error.value.code == "REQUIREMENTS_UNAVAILABLE"


def test_demo_mode_never_builds_a_client(monkeypatch):
    monkeypatch.setattr(requirements, "get_settings", lambda: MockSettings())
    monkeypatch.setattr(requirements.cv_skills, "get_settings", lambda: MockSettings())

    def explode(**kwargs):
        raise AssertionError("client built in demo mode")

    monkeypatch.setattr(requirements.genai, "Client", explode)

    [result] = requirements.extract(POSTING)
    assert result["name"] == "PostgreSQL"
    assert result["level"] == "required"
