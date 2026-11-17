"""A bounded, SSRF-safe HTTP GET for one purpose: fetching a landing page's response metadata
for A6 Preflight checks. Nothing else in this codebase should import this module for a general
"make an outbound request" need — CLAUDE.md rule 20 restricts outbound calls to a named module
per feature, and for A6 this is it.

Four guarantees, all enforced before any byte crosses the wire:
  * only http/https schemes are ever attempted (no file://, ftp://, data:, ...);
  * every hostname is resolved and every resolved address is checked against
    loopback/link-local/private(RFC1918)/multicast/reserved/unspecified ranges *before*
    connecting — for the original URL and for every redirect hop, not just the first one;
  * a hard timeout, a hard redirect cap, and a hard response-byte cap are always active;
  * the response body is read only far enough to run the two safe HTML checks A6 needs
    (viewport meta, contact/policy link) — never persisted, never returned in full.
"""
from __future__ import annotations

import contextlib
import ipaddress
import socket
import time
from dataclasses import dataclass
from enum import Enum
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

DEFAULT_TIMEOUT_SECONDS = 8.0
DEFAULT_MAX_REDIRECTS = 5
DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_SCHEMES = ("http", "https")

_CONTACT_POLICY_HINTS = (
    "contact",
    "liên hệ",
    "lien he",
    "policy",
    "chính sách",
    "chinh sach",
    "privacy",
    "terms",
    "điều khoản",
    "dieu khoan",
)


class FetchOutcome(str, Enum):
    """What the caller should conclude from one fetch attempt.

    `TRANSIENT_ERROR` is deliberately distinct from `UNREACHABLE`/`BLOCKED_UNSAFE`: a timeout
    or a DNS blip is not evidence the page is broken, so the A6 verdict rollup must route it to
    `unknown_missing_evidence`, never to a `landing_page_unreachable` finding (A6 guardrail 16).
    """

    OK = "ok"
    UNREACHABLE = "unreachable"
    BLOCKED_UNSAFE = "blocked_unsafe"
    TRANSIENT_ERROR = "transient_error"


@dataclass(frozen=True)
class SafeFetchResult:
    outcome: FetchOutcome
    url: str
    final_url: str | None = None
    http_status: int | None = None
    is_https: bool = False
    redirect_count: int | None = None
    response_time_ms: int | None = None
    mobile_viewport_meta_present: bool | None = None
    contact_or_policy_link_detected: bool | None = None
    fetch_error: str | None = None


class _UnsafeTarget(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _is_unsafe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_loopback
        or ip.is_link_local
        or ip.is_private
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _assert_safe_host(hostname: str) -> None:
    """Resolve every address for `hostname` and refuse if any one of them is unsafe.

    A hostname can resolve to several addresses (round-robin DNS, dual-stack A+AAAA); refusing
    only the first would leave a bypass. Resolution failure is refused too — an attacker
    controlling DNS can otherwise pass validation and then answer differently at connect time.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        raise _UnsafeTarget(f"dns_resolution_failed: {exc}") from exc
    if not infos:
        raise _UnsafeTarget("dns_resolution_empty")
    for _family, _type, _proto, _canon, sockaddr in infos:
        raw = sockaddr[0]
        ip = ipaddress.ip_address(raw)
        if _is_unsafe_ip(ip):
            raise _UnsafeTarget(f"unsafe_address:{raw}")


def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise _UnsafeTarget(f"unsupported_scheme:{parsed.scheme}")
    if not parsed.hostname:
        raise _UnsafeTarget("missing_host")
    _assert_safe_host(parsed.hostname)


class _SignalScanner(HTMLParser):
    """Extracts exactly two booleans from a bounded HTML fragment. Never stores the markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.has_viewport_meta = False
        self.has_contact_or_policy_link = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k.lower(): (v or "") for k, v in attrs}
        if tag.lower() == "meta" and attrs_dict.get("name", "").lower() == "viewport":
            self.has_viewport_meta = True
        if tag.lower() == "a":
            haystack = (attrs_dict.get("href", "") + " " + attrs_dict.get("title", "")).lower()
            if any(hint in haystack for hint in _CONTACT_POLICY_HINTS):
                self.has_contact_or_policy_link = True

    def handle_data(self, data: str) -> None:
        # A plain-text link label ("Liên hệ") wrapped by an <a> with no matching href/title.
        lowered = data.strip().lower()
        if lowered and any(hint in lowered for hint in _CONTACT_POLICY_HINTS):
            self.has_contact_or_policy_link = True


