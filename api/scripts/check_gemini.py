"""Smoke test for the Gemini connection. Reads api/.env and never prints the key."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google import genai  # noqa: E402

from app.config import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()

    if not settings.gemini_api_key:
        print("FAILED: GEMINI_API_KEY is empty in api/.env")
        return 1

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        interaction = client.interactions.create(
            model=settings.gemini_model,
            input="Reply with the single word OK.",
        )
    except Exception as error:  # noqa: BLE001
        message = str(error).replace(settings.gemini_api_key, "[redacted]")
        print(f"FAILED: {type(error).__name__}: {message[:300]}")
        return 1

    reply = (getattr(interaction, "output_text", "") or "").strip()

    print(f"OK: {settings.gemini_model} replied {reply!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
