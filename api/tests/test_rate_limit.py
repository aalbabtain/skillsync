from fastapi.testclient import TestClient

from app import main
from app.agents import cv_skills, requirements
from app.rate_limit import RateLimiter

client = TestClient(main.app)

CV = "Skills: Python, FastAPI and React, used every day in the SkillSync project."
POSTING = "Requirements: strong experience with Python and PostgreSQL in production systems."


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_allows_up_to_the_limit_then_refuses():
    limiter = RateLimiter(limit=3, window_seconds=60, clock=Clock())

    assert [limiter.take("a") for _ in range(3)] == [None, None, None]
    assert limiter.take("a") == 60


def test_counts_units_and_frees_them_after_the_window():
    clock = Clock()
    limiter = RateLimiter(limit=5, window_seconds=60, clock=clock)

    assert limiter.take("a", units=4) is None
    assert limiter.take("a", units=2) == 60

    clock.now += 61
    assert limiter.take("a", units=5) is None


def test_keeps_addresses_apart():
    limiter = RateLimiter(limit=1, window_seconds=60, clock=Clock())

    assert limiter.take("a") is None
    assert limiter.take("b") is None
    assert limiter.take("a") is not None


def test_zero_disables_the_limit():
    limiter = RateLimiter(limit=0, window_seconds=60, clock=Clock())

    assert all(limiter.take("a", units=100) is None for _ in range(5))


def test_skills_route_returns_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(main, "rate_limiter", RateLimiter(limit=1, window_seconds=3600))
    monkeypatch.setattr(cv_skills, "extract", lambda text: [])

    assert client.post("/api/skills/extract", json={"text": CV}).status_code == 200
    response = client.post("/api/skills/extract", json={"text": CV})

    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0


def test_each_posting_counts_once(monkeypatch):
    monkeypatch.setattr(main, "rate_limiter", RateLimiter(limit=3, window_seconds=3600))
    monkeypatch.setattr(requirements, "extract", lambda text: [])

    ok = client.post("/api/requirements/extract", json={"postings": [{"text": POSTING}] * 3})
    refused = client.post("/api/requirements/extract", json={"postings": [{"text": POSTING}]})

    assert ok.status_code == 200
    assert refused.status_code == 429


def test_invalid_requests_do_not_use_the_allowance(monkeypatch):
    monkeypatch.setattr(main, "rate_limiter", RateLimiter(limit=1, window_seconds=3600))
    monkeypatch.setattr(cv_skills, "extract", lambda text: [])

    for _ in range(3):
        assert client.post("/api/skills/extract", json={"text": "short"}).status_code == 422

    assert client.post("/api/skills/extract", json={"text": CV}).status_code == 200


def test_uses_the_address_render_appends_last(monkeypatch):
    monkeypatch.setattr(main, "rate_limiter", RateLimiter(limit=1, window_seconds=3600))
    monkeypatch.setattr(cv_skills, "extract", lambda text: [])

    def post(forwarded):
        return client.post(
            "/api/skills/extract", json={"text": CV}, headers={"X-Forwarded-For": forwarded}
        )

    assert post("1.1.1.1, 9.9.9.9").status_code == 200
    # Changing the spoofable left part does not reset the allowance.
    assert post("2.2.2.2, 9.9.9.9").status_code == 429
    assert post("9.9.9.8").status_code == 200
