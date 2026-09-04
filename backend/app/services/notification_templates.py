"""Server-side message rendering (MINI-SPEC A3 §D).

Every message is built here from an allowlist of safe fields. Nothing that reaches Telegram is
copied verbatim from evidence, an audit diff, a provider response or a URL: the template takes
named strings, escapes them, truncates them, and drops anything it was not explicitly given.

The deep link is included only when a public URL is configured and safe. A link to
`127.0.0.1` is useless to whoever receives the message, so an unusable link is omitted rather
than invented.
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse

from app.services.quiet_hours import resolve_timezone

TEMPLATE_VERSION = "a3-v1"

#: Telegram's hard limit is 4096 characters; staying well under it leaves room for truncation
#: markers without ever risking a rejected message.
MAX_MESSAGE_LENGTH = 3500
_FIELD_LIMIT = 300
_SUMMARY_LIMIT = 600

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


@dataclass(frozen=True)
class MessageInputs:
    """The complete allowlist. If a value is not one of these fields, it cannot be sent."""

    severity: str
    alert_title: str
    account_display_name: str
    account_reference: str
    health_status: str
    readiness_status: str
    observed_at: datetime
    safe_summary: str
    recommended_next_step: str
    timezone_name: str | None = None
    dashboard_link: str | None = None

    def to_payload(self) -> dict:
        return {
            "template_version": TEMPLATE_VERSION,
            "severity": self.severity,
            "alert_title": self.alert_title,
            "account_display_name": self.account_display_name,
            "account_reference": self.account_reference,
            "health_status": self.health_status,
            "readiness_status": self.readiness_status,
            "observed_at": self.observed_at.isoformat(),
            "safe_summary": self.safe_summary,
            "recommended_next_step": self.recommended_next_step,
            "timezone": self.timezone_name,
            "dashboard_link": self.dashboard_link,
        }


def sanitise(value: str | None, *, limit: int = _FIELD_LIMIT) -> str:
    """Strip control characters, collapse newlines, and truncate.

    Plain text is sent to Telegram with no parse mode, so there is no markup to escape — but an
    operator note with newlines or control bytes could still deform the message, and a long one
    could push the payload past the limit. Both are handled here rather than trusted.
    """
    if not value:
        return "—"
    cleaned = _CONTROL_CHARS.sub("", str(value)).replace("\r", " ").replace("\n", " ").strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    if not cleaned:
        return "—"
    if len(cleaned) > limit:
        return cleaned[: limit - 1].rstrip() + "…"
    return cleaned


def is_safe_public_url(candidate: str | None) -> bool:
    """A dashboard link must be an absolute http(s) URL that a recipient can actually open."""
    if not candidate:
        return False
    try:
        parsed = urlparse(candidate.strip())
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host in ("localhost", "localhost.localdomain") or host.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return "." in host  # a bare hostname is not reachable outside this network
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
    )


def build_dashboard_link(base_url: str | None, ad_account_id: str | None) -> str | None:
    if not is_safe_public_url(base_url):
        return None
    base = (base_url or "").rstrip("/")
    if ad_account_id:
        return f"{base}/accounts/{ad_account_id}?tab=health"
    return f"{base}/alerts"


def format_observed_at(moment: datetime, timezone_name: str | None) -> str:
    zone = resolve_timezone(timezone_name)
    local = moment.astimezone(zone) if zone else moment
    suffix = timezone_name if zone else "UTC"
    return f"{local.strftime('%Y-%m-%d %H:%M')} ({suffix})"


def render(inputs: MessageInputs) -> str:
    """Render the A3 v1 template. Concise, operational, and free of any safety claim."""
    lines = [
        f"[AdsOps] {sanitise(inputs.severity, limit=32).upper()} — {sanitise(inputs.alert_title)}",
        "",
        f"Account: {sanitise(inputs.account_display_name)} ({sanitise(inputs.account_reference, limit=120)})",
        f"Health: {sanitise(inputs.health_status, limit=48)}",
        f"Readiness: {sanitise(inputs.readiness_status, limit=48)}",
        f"Observed: {format_observed_at(inputs.observed_at, inputs.timezone_name)}",
        "",
        f"Reason: {sanitise(inputs.safe_summary, limit=_SUMMARY_LIMIT)}",
        f"Next step: {sanitise(inputs.recommended_next_step, limit=_SUMMARY_LIMIT)}",
    ]
    if inputs.dashboard_link and is_safe_public_url(inputs.dashboard_link):
        lines += ["", inputs.dashboard_link]

    message = "\n".join(lines)
    if len(message) > MAX_MESSAGE_LENGTH:
        message = message[: MAX_MESSAGE_LENGTH - 1].rstrip() + "…"
    return message
