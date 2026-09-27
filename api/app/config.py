from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = API_DIR.parent


class Settings(BaseSettings):
    # Values come from the process environment first, then from .env at the repo
    # root, then from the defaults below. In Docker there is no .env file in the
    # image, so Compose passes the environment in and the file is skipped.
    model_config = SettingsConfigDict(
        env_prefix="POTHOLO_",
        env_file=REPO_DIR / ".env",
        env_file_encoding="utf-8",
        # .env also holds keys for other parts of the project.
        extra="ignore",
    )

    # "production" turns off the interactive API docs.
    environment: Literal["development", "production"] = "development"

    # Anchored to the api/ folder, not the working directory. A relative path
    # meant `fastapi dev` in api/ and `python mock/seed_db.py` from the repo root
    # silently used two different database files.
    database_url: str = f"sqlite:///{API_DIR / 'potholo.db'}"

    # Reverse geocoding for the pothole map. Nominatim is free and needs no key,
    # but its usage policy asks for an identifying User-Agent, at most one request
    # a second and caching. Set POTHOLO_GEOCODER_USER_AGENT to something that says
    # how to reach you, and POTHOLO_GEOCODER_URL to point at your own instance.
    geocoder_url: str = "https://nominatim.openstreetmap.org/reverse"
    geocoder_user_agent: str = "Potholo/0.1 (prototype)"

    # Chicago 311 Open311 key. Without it a report is prepared but never sent.
    # Read as CHI311_API_KEY, without the POTHOLO_ prefix.
    chi311_api_key: str | None = Field(default=None, validation_alias="CHI311_API_KEY")

    # Claude API key, for the plain-language summary on the Try page. Without it
    # a user still gets a summary, just the deterministic fallback text instead
    # of a written one. Read as CLAUDE_API_KEY, without the POTHOLO_ prefix.
    claude_api_key: str | None = Field(default=None, validation_alias="CLAUDE_API_KEY")
    claude_model: str = "claude-sonnet-5"

    # Origins allowed to call the API from a browser. In production set
    # POTHOLO_CORS_ORIGINS='["https://potholo.usemaison.io"]'.
    cors_origins: list[str] = ["http://localhost:8840", "http://127.0.0.1:8840"]


settings = Settings()
