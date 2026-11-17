"""O4 unit and regression tests: the vault, the OAuth state, `resolve_reader`'s precedence, the
Business-Manager-level no-fallback rule, `debug_token` mapping, the transport's two new paths,
and the structural pins (who may decrypt, who may make an outbound request).
"""
from __future__ import annotations

import io
import json
import logging
import pathlib
import re
import urllib.error
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app.core import secret_vault
from app.core.config import Settings
from app.core.enums import ReaderCredentialStatus
from app.core.production_checks import check_settings
from app.services import meta_graph_transport
from app.services.meta_graph_transport import MetaGraphTransport
from app.services.meta_provider import MetaFailureCode
from app.services.meta_reader_credentials import (
    callback_redirect,
    parse_debug_token,
    refusal_reason,
)
from app.services.meta_real_provider import (
    READER_BUSINESS_SPECIFIC,
    READER_SERVER_DEFAULT,
    READER_VAULT,
    READER_VAULT_RECONNECT_REQUIRED,
    build_real_provider,
    resolve_reader,
)

BACKEND_APP = pathlib.Path(__file__).resolve().parents[1] / "app"
TOKEN = "FAKE-TOKEN-unit-0001"


def _settings(**overrides) -> Settings:
    base = {
        "database_url": "postgresql+psycopg://u:p@db/x",
        "jwt_secret": "x" * 40,
        "credential_vault_key": Fernet.generate_key().decode(),
        "meta_app_id": "900",
        "meta_access_token": "server-default-token",
        "meta_access_tokens_by_business": {"222": "bm-specific-token"},
    }
    base.update(overrides)
    return Settings(**base)


def _credential(settings, status=ReaderCredentialStatus.ACTIVE, token=TOKEN):
    return SimpleNamespace(
        status=status,
        archived_at=None,
        encrypted_secret=secret_vault.encrypt_secret(settings, token) if token else None,
    )


# ------------------------------------------------------------------------------ vault


def test_round_trip_and_ciphertext_is_not_the_token():
    settings = _settings()
    ciphertext = secret_vault.encrypt_secret(settings, TOKEN)
    assert TOKEN not in ciphertext
    assert secret_vault.decrypt_secret(settings, ciphertext) == TOKEN


def test_a_missing_or_malformed_key_refuses_and_never_stores_plaintext():
    for key in ("", "not-a-fernet-key"):
        settings = _settings(credential_vault_key=key)
        assert secret_vault.vault_configured(settings) is False
        with pytest.raises(secret_vault.VaultNotConfiguredError) as raised:
            secret_vault.encrypt_secret(settings, TOKEN)
        assert TOKEN not in str(raised.value) and (key or "§") not in str(raised.value)


def test_a_wrong_key_or_tampered_ciphertext_cannot_be_opened():
    stored = secret_vault.encrypt_secret(_settings(), TOKEN)
    with pytest.raises(secret_vault.SecretDecryptionError):
        secret_vault.decrypt_secret(_settings(), stored)
    settings = _settings()
    good = secret_vault.encrypt_secret(settings, TOKEN)
    with pytest.raises(secret_vault.SecretDecryptionError):
        secret_vault.decrypt_secret(settings, good[:-6] + "AAAAAA")


def test_an_empty_credential_is_refused():
    with pytest.raises(ValueError):
        secret_vault.encrypt_secret(_settings(), "")


def test_state_round_trip_ttl_and_tamper(monkeypatch):
    settings = _settings()
    state = secret_vault.sign_state(settings, {"w": "1", "u": "2", "n": "x"})
    assert secret_vault.verify_state(settings, state)["w"] == "1"
    with pytest.raises(secret_vault.StateInvalidError):
        secret_vault.verify_state(settings, state[:-4] + "AAAA")
    with pytest.raises(secret_vault.StateInvalidError):
        secret_vault.verify_state(_settings(), state)  # signed by another key
    with pytest.raises(secret_vault.StateInvalidError):
        secret_vault.verify_state(settings, state, ttl_seconds=-1)
    with pytest.raises(secret_vault.StateInvalidError):
        secret_vault.verify_state(_settings(credential_vault_key=""), state)


