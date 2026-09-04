"""A4 §10.2 — production configuration validation, and the secrets it must never reveal."""
from __future__ import annotations

import pathlib

import pytest

from app.core.config import Settings
from app.core.production_checks import (
    PILOT_PASSWORD,
    ProductionConfigurationError,
    check_settings,
    enforce,
    errors,
    is_production,
)

REPO = pathlib.Path(__file__).resolve().parents[2]


def settings(**overrides) -> Settings:
    base = {
        "environment": "production",
        "database_url": "postgresql+psycopg://adsops:a-long-real-password@db:5432/adsops",
        "jwt_secret": "x" * 48,
        "cors_origins_raw": "https://adsops.example.com",
        "public_app_url": "https://adsops.example.com",
        "notification_transport": "disabled",
        "release_version": "abc1234",
        "enable_api_docs": False,
    }
    base.update(overrides)
    return Settings(**base)


def codes(found) -> set[str]:
    return {finding.code for finding in found}


def test_a_well_configured_production_deployment_has_no_errors():
    findings = check_settings(settings())
    assert errors(findings) == [], [f.code for f in findings]


def test_missing_database_and_auth_settings_are_errors():
    found = codes(check_settings(settings(database_url="", jwt_secret="")))
    assert {"database_url_missing", "jwt_secret_missing"} <= found


def test_placeholder_secrets_are_rejected_in_production():
    found = codes(check_settings(settings(jwt_secret="change-me")))
    assert "jwt_secret_placeholder" in found
    found = codes(
        check_settings(settings(database_url="postgresql+psycopg://adsops:change-me@db:5432/adsops"))
    )
    assert "database_password_placeholder" in found


def test_a_short_secret_is_rejected():
    assert "jwt_secret_too_short" in codes(check_settings(settings(jwt_secret="short")))


def test_the_pilot_password_is_refused_in_every_environment():
    for environment in ("production", "development", "local-pilot"):
        found = codes(
            check_settings(
                settings(environment=environment, bootstrap_owner_password=PILOT_PASSWORD)
            )
        )
        assert "bootstrap_password_is_pilot_credential" in found, environment


def test_wildcard_cors_is_rejected_in_production():
    assert "cors_wildcard" in codes(check_settings(settings(cors_origins_raw="*")))
    assert "cors_origins_missing" in codes(check_settings(settings(cors_origins_raw="")))


def test_telegram_mode_without_a_token_is_an_error():
    found = check_settings(settings(notification_transport="telegram", telegram_bot_token=""))
    assert "telegram_token_missing" in codes(found)
    # ...and the finding must not hint at the shape of the expected value.
    message = next(f.message for f in found if f.code == "telegram_token_missing")
    assert ":" not in message.replace("server-side.", "")
    assert "AA" not in message


def test_the_fake_transport_starts_without_a_real_token():
    found = check_settings(settings(environment="development", notification_transport="fake"))
    assert errors(found) == []


def test_the_fake_transport_in_production_is_flagged_but_not_fatal():
    found = check_settings(settings(notification_transport="fake"))
    assert "fake_transport_in_production" in codes(found)
    assert "fake_transport_in_production" not in codes(errors(found))


def test_public_url_must_be_https_in_production_and_only_warns_elsewhere():
    assert "public_app_url_not_https" in codes(
        errors(check_settings(settings(public_app_url="http://adsops.example.com")))
    )
    dev = check_settings(settings(environment="development", public_app_url="http://localhost:5173"))
    assert "public_app_url_not_https" not in codes(errors(dev))


def test_published_api_docs_and_an_unstamped_release_are_flagged_in_production():
    found = codes(check_settings(settings(enable_api_docs=True, release_version="unknown")))
    assert {"api_docs_enabled_in_production", "release_version_unset"} <= found


def test_enforce_refuses_to_start_a_misconfigured_production_process():
    with pytest.raises(ProductionConfigurationError) as excinfo:
        enforce(settings(jwt_secret="change-me"))
    assert "jwt_secret_placeholder" in str(excinfo.value)


def test_enforce_never_echoes_the_offending_value():
    secret = "super-secret-value-that-must-not-leak"
    with pytest.raises(ProductionConfigurationError) as excinfo:
        enforce(settings(jwt_secret=secret[:10], bootstrap_owner_password=PILOT_PASSWORD))
    assert secret[:10] not in str(excinfo.value)
    assert PILOT_PASSWORD not in str(excinfo.value)


def test_enforce_only_warns_outside_production():
    findings = enforce(settings(environment="development", jwt_secret="change-me"))
    assert isinstance(findings, list)  # it returned instead of raising


def test_is_production_covers_staging_too():
    assert is_production(settings(environment="staging"))
    assert not is_production(settings(environment="development"))


# ---- repository-level configuration hygiene ------------------------------------------


def test_env_example_contains_no_real_secret_like_value():
    text = (REPO / ".env.example").read_text()
    assert PILOT_PASSWORD not in text
    # A Telegram bot token looks like 123456789:AA... — no such value may sit in the template.
    import re

    assert re.search(r"\d{6,}:[A-Za-z0-9_-]{20,}", text) is None
    for line in text.splitlines():
        if line.startswith("TELEGRAM_BOT_TOKEN"):
            assert line.strip() == "TELEGRAM_BOT_TOKEN="


def test_the_api_image_does_not_migrate_on_start():
    """A4 §5.16: a schema change is a release step with a backup in front of it."""
    lines = (REPO / "backend" / "Dockerfile").read_text().splitlines()
    instructions = [line for line in lines if line.startswith(("CMD", "ENTRYPOINT"))]
    assert instructions, "the image must declare a start command"
    for line in instructions:
        assert "alembic" not in line, line


def test_production_compose_pins_explicit_image_tags():
    compose = (REPO / "docker-compose.production.yml").read_text()
    assert ":latest" not in compose
    assert "IMAGE_TAG:?" in compose
    for service_image in ("postgres:16.4-alpine", "nginx:1.27.2-alpine"):
        assert service_image in compose


def test_production_compose_keeps_database_and_api_off_public_ports():
    compose = (REPO / "docker-compose.production.yml").read_text()
    db_block = compose.split("  db:", 1)[1].split("\n  api:", 1)[0]
    api_block = compose.split("  api:", 1)[1].split("\n  # The A3 outbox", 1)[0]
    assert "ports: !override []" in db_block
    assert "ports: !override []" in api_block
    # The web container binds to loopback by default, never 0.0.0.0.
    assert "${WEB_BIND:-127.0.0.1}" in compose


def test_production_compose_bounds_every_service():
    compose = (REPO / "docker-compose.production.yml").read_text()
    assert compose.count("mem_limit:") >= 5
    assert compose.count("cpus:") >= 5
    assert "max-size" in compose  # log rotation
    assert "no-new-privileges:true" in compose


def test_nginx_configs_carry_the_required_security_headers():
    for path in ("frontend/nginx.conf", "deploy/nginx/edge.conf"):
        config = (REPO / path).read_text()
        for header in (
            "X-Content-Type-Options",
            "Referrer-Policy",
            "Content-Security-Policy",
            "frame-ancestors 'none'",
        ):
            assert header in config, f"{path} is missing {header}"
        assert "server_tokens off" in config
        assert "client_max_body_size" in config
    edge = (REPO / "deploy/nginx/edge.conf").read_text()
    assert "return 301 https://" in edge
    # HSTS ships commented out on purpose: enabling it before the certificate is right locks
    # browsers out of the site.
    assert "# add_header Strict-Transport-Security" in edge
