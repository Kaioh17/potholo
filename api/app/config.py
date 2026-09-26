from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POTHOLO_")

    # Anchored to the api/ folder, not the working directory. A relative path
    # meant `fastapi dev` in api/ and `python mock/seed_db.py` from the repo root
    # silently used two different database files.
    database_url: str = f"sqlite:///{API_DIR / 'potholo.db'}"


settings = Settings()
