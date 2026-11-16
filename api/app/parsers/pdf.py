"""PDF text extraction. The only module that knows about PDF libraries."""

import re
import unicodedata
from dataclasses import dataclass

import pymupdf

MAGIC = b"%PDF-"
MAX_PAGES = 10
MIN_CHARACTERS = 40

RTL_BLOCKS = range(0x0590, 0x0900)


@dataclass(frozen=True)
class PdfDocument:
    pages: int
    text: str
    characters: int


class PdfExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _is_rtl(character: str) -> bool:
    return ord(character) in RTL_BLOCKS


def _reorder(line: str) -> str:
    """Reverse each right-to-left run, for PDFs that store a word's letters in visual order."""
    pieces: list[str] = []
    run: list[str] = []
    for character in line:
        if _is_rtl(character):
            run.append(character)
            continue
        pieces.append("".join(reversed(run)))
        run = []
        pieces.append(character)
    pieces.append("".join(reversed(run)))
    return "".join(pieces)


ARABIC_WORD = re.compile(r"[\u0621-\u064a]{3,}")


def _letters_are_reversed(text: str) -> bool:
    """Tell the two ways PDFs store Arabic apart.

    Browsers and Google Docs exports come out in reading order; some generators store each
    word's letters backwards. Arabic words often start with the article "ال" and end with
    "ة", never the reverse, so whichever pattern is more common tells the layout.
    """
    words = ARABIC_WORD.findall(text)
    in_order = sum(word.startswith("ال") + word.endswith("ة") for word in words)
    backwards = sum(word.endswith("لا") + word.startswith("ة") for word in words)
    return backwards > in_order


def _normalise(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw)
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    lines = [line for line in lines if line]
    if _letters_are_reversed(text):
        lines = [_reorder(line) for line in lines]
    return "\n".join(lines)


def _count(text: str) -> int:
    return sum(1 for character in text if not character.isspace())


def extract(data: bytes) -> PdfDocument:
    if not data:
        raise PdfExtractionError("EMPTY_UPLOAD", "The uploaded file is empty.")

    if not data.startswith(MAGIC):
        raise PdfExtractionError("NOT_A_PDF_MAGIC", "The file is not a PDF.")

    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as error:
        raise PdfExtractionError("PDF_CORRUPTED", "The PDF could not be read.") from error

    if document.needs_pass:
        raise PdfExtractionError("PDF_ENCRYPTED", "The PDF is password protected.")

    pages = document.page_count

    if pages > MAX_PAGES:
        raise PdfExtractionError(
            "PDF_TOO_MANY_PAGES",
            f"The PDF has {pages} pages; the limit is {MAX_PAGES}.",
        )

    try:
        raw_text = "\n".join(page.get_text() for page in document)
    except Exception as error:
        raise PdfExtractionError("PDF_CORRUPTED", "The PDF could not be read.") from error

    text = _normalise(raw_text)
    characters = _count(text)

    if characters < MIN_CHARACTERS:
        raise PdfExtractionError(
            "PDF_NO_TEXT_LAYER",
            "No text layer found. Scanned PDFs are not supported yet.",
        )

    return PdfDocument(pages=pages, text=text, characters=characters)
