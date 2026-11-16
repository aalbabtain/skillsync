"""Reads a CV upload as text. The file type comes from its first bytes, not its name."""

from app.parsers import docx, pdf
from app.parsers.pdf import PdfDocument, PdfExtractionError

ZIP_MAGIC = b"PK\x03\x04"
# Old binary Word files (.doc) and password-protected Office files share this signature.
OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


def extract_document(data: bytes) -> PdfDocument:
    if not data:
        raise PdfExtractionError("EMPTY_UPLOAD", "The uploaded file is empty.")

    if data.startswith(pdf.MAGIC):
        return pdf.extract(data)

    if data.startswith(ZIP_MAGIC):
        return docx.extract(data)

    if data.startswith(OLE_MAGIC):
        raise PdfExtractionError(
            "WORD_LEGACY_OR_PROTECTED",
            "Old Word files (.doc) and password-protected documents cannot be read. "
            "Save the CV as .docx without a password, or as PDF.",
        )

    raise PdfExtractionError("UNSUPPORTED_FILE", "Only PDF and Word (.docx) files are accepted.")
