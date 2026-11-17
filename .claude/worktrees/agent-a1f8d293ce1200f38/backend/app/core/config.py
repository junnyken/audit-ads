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
    #:
    #: Since O4 a reader credential has exactly two homes (rule 40): this server configuration,
    #: or the encrypted vault (`meta_reader_credentials.encrypted_secret`) filled only by the
    #: product's own Facebook Login for Business flow. A connection bound to an `active` vault
    #: credential is never read with the values below.
    meta_access_token: str = ""
    #: One reader credential per Business Manager, for the case one system user cannot read
    #: another business at all — measured 2026-09-11: a token with no role in a BM still reads
    #: the BM node, every asset edge answers 200 with an empty list, and only
    #: `{bm}/system_users` refuses. Partner sharing does not fix it: discovery reads the BM node
    #: itself, so shared assets surface under the *sharing* BM's `client_ad_accounts` instead.
    #:
    #: Keyed by Business Manager id, which `meta_connections.business_manager_reference` already
    #: stores, so the database learns nothing new and no migration is needed. A BM with no entry
    #: falls back to `meta_access_token` — exactly today's behaviour — because a system user may
    #: legitimately hold assets across businesses and refusing to try would remove working access.
    #:
    #: Same boundary as every other credential here: server configuration only. It never reaches
    #: the database, an API response, an audit row, a log line or the frontend bundle.
    #: `META_ACCESS_TOKENS_BY_BUSINESS={"109796697343603":"..."}`
    meta_access_tokens_by_business: dict[str, str] = {}
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

    # ---- O4 Meta reader credentials via Facebook Login for Business (vault) -------------
    #: The Meta app that owns the Login for Business configuration. `META_APP_ID` is not a
    #: secret; `META_APP_SECRET` is, under rule 18's terms: server configuration only, never the
    #: database, a response, an audit row, a log line or the bundle. Together they form the app
    #: access token `debug_token` needs, and the code exchange's `client_secret`.
    meta_app_id: str = ""
    meta_app_secret: str = ""
    #: The Facebook Login for Business configuration id (`config_id`). It — not a `scope`
    #: parameter — decides which permissions and which token type Meta grants. It must ask for
    #: `ads_read` + `business_management` only; a token carrying `ads_management` is refused.
    meta_login_config_id: str = ""
    #: The callback Meta redirects to, registered on the app exactly as written here:
    #: `https://<api host>/api/v1/meta-reader-credentials/callback`.
    meta_oauth_redirect_uri: str = ""
    #: Which token the configuration above was created to issue: `system_user` (the owner's
    #: decision, §14 13.3 — never expires) or `user`. Used only to tell the form whether a
    #: Business Manager id is required; the callback always trusts `debug_token.type` instead.
    meta_login_config_kind: str = "system_user"
    #: Fernet key for the credential vault (`core/secret_vault.py`). Missing or invalid means the
    #: vault refuses to work — never plaintext. Changing it makes every stored credential
    #: unreadable (`vault_unavailable` → reconnect), by design: there is no key rotation in O4.
    credential_vault_key: str = ""
    #: How often the dispatcher also checks that each vault credential is still alive, counted in
    #: dispatch passes. **Zero disables it, and zero is the default** — like every pass that calls
    #: Meta, switching it on in production is a release decision with a named approver (rule 22).
    #: `python -m app.commands.run_dispatcher --credential-check` runs one pass by hand.
    credential_check_every_n_passes: int = 0
    #: Credentials per workspace per pass. At most three GETs each.
    credential_check_batch: int = 10
    #: A credential that expires within this many days raises one `warning` alert (§14 13.5).
    credential_expiry_warning_days: int = 14
    #: `user` tokens only: within this many days of expiry the pass *tries* one
    #: `fb_exchange_token`. Whether that extends anything is counted (`renewed` /
    #: `renew_not_extended`), never assumed — Meta does not document it (T4).
    credential_renew_before_days: int = 20

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
    #: How often the dispatcher also re-evaluates health, counted in dispatch passes — the same
    #: shape as `dispatcher_recovery_every_n_passes`, and for the same reason: one bounded loop in
    #: one container, because the deployment targets here give no host-unit access.
    #:
    #: **Zero disables it, and zero is the default.** Health has always been recalculated on
    #: mutation and on request; a sweep that switched itself on would change how a deployed system
    #: behaves without anyone asking for it. Turning it on is a release decision.
    health_sweep_every_n_passes: int = 0
    #: Accounts per workspace per sweep. Bounded like every other pass here, so one large workspace
    #: cannot monopolise a 4 vCPU host. What it could not reach is reported as `due_remaining`
    #: rather than dropped silently.
    health_sweep_batch: int = 10
    #: A backup older than this is reported stale (daily backup + 2h grace).
    backup_stale_after_hours: int = 26

    # ---- S1 spend tracking (Meta, read-only) ------------------------------------------
    #: How often the dispatcher also reads spend from Meta, counted in dispatch passes.
    #:
    #: **Zero disables it, and zero is the default.** This is the first path in the product that
    #: calls Meta without a person pressing a button. Turning it on in production is a release
    #: decision with a named approver (rule 22, `docs/AUDIT_BEFORE_BUILD_SPEND.md` §6.7) — not a
    #: default anyone drifts past. `python -m app.commands.run_dispatcher --spend-sweep` runs one
    #: pass by hand first.
    spend_sweep_every_n_passes: int = 0
    #: Accounts per workspace per spend sweep. Two GETs per account, so this bounds the calls one
    #: pass can spend. What it could not reach is reported as `due_remaining`.
    spend_sweep_batch: int = 10
    #: A successful spend observation older than this is `stale`. It is also what makes an account
    #: due for the sweep, so the sweep and the badge agree by construction. Lower it to read each
    #: account more often; the default re-reads about once a day.
    spend_observation_stale_after_hours: int = 26
    #: `spend_change_vs_baseline` needs at least this many complete days with an insights row
    #: before the latest complete day; fewer means no baseline, and the rule does not fire.
    spend_baseline_min_days: int = 5
    #: Relative change versus the baseline median, in both directions (0.5 = ±50%).
    spend_change_ratio_threshold: float = 0.5
    #: The absolute change that must also be reached, per currency, in that currency's units as
    #: Meta's insights report them. A currency with no entry here never fires the rule — an
    #: unconfigured minimum is not a minimum of zero. Decided 2026-10-26: VND 500 000 / USD 20.
    #: `SPEND_CHANGE_MIN_AMOUNT_JSON={"VND": 500000, "USD": 20}`
    spend_change_min_amount_json: dict[str, float] = Field(
        default_factory=lambda: {"VND": 500000, "USD": 20}
    )
    #: `spend_cap_approaching` fires when amount_spent / spend_cap reaches this ratio.
    spend_cap_ratio_threshold: float = 0.9

    # ---- O3 scheduled discovery and automatic import (Meta, read-only) ------------------
    #: How often the dispatcher also runs discovery for connections whose owner switched them to
    #: automatic, counted in dispatch passes.
    #:
    #: **Zero disables it, and zero is the default.** It is one of two switches, held by
    #: different people: this one is a release decision with a named approver (rule 22,
    #: `docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md` §9); the other is the per-connection
    #: `auto_discovery_enabled` / `auto_import_enabled` an owner sets through
    #: `PATCH /meta-connections/{id}/automation`. Neither alone reaches Meta or writes the
    #: registry. `python -m app.commands.run_dispatcher --discovery-sweep` runs one pass by hand.
    discovery_sweep_every_n_passes: int = 0
    #: Connections per workspace per pass. About six GETs per connection.
    discovery_sweep_batch: int = 5
    #: A discovery run older than this is `stale`: the badge on screen, the sweep's "due" and
    #: `account_not_returned_by_latest_discovery`'s window all read this one value, so they agree
    #: by construction. It replaced the router constant `DISCOVERY_STALE_AFTER` (24 h).
    discovery_stale_after_hours: int = 24
    #: A `warning` alert of an account the sweep imported within this many hours is not sent on
    #: its own (`skip_reason=auto_import_grace`); the pass's summary already announced it.
    #: Never applies to `critical`. Zero turns the grace off.
    auto_import_telegram_grace_hours: int = 24

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
    def meta_login_configured(self) -> bool:
        """O4. The four values the Facebook Login for Business round trip cannot start without.
        A boolean capability only — none of the values leaves the server process. The vault key
        is checked separately (`secret_vault.vault_configured`), because a wrong key is a
        different failure from a missing app."""
        return all(
            (value or "").strip()
            for value in (
                self.meta_app_id,
                self.meta_app_secret,
                self.meta_login_config_id,
                self.meta_oauth_redirect_uri,
            )
        )

    @property
    def cors_origins(self) -> list[str]:
        """Comma-separated allowlist. Never a wildcard."""
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
