from app.agents.json_stream import ObjectScanner


def scan(pieces):
    scanner = ObjectScanner()
    found = []
    for piece in pieces:
        found.extend(scanner.feed(piece))
    return found


def test_objects_come_out_as_soon_as_they_close():
    scanner = ObjectScanner()
    assert list(scanner.feed('{"skills": [{"name": "Py')) == []
    assert list(scanner.feed('thon", "evidence": "x"}, {"na')) == [{"name": "Python", "evidence": "x"}]
    assert list(scanner.feed('me": "SQL"}]}')) == [{"name": "SQL"}]


def test_braces_and_quotes_inside_strings_do_not_confuse_it():
    text = '{"skills": [{"name": "C#", "evidence": "Built {APIs} and \\"tools\\" in C# [2024]"}]}'
    assert scan([text[i : i + 3] for i in range(0, len(text), 3)]) == [
        {"name": "C#", "evidence": 'Built {APIs} and "tools" in C# [2024]'}
    ]


def test_arabic_text_passes_through():
    assert scan(['{"skills": [{"name": "Python", "evidence": "بنيتُ ', 'نظامًا بـ Python"}]}']) == [
        {"name": "Python", "evidence": "بنيتُ نظامًا بـ Python"}
    ]


def test_nested_values_stay_inside_their_object():
    assert scan(['{"skills": [{"name": "Go", "tags": [{"a": 1}], "x": {"y": 2}}]}']) == [
        {"name": "Go", "tags": [{"a": 1}], "x": {"y": 2}}
    ]


def test_an_empty_list_yields_nothing():
    assert scan(['{"skills": []}']) == []
