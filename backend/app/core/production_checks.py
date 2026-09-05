"""Production configuration validation.

A deployment that starts with a placeholder secret, a wildcard CORS origin or the pilot
password still active looks healthy from the outside. These checks refuse that quietly-broken
state: in production they stop the process, everywhere else they warn.

Findings never contain the offending value. "jwt_secret is a known placeholder" is actionable;
echoing the secret into a log to prove it would be the exact failure this module exists to
prevent.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from app.core.config import Settings

#: Values that ship in the template or the local pilot. None of them may reach production.
KNOWN_PLACEHOLDER_SECRETS = frozenset(
    {
        "change-me",
        "change-me-in-env",
        "changeme",
        "secret",
        "password",
        "postgres",
        "adsops",
        "local-pilot-secret-do-not-reuse",
        "pilot-local-password",
    }
)

#: The credential used by every local pilot in TEST_LOG. Present in production means the
#: deployment can be logged into with a password written down in a public document.
PILOT_PASSWORD = "pilot-local-password"

MIN_SECRET_LENGTH = 32

PRODUCTION_ENVIRONMENTS = frozenset({"production", "prod", "staging"})


@dataclass(frozen=True)
class ConfigFinding:
    code: str
    severity: str  # "error" | "warning"
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "severity": self.severity, "message": self.message}


class ProductionConfigurationError(RuntimeError):
    """Raised at startup when production configuration is unsafe."""


def is_production(settings: Settings) -> bool:
    return settings.environment.strip().lower() in PRODUCTION_ENVIRONMENTS


def _placeholder(value: str) -> bool:
    return value.strip().lower() in KNOWN_PLACEHOLDER_SECRETS


def check_settings(settings: Settings) -> list[ConfigFinding]:
    """Every production requirement, as findings. Pure: it reads settings and nothing else."""
    findings: list[ConfigFinding] = []
    production = is_production(settings)

    def add(code: str, message: str, *, severity: str = "error") -> None:
        findings.append(ConfigFinding(code=code, severity=severity, message=message))

    # ---- database ------------------------------------------------------------------
    if not settings.database_url.strip():
        add("database_url_missing", "DATABASE_URL is not set.")
    elif production:
        parsed = urlparse(settings.database_url.replace("postgresql+psycopg", "postgresql"))
        if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
            add(
                "database_url_localhost",
                "DATABASE_URL points at localhost. In a container that is the container itself, "
                "not the database service.",
                severity="warning",
            )
        if parsed.password and _placeholder(parsed.password):
            add("database_password_placeholder", "The database password is a known placeholder.")

    # ---- authentication ------------------------------------------------------------
    if not settings.jwt_secret.strip():
        add("jwt_secret_missing", "JWT_SECRET is not set.")
    elif production:
        if _placeholder(settings.jwt_secret):
            add("jwt_secret_placeholder", "JWT_SECRET is a known placeholder value.")
        elif len(settings.jwt_secret) < MIN_SECRET_LENGTH:
            add(
                "jwt_secret_too_short",
                f"JWT_SECRET is shorter than {MIN_SECRET_LENGTH} characters.",
            )

    # ---- bootstrap credentials -----------------------------------------------------
    if settings.bootstrap_owner_password:
        if settings.bootstrap_owner_password == PILOT_PASSWORD:
            add(
                "bootstrap_password_is_pilot_credential",
                "BOOTSTRAP_OWNER_PASSWORD is the documented local pilot password. It is written "
                "down in this repository's test log and must never reach a deployment.",
            )
        elif production and _placeholder(settings.bootstrap_owner_password):
            add("bootstrap_password_placeholder", "BOOTSTRAP_OWNER_PASSWORD is a placeholder.")
        elif production and len(settings.bootstrap_owner_password) < 12:
            add(
                "bootstrap_password_too_short",
                "BOOTSTRAP_OWNER_PASSWORD is shorter than 12 characters.",
            )
    if production and settings.bootstrap_owner_email and not settings.bootstrap_owner_password:
        add(
            "bootstrap_incomplete",
            "BOOTSTRAP_OWNER_EMAIL is set without a password; the owner will not be created.",
            severity="warning",
        )

    # ---- CORS ----------------------------------------------------------------------
    origins = settings.cors_origins
    if production:
        if not origins:
            add("cors_origins_missing", "CORS_ORIGINS is empty; the frontend cannot call the API.")
        if any(origin.strip() == "*" for origin in origins):
            add("cors_wildcard", "CORS_ORIGINS contains a wildcard. Production requires exact origins.")
        for origin in origins:
            if origin.startswith("http://") and "localhost" not in origin and "127.0.0.1" not in origin:
                add(
                    "cors_origin_not_https",
                    "A production CORS origin is plain HTTP.",
                    severity="warning",
                )

    # ---- public URL ----------------------------------------------------------------
    public_url = settings.public_app_url.strip()
    if public_url:
        parsed = urlparse(public_url)
        if parsed.scheme != "https":
            add(
                "public_app_url_not_https",
                "PUBLIC_APP_URL is not HTTPS. Deep links will be omitted from messages.",
                severity="warning" if not production else "error",
            )
    elif production:
        add(
            "public_app_url_missing",
            "PUBLIC_APP_URL is not set. Notifications will be sent without a dashboard link.",
            severity="warning",
        )

    # ---- notification transport -----------------------------------------------------
    mode = settings.notification_transport.strip().lower()
    if mode not in ("disabled", "fake", "telegram"):
        add("notification_transport_invalid", f"NOTIFICATION_TRANSPORT '{mode}' is not a known mode.")
    if mode == "telegram" and not settings.telegram_bot_token.strip():
        add(
            "telegram_token_missing",
            "NOTIFICATION_TRANSPORT is 'telegram' but no bot token is configured server-side.",
        )
    if production and mode == "fake":
        add(
            "fake_transport_in_production",
            "The fake transport is enabled in a production environment. Nothing will actually "
            "be delivered.",
            severity="warning",
        )

    # ---- API surface ---------------------------------------------------------------
    if production and settings.enable_api_docs:
        add(
            "api_docs_enabled_in_production",
            "Interactive API docs are enabled in production; they publish the whole API surface.",
            severity="warning",
        )
    if production and settings.release_version.strip().lower() in ("", "unknown", "latest"):
        add(
            "release_version_unset",
            "RELEASE_VERSION is not stamped, so a deployment cannot be identified or rolled back "
            "to a known commit.",
            severity="warning",
        )

    # ---- Rate limiting -------------------------------------------------------------
    if production and not settings.rate_limit_enabled:
        add(
            "rate_limit_disabled_in_production",
            "Rate limiting is switched off, so the login route has no brute-force bound.",
        )
    if production and settings.rate_limit_process_count > 1 and settings.rate_limit_enabled:
        add(
            "rate_limit_multi_process",
            "Rate limit buckets are per process. RATE_LIMIT_PROCESS_COUNT is set above one, so "
            "the configured allowance is divided; confirm it matches the deployed worker count.",
            severity="warning",
        )
    if production and settings.rate_limit_trusted_proxy_hops == 0 and settings.rate_limit_enabled:
        add(
            "rate_limit_no_proxy_hops",
            "RATE_LIMIT_TRUSTED_PROXY_HOPS is zero, so every request behind a proxy shares one "
            "bucket and one caller can exhaust the allowance for all of them.",
            severity="warning",
        )

    return findings


def errors(findings: list[ConfigFinding]) -> list[ConfigFinding]:
    return [finding for finding in findings if finding.severity == "error"]


def enforce(settings: Settings) -> list[ConfigFinding]:
    """Validate, and refuse to start a production process that is configured unsafely.

    Non-production keeps running: a developer with a placeholder secret needs a warning, not a
    process that will not boot.
    """
    findings = check_settings(settings)
    blocking = errors(findings)
    if blocking and is_production(settings):
        detail = "; ".join(f"{f.code}: {f.message}" for f in blocking)
        raise ProductionConfigurationError(
            f"Refusing to start with unsafe production configuration — {detail}"
        )
    return findings
