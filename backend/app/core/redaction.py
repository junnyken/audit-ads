"""SensitiveFieldRedactionService (A1 §E, §H).

Two jobs, deliberately separated:

* **Rejection** — a request that carries a secret-bearing field never becomes stored data.
  The API refuses it (422) instead of silently dropping it, so the operator learns that the
  field is not supported rather than believing it was saved.
* **Redaction** — anything that reaches a log line or an audit diff is walked recursively and
  masked. The backend is the final enforcement point; client-side omission is not trusted.
"""
from __future__ import annotations

import re
from typing import Any

REDACTED = "[REDACTED]"

#: A field is sensitive when its name *contains* any of these (case-insensitive).
SENSITIVE_NAME_FRAGMENTS: tuple[str, ...] = (
    "password",
    "passwd",
    "cookie",
    "session",
    "token",
    "secret",
    "credential",
    "authorization",
    "auth_header",
    "proxy_url",
    "proxy_username",
    "proxy_password",
    "private_key",
    "api_key",
    "apikey",
    "access_key",
    # F1: the stored email's ciphertext and the reveal-PIN hash never reach an audit diff.
    "ciphertext",
    "pin_hash",
)

#: F1. Short names that would match far too much as fragments ("pin" is in "mapping", "otp" in
#: "otpauth" is fine but "seed" is in "seeded"), so these match the **whole** name, or a
#: `_`-separated suffix (`new_pin`, `backup_code`).
SENSITIVE_EXACT_NAMES: frozenset[str] = frozenset(
    {
        "pin",
        "otp",
        "totp",
        "mfa",
        "mfa_code",
        "2fa",
        "2fa_code",
        "two_factor_code",
        "otp_code",
        "verification_code",
        "recovery_code",
        "backup_code",
        "backup_codes",
        "seed",
    }
)
_SENSITIVE_SUFFIXES: tuple[str, ...] = ("_pin", "_otp", "_totp", "_mfa_code", "_2fa", "_backup_code")

#: Values that look like transported credentials regardless of the field name.
_CONNECTION_STRING = re.compile(r"^[a-z][a-z0-9+.\-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE)
_USER_PASS_HOST = re.compile(r"^[^\s:@/]+:[^\s:@/]+@[^\s@/]+(:\d+)?/?$")
_BEARER = re.compile(r"^(bearer|basic)\s+\S+$", re.IGNORECASE)


def is_sensitive_name(name: str) -> bool:
    lowered = name.lower()
    if lowered in SENSITIVE_EXACT_NAMES or lowered.endswith(_SENSITIVE_SUFFIXES):
        return True
    return any(fragment in lowered for fragment in SENSITIVE_NAME_FRAGMENTS)


# F1. Free text an operator types about a Facebook account (where the password is kept, how to
# recover it) must never become the password or the second factor itself. These are heuristics with
# a bias to refuse: a refused note is retyped, a stored password is a breach.
_LABELLED_SECRET = re.compile(
    r"(?:password|passwd|pass|pwd|pw|mk|m\u1eadt\s*kh\u1ea9u|mat\s*khau|2fa|otp|totp|pin)\s*[:=]\s*\S+",
    re.IGNORECASE,
)
_STANDALONE_CODE = re.compile(r"(?<![\d.,/-])\d{6,8}(?![\d.,/-])")
_BASE32_SEED = re.compile(r"(?<![A-Z2-7])(?:[A-Z2-7]{4}\s?){4,}(?![A-Z2-7])")
_OTPAUTH = re.compile(r"otpauth://", re.IGNORECASE)


def looks_like_login_secret(value: object) -> bool:
    """True when free text seems to carry a password, a one-time code or a 2FA seed.

    Phone numbers (9+ digits) and ids are not codes; a 6-8 digit run standing alone is.
    """
    if not isinstance(value, str) or not value.strip():
        return False
    text = value.strip()
    return bool(
        looks_like_credential_value(text)
        or _LABELLED_SECRET.search(text)
        or _STANDALONE_CODE.search(text)
        or _BASE32_SEED.search(text)
        or _OTPAUTH.search(text)
    )


def looks_like_credential_value(value: object) -> bool:
    """True when a plain string smells like a credential-bearing connection string."""
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate or len(candidate) > 512:
        return bool(candidate)
    return bool(
        _CONNECTION_STRING.match(candidate)
        or _USER_PASS_HOST.match(candidate)
        or _BEARER.match(candidate)
    )


def find_sensitive_keys(payload: Any, *, _path: str = "") -> list[str]:
    """Return dotted paths of every sensitive key found in a nested payload."""
    found: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            path = f"{_path}.{key}" if _path else str(key)
            if isinstance(key, str) and is_sensitive_name(key):
                found.append(path)
                continue
            found.extend(find_sensitive_keys(value, _path=path))
    elif isinstance(payload, list | tuple):
        for index, item in enumerate(payload):
            found.extend(find_sensitive_keys(item, _path=f"{_path}[{index}]"))
    return found


def redact(payload: Any, *, _depth: int = 0) -> Any:
    """Recursively mask sensitive keys and credential-looking values."""
    if _depth > 12:
        return REDACTED
    if isinstance(payload, dict):
        result: dict[str, Any] = {}
        for key, value in payload.items():
            if isinstance(key, str) and is_sensitive_name(key) or looks_like_credential_value(value):
                result[key] = REDACTED
            else:
                result[key] = redact(value, _depth=_depth + 1)
        return result
    if isinstance(payload, list | tuple):
        return [redact(item, _depth=_depth + 1) for item in payload]
    return payload
