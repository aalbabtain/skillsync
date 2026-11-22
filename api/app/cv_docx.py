"""The CV as a Word document, built with the standard library (a .docx is a zip of XML).

Layout, from the owner's reference CV: name centred and large, the target title under it, one
contact line joined by " | ", section headings in bold capitals with a rule under them, each
job or project title in bold with its link after " | " and its dates at the line's end (a
right tab stop), an italic role and tools line, then bullets. Single column, Calibri 11 pt.
"""

import io
import re
import zipfile
from xml.sax.saxutils import escape

from pydantic import BaseModel, Field

# A4 with 0.7 inch margins, in twentieths of a point.
PAGE_WIDTH = 11906
PAGE_HEIGHT = 16838
MARGIN = 1008
TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN

Short = Field(default="", max_length=300)


class Personal(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    field: str = Short
    target_title: str = Short


class Contact(BaseModel):
    email: str = Short
    phone: str = Short
    location: str = Short
    linkedin: str = Short
    github: str = Short


class Job(BaseModel):
    company: str = Short
    title: str = Short
    start: str = Short
    end: str = Short
    role_line: str = Short
    bullets: list[str] = Field(default=[], max_length=8)


class Education(BaseModel):
    institution: str = Short
    degree: str = Short
    major: str = Short
    end: str = Short
    gpa: str = Short
    achievements: list[str] = Field(default=[], max_length=8)


class Project(BaseModel):
    name: str = Short
    url: str = Short
    start: str = Short
    end: str = Short
    role_line: str = Short
    bullets: list[str] = Field(default=[], max_length=8)


class Certification(BaseModel):
    name: str = Short
    issuer: str = Short
    date: str = Short
    url: str = Short


class Resume(BaseModel):
    personal: Personal
    contact: Contact = Contact()
    summary: str = Field(default="", max_length=1200)
    experience: list[Job] = Field(default=[], max_length=15)
    education: list[Education] = Field(default=[], max_length=8)
    skills: dict[str, list[str]] = Field(default={}, max_length=12)
    projects: list[Project] = Field(default=[], max_length=15)
    certifications: list[Certification] = Field(default=[], max_length=20)
    languages: list[str] = Field(default=[], max_length=10)
    volunteering: list[str] = Field(default=[], max_length=10)
    awards: list[str] = Field(default=[], max_length=10)


def _run(text: str, *, bold: bool = False, italic: bool = False, size: int | None = None) -> str:
    props = ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") + (f'<w:sz w:val="{size}"/>' if size else "")
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _tab() -> str:
    return "<w:r><w:tab/></w:r>"


def _para(runs: str, *, center: bool = False, tab: bool = False, bullet: bool = False,
          border: bool = False, before: int = 0, after: int = 40) -> str:
    props = [f'<w:spacing w:before="{before}" w:after="{after}"/>']
    if bullet:
        props.insert(0, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    if border:
        props.insert(0, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>')
    if tab:
        props.insert(0, f'<w:tabs><w:tab w:val="right" w:pos="{TEXT_WIDTH}"/></w:tabs>')
    if center:
        props.append('<w:jc w:val="center"/>')
    return f"<w:p><w:pPr>{''.join(props)}</w:pPr>{runs}</w:p>"


def _heading(text: str) -> str:
    return _para(_run(text.upper(), bold=True), border=True, before=160, after=80)


def _dates(start: str, end: str) -> str:
    return " – ".join(part for part in (start.strip(), end.strip()) if part)


def _title_row(title: str, link: str, dates: str) -> str:
    runs = _run(title, bold=True)
    if link:
        runs += _run(f" | {_bare(link)}")
    if dates:
        runs += _tab() + _run(dates)
    return _para(runs, tab=True, before=60, after=0)


def _bare(link: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", link.strip()).rstrip("/")


def _bullets(lines: list[str]) -> str:
    return "".join(_para(_run(line), bullet=True, after=0) for line in lines if line.strip())


def _body(resume: Resume) -> str:
    p, c = resume.personal, resume.contact
    out = [_para(_run(p.name, bold=True, size=36), center=True, after=0)]
    if title := (p.target_title or p.field).strip():
        out.append(_para(_run(title, bold=True), center=True, after=0))
    contact = [c.location, c.phone, c.email, _bare(c.linkedin), _bare(c.github)]
    if line := " | ".join(part.strip() for part in contact if part.strip()):
        out.append(_para(_run(line), center=True, after=80))

    if resume.summary.strip():
        out += [_heading("Professional Summary"), _para(_run(resume.summary.strip()))]

    if jobs := [job for job in resume.experience if job.company or job.title]:
        out.append(_heading("Experience"))
        for job in jobs:
            title = ", ".join(part for part in (job.title, job.company) if part)
            out.append(_title_row(title, "", _dates(job.start, job.end)))
            if job.role_line:
                out.append(_para(_run(job.role_line, italic=True), after=0))
            out.append(_bullets(job.bullets))

    if schools := [school for school in resume.education if school.institution]:
        out.append(_heading("Education"))
        for school in schools:
            out.append(_title_row(school.institution, "", school.end))
            degree = " in ".join(part for part in (school.degree, school.major) if part)
            if school.gpa:
                degree = f"{degree} | GPA: {school.gpa}" if degree else f"GPA: {school.gpa}"
            if degree:
                out.append(_para(_run(degree), after=0))
            out.append(_bullets(school.achievements))

    if projects := [project for project in resume.projects if project.name]:
        out.append(_heading("Projects"))
        for project in projects:
            out.append(_title_row(project.name, project.url, _dates(project.start, project.end)))
            if project.role_line:
                out.append(_para(_run(project.role_line, italic=True), after=0))
            out.append(_bullets(project.bullets))

    if skills := {category: items for category, items in resume.skills.items() if items}:
        out.append(_heading("Technical Skills"))
        for category, items in skills.items():
            out.append(_para(_run(f"{category}: ", bold=True) + _run(", ".join(items)), after=0))

    if certs := [cert for cert in resume.certifications if cert.name]:
        out.append(_heading("Certifications"))
        for cert in certs:
            title = " | ".join(part for part in (cert.name, cert.issuer) if part)
            out.append(_title_row(title, cert.url, cert.date))

    for title, items in (("Languages", resume.languages), ("Volunteering", resume.volunteering), ("Awards", resume.awards)):
        if items := [item for item in items if item.strip()]:
            out.append(_heading(title))
            out.append(_para(_run(", ".join(items))) if title == "Languages" else _bullets(items))

    return "".join(out)


NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>"""

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {NS}>
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>"""

NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering {NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"""


def build_docx(resume: Resume) -> bytes:
    document = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {NS}><w:body>{_body(resume)}'
        f'<w:sectPr><w:pgSz w:w="{PAGE_WIDTH}" w:h="{PAGE_HEIGHT}"/>'
        f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" w:left="{MARGIN}" w:header="0" w:footer="0" w:gutter="0"/>'
        "</w:sectPr></w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", ROOT_RELS)
        archive.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", STYLES)
        archive.writestr("word/numbering.xml", NUMBERING)
    return buffer.getvalue()


def file_name(resume: Resume) -> str:
    """An ASCII file name from the person's name, for the download header."""
    name = re.sub(r"[^A-Za-z0-9]+", "-", resume.personal.name).strip("-")
    return f"{name or 'CV'}-CV.docx"
