"""Regenerates the committed PDF fixtures. Dev-only; needs `pip install fpdf2 pypdf`.

The CVs printed by Chrome come from make_chrome_fixtures.mjs instead.

The generated PDFs are committed, so the test suite never runs this script.
The Arabic fixture embeds Noto Naskh Arabic (OFL), downloaded on demand.
"""

from pathlib import Path
from urllib.request import urlretrieve

from fpdf import FPDF

HERE = Path(__file__).resolve().parent
CASES = HERE / "cases"
ARABIC_FONT = HERE / "NotoNaskhArabic.ttf"
ARABIC_FONT_URL = (
    "https://github.com/google/fonts/raw/main/ofl/notonaskharabic/"
    "NotoNaskhArabic%5Bwght%5D.ttf"
)

ENGLISH = [
    "Ahmed Ababtain",
    "Computer Science, King Saud University",
    "MARKER-7731",
    "Skills: Python, FastAPI, React, TypeScript, SQL",
    "Projects: SkillSync pipeline, campus course planner",
]

ARABIC = [
    "أحمد أبا بطين",
    "علوم الحاسب - جامعة الملك سعود",
    "المهارات: بايثون، فاست API، ريأكت، تايب سكربت",
    "المشاريع: منصة سكيل سينك، مخطط المقررات",
]

BACKEND = [
    "Sara Alharbi",
    "Backend Engineer, Riyadh",
    "Skills: Python, Django, PostgreSQL, Docker, AWS",
    "Experience: REST APIs in Django with Redis caching",
    "Tools: Git, GitHub Actions, Linux",
]

GRADUATE = [
    "Omar Alqahtani",
    "Fresh graduate, Information Systems",
    "Coursework: Java, SQL, HTML, CSS",
    "Project: library system in Java with MySQL",
    "Soft skills: teamwork, communication, presentation",
]


def write_lines(path: Path, lines: list[str], font: str | None = None) -> None:
    pdf = FPDF()
    pdf.add_page()
    if font is None:
        pdf.set_font("helvetica", size=12)
    else:
        pdf.add_font("body", "", font)
        pdf.set_font("body", size=12)

    for line in lines:
        pdf.cell(0, 10, line, new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(path))


def write_scanned(path: Path) -> None:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_fill_color(230, 230, 230)
    pdf.rect(20, 20, 160, 80, style="F")
    pdf.output(str(path))


def write_encrypted(source: Path, path: Path) -> None:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(clone_from=PdfReader(source))
    writer.encrypt("fixture-only")
    writer.write(path)

if __name__ == "__main__":
    CASES.mkdir(exist_ok=True)
    write_lines(CASES / "english_cv.pdf", ENGLISH)
    if not ARABIC_FONT.exists():
        urlretrieve(ARABIC_FONT_URL, ARABIC_FONT)
    write_lines(CASES / "arabic_cv.pdf", ARABIC, font=str(ARABIC_FONT))
    write_lines(CASES / "backend_cv.pdf", BACKEND)
    write_lines(CASES / "graduate_cv.pdf", GRADUATE)
    write_scanned(CASES / "scanned.pdf")
    write_encrypted(CASES / "english_cv.pdf", CASES / "encrypted.pdf")
    print("fixtures written to", CASES)
