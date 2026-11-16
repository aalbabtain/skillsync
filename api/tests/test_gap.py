import json
from pathlib import Path

import pytest

from app.gap import evaluate_gap

CASES = sorted((Path(__file__).parent / "fixtures" / "gap").glob("*.json"))


@pytest.mark.parametrize("path", CASES, ids=[path.stem for path in CASES])
def test_golden_case(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    given = case["input"]

    result = evaluate_gap(given["skills"], given["requirements"], given["postings_count"])

    assert result == case["expected"]


def test_same_input_gives_the_same_gap():
    case = json.loads(CASES[0].read_text(encoding="utf-8"))["input"]
    runs = [evaluate_gap(case["skills"], case["requirements"], case["postings_count"]) for _ in range(3)]

    assert runs[0] == runs[1] == runs[2]


def test_does_not_mutate_its_input():
    case = json.loads(CASES[0].read_text(encoding="utf-8"))["input"]
    before = json.dumps(case, sort_keys=True)

    evaluate_gap(case["skills"], case["requirements"], case["postings_count"])

    assert json.dumps(case, sort_keys=True) == before