def test_only_resolve_reader_and_the_vault_may_decrypt():
    """Rule 1's exception: decryption lives in exactly one call site."""
    callers = [
        path.relative_to(BACKEND_APP).as_posix()
        for path in BACKEND_APP.rglob("*.py")
        if re.search(r"\bdecrypt_secret\s*\(", path.read_text())
    ]
    assert sorted(callers) == ["core/secret_vault.py", "services/meta_real_provider.py"]
    text = (BACKEND_APP / "services/meta_real_provider.py").read_text()
    body = text[text.index("def resolve_reader"):text.index("def build_real_provider")]
    assert "decrypt_secret(" in body
    assert text.count("decrypt_secret(") == 1
    # And only the vault imports the cipher.
    importers = [
        path.relative_to(BACKEND_APP).as_posix()
        for path in BACKEND_APP.rglob("*.py")
        if re.search(r"^\s*(from|import)\s+cryptography", path.read_text(), re.MULTILINE)
    ]
    assert importers == ["core/secret_vault.py"]


# --------------------------------------------------------------------- resolve_reader


def test_no_credential_keeps_the_env_precedence_exactly():
    settings = _settings()
    assert resolve_reader(settings, "222") == ("bm-specific-token", READER_BUSINESS_SPECIFIC)
    assert resolve_reader(settings, "333") == ("server-default-token", READER_SERVER_DEFAULT)


def test_an_active_vault_credential_wins_over_every_server_token():
    settings = _settings()
    assert resolve_reader(settings, "222", credential=_credential(settings)) == (TOKEN, READER_VAULT)
    provider = build_real_provider(settings, business_id="222", credential=_credential(settings))
    assert provider.transport.access_token == TOKEN


@pytest.mark.parametrize(
    "status",
    [
        ReaderCredentialStatus.PENDING_VERIFICATION,
        ReaderCredentialStatus.RECONNECT_REQUIRED,
        ReaderCredentialStatus.REVOKED,
    ],
)
def test_a_vault_credential_that_is_not_active_never_falls_back_to_env(status):
    settings = _settings()
    token, source = resolve_reader(settings, "222", credential=_credential(settings, status))
    assert (token, source) == ("", READER_VAULT_RECONNECT_REQUIRED)


def test_unverified_is_opened_only_when_verification_asks():
    settings = _settings()
    pending = _credential(settings, ReaderCredentialStatus.PENDING_VERIFICATION)
    assert resolve_reader(settings, None, credential=pending, include_unverified=True) == (TOKEN, READER_VAULT)
    revoked = _credential(settings, ReaderCredentialStatus.REVOKED)
    assert resolve_reader(settings, None, credential=revoked, include_unverified=True)[1] == READER_VAULT_RECONNECT_REQUIRED


def test_a_missing_or_changed_key_degrades_to_reconnect_required_not_an_exception():
    settings = _settings()
    credential = _credential(settings)
    for other in (_settings(credential_vault_key=""), _settings()):
        assert resolve_reader(other, "222", credential=credential) == ("", READER_VAULT_RECONNECT_REQUIRED)


# --------------------------------------------------------------------- debug_token mapping


def _data(**fields):
    base = {"app_id": "900", "type": "SYSTEM_USER", "is_valid": True, "expires_at": 0,
            "scopes": ["ads_read", "business_management"], "user_id": "7"}
    base.update(fields)
    return {"data": base}


def test_debug_token_maps_kind_scopes_and_never_expiring():
    facts = parse_debug_token(_data(granular_scopes=[{"scope": "pages_show_list"}, {"scope": "<bad>"}]))
    assert facts.kind.value == "system_user"
    assert facts.expires_at is None
    assert facts.scopes == ["ads_read", "business_management", "pages_show_list"]
    assert parse_debug_token(_data(type="USER", expires_at=1893456000)).expires_at.year == 2030


@pytest.mark.parametrize(
    "fields,reason",
    [
        ({"app_id": "1"}, "app_mismatch"),
        ({"is_valid": False}, "invalid_token"),
        ({"is_valid": False, "error": {"code": 190, "subcode": 460}}, "password_changed"),
        ({"is_valid": False, "error": {"code": 190, "subcode": 459}}, "checkpointed"),
        ({"is_valid": False, "error": {"code": 190, "subcode": 458}}, "app_not_installed"),
        ({"is_valid": False, "error": {"code": 190, "subcode": 463}}, "expired"),
        ({"scopes": ["ads_read"]}, "scope_missing"),
        ({"scopes": ["ads_read", "business_management", "ads_management"]}, "scope_too_broad"),
        ({"scopes": ["ads_management"]}, "scope_too_broad"),
        ({}, None),
    ],
)
def test_refusal_reasons(fields, reason):
    facts = parse_debug_token(_data(**fields))
    assert refusal_reason(facts, _settings(), now=datetime.now(UTC)) == reason


