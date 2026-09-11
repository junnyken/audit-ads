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
    #: NOTE: pydantic-settings binds this field by its alias ONLY — `Settings(cors_origins_raw=…)`
    #: is silently ignored and falls back to the default. Construct it as `CORS_ORIGINS=…`,
    #: including in tests; asserting against a value passed by field name tests nothing.
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
    #: A7/A10: server-side only, same boundary as `telegram_bot_token` above. A long-lived
    #: system-user token (the auth model chosen for A10 — no OAuth round-trip). It never
    #: reaches the database, an API response, an audit row, a log line or the frontend bundle;
    #: `token_configured` is a computed boolean, never the credential.
    meta_access_token: str = ""
    #: A10. Pinned deliberately: a floating version means Meta changes behaviour underneath a
    #: running deployment. Bump it as a decision, with a release, not by accident.
    meta_graph_api_base_url: str = "https://graph.facebook.com"
    meta_graph_api_version: str = "v21.0"
    meta_timeout_seconds: int = 15
    #: A10.2. The most items one batch may run when writes land on a real Business Manager.
    #: A created ad account cannot be un-created, and a BM has a finite account quota, so the
    #: first real write is a pilot of exactly one. Raising this is a deliberate decision after
    #: that pilot has been checked in Business Settings — not a default anyone drifts past.
    #: It has no effect on the fake provider, where a write costs nothing and repeats freely.
    meta_write_pilot_max_items: int = 1
    #: A10. The Business Manager to read. Required for a system-user token, because Meta will
    #: not name the business behind one: verified live on 2026-09-10 against a real BM, where
    #: `business` as a field returned `invalid_request` and `businesses` as both an expanded
    #: field and an edge came back empty, while reading the BM by id worked. Not a secret — a BM
    #: id is visible in Business Settings — so unlike the token it may appear in logs and
    #: findings. Empty means "not configured", which reports as a `False` capability with reason
    #: `not_configured`, never as a silent success.
    meta_business_id: str = ""
    #: Public dashboard URL for deep links. A missing or unsafe value omits the link entirely
    #: rather than sending a recipient somewhere unreachable.
    public_app_url: str = ""

    #: Set by the release process to the deployed commit. "unknown" means nobody stamped it,
    #: which is itself worth seeing on the status page.
    release_version: str = "unknown"
    #: Human-safe label for the running environment, shown in status and the test message.
    environment_label: str = ""
    #: Serve /docs, /redoc and /openapi.json. Off in production: the schema is a map of the
    #: whole API and there is no reason to publish it to the internet.
    enable_api_docs: bool = True

    notification_dispatch_batch_size: int = 10
    notification_max_attempts: int = 3
    #: Backoff between transient retries, in minutes, one entry per retry.
    notification_retry_backoff_minutes: str = "1,5,15"
    #: How long a dispatcher may hold a claimed delivery before another may reclaim it.
    notification_lease_seconds: int = 120

    # ---- A4 dispatcher runner --------------------------------------------------------
    #: Seconds the standalone dispatcher sleeps between passes. Bounded loop, never a busy one.
    dispatcher_interval_seconds: int = 60
    #: Passes between recovery sweeps. A sweep reclaims stranded rows; it sends nothing.
    dispatcher_recovery_every_n_passes: int = 10
    #: A dispatcher with no recorded run for longer than this is reported stale.
    dispatcher_stale_after_minutes: int = 15
    #: A backup older than this is reported stale (daily backup + 2h grace).
    backup_stale_after_hours: int = 26

    # ---- A5 Chrome context extension ------------------------------------------------
    #: Extension tokens are short-lived on purpose: they live in browser storage, so a stolen
    #: one should stop working in hours rather than the 12 hours a dashboard session gets.
    extension_token_expire_minutes: int = 720
    #: Oldest extension build allowed to talk to this API. Empty means "any".
    extension_minimum_version: str = ""

    # ---- Rate limiting ----------------------------------------------------------------
    #: Master switch. On everywhere by default: a limiter that is off in development is a
    #: limiter nobody notices is misconfigured until production. Tests turn it off explicitly.
    rate_limit_enabled: bool = True
    #: Authentication attempts per window, per client address. Deliberately small: this is the
    #: brute-force bound, and a human logging in never comes close to it.
    rate_limit_auth_attempts: int = 10
    rate_limit_auth_window_seconds: int = 300
    #: General API calls per window, per authenticated subject (per address when anonymous).
    rate_limit_api_requests: int = 300
    rate_limit_api_window_seconds: int = 60
    #: Number of API worker processes. Buckets are per process, so the configured limits are
    #: divided by this to make the documented number the number an operator actually gets.
    rate_limit_process_count: int = 1
    #: Proxy hops between the client and this process. 0 means "no proxy": X-Forwarded-For is
    #: ignored entirely, because a client can set that header itself. Behind the production
    #: nginx edge this is 1; behind an additional platform proxy it is 2.
    rate_limit_trusted_proxy_hops: int = 0

    # ---- A4 controlled test send -----------------------------------------------------
    #: Master switch for the controlled Telegram test send. Off by default: the endpoint
    #: exists so the flow is reviewable, and it refuses to do anything until an operator
    #: turns it on for one approved verification.
    allow_test_send: bool = False

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
