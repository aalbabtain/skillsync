import json

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


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        return json.dumps(self.body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_the_api_key_reads_the_dashboard_count(monkeypatch):
    monkeypatch.setattr(main.settings, "goatcounter_api_key", "secret-key")
    seen = {}

    def urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["auth"] = request.get_header("Authorization")
        return FakeResponse({"hits": [
            {"path": "step-skills", "count": 4, "event": True},
            {"path": "step-skills-old", "count": 9, "event": True},
        ]})

    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)

    assert main._read_goatcounter("skillsync", "step-skills") == 4
    assert seen["url"].startswith("https://skillsync.goatcounter.com/api/v0/stats/hits?")
    assert seen["auth"] == "Bearer secret-key"


def test_the_api_is_asked_with_times_on_the_hour(monkeypatch):
    from urllib.parse import parse_qs, urlparse

    monkeypatch.setattr(main.settings, "goatcounter_api_key", "secret-key")
    monkeypatch.setattr(main.time, "time", lambda: 1_700_000_123.0)  # 2023-11-14 22:15:23 UTC
    seen = {}

    def urlopen(request, timeout):
        seen["query"] = parse_qs(urlparse(request.full_url).query)
        return FakeResponse({"hits": []})

    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)
    main._read_goatcounter("skillsync", "step-skills")

    assert seen["query"]["start"] == ["2020-01-01T00:00:00Z"]
    assert seen["query"]["end"] == ["2023-11-14T23:00:00Z"]
    assert "filter" not in seen["query"]


def test_the_api_reports_zero_when_the_step_has_no_hits(monkeypatch):
    monkeypatch.setattr(main.settings, "goatcounter_api_key", "secret-key")
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda request, timeout: FakeResponse({"hits": []}))

    assert main._read_goatcounter("skillsync", "step-skills") == 0


def test_without_an_api_key_the_public_counter_is_read(monkeypatch):
    monkeypatch.setattr(main.settings, "goatcounter_api_key", "")
    seen = {}

    def urlopen(request, timeout):
        seen["url"] = request.full_url
        return FakeResponse({"count": "1,234"})

    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)

    assert main._read_goatcounter("skillsync", "step-skills") == 1234
    assert seen["url"] == "https://skillsync.goatcounter.com/counter/step-skills.json"


def test_a_failing_api_falls_back_to_the_public_counter(monkeypatch):
    monkeypatch.setattr(main.settings, "goatcounter_api_key", "secret-key")
    seen = []

    def urlopen(request, timeout):
        seen.append(request.full_url)
        if "/api/v0/" in request.full_url:
            raise OSError("HTTP Error 404: Not Found")
        return FakeResponse({"count": "3"})

    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)

    assert main._read_goatcounter("skillsync", "step-skills") == 3
    assert seen[-1] == "https://skillsync.goatcounter.com/counter/step-skills.json"


def test_goatcounters_reason_is_logged_without_the_key(monkeypatch, caplog):
    import io
    import urllib.error

    monkeypatch.setattr(main.settings, "goatcounter_api_key", "secret-key")

    def urlopen(request, timeout):
        if "/api/v0/" in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, io.BytesIO(b'{"error":"start: invalid"}'))
        return FakeResponse({"count": "2"})

    monkeypatch.setattr(main.urllib.request, "urlopen", urlopen)

    assert main._read_goatcounter("skillsync", "step-skills") == 2
    assert 'start: invalid' in caplog.text
    assert "secret-key" not in caplog.text
