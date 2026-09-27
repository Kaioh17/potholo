from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POTHOLO_")

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


settings = Settings()
