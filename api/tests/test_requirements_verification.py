from app.verification import VerifiedRequirement, aggregate, verify_requirements

POSTING = """Backend Developer
Requirements: strong JS and Python
Nice to have: Docker
"""


def candidate(name, evidence, level="required", category="Programming languages"):
    return {"name": name, "category": category, "level": level, "evidence": evidence}


def req(name, level="required", evidence="quote", category="Programming languages"):
    return VerifiedRequirement(name=name, category=category, level=level, evidence=evidence)


def test_drops_a_requirement_without_a_quote():
    kept, dropped = verify_requirements(
        [
            candidate("Python", "strong JS and Python"),
            candidate("Kubernetes", "Kubernetes in production", category="Cloud & DevOps"),
        ],
        POSTING,
    )

    assert [item.name for item in kept] == ["Python"]
    assert dropped == 1


def test_merges_aliases_within_one_posting_and_keeps_the_strongest_level():
    kept, dropped = verify_requirements(
        [
            candidate("JS", "Nice to have: Docker", level="preferred"),
            candidate("JavaScript", "strong JS and Python", level="required"),
        ],
        POSTING,
    )

    assert dropped == 0
    assert kept == [
        VerifiedRequirement(
            name="JavaScript",
            category="Programming languages",
            level="required",
            evidence="Nice to have: Docker",
        )
    ]


def test_matches_an_arabic_quote_with_tatweel():
    kept, _ = verify_requirements(
        [candidate("Python", "خبرة في Python")],
        "المتطلبات: خبـــرة في Python",
    )

    assert [item.name for item in kept] == ["Python"]


def test_aggregate_counts_a_posting_once():
    [result] = aggregate([[req("JavaScript"), req("JS")]])

    assert result.name == "JavaScript"
    assert result.frequency == 1
    assert len(result.sources) == 1


def test_aggregate_counts_frequency_across_postings():
    results = aggregate(
        [
            [req("Python", evidence="a")],
            [req("Python", evidence="b")],
            [req("Python", evidence="c")],
        ]
    )

    assert results[0].frequency == 3
    assert [(s.posting, s.evidence) for s in results[0].sources] == [
        (0, "a"),
        (1, "b"),
        (2, "c"),
    ]


def test_aggregate_merges_preferred_and_required_as_required():
    [result] = aggregate([[req("Docker", level="preferred")], [req("Docker")]])

    assert result.level == "required"
    assert [s.level for s in result.sources] == ["preferred", "required"]


def test_aggregate_orders_by_frequency_then_level_then_name():
    results = aggregate(
        [
            [req("Go", level="preferred"), req("Python"), req("Docker", level="preferred")],
            [req("Python"), req("Ansible", level="preferred"), req("Rust")],
        ]
    )

    assert [r.name for r in results] == ["Python", "Rust", "Ansible", "Docker", "Go"]
