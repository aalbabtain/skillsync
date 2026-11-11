import logging
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"
client = TestClient(app)


def upload(name: str, content_type: str = "application/pdf", data: bytes | None = None):
    payload = data if data is not None else (FIXTURES / name).read_bytes()
    return client.post("/api/runs", files={"file": (name, payload, content_type)})


def test_accepts_a_pdf_and_returns_its_text():
    response = upload("english_cv.pdf")

    assert response.status_code == 200
    body = response.json()
    assert len(body["run_id"]) == 36
    assert body["pages"] == 1
    assert body["characters"] >= 40
    assert "Ahmed Ababtain" in body["text"]


def test_accepts_an_arabic_pdf():
    response = upload("arabic_cv.pdf")

    assert response.status_code == 200
    assert "أحمد" in response.json()["text"]


def test_rejects_a_non_pdf_content_type():
    response = upload("cv.txt", content_type="text/plain", data=b"hello")

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "NOT_A_PDF"


def test_rejects_bytes_without_pdf_magic():
    response = upload("cv.pdf", data=b"<html>hello</html>")

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "NOT_A_PDF_MAGIC"


def test_rejects_an_oversized_upload():
    response = upload("big.pdf", data=b"%PDF-" + b"0" * (5 * 1024 * 1024))

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "PDF_TOO_LARGE"


def test_rejects_an_empty_upload():
    response = upload("empty.pdf", data=b"")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "EMPTY_UPLOAD"


def test_rejects_a_scanned_pdf_with_422():
    response = upload("scanned.pdf")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PDF_NO_TEXT_LAYER"


def test_never_logs_the_cv_text(caplog):
    caplog.set_level(logging.DEBUG)

    upload("english_cv.pdf")

    assert "MARKER-7731" not in caplog.text
