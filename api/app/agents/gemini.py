"""One Gemini call with retries: a busy model is tried again, then the fallback models in turn."""

import logging
import time

logger = logging.getLogger("skillsync.agents")

# Google answers these when a model is overloaded or briefly down; they usually pass.
TRANSIENT_CODES = {500, 502, 503, 504}
# The model's own quota is used up (each model has its own on the free tier), or the key
# cannot use that model name: waiting does not help, but the next model may answer.
NEXT_MODEL_CODES = {429, 404}
ATTEMPTS_PER_MODEL = 3
WAIT_SECONDS = (1.0, 2.0)

sleep = time.sleep


def is_busy(error: Exception) -> bool:
    return getattr(error, "code", None) in TRANSIENT_CODES


def models_to_try(settings) -> list[str]:
    """The main model, then each name in GEMINI_FALLBACK_MODEL (comma-separated), in order."""
    fallbacks = getattr(settings, "gemini_fallback_model", "") or ""
    return [settings.gemini_model, *(name.strip() for name in fallbacks.split(","))]


def generate(client, models: list[str], **request):
    """Call `generate_content`, retrying busy answers, then moving to the next model.

    A used-up quota or an unknown model moves to the next model at once. Any other error
    (bad key, bad request) is raised at once: no model can help.
    """
    names = list(dict.fromkeys(model for model in models if model))
    last_error: Exception | None = None

    for model in names:
        for attempt in range(ATTEMPTS_PER_MODEL):
            started = time.monotonic()
            try:
                response = client.models.generate_content(model=model, **request)
                # Only the model and the time: never the request or the answer.
                logger.info("gemini model %s answered in %.1fs", model, time.monotonic() - started)
                return response
            except Exception as error:  # noqa: BLE001
                code = getattr(error, "code", None)
                if code in NEXT_MODEL_CODES:
                    last_error = error
                    logger.warning(
                        "gemini model %s unavailable (code=%s) after %.1fs, trying the next one",
                        model,
                        code,
                        time.monotonic() - started,
                    )
                    break
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
