import json

import pytest
from fastapi.testclient import TestClient

from app.agents import cv_skills, cv_writer
from app.cv_check import mentions
from app.main import app, rate_limiter
from app.parsers import extract_document

client = TestClient(app)

CV = """Sara Alharbi
sara@example.com | +966 50 000 0000 | linkedin.com/in/sara-a | github.com/sara-a
King Saud University, B.Sc. in Software Engineering, Jun 2027
Skills: Python, FastAPI, Docker
SkillSync: built the API with FastAPI and tested it with pytest"""


@pytest.fixture(autouse=True)
def fresh_limits():
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def test_contact_found_by_code():
    assert cv_writer.contact_from(CV) == {
        "email": "sara@example.com",
        "phone": "+966 50 000 0000",
        "linkedin": "https://linkedin.com/in/sara-a",
        "github": "https://github.com/sara-a",
    }


def test_mentions_reads_catalog_spellings():
    assert mentions("PostgreSQL", "we used postgres")
    assert mentions("King Saud University", CV)
    assert not mentions("MIT", CV)


def fake_import(monkeypatch, answer, seen):
    def ask(prompt, schema, contents):
        seen.append(contents)
        return schema.model_validate(answer)

    monkeypatch.setattr(cv_writer, "_ask", ask)
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: "gemini")


def test_model_never_sees_contact(monkeypatch):
    seen = []
    fake_import(monkeypatch, {"name": "Sara Alharbi"}, seen)
    cv_writer.import_resume(CV)
    for gone in ("sara@example.com", "000 0000", "linkedin.com", "github.com"):
        assert gone not in seen[0]


def test_invented_value_dropped(monkeypatch):
    answer = {
        "name": "Sara Alharbi", "school": "MIT", "degree": "B.Sc. in Software Engineering",
        "skills": ["Python", "Kubernetes"],
        "projects": [{"name": "SkillSync", "lines": ["Built the API with FastAPI", "Deployed it on AWS"]}],
    }
    fake_import(monkeypatch, answer, [])
    resume = cv_writer.import_resume(CV)
    assert resume["school"] == "" and resume["degree"] == "B.Sc. in Software Engineering"
    assert resume["skills"] == ["Python"]
    assert [(project["name"], project["lines"]) for project in resume["projects"]] == [("SkillSync", ["Built the API with FastAPI"])]


def test_demo_import_backend_cv():
    text = extract_document(open("tests/fixtures/cases/backend_cv.pdf", "rb").read()).text
    resume = cv_writer.import_resume(text, extractor=cv_skills.MOCK)
    assert resume["name"] == "Sara Alharbi"
    assert len(resume["skills"]) >= 3


