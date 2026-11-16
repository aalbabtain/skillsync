import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
BASIC = json.loads((Path(__file__).parent / "fixtures" / "gap" / "basic.json").read_text("utf-8"))


def post(body):
    return client.post("/api/gap", json=body)


def test_returns_the_golden_result():
    response = post(BASIC["input"])

    assert response.status_code == 200
    assert response.json() == BASIC["expected"]


def test_rejects_empty_requirements():
    response = post({**BASIC["input"], "requirements": []})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "GAP_NO_REQUIREMENTS"


@pytest.mark.parametrize(
    "change",
    [
        {"postings_count": 0},
        {"postings_count": 11},
        {"requirements": [{**BASIC["input"]["requirements"][0], "frequency": 3}]},
        {"requirements": [{**BASIC["input"]["requirements"][0], "level": "must"}]},
        {"requirements": [{"name": "Python"}]},
        {"skills": "Python"},
    ],
)
def test_rejects_invalid_input(change):
    response = post({**BASIC["input"], **change})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "GAP_INVALID"


def test_never_logs_cv_or_posting_quotes(caplog):
    body = json.loads(json.dumps(BASIC["input"]))
    body["skills"][0]["evidence"] = "marker-cv-5521 Python"
    body["requirements"][0]["sources"][0]["evidence"] = "marker-post-8830"

    with caplog.at_level(logging.DEBUG):
        assert post(body).status_code == 200

    assert "marker-cv-5521" not in caplog.text
    assert "marker-post-8830" not in caplog.text
