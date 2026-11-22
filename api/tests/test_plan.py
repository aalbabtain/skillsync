import json
from pathlib import Path

import pytest

from app import plan

FIXTURES = sorted((Path(__file__).parent / "fixtures" / "plan").glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_order_and_phases_match_the_golden_files(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    given = case["input"]

    items, later = plan.order_plan(given["gap"], given["skills"], given["postings_count"])

    assert [{"name": i["name"], "phase": i["phase"], "builds_on": i["builds_on"]} for i in items] == case["expected"]
    assert later == []


def test_kubernetes_comes_first_because_more_postings_ask():
    case = json.loads((Path(__file__).parent / "fixtures" / "plan" / "basic.json").read_text(encoding="utf-8"))["input"]
    items, _ = plan.order_plan(case["gap"], case["skills"], case["postings_count"])

    assert [item["id"] for item in items] == ["s1", "s2", "s3", "s4", "s5"]
    assert items[1]["evidence_lines"] == ["containerized deployment with Docker"]


def test_a_long_gap_keeps_twelve_and_names_the_rest():
    missing = [{"name": f"Skill {n}", "category": "Other", "level": "required", "frequency": 1, "sources": []} for n in range(15)]

    items, later = plan.order_plan({"missing": missing, "needs_proof": []}, [], 1)

    assert len(items) == plan.MAX_PLAN_SKILLS
    assert len(later) == 3


NOTES = [
    {"id": "docker-01", "skill": "Docker", "title": "Docker overview", "publisher": "Docker Docs", "url": "https://docs.docker.com/a"},
    {"id": "docker-02", "skill": "Docker", "title": "Writing a Dockerfile", "publisher": "Docker Docs", "url": "https://docs.docker.com/b"},
    {"id": "docker-03", "skill": "Docker", "title": "Docker Compose", "publisher": "Docker Docs", "url": "https://docs.docker.com/c"},
]
ITEM = {"id": "s1", "name": "Docker", "kind": "learn", "phase": "quick", "level": "required",
        "frequency": 2, "postings_count": 3, "builds_on": "FastAPI", "evidence_lines": []}


def test_a_topic_is_kept_only_with_a_retrieved_source():
    raw = {
        "topics": [
            {"source_id": "docker-02", "text": "Writing a Dockerfile for a Python app"},
            {"source_id": "k8s-01", "text": "Pods and Services"},
            {"source_id": "docker-03", "text": "Compose with a database https://example.com/x"},
            {"source_id": "docker-02", "text": "The same source again"},
            {"text": "No source at all"},
        ],
        "project_title": "Containerize your FastAPI project",
        "project_summary": "Run the API and PostgreSQL together.",
        "weeks": 2,
    }

    card = plan.verify_card(raw, ITEM, NOTES, "en")

    assert [t["text"] for t in card["topics"]] == ["Writing a Dockerfile for a Python app", "Compose with a database"]
    assert card["topics"][0]["source"]["url"] == "https://docs.docker.com/b"
    assert card["docs_url"] == "https://docs.docker.com/a"


def test_too_few_sourced_topics_fall_back_to_the_notes():
    card = plan.verify_card({"topics": [{"source_id": "nope", "text": "x"}], "weeks": 3}, ITEM, NOTES, "en")

    assert [t["text"] for t in card["topics"]] == ["Docker overview", "Writing a Dockerfile", "Docker Compose"]


def test_weeks_are_clamped_and_a_missing_project_gets_a_template():
    learn = plan.verify_card({"weeks": 40}, ITEM, NOTES, "ar")
    prove = plan.verify_card({"weeks": 9}, {**ITEM, "kind": "prove", "phase": "prove"}, NOTES, "en")

    assert learn["weeks"] == 8 and prove["weeks"] == 2
    assert "Docker" in learn["project"]["title"] and learn["project"]["summary"]
    assert prove["topics"] == []