def test_import_route(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    body = client.post("/api/cv/import", json={"text": CV}).json()
    assert body["resume"]["name"] == "Sara Alharbi"
    assert body["contact"]["email"] == "sara@example.com"


def test_import_route_refuses_short_text():
    assert client.post("/api/cv/import", json={"text": "hi"}).status_code == 422


FULL_CV = """Example Candidate
Software Engineer
Riyadh, Saudi Arabia | candidate@example.com
PROFESSIONAL SUMMARY
Software Engineering student at King Saud University who builds web and mobile apps.
EDUCATION
King Saud University (KSU), Riyadh Expected June 2027
B.Sc. in Software Engineering | GPA: 4.67/5
PROJECTS
Nakhlah – AI-Powered Date Fruit Platform (Team Project) | nakhlahsa.com Jan 2025 – May 2025
UI/UX & Full-Stack Developer | Flutter, React, Firebase
• Wrote the dashboard's authentication and data layer with Firebase Auth
• Built the admin dashboard in React
SkillSync – Skill Gap Analyzer (Course Project) | skillsync.example.com Oct 2025 – Present
Full-Stack & AI Developer | Python, FastAPI, React
• Built a bilingual web app with five agents
ACTIVITIES & MEMBERSHIPS
Member, Artificial Intelligence Club – King Saud University Mar 2026 – Present
Student Member, Saudi Council of Engineers (SCE) Jun 2025 – Jun 2026"""


def test_import_reads_every_section_and_cleans_what_the_model_copied(monkeypatch):
    answer = {
        "name": "Example Candidate", "title": "Software Engineer", "location": "Riyadh, Saudi Arabia",
        "summary": "Software Engineering student at King Saud University who builds web and mobile apps.",
        "school": "King Saud University (KSU)", "degree": "B.Sc. in Software Engineering", "grad": "Expected June 2027", "gpa": "4.67/5",
        "projects": [
            {"name": "Nakhlah – AI-Powered Date Fruit Platform (Team Project)", "url": "nakhlahsa.com", "start": "Jan 2025", "end": "May 2025",
             "role": "UI/UX & Full-Stack Developer", "tools": "Flutter, React, Firebase",
             "lines": ["• Wrote the dashboard's authentication and data layer with Firebase Auth", "- Built the admin dashboard in React"]},
            {"name": "SkillSync – Skill Gap Analyzer (Course Project)", "url": "skillsync.example.com", "start": "Oct 2025", "end": "Present",
             "role": "Full-Stack & AI Developer", "tools": "Python, FastAPI, React", "lines": ["Built a bilingual web app with five agents"]},
            {"name": "Invented Project", "lines": ["Built a rocket"]},
        ],
        "activities": ["Member, Artificial Intelligence Club – King Saud University, Mar 2026 – Present", "Founder, Robotics Society"],
    }
    fake_import(monkeypatch, answer, [])
    resume = cv_writer.import_resume(FULL_CV)
    assert resume["title"] == "Software Engineer" and resume["location"] == "Riyadh, Saudi Arabia"
    assert resume["summary"].startswith("Software Engineering student")
    assert [project["name"] for project in resume["projects"]] == [
        "Nakhlah – AI-Powered Date Fruit Platform (Team Project)", "SkillSync – Skill Gap Analyzer (Course Project)"]
    nakhlah = resume["projects"][0]
    assert nakhlah["url"] == "https://nakhlahsa.com" and nakhlah["start"] == "Jan 2025" and nakhlah["end"] == "May 2025"
    assert nakhlah["role"] == "UI/UX & Full-Stack Developer" and nakhlah["tools"] == "Flutter, React, Firebase"
    assert nakhlah["lines"] == ["Wrote the dashboard's authentication and data layer with Firebase Auth", "Built the admin dashboard in React"]
    assert resume["activities"] == ["Member, Artificial Intelligence Club – King Saud University, Mar 2026 – Present"]


SKILLS_CV = FULL_CV + """
SKILLS
Programming Languages: Java, Python, Dart, TypeScript/JavaScript, PHP, SQL
Backend & Databases: Firebase (Auth, Firestore, Storage), MySQL/MariaDB, REST APIs
AI & Agents: Multi-agent design, Prompt engineering"""


def test_import_keeps_the_cvs_own_skill_headings(monkeypatch):
    answer = {"skill_groups": [
        {"name": "Programming Languages", "items": ["Java", "Python", "TypeScript/JavaScript"]},
        {"name": "Backend & Databases", "items": ["Firebase (Auth, Firestore, Storage)", "MySQL/MariaDB", "Kubernetes"]},
        {"name": "Invented Heading", "items": ["Python"]},
    ]}
    fake_import(monkeypatch, answer, [])
    resume = cv_writer.import_resume(SKILLS_CV)
    assert resume["skill_groups"] == [
        {"name": "Programming Languages", "items": ["Java", "Python", "TypeScript/JavaScript"]},
        {"name": "Backend & Databases", "items": ["Firebase (Auth, Firestore, Storage)", "MySQL/MariaDB"]},
    ]
    assert "Firebase (Auth, Firestore, Storage)" in resume["skills"]
