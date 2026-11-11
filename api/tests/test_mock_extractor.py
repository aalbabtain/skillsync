from app.agents import cv_skills, mock_extractor

CV_TEXT = """Ahmed Ababtain
Skills: Python, React, Docker
Built a FastAPI service with PostgreSQL
"""


def test_finds_skills_and_quotes_the_matching_line():
    skills = mock_extractor.extract(CV_TEXT)
    by_name = {skill["name"]: skill for skill in skills}

    assert by_name["Python"]["evidence"] == "Skills: Python, React, Docker"
    assert by_name["Python"]["category"] == "Programming languages"
    assert by_name["React"]["category"] == "Frameworks"
    assert by_name["Docker"]["category"] == "Cloud & DevOps"
    assert by_name["PostgreSQL"]["evidence"] == "Built a FastAPI service with PostgreSQL"


def test_ignores_words_outside_the_dictionary():
    assert mock_extractor.extract("Worked on a campus project last summer") == []


def test_returns_one_entry_per_skill():
    skills = mock_extractor.extract("Python here.\nPython again.")

    assert [skill["name"] for skill in skills] == ["Python"]


def test_matches_arabic_aliases():
    skills = mock_extractor.extract("المهارات: بايثون، ريأكت، فاست API")

    assert [skill["name"] for skill in skills] == ["Python", "React", "FastAPI"]


def test_every_dictionary_category_is_an_agent_category():
    for _, category, _ in mock_extractor.SKILLS:
        assert category in cv_skills.CATEGORIES
