"""The third — and, at the time of writing, last — module in this backend permitted to make an
outbound network request. A10.

It talks to exactly one host: the configured Meta Graph API base. Until A10.2 it performed GET
requests only, and that was what made A10's "read-only" claim structural rather than a promise.

A10.2 removed that barrier deliberately, and as narrowly as it could be removed. There is now
exactly one write method, `post()`, and it refuses every path except `{business-id}/adaccount`.
The distinction is the whole point: a transport that can POST *anywhere* is a far larger surface
than one that can create *one kind of thing*. PATCH and DELETE remain absent — nothing here can
modify or remove anything that already exists on Meta.

What leaves this process: a Graph path, a pinned API version, and the access token in the
`Authorization` header. What never enters a log, an audit row or an API response: the token
itself, the full request URL (it carries query parameters that may identify a BM), and the raw
response body.

Stdlib `urllib.request` on purpose, matching `telegram_transport.py`: no new dependency enters
the production image for this, and `test_alert_security.py` names both modules explicitly.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from app.services.meta_provider import MetaFailureCode

logger = logging.getLogger(__name__)

#: Graph error codes that mean the token is finished, not that the call should be retried.
#: 190 covers expired/invalid/revoked tokens; 102 is a session problem of the same family.
_TOKEN_ERROR_CODES = {102, 190}
#: Graph's own rate-limit families: 4 (app), 17 (user), 32 (page), 613 (custom-rate).
_RATE_LIMIT_CODES = {4, 17, 32, 613}
#: Missing permission / not allowed on this object.
_PERMISSION_ERROR_CODES = {10, 200, 299, 3, 33}
#: A10.2. Billing must be configured on a Business Manager before it may hold a new ad account.
#: Mapped to its own code so an operator is told to go fix billing, rather than being handed a
#: generic "invalid request" for a condition with an obvious remedy.
_BILLING_ERROR_CODES = {2500, 1487742}

#: The only Graph path this transport may POST to, anchored at both ends. A Business Manager id
#: is a bare number, so the pattern is exact rather than a prefix check — `12/adaccount/../me`
#: and `12/adaccountsomethingelse` both fail it.
_WRITABLE_PATH = re.compile(r"^\d{1,30}/adaccount$")


@dataclass(frozen=True)
class GraphResponse:
    """A typed outcome, never a raised exception — the same contract the batch engine's failure
    vocabulary already expects. `ok=False` always carries a `failure_code`."""

    ok: bool
    payload: dict[str, Any] = field(default_factory=dict)
    failure_code: MetaFailureCode | None = None
    failure_summary: str | None = None
    #: Whatever Meta told us about our remaining budget, when it tells us. Observability only —
    #: nothing in this build throttles itself on it, and pretending otherwise would be a lie.
    rate_limit_header: str | None = None


@dataclass
class MetaGraphTransport:
    """GET-only client for the Graph API.

    `access_token` is held in memory for the lifetime of a call and sent as a bearer header
    rather than a query parameter, so it does not end up in an intermediary's access log.
    """

    access_token: str
    api_base_url: str = "https://graph.facebook.com"
    api_version: str = "v21.0"
    timeout_seconds: int = 15

    def get(self, path: str, params: dict[str, str] | None = None) -> GraphResponse:
        """Issue one GET. `path` is a Graph path such as `me/businesses`, never a full URL —
        a caller cannot redirect this transport at another host."""
        if not self.access_token:
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.PERMISSION_MISSING,
                failure_summary="No Meta access token is configured on the server.",
            )

        url = self._build_url(path, params)
        request = urllib.request.Request(  # noqa: S310 - scheme and host are fixed by configuration
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
                return GraphResponse(
                    ok=True,
                    payload=body if isinstance(body, dict) else {"data": body},
                    rate_limit_header=response.headers.get("X-Business-Use-Case-Usage"),
                )
        except urllib.error.HTTPError as exc:
            return self._from_http_error(exc)
        except TimeoutError:
            # Deliberately `TIMEOUT`, which the batch engine treats as `unknown` and never
            # auto-retries. Irrelevant for a GET, but the mapping stays honest either way.
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.TIMEOUT,
                failure_summary="The Meta API did not respond in time.",
            )
        except (urllib.error.URLError, OSError) as exc:
            logger.warning("meta graph request failed", extra={"context": {"reason": type(exc).__name__}})
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.PROVIDER_SERVER_ERROR,
                failure_summary="The Meta API could not be reached.",
            )

    def post(self, path: str, data: dict[str, str]) -> GraphResponse:
        """Issue one POST. The **only** write this backend can make against Meta.

        `path` must be exactly `{business-id}/adaccount`; anything else raises before a socket is
        opened. That is deliberate and structural: A10 made read-only a property of the type
        rather than a setting, and A10.2 narrows rather than abandons that idea — this transport
        can create one kind of thing, and cannot modify or delete anything at all.

        A refusal here is a programming error, not an operational one, so it raises rather than
        returning a failed `GraphResponse`. A failed response would flow into the batch engine's
        vocabulary as though Meta had answered, and nothing was sent.

        Body fields go in the form-encoded body, not the query string: a URL ends up in
        intermediaries' access logs, and these fields name a Business Manager.
        """
        if not _WRITABLE_PATH.match(path.strip("/")):
            raise ValueError("This transport may only POST to {business-id}/adaccount.")
        if not self.access_token:
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.PERMISSION_MISSING,
                failure_summary="No Meta access token is configured on the server.",
            )

        body = urllib.parse.urlencode(data).encode("utf-8")
        request = urllib.request.Request(  # noqa: S310 - scheme and host are fixed by configuration
            self._build_url(path, None),
            method="POST",
            data=body,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
                return GraphResponse(
                    ok=True,
                    payload=payload if isinstance(payload, dict) else {"data": payload},
                    rate_limit_header=response.headers.get("X-Business-Use-Case-Usage"),
                )
        except urllib.error.HTTPError as exc:
            return self._from_http_error(exc)
        except TimeoutError:
            # The case this whole product is most careful about. A timed-out create may have
            # succeeded on Meta's side, so `TIMEOUT` maps to `unknown` in the batch engine, which
            # never auto-retries it — a blind retry here would create a second real ad account.
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.TIMEOUT,
                failure_summary="The Meta API did not respond in time. The account may or may not have been created.",
            )
        except (urllib.error.URLError, OSError) as exc:
            # Also `unknown`, and for the same reason: a connection that dropped mid-request
            # cannot prove the request never arrived.
            logger.warning("meta graph write failed", extra={"context": {"reason": type(exc).__name__}})
            return GraphResponse(
                ok=False,
                failure_code=MetaFailureCode.TIMEOUT,
                failure_summary="The Meta API could not be reached. The account may or may not have been created.",
            )

    def _build_url(self, path: str, params: dict[str, str] | None) -> str:
        safe_path = path.strip("/")
        base = f"{self.api_base_url.rstrip('/')}/{self.api_version}/{safe_path}"
        if params:
            base = f"{base}?{urllib.parse.urlencode(params)}"
        return base

    @staticmethod
    def _from_http_error(exc: urllib.error.HTTPError) -> GraphResponse:
        """Map Graph's error envelope onto this product's own failure vocabulary.

        The raw body is parsed but never returned or logged: it can echo request parameters
        back, and those may name a Business Manager.
        """
        code: int | None = None
        try:
            body = json.loads(exc.read().decode("utf-8") or "{}")
            error = body.get("error", {}) if isinstance(body, dict) else {}
            code = error.get("code")
        except (ValueError, AttributeError, OSError):
            pass

        rate_header = exc.headers.get("X-Business-Use-Case-Usage") if exc.headers else None

        if code in _TOKEN_ERROR_CODES or exc.code == 401:
            failure = MetaFailureCode.TOKEN_EXPIRED
            summary = "The Meta access token is expired or no longer valid."
        elif code in _RATE_LIMIT_CODES or exc.code == 429:
            failure = MetaFailureCode.RATE_LIMITED
            summary = "The Meta API rate limit was reached."
        elif code in _PERMISSION_ERROR_CODES or exc.code == 403:
            failure = MetaFailureCode.PERMISSION_MISSING
            summary = "The Meta token does not have permission for this."
        elif exc.code >= 500:
            failure = MetaFailureCode.PROVIDER_SERVER_ERROR
            summary = "The Meta API returned a server error."
        elif code in _BILLING_ERROR_CODES:
            failure = MetaFailureCode.BILLING_REQUIRED
            summary = "The Business Manager needs billing configured before it can hold this."
        elif exc.code == 400:
            failure = MetaFailureCode.INVALID_REQUEST
            summary = "The Meta API rejected the request as invalid."
        else:
            failure = MetaFailureCode.UNKNOWN_ERROR
            summary = "The Meta API returned an unexpected error."

        # Meta's own `error.message` is deliberately parsed and dropped: it echoes request
        # parameters back, which may name a Business Manager. The mapped code is enough.
        logger.info(
            "meta graph error",
            extra={"context": {"http_status": exc.code, "graph_code": code, "mapped": failure.value}},
        )
        return GraphResponse(
            ok=False, failure_code=failure, failure_summary=summary, rate_limit_header=rate_header
        )
