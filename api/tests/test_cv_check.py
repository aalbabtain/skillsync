from app.cv_check import check_line, facts, unsupported

SOURCE = "بنيت لوحة بـ React و FastAPI، استخدمها ٣٠٠ طالب في King Saud University عام 2025"


def test_tools_numbers_names_found():
    assert check_line(
        "Built a dashboard with React and FastAPI used by 300 students at King Saud University in 2025",
        SOURCE,
    )


def test_arabic_digits_match_western():
    assert unsupported("Served 300 students", SOURCE) == []


def test_western_digits_in_source_match_arabic_in_line():
    assert unsupported("خدم ٢٠٢٥ طالبًا", "served 2025 students") == []


def test_invented_tool_rejected():
    assert unsupported("Built a dashboard with React and Docker", SOURCE) == ["Docker"]


def test_tool_alias_supports_canonical_name():
    assert unsupported("Built an API with PostgreSQL", "stored data in postgres") == []


def test_invented_number_rejected():
    assert unsupported("Improved load time by 40%", SOURCE) == ["40%"]


def test_invented_organisation_rejected():
    assert unsupported("Interned at Aramco", SOURCE) == ["Aramco"]


def test_short_name_for_a_long_one_rejected():
    assert unsupported("Interned at STC", "trained at Saudi Telecom Company") == ["STC"]


def test_sentence_start_and_common_words_are_not_facts():
    assert facts("Developed the API") == []
    assert facts("Final-year student. Seeking a role in June.") == []


def test_link_must_appear():
    assert unsupported("Code at https://github.com/x/y", SOURCE) == ["https://github.com/x/y"]


def test_link_given_is_supported():
    assert unsupported("Code at https://github.com/x/y.", "my repo https://github.com/x/y") == []


def test_each_fact_reported_once():
    assert unsupported("Used Docker, then Docker again", SOURCE) == ["Docker"]
