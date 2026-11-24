from app.verification import normalize, verify_skills

CV = """Example Candidate
Skills: Python, ReactJS, TypeScript, PostgreSQL
Project: SkillSync pipeline built with FastAPI and ReactJS
"""


def skill(name: str, evidence: str, category: str = "Other") -> dict[str, str]:
    return {"name": name, "category": category, "evidence": evidence}


def test_keeps_a_skill_whose_evidence_is_in_the_cv():
    result = verify_skills([skill("Python", "Skills: Python, ReactJS")], CV)

    assert [item.name for item in result.skills] == ["Python"]
    assert result.skills[0].evidence == "Skills: Python, ReactJS"
    assert result.dropped_count == 0


def test_drops_a_skill_whose_evidence_is_missing():
    result = verify_skills([skill("Kubernetes", "Deployed Kubernetes clusters")], CV)

    assert result.skills == []
    assert result.dropped_count == 1


def test_drops_paraphrased_evidence():
    result = verify_skills([skill("React", "Used React for dashboards")], CV)

    assert result.skills == []
    assert result.dropped_count == 1


def test_does_not_match_a_word_inside_a_longer_word():
    result = verify_skills([skill("React", "React")], "Skills: ReactJS")

    assert result.skills == []
    assert result.dropped_count == 1


def test_merges_aliases_case_insensitively():
    result = verify_skills(
        [
            skill("ReactJS", "Project: SkillSync pipeline built with FastAPI and ReactJS"),
            skill("react", "Project: SkillSync pipeline built with FastAPI and ReactJS"),
        ],
        CV,
    )

    assert [item.name for item in result.skills] == ["React"]
    assert result.dropped_count == 0


def test_matches_arabic_text_with_diacritics():
    cv = "المهارات: بَايثُون، ريأكت\nالمشاريع: منصة سكيل سينك"

    result = verify_skills([skill("بايثون", "المهارات: بَايثُون")], cv)

    assert [item.name for item in result.skills] == ["بايثون"]
    assert result.dropped_count == 0


def test_drops_an_empty_evidence_quote():
    result = verify_skills([skill("Go", "   ")], CV)

    assert result.skills == []
    assert result.dropped_count == 1


def test_normalize_removes_diacritics_and_punctuation():
    assert normalize("  المهارات: بَايثُون، ريأكت  ") == "المهارات بايثون ريأكت"
    assert normalize("Node.js / React.JS") == "node js react js"


def test_normalize_separates_arabic_glued_to_latin():
    # PDF extraction can drop the space between an Arabic word and an English one.
    assert normalize("علىKubernetes") == "على kubernetes"
    assert normalize("وDocker") == "و docker"
    assert normalize("بنيتReact") == "بنيت react"
