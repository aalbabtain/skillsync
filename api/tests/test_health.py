from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cors_allows_the_dev_frontend():
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_health_has_no_analytics_without_a_code(monkeypatch):
    monkeypatch.setattr("app.main.settings.goatcounter_code", "")

    assert client.get("/api/health").json()["analytics"] == ""


def test_health_returns_the_goatcounter_code(monkeypatch):
    monkeypatch.setattr("app.main.settings.goatcounter_code", "skillsync")

    assert client.get("/api/health").json()["analytics"] == "skillsync"


def test_health_ignores_a_code_that_is_not_a_goatcounter_name(monkeypatch):
    # The code becomes part of a script address in the page, so only a plain name passes.
    monkeypatch.setattr("app.main.settings.goatcounter_code", "evil.example.com/x")

    assert client.get("/api/health").json()["analytics"] == ""
