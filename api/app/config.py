from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    # Tried when the main model stays busy; empty means no fallback.
    gemini_fallback_model: str = ""
    # Embeddings for the learning library (Agent 4's retrieval).
    gemini_embedding_model: str = "gemini-embedding-001"
    skillsync_extractor: str = ""
    skillsync_static_dir: str = ""
    # Model requests per client address per hour; 0 turns the limit off.
    skillsync_rate_limit: int = 20
    # GoatCounter site code for anonymous visit counts; empty turns counting off.
    goatcounter_code: str = ""
    # Optional GoatCounter API key with read access: the landing then shows the dashboard's own
    # count instead of the public counter's, which can lag behind it.
    goatcounter_api_key: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
