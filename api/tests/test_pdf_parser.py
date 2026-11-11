import io
from pathlib import Path

import pytest
from pypdf import PdfWriter

from app.parsers.pdf import PdfExtractionError, extract

FIXTURES = Path(__file__).parent / "fixtures" / "cases"


def read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_extracts_latin_text():
    document = extract(read("english_cv.pdf"))

    assert document.pages == 1
    assert "Ahmed Ababtain" in document.text
    assert "FastAPI" in document.text
    assert document.characters >= 40


def test_extracts_arabic_text():
    document = extract(read("arabic_cv.pdf"))

    assert document.pages == 1
    assert "أحمد" in document.text
    assert "بايثون" in document.text
    assert "جامعة" in document.text
    assert document.characters >= 40


def test_arabic_text_has_no_presentation_forms():
    document = extract(read("arabic_cv.pdf"))

    assert not any(0xFB50 <= ord(character) <= 0xFEFF for character in document.text)


def test_rejects_bytes_without_pdf_magic():
    with pytest.raises(PdfExtractionError) as error:
        extract(b"<html>not a pdf</html>")

    assert error.value.code == "NOT_A_PDF_MAGIC"


def test_rejects_empty_upload():
    with pytest.raises(PdfExtractionError) as error:
        extract(b"")

    assert error.value.code == "EMPTY_UPLOAD"


def test_rejects_truncated_pdf():
    with pytest.raises(PdfExtractionError) as error:
        extract(read("english_cv.pdf")[:120])

    assert error.value.code == "PDF_CORRUPTED"


def test_rejects_scanned_pdf():
    with pytest.raises(PdfExtractionError) as error:
        extract(read("scanned.pdf"))

    assert error.value.code == "PDF_NO_TEXT_LAYER"


def test_rejects_encrypted_pdf():
    writer = PdfWriter()
    writer.append(io.BytesIO(read("english_cv.pdf")))
    writer.encrypt("secret")
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(PdfExtractionError) as error:
        extract(buffer.getvalue())

    assert error.value.code == "PDF_ENCRYPTED"


def test_rejects_more_than_ten_pages():
    writer = PdfWriter()
    for _ in range(11):
        writer.append(io.BytesIO(read("english_cv.pdf")))
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(PdfExtractionError) as error:
        extract(buffer.getvalue())

    assert error.value.code == "PDF_TOO_MANY_PAGES"
