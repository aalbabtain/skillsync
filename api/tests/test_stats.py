from fastapi.testclient import TestClient

import app.main as main
from app.main import app

client = TestClient(app)


def _reset(monkeypatch, code="skillsync"):
    monkeypatch.setattr(main.settings, "goatcounter_code", code)
    monkeypatch.setattr(main, "_stats_cache", {"at": 0.0, "checked": None})


def test_stats_reports_the_checked_count(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(main, "_read_goatcounter", lambda code, path: 7)

    assert client.get("/api/stats").json() == {"checked": 7}


def test_stats_reports_zero(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(main, "_read_goatcounter", lambda code, path: 0)

    assert client.get("/api/stats").json() == {"checked": 0}


def test_stats_is_empty_without_a_code(monkeypatch):
    _reset(monkeypatch, code="")
    monkeypatch.setattr(main, "_read_goatcounter", lambda code, path: 7)

    assert client.get("/api/stats").json() == {"checked": None}


def test_stats_is_empty_when_goatcounter_fails(monkeypatch):
    _reset(monkeypatch)

    def fail(code, path):
        raise OSError("unreachable")

    monkeypatch.setattr(main, "_read_goatcounter", fail)

    assert client.get("/api/stats").json() == {"checked": None}


def test_stats_asks_goatcounter_once_per_few_minutes(monkeypatch):
    _reset(monkeypatch)
    calls = []

    def read(code, path):
        calls.append(path)
        return 3

    monkeypatch.setattr(main, "_read_goatcounter", read)
    client.get("/api/stats")
    client.get("/api/stats")

    assert calls == ["step-skills"]
