from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", case_sensitive=False, populate_by_name=True
    )

    app_name: str = "AdsOps Control Center"
    app_version: str = "0.1.0"
    environment: str = "development"
    log_level: str = "INFO"

    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+psycopg://adsops:adsops@localhost:5434/adsops"

    jwt_secret: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720

    # Read as a raw string, not a list: pydantic-settings tries to JSON-decode list-typed
    # env values before any validator runs, so "a,b" would fail to parse.
    cors_origins_raw: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    #: Owner bootstrapped on first start when the database has no workspace yet.
    bootstrap_owner_email: str = ""
    bootstrap_owner_password: str = ""
    bootstrap_workspace_name: str = "AdsOps"

    #: A completed manual review older than this is no longer "current" (A1 §C).
    readiness_manual_review_interval_days: int = 30
    #: last_synced_at older than this reports data_freshness = stale (A1 §D).
    data_freshness_stale_after_days: int = 7

    @property
    def cors_origins(self) -> list[str]:
        """Comma-separated allowlist. Never a wildcard."""
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
