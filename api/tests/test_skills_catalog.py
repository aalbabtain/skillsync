from fastapi.testclient import TestClient

from app.agents.cv_skills import CATEGORIES
from app.main import app
from app.skills_catalog import CATALOG, RELATED
from app.verification import normalize

client = TestClient(app)
NAMES = [name for name, _, _ in CATALOG]


def test_names_are_unique():
    assert len(NAMES) == len({normalize(name) for name in NAMES})


def test_every_category_is_a_known_one():
    assert {category for _, category, _ in CATALOG} <= set(CATEGORIES)


def test_no_alias_points_to_two_skills():
    owner = {}
    for name, _, aliases in CATALOG:
        for alias in aliases:
            key = normalize(alias)
            assert owner.setdefault(key, name) == name, f"{alias!r} belongs to {owner[key]} and {name}"


def test_aliases_are_written_normalized():
    for _, _, aliases in CATALOG:
        for alias in aliases:
            assert alias == alias.lower()


def test_related_skills_all_exist():
    known = set(NAMES)
    for skill, related in RELATED.items():
        assert skill in known
        assert set(related) <= known, f"{skill}: {set(related) - known}"
        assert skill not in related


def test_catalog_route_serves_names_categories_and_english_aliases():
    response = client.get("/api/skills/catalog")

    assert response.status_code == 200
    body = response.json()
    by_name = {item["name"]: item for item in body["skills"]}
    assert len(by_name) == len(CATALOG)
    assert by_name["CAPM"]["category"] == "Other"
    assert by_name["Python"]["aliases"] == ["python"]
    assert body["related"]["React"][0] == "TypeScript"
    assert "max-age" in response.headers["cache-control"]
