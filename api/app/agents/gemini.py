"""One Gemini call with retries: a busy model is tried again, then the fallback model."""

import logging
import time

logger = logging.getLogger("skillsync.agents")

# Google answers these when a model is overloaded or briefly down; they usually pass.
TRANSIENT_CODES = {500, 502, 503, 504}
ATTEMPTS_PER_MODEL = 3
WAIT_SECONDS = (1.0, 2.0)

sleep = time.sleep


def is_busy(error: Exception) -> bool:
    return getattr(error, "code", None) in TRANSIENT_CODES


def generate(client, models: list[str], **request):
    """Call `generate_content`, retrying busy answers, then moving to the next model.

    Any other error (bad key, quota, bad request) is raised at once: retrying cannot help.
    """
    names = list(dict.fromkeys(model for model in models if model))
    last_error: Exception | None = None

    for model in names:
        for attempt in range(ATTEMPTS_PER_MODEL):
            try:
                return client.models.generate_content(model=model, **request)
            except Exception as error:  # noqa: BLE001
                if not is_busy(error):
                    raise
                last_error = error
                logger.warning(
                    "gemini model %s busy (code=%s), attempt %d of %d",
                    model,
                    getattr(error, "code", None),
                    attempt + 1,
                    ATTEMPTS_PER_MODEL,
                )
                if attempt < ATTEMPTS_PER_MODEL - 1:
                    sleep(WAIT_SECONDS[attempt])

    assert last_error is not None
    raise last_error
