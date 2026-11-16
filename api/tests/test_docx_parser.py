import io
import zipfile

import pytest

from app.parsers import extract_document
from app.parsers.pdf import PdfExtractionError
from tests.docx_builder import W, build_docx, paragraph

SKILLS = "Skills: Python, FastAPI, React and TypeScript in production projects."


def test_reads_paragraphs_in_order():
    data = build_docx(paragraph("Sara Alharbi") + paragraph(SKILLS))

    document = extract_document(data)

    assert document.text == f"Sara Alharbi\n{SKILLS}"
    assert document.pages == 1


def test_reads_the_header_first():
    data = build_docx(paragraph(SKILLS), header=paragraph("Sara Alharbi, Riyadh"))

    assert extract_document(data).text.splitlines()[0] == "Sara Alharbi, Riyadh"


def test_reads_table_cells():
    table = f"<w:tbl><w:tr><w:tc>{paragraph('Languages')}</w:tc><w:tc>{paragraph('Python, SQL and Go')}</w:tc></w:tr></w:tbl>"
    data = build_docx(paragraph(SKILLS) + table)

    text = extract_document(data).text

    assert "Languages" in text
    assert "Python, SQL and Go" in text


def test_reads_a_text_box_once():
    box = (
        "<w:p><w:r><w:t>Before box</w:t></w:r><w:r><w:pict><w:txbxContent>"
        + paragraph("Inside the box: Docker")
        + "</w:txbxContent></w:pict></w:r></w:p>"
    )
    data = build_docx(paragraph(SKILLS) + box)

    text = extract_document(data).text

    assert text.count("Inside the box: Docker") == 1
    assert "Before box" in text


def test_tabs_and_breaks_become_spaces_and_lines():
    run = "<w:p><w:r><w:t>Python</w:t><w:tab/><w:t>FastAPI</w:t><w:br/><w:t>React</w:t></w:r></w:p>"
    data = build_docx(paragraph(SKILLS) + run)

    assert "Python FastAPI\nReact" in extract_document(data).text


def test_keeps_arabic_in_reading_order():
    data = build_docx(
        paragraph("خالد الدوسري", rtl=True)
        + paragraph("المهارات: بايثون و Docker و Kubernetes على AWS", rtl=True)
    )

    text = extract_document(data).text

    assert "خالد الدوسري" in text
    assert "المهارات: بايثون و Docker" in text


def test_ignores_deleted_tracked_changes():
    deleted = "<w:p><w:del><w:r><w:delText>Old skill: Perl</w:delText></w:r></w:del></w:p>"
    data = build_docx(paragraph(SKILLS) + deleted)

    assert "Perl" not in extract_document(data).text


def test_reads_the_page_count_when_word_saved_it():
    data = build_docx(paragraph(SKILLS), pages=2)

    assert extract_document(data).pages == 2


def code_of(data: bytes) -> str:
    with pytest.raises(PdfExtractionError) as error:
        extract_document(data)
    return error.value.code


def test_rejects_an_almost_empty_document():
    assert code_of(build_docx(paragraph("Sara"))) == "DOCX_NO_TEXT"


def test_rejects_a_broken_zip():
    assert code_of(b"PK\x03\x04 not really a zip") == "DOCX_CORRUPTED"


def test_rejects_a_zip_that_is_not_a_word_document():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.txt", "hello")

    assert code_of(buffer.getvalue()) == "UNSUPPORTED_FILE"


def test_rejects_malformed_xml():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>')

    assert code_of(buffer.getvalue()) == "DOCX_CORRUPTED"


def test_refuses_to_unpack_an_oversized_part():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "<a>" + " " * (25 * 1024 * 1024) + "</a>")

    assert code_of(buffer.getvalue()) == "DOCX_CORRUPTED"


def test_recognises_an_old_word_file():
    old_doc = bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 512

    assert code_of(old_doc) == "WORD_LEGACY_OR_PROTECTED"


def test_rejects_other_files():
    assert code_of(b"just some text, not a CV file at all") == "UNSUPPORTED_FILE"
    assert code_of(b"") == "EMPTY_UPLOAD"