def safe_fetch(
    url: str,
    *,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
) -> SafeFetchResult:
    try:
        _assert_safe_url(url)
    except _UnsafeTarget as exc:
        return SafeFetchResult(
            outcome=FetchOutcome.BLOCKED_UNSAFE, url=url, fetch_error=exc.reason
        )

    started = time.monotonic()
    current_url = url
    redirect_count = 0

    # Redirects are followed manually, one hop at a time, so every hop is re-validated against
    # the same safety check as the original URL — httpx's built-in redirect following would
    # not re-run our DNS/IP allowlist on each hop.
    with httpx.Client(
        timeout=timeout_seconds, follow_redirects=False, headers={"User-Agent": "AdsOps-Preflight/1"}
    ) as client:
        while True:
            try:
                with client.stream("GET", current_url) as response:
                    if response.is_redirect:
                        redirect_count += 1
                        if redirect_count > max_redirects:
                            return SafeFetchResult(
                                outcome=FetchOutcome.UNREACHABLE,
                                url=url,
                                final_url=current_url,
                                redirect_count=redirect_count,
                                fetch_error="too_many_redirects",
                            )
                        location = response.headers.get("location")
                        if not location:
                            return SafeFetchResult(
                                outcome=FetchOutcome.UNREACHABLE,
                                url=url,
                                final_url=current_url,
                                fetch_error="redirect_without_location",
                            )
                        next_url = urljoin(current_url, location)
                        try:
                            _assert_safe_url(next_url)
                        except _UnsafeTarget as exc:
                            return SafeFetchResult(
                                outcome=FetchOutcome.BLOCKED_UNSAFE,
                                url=url,
                                final_url=next_url,
                                redirect_count=redirect_count,
                                fetch_error=f"redirect_target_{exc.reason}",
                            )
                        current_url = next_url
                        continue

                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) >= max_response_bytes:
                            break
                    elapsed_ms = int((time.monotonic() - started) * 1000)

                    scanner = _SignalScanner()
                    # A malformed fragment must never crash the check — best-effort only.
                    with contextlib.suppress(Exception):
                        scanner.feed(body.decode("utf-8", errors="replace"))

                    final_scheme = urlparse(str(response.url)).scheme
                    is_final_ok = 200 <= response.status_code < 400
                    return SafeFetchResult(
                        outcome=FetchOutcome.OK if is_final_ok else FetchOutcome.UNREACHABLE,
                        url=url,
                        final_url=str(response.url),
                        http_status=response.status_code,
                        is_https=final_scheme == "https",
                        redirect_count=redirect_count,
                        response_time_ms=elapsed_ms,
                        mobile_viewport_meta_present=scanner.has_viewport_meta,
                        contact_or_policy_link_detected=scanner.has_contact_or_policy_link,
                        fetch_error=None if is_final_ok else f"http_status_{response.status_code}",
                    )
            except httpx.TimeoutException as exc:
                return SafeFetchResult(
                    outcome=FetchOutcome.TRANSIENT_ERROR,
                    url=url,
                    final_url=current_url,
                    redirect_count=redirect_count,
                    fetch_error=f"timeout: {exc}",
                )
            except httpx.TransportError as exc:
                return SafeFetchResult(
                    outcome=FetchOutcome.TRANSIENT_ERROR,
                    url=url,
                    final_url=current_url,
                    redirect_count=redirect_count,
                    fetch_error=f"transport_error: {exc}",
                )
