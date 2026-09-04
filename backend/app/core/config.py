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

    # ---- A2 health policy ------------------------------------------------------------
    #: A health evaluation older than this is reported stale, and a stale evaluation can never
    #: present as clear_signals (A2 §C). The manual-review interval deliberately reuses the A1
    #: setting above rather than introducing a second, divergable policy value.
    health_evaluation_stale_after_hours: int = 24
    #: Backfill runs synchronously because there is no worker; the bound is what keeps it safe.
    health_backfill_default_batch: int = 5
    health_backfill_max_batch: int = 50

    # ---- A3 alerting and notification delivery ---------------------------------------
    #: "disabled" | "fake" | "telegram". Disabled by default so a fresh deployment cannot
    #: message anyone by accident; a real send needs this AND a bot token.
    notification_transport: str = "disabled"
    #: Server-side only. Never stored in the database, never returned by an endpoint, never
    #: logged — the redactor masks any key containing "token" before anything is written.
    telegram_bot_token: str = ""
    telegram_api_base_url: str = "https://api.telegram.org"
    telegram_timeout_seconds: int = 10
    #: Public dashboard URL for deep links. A missing or unsafe value omits the link entirely
    #: rather than sending a recipient somewhere unreachable.
    public_app_url: str = ""

    notification_dispatch_batch_size: int = 10
    notification_max_attempts: int = 3
    #: Backoff between transient retries, in minutes, one entry per retry.
    notification_retry_backoff_minutes: str = "1,5,15"
    #: How long a dispatcher may hold a claimed delivery before another may reclaim it.
    notification_lease_seconds: int = 120

    @property
    def retry_backoff_minutes(self) -> list[int]:
        return [
            int(part.strip())
            for part in self.notification_retry_backoff_minutes.split(",")
            if part.strip().isdigit()
        ] or [1, 5, 15]

    @property
    def telegram_transport_configured(self) -> bool:
        """A boolean capability only. The token itself never leaves the server process."""
        return bool(self.telegram_bot_token) and self.notification_transport == "telegram"

    @property
    def cors_origins(self) -> list[str]:
        """Comma-separated allowlist. Never a wildcard."""
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
