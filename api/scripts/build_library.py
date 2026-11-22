"""Writes the learning library the server reads (app/library/sources.json) from the reviewed
notes in scripts/library_notes.py. Run it after editing the notes, then review the diff.

    python scripts/build_library.py
"""

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from library_notes import NOTES, PUBLISHERS  # noqa: E402

OUT = API_DIR / "app" / "library" / "sources.json"


def slug(skill: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in skill.lower()).strip("-").replace("--", "-")


def build() -> list[dict]:
    notes = []
    for skill, entries in NOTES.items():
        for suffix, title, note, url in entries:
            notes.append({
                "id": f"{slug(skill)}-{suffix}",
                "skill": skill,
                "title": title,
                "note": note,
                "url": url,
                "publisher": PUBLISHERS[urlparse(url).netloc],
                "lang": "en",
            })
    return notes


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    notes = build()
    OUT.write_text(json.dumps(notes, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(notes)} notes for {len(NOTES)} skills to {OUT.relative_to(API_DIR)}")
