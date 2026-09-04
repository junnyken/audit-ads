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
)

#: Values that look like transported credentials regardless of the field name.
_CONNECTION_STRING = re.compile(r"^[a-z][a-z0-9+.\-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE)
_USER_PASS_HOST = re.compile(r"^[^\s:@/]+:[^\s:@/]+@[^\s@/]+(:\d+)?/?$")
_BEARER = re.compile(r"^(bearer|basic)\s+\S+$", re.IGNORECASE)


def is_sensitive_name(name: str) -> bool:
    lowered = name.lower()
    return any(fragment in lowered for fragment in SENSITIVE_NAME_FRAGMENTS)


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