def test_the_redirect_never_echoes_an_unknown_reason():
    url = callback_redirect(_settings(public_app_url="https://app.example.com"), ok=False, reason="whatever<x>", credential_id=None)
    assert url == "https://app.example.com/settings?meta_login=error&reason=token_check_failed#meta-readers"


# ------------------------------------------------------------------------ transport


class _Response(io.BytesIO):
    headers: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_the_code_exchange_may_go_without_a_bearer_and_nothing_else_may(monkeypatch):
    seen = []

    def fake_urlopen(request, timeout):
        seen.append(request)
        return _Response(b'{"access_token":"FAKE-TOKEN-x"}')

    monkeypatch.setattr(meta_graph_transport.urllib.request, "urlopen", fake_urlopen)
    transport = MetaGraphTransport(access_token="")
    assert transport.get("oauth/access_token", {"code": "c", "client_secret": "s"}).ok
    assert "Authorization" not in seen[0].headers
    refused = transport.get("debug_token", {"input_token": "t"})
    assert refused.ok is False and refused.failure_code == MetaFailureCode.PERMISSION_MISSING
    assert len(seen) == 1
    # Still no new method: GET, and the one narrow POST.
    public = {name for name in dir(MetaGraphTransport) if not name.startswith("_")}
    assert public == {"get", "post", "api_base_url", "api_version", "timeout_seconds"}


def test_the_two_credential_paths_never_reach_a_log_line(monkeypatch, caplog):
    secrets_in_url = {
        "client_secret": "o4-unit-app-secret",
        "code": "o4-unit-code",
        "fb_exchange_token": "FAKE-TOKEN-exchange",
        "input_token": "FAKE-TOKEN-input",
    }
    body = json.dumps({"error": {"code": 190, "error_subcode": 460, "message": "leaks o4-unit-code"}}).encode()

    def failing(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 400, "Bad", {}, io.BytesIO(body))

    monkeypatch.setattr(meta_graph_transport.urllib.request, "urlopen", failing)
    caplog.set_level(logging.DEBUG)
    transport = MetaGraphTransport(access_token="900|o4-unit-app-secret")
    for path in ("oauth/access_token", "debug_token"):
        response = transport.get(path, secrets_in_url)
        assert response.failure_code == MetaFailureCode.TOKEN_EXPIRED
        assert (response.graph_error_code, response.graph_error_subcode) == (190, 460)
        assert all(value not in (response.failure_summary or "") for value in secrets_in_url.values())

    def unreachable(request, timeout):
        raise urllib.error.URLError(f"cannot reach {request.full_url}")

    monkeypatch.setattr(meta_graph_transport.urllib.request, "urlopen", unreachable)
    transport.get("debug_token", secrets_in_url)
    text = caplog.text + " ".join(str(r.__dict__) for r in caplog.records)
    for value in [*secrets_in_url.values(), "oauth/access_token", "debug_token", "graph.facebook.com"]:
        assert value not in text


def test_uvicorn_access_lines_lose_their_query_string():
    from app.core.logging import StripQueryStringFilter

    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4", "GET", "/api/v1/meta-reader-credentials/callback?code=abc&state=def", "1.1", 302), None,
    )
    StripQueryStringFilter().filter(record)
    assert "code=abc" not in record.getMessage()
    assert "/api/v1/meta-reader-credentials/callback" in record.getMessage()


# ------------------------------------------------------------------- configuration findings


def test_configuration_findings_name_codes_never_values():
    settings = _settings(
        environment="production",
        meta_app_id="900",
        meta_app_secret="change-me",
        meta_login_config_id="1",
        meta_oauth_redirect_uri="http://insecure.example.com/cb",
        credential_vault_key="not-a-key",
    )
    findings = {f.code: f for f in check_settings(settings)}
    assert {"meta_app_secret_placeholder", "credential_vault_key_unusable", "meta_oauth_redirect_not_https"} <= set(findings)
    for finding in findings.values():
        assert "change-me" not in finding.message and "not-a-key" not in finding.message
    partial = {f.code for f in check_settings(_settings(meta_app_id="900", meta_app_secret=""))}
    assert "meta_login_partially_configured" in partial
