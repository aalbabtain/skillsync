"""Pull complete objects out of a JSON answer while it is still arriving.

Gemini streams its JSON answer in pieces, such as `{"skills": [{"name": "Py` and then
`thon", ...}, {...`. Each object inside the top-level list is handed over as soon as its closing
brace arrives, so a skill can be checked and shown before the rest of the answer is written.
"""

import json
from collections.abc import Iterator


class ObjectScanner:
    """Feed it text pieces; it yields each object found one level inside the top-level list."""

    def __init__(self) -> None:
        self._stack: list[str] = []
        self._in_string = False
        self._escaped = False
        self._current: list[str] | None = None

    def feed(self, piece: str) -> Iterator[dict]:
        for char in piece:
            if self._current is not None:
                self._current.append(char)

            if self._in_string:
                if self._escaped:
                    self._escaped = False
                elif char == "\\":
                    self._escaped = True
                elif char == '"':
                    self._in_string = False
                continue

            if char == '"':
                self._in_string = True
            elif char in "{[":
                # An object that opens inside the top-level list: {"skills": [ here ].
                if char == "{" and self._stack == ["{", "["]:
                    self._current = [char]
                self._stack.append(char)
            elif char in "}]":
                if self._stack:
                    self._stack.pop()
                if char == "}" and self._current is not None and self._stack == ["{", "["]:
                    text = "".join(self._current)
                    self._current = None
                    try:
                        found = json.loads(text)
                    except ValueError:
                        continue
                    if isinstance(found, dict):
                        yield found
