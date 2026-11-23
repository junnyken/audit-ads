"""Cloudflare Turnstile server-side siteverify transport (hardcoded HTTPS URL)."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

_TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_turnstile_token(
    secret_key: str,
    response_token: str,
    *,
    remote_ip: str | None = None,
    timeout_seconds: int = 8,
) -> tuple[bool, str]:
    """Verify a Cloudflare Turnstile token server-side without ever echoing the secret key."""
    secret = (secret_key or "").strip()
    token = (response_token or "").strip()
    if not secret:
        return True, "disabled"
    if not token:
        return False, "captcha_missing"

    form: dict[str, str] = {"secret": secret, "response": token}
    if remote_ip and remote_ip.strip():
        form["remoteip"] = remote_ip.strip()[:64]

    data_bytes = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310 - scheme & host strictly fixed above
        _TURNSTILE_VERIFY_URL,
        data=data_bytes,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            payload = json.loads((resp.read() or b"{}").decode("utf-8"))
    except urllib.error.HTTPError:
        return False, "turnstile_http_error"
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False, "turnstile_unreachable"

    if isinstance(payload, dict) and payload.get("success") is True:
        return True, "ok"
    return False, "captcha_failed"
