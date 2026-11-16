"""Word (.docx) text extraction with the standard library: a .docx is a zip of XML files.

Word stores Arabic in reading order, so no reordering is needed, unlike some PDFs.
"""

import io
import re
import unicodedata
import zipfile
from xml.etree import ElementTree

from app.parsers.pdf import MIN_CHARACTERS, PdfDocument, PdfExtractionError

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PARAGRAPH = f"{W}p"
TEXT = f"{W}t"
TAB = f"{W}tab"
BREAKS = {f"{W}br", f"{W}cr"}

DOCUMENT = "word/document.xml"
HEADER = re.compile(r"word/header\d*\.xml")
APP_PROPERTIES = "docProps/app.xml"
PAGES = re.compile(r"<(?:\w+:)?Pages>(\d+)</(?:\w+:)?Pages>")

# A real CV's XML is well under a megabyte; anything this large is a zip bomb or not a CV.
MAX_PART_BYTES = 20 * 1024 * 1024


def _corrupted() -> PdfExtractionError:
    return PdfExtractionError("DOCX_CORRUPTED", "The Word document could not be read.")


def _read_part(archive: zipfile.ZipFile, name: str) -> bytes:
    if archive.getinfo(name).file_size > MAX_PART_BYTES:
        raise _corrupted()
    return archive.read(name)


def _paragraphs(element: ElementTree.Element, out: list[str]) -> None:
    for child in element:
        if child.tag == PARAGRAPH:
            _paragraph(child, out)
        else:
            _paragraphs(child, out)


def _paragraph(element: ElementTree.Element, out: list[str]) -> None:
    parts: list[str] = []
    _collect(element, parts, out)
    text = "".join(parts)
    out.extend(line for line in text.split("\n"))


def _collect(element: ElementTree.Element, parts: list[str], out: list[str]) -> None:
    for child in element:
        if child.tag == TEXT:
            parts.append(child.text or "")
        elif child.tag == TAB:
            parts.append(" ")
        elif child.tag in BREAKS:
            parts.append("\n")
        elif child.tag == PARAGRAPH:
            # A paragraph inside a text box: its own line, read once.
            _paragraph(child, out)
        else:
            _collect(child, parts, out)


def _lines_of(xml: bytes) -> list[str]:
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise _corrupted() from error
    lines: list[str] = []
    _paragraphs(root, lines)
    return lines


def _page_count(archive: zipfile.ZipFile) -> int:
    if APP_PROPERTIES not in archive.namelist():
        return 1
    match = PAGES.search(_read_part(archive, APP_PROPERTIES).decode("utf-8", "replace"))
    return max(1, int(match.group(1))) if match else 1


def extract(data: bytes) -> PdfDocument:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise _corrupted() from error

    with archive:
        names = archive.namelist()
        if DOCUMENT not in names:
            raise PdfExtractionError(
                "UNSUPPORTED_FILE", "Only PDF and Word (.docx) files are accepted."
            )

        try:
            lines: list[str] = []
            for name in sorted(n for n in names if HEADER.fullmatch(n)):
                lines += _lines_of(_read_part(archive, name))
            lines += _lines_of(_read_part(archive, DOCUMENT))
            pages = _page_count(archive)
        except (zipfile.BadZipFile, KeyError, OSError, RuntimeError) as error:
            raise _corrupted() from error

    cleaned = [unicodedata.normalize("NFKC", line).strip() for line in lines]
    text = "\n".join(line for line in cleaned if line)
    characters = sum(1 for character in text if not character.isspace())

    if characters < MIN_CHARACTERS:
        raise PdfExtractionError("DOCX_NO_TEXT", "The Word document has almost no text.")

    return PdfDocument(pages=pages, text=text, characters=characters)
