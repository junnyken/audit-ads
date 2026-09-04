"""Unit tests for SensitiveFieldRedactionService (A1 §H)."""
from __future__ import annotations

import pytest

from app.core.redaction import (
    REDACTED,
    find_sensitive_keys,
    is_sensitive_name,
    looks_like_credential_value,
    redact,
)


@pytest.mark.parametrize(
    "name",
    [
        "password",
        "Password",
        "user_passwd",
        "cookie",
        "session_token",
        "access_token",
        "refresh_token",
        "api_secret",
        "credential",
        "Authorization",
        "proxy_url",
        "proxy_username",
        "proxy_password",
    ],
)
def test_sensitive_names_are_detected(name):
    assert is_sensitive_name(name)


@pytest.mark.parametrize("name", ["display_name", "notes", "reference_code", "proxy_reference"])
def test_ordinary_names_are_not_flagged(name):
    assert not is_sensitive_name(name)


def test_nested_sensitive_keys_are_reported_with_paths():
    payload = {"a": {"b": [{"access_token": "x"}]}, "ok": 1}
    assert find_sensitive_keys(payload) == ["a.b[0].access_token"]


def test_redaction_masks_keys_recursively_and_keeps_other_values():
    payload = {"notes": "fine", "nested": {"cookie": "abc", "keep": [1, 2]}}
    assert redact(payload) == {"notes": "fine", "nested": {"cookie": REDACTED, "keep": [1, 2]}}


@pytest.mark.parametrize(
    "value",
    [
        "http://user:pass@gate.example.com:7000",
        "socks5://alice:s3cret@proxy.internal:1080",
        "alice:s3cret@proxy.internal:1080",
        "Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
    ],
)
def test_credential_shaped_values_are_recognised(value):
    assert looks_like_credential_value(value)


@pytest.mark.parametrize(
    "value", ["smartproxy-label-01", "chrome-profile-3", "https://example.test/offer", "PAY-01"]
)
def test_operator_labels_are_not_mistaken_for_credentials(value):
    assert not looks_like_credential_value(value)


def test_credential_shaped_value_is_masked_even_under_an_innocent_key():
    payload = {"proxy_reference": "http://user:pass@gate.example.com:7000"}
    assert redact(payload)["proxy_reference"] == REDACTED
