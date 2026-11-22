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


from app.cv_check import polished_ok  # noqa: E402


def test_spelling_and_capital_letters_may_be_fixed():
    assert polished_ok("text", "spinsh", "Spanish")
    assert polished_ok("text", "King saud university", "King Saud University")
    assert polished_ok("text", "software enginner", "Software Engineering")
    assert polished_ok("text", "team work good speaker", "Teamwork, Public Speaking")
    assert polished_ok("langs", "arabic native english good", "Arabic (Native), English (Fluent)")


def test_nothing_new_may_be_added_to_a_field():
    assert not polished_ok("text", "spinsh", "French")
    assert not polished_ok("text", "King saud university", "Harvard University")
    assert not polished_ok("text", "python", "Python, Django, Kubernetes")
    assert not polished_ok("text", "3 years of python", "5 years of Python")


def test_a_certificate_may_be_written_out_in_full_around_what_was_given():
    assert polished_ok("cert", "CAPM", "Certified Associate in Project Management (CAPM), PMI")
    assert polished_ok("cert", "aws cloud practitioner 2025", "AWS Certified Cloud Practitioner, Amazon Web Services, 2025")
    assert not polished_ok("cert", "CAPM", "AWS Certified Solutions Architect")
    assert not polished_ok("cert", "aws cloud practitioner 2025", "AWS Certified Cloud Practitioner, 2024")


def test_worse_misspellings_and_a_country_for_its_language():
    assert polished_ok("text", "king saud unicertiy", "King Saud University")
    assert polished_ok("text", "cyper security", "Cybersecurity")
    assert polished_ok("langs", "arabic spain englih", "Arabic, Spanish, English")
    assert not polished_ok("langs", "arabic spain", "Arabic, French")
    assert not polished_ok("text", "king saud unicertiy", "Harvard University")


def test_two_different_known_skills_are_never_the_same_word():
    assert not polished_ok("text", "java", "JavaScript")
    assert not polished_ok("text", "react", "React Native")


def test_a_written_line_may_fix_the_spelling_of_a_name_given():
    source = "student at king saud unicertiy in cyper security"
    assert unsupported("Studied at King Saud University", source) == []
    assert unsupported("Studied at Harvard University", source) == ["Harvard University"]
    assert unsupported("Uses Java daily", "i use javascript") == ["Java"]
