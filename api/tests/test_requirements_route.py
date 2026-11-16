import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agents import requirements
from app.main import app

client = TestClient(app)

POSTINGS_DIR = Path(__file__).parent / "fixtures" / "postings"
VALID = "Requirements: strong experience with Python and PostgreSQL in production systems."


def posting(name: str) -> str:
    return (POSTINGS_DIR / name).read_text(encoding="utf-8")


@pytest.fixture
def demo_mode(monkeypatch):
    real = requirements.extract
    monkeypatch.setattr(requirements, "extract", lambda text: real(text, "mock"))


def post(postings):
    return client.post("/api/requirements/extract", json={"postings": postings})


def test_aggregates_the_sample_postings(demo_mode):
    response = post(
        [
            {"title": "Backend", "text": posting("backend_en.txt")},
            {"title": "", "text": posting("arabic.txt")},
            {"text": posting("mixed_preferred.txt")},
        ]
    )

    assert response.status_code == 200
    body = response.json()
    assert body["postings_count"] == 3
    assert body["dropped_count"] == 0

    summary = [(r["name"], r["frequency"], r["level"]) for r in body["requirements"]]
    assert summary[:4] == [
        ("Docker", 2, "required"),
        ("PostgreSQL", 2, "required"),
        ("Python", 2, "required"),
        ("React", 2, "required"),
    ]
    levels = {name: level for name, _, level in summary}
    assert levels["AWS"] == "preferred"
    assert levels["Figma"] == "preferred"
    assert levels["Kubernetes"] == "preferred"

    python = body["requirements"][2]
    assert python["category"] == "Programming languages"
    assert [s["posting"] for s in python["sources"]] == [0, 2]
    assert python["sources"][0]["evidence"] == "- 2+ years building REST APIs with Python and FastAPI"


def test_drops_requirements_without_proof(monkeypatch):
    monkeypatch.setattr(
        requirements,
        "extract",
        lambda text: [
            {"name": "Python", "category": "Programming languages", "level": "required",
             "evidence": "strong experience with Python"},
            {"name": "Rust", "category": "Programming languages", "level": "required",
             "evidence": "Rust is mandatory"},
        ],
    )

    body = post([{"text": VALID}]).json()

    assert [r["name"] for r in body["requirements"]] == ["Python"]
    assert body["dropped_count"] == 1


@pytest.mark.parametrize(
    ("postings", "status", "code"),
    [
        ([], 422, "POSTINGS_EMPTY"),
        ([{"text": VALID}] * 11, 422, "POSTINGS_TOO_MANY"),
        ([{"text": VALID}, {"text": "   "}], 422, "POSTING_TOO_SHORT"),
        ([{"text": "x" * 20_001}], 413, "POSTING_TOO_LONG"),
        ([{"title": "t" * 121, "text": VALID}], 422, "POSTING_TITLE_TOO_LONG"),
    ],
)
def test_rejects_bad_input(demo_mode, postings, status, code):
    response = post(postings)

    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


def test_a_short_posting_is_named_by_number(demo_mode):
    response = post([{"text": VALID}, {"title": "Only a title", "text": "Python"}])

    assert "Posting 2" in response.json()["detail"]["message"]


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("REQUIREMENTS_MALFORMED", 502),
        ("REQUIREMENTS_UNAVAILABLE", 503),
        ("REQUIREMENTS_QUOTA_EXCEEDED", 429),
    ],
)
def test_a_failure_on_any_posting_fails_the_request(monkeypatch, code, status):
    calls = []

    def extract(text):
        calls.append(text)
        if len(calls) == 2:
            raise requirements.RequirementsError(code, "failed")
        return []

    monkeypatch.setattr(requirements, "extract", extract)

    response = post([{"text": VALID}] * 3)

    assert response.status_code == status
    assert response.json() == {"detail": {"code": code, "message": "failed"}}
    assert len(calls) == 2


def test_never_logs_the_posting_text(demo_mode, caplog):
    secret = (
        "Requirements: the unique-marker-7741 team needs Python and Docker every day "
        "for the internal payments platform."
    )

    with caplog.at_level(logging.DEBUG):
        assert post([{"title": "Secret title 9931", "text": secret}]).status_code == 200

    assert "unique-marker-7741" not in caplog.text
    assert "Secret title 9931" not in caplog.text
