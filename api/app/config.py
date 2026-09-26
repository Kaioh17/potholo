from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POTHOLO_")

    database_url: str = "sqlite:///./potholo.db"


settings = Settings()
