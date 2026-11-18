"""One Gemini call with retries: a busy model is tried again, then the fallback models in turn."""

import logging
import time

from google.genai import types

logger = logging.getLogger("skillsync.agents")

# Google answers these when a model is overloaded or briefly down; they usually pass.
TRANSIENT_CODES = {500, 502, 503, 504}
# The model's own quota is used up (each model has its own on the free tier), or the key
# cannot use that model name: waiting does not help, but the next model may answer.
NEXT_MODEL_CODES = {429, 404}
ATTEMPTS_PER_MODEL = 3
WAIT_SECONDS = (1.0, 2.0)

sleep = time.sleep

# Extracting quoted skills needs no long reasoning, and thinking costs the visitor seconds.
MINIMAL_THINKING = types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)


def _rejects_thinking(error: Exception) -> bool:
    return getattr(error, "code", None) == 400 and "thinking" in str(error).lower()


def _without_thinking(request: dict) -> dict | None:
    config = request.get("config")
    if config is None or getattr(config, "thinking_config", None) is None:
        return None
    return {**request, "config": config.model_copy(update={"thinking_config": None})}


def is_busy(error: Exception) -> bool:
    return getattr(error, "code", None) in TRANSIENT_CODES


def models_to_try(settings) -> list[str]:
    """The main model, then each name in GEMINI_FALLBACK_MODEL (comma-separated), in order."""
    fallbacks = getattr(settings, "gemini_fallback_model", "") or ""
    return [settings.gemini_model, *(name.strip() for name in fallbacks.split(","))]


def generate(client, models: list[str], **request):
    """Call `generate_content`, moving through the models until one answers.

    A busy model, a used-up quota or an unknown model moves to the next model at once: another
    model is usually free, and waiting costs the visitor seconds. Only the last model, with
    nothing left to move to, is retried with short waits. A model that does not take the
    thinking setting is asked again without it, and so are the models after it. Any other
    error (bad key, bad request) is raised at once: no model can help.
    """
    names = list(dict.fromkeys(model for model in models if model))
    last_error: Exception | None = None

    for index, model in enumerate(names):
        attempts = ATTEMPTS_PER_MODEL if index == len(names) - 1 else 1
        attempt = 0
        while attempt < attempts:
            started = time.monotonic()
            try:
                response = client.models.generate_content(model=model, **request)
                # Only the model and the time: never the request or the answer.
                logger.info("gemini model %s answered in %.1fs", model, time.monotonic() - started)
                return response
            except Exception as error:  # noqa: BLE001
                code = getattr(error, "code", None)
                plain = _without_thinking(request) if _rejects_thinking(error) else None
                if plain is not None:
                    logger.warning("gemini model %s does not take the thinking setting; asking without it", model)
                    request = plain
                    continue
                last_error = error
                if code in NEXT_MODEL_CODES:
                    logger.warning(
                        "gemini model %s unavailable (code=%s) after %.1fs, trying the next one",
                        model,
                        code,
                        time.monotonic() - started,
                    )
                    break
                if not is_busy(error):
                    raise
                attempt += 1
                logger.warning(
                    "gemini model %s busy (code=%s) after %.1fs, attempt %d of %d",
                    model,
                    code,
                    time.monotonic() - started,
                    attempt,
                    attempts,
                )
                if attempt < attempts:
                    sleep(WAIT_SECONDS[attempt - 1])

    assert last_error is not None
    raise last_error


# Yielded by generate_stream when a model stopped mid-answer and the next one starts afresh:
# whatever was half-read belongs to the old answer.
RESTART = object()


def generate_stream(client, models: list[str], **request):
    """Like generate, but yields the answer's text as it arrives.

    Errors before the first piece follow generate's rules. If a model stops after it has
    started answering, RESTART is yielded and the next model answers from the beginning.
    """
    names = list(dict.fromkeys(model for model in models if model))
    last_error: Exception | None = None

    for index, model in enumerate(names):
        attempts = ATTEMPTS_PER_MODEL if index == len(names) - 1 else 1
        attempt = 0
        while attempt < attempts:
            started = time.monotonic()
            answered = False
            try:
                for chunk in client.models.generate_content_stream(model=model, **request):
                    text = getattr(chunk, "text", None)
                    if not text:
                        continue
                    if not answered:
                        answered = True
                        logger.info("gemini model %s started answering in %.1fs", model, time.monotonic() - started)
                    yield text
                logger.info("gemini model %s answered in %.1fs", model, time.monotonic() - started)
                return
            except Exception as error:  # noqa: BLE001
                code = getattr(error, "code", None)
                if answered:
                    last_error = error
                    logger.warning("gemini model %s stopped mid-answer (code=%s), trying the next one", model, code)
                    yield RESTART
                    break
                plain = _without_thinking(request) if _rejects_thinking(error) else None
                if plain is not None:
                    logger.warning("gemini model %s does not take the thinking setting; asking without it", model)
                    request = plain
                    continue
                last_error = error
                if code in NEXT_MODEL_CODES:
                    logger.warning(
                        "gemini model %s unavailable (code=%s) after %.1fs, trying the next one",
                        model,
                        code,
                        time.monotonic() - started,
                    )
                    break
                if not is_busy(error):
                    raise
                attempt += 1
                logger.warning(
                    "gemini model %s busy (code=%s) after %.1fs, attempt %d of %d",
                    model,
                    code,
                    time.monotonic() - started,
                    attempt,
                    attempts,
                )
                if attempt < attempts:
                    sleep(WAIT_SECONDS[attempt - 1])

    assert last_error is not None
    raise last_error
