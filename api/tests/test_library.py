from urllib.parse import urlparse

from app.agents import retrieval
from app.skills_catalog import CATALOG

CATALOG_NAMES = {name for name, _, _ in CATALOG}


def test_every_note_is_complete_and_points_to_an_https_page():
    notes = retrieval.load_notes()
    assert len(notes) >= 100
    for note in notes:
        assert note["skill"] in CATALOG_NAMES, note["id"]
        assert note["title"] and note["publisher"], note["id"]
        assert 0 < len(note["note"]) <= 400, note["id"]
        assert urlparse(note["url"]).scheme == "https" and urlparse(note["url"]).netloc, note["id"]


def test_note_ids_are_unique():
    ids = [note["id"] for note in retrieval.load_notes()]
    assert len(ids) == len(set(ids))


def test_the_library_file_matches_the_reviewed_notes():
    # The server reads sources.json; it must be rebuilt from scripts/library_notes.py.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import build_library

    assert build_library.build() == list(retrieval.load_notes())
