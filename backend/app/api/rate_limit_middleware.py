"""The rate limit, applied to requests.

Policy selection is deliberately small and readable: authentication routes get the strict
bucket, everything else under the API prefix gets the general one, and liveness/readiness get
nothing at all — a limiter that can make a health probe fail turns a busy minute into a
restart loop.

Identity is derived from a **verified** token, never a decoded-but-unverified one. Trusting an
unverified subject would let a caller forge someone else's identity and drain their allowance,
turning the limiter into the denial of service it exists to prevent. A token that does not
verify is simply anonymous, and anonymous callers are limited by address.
"""
from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import Settings
from app.core.errors import error_payload
from app.core.rate_limit import RateLimiter, RateLimitPolicy, client_address
from app.core.security import decode_access_token

logger = logging.getLogger("app.rate_limit")

#: Paths (relative to the API prefix) that exchange a credential. These are the brute-force
#: surface, and they are limited by address because the caller is not yet authenticated.
AUTH_PATH_SUFFIXES = ("/auth/login", "/extension/connect")

#: Never limited. A failing health probe restarts the container, so limiting one converts a
#: traffic spike into an outage.
UNLIMITED_PATH_PREFIXES = ("/health/",)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, settings: Settings, limiter: RateLimiter | None = None) -> None:
        super().__init__(app)
        self._settings = settings
        self._limiter = limiter or RateLimiter()
        count = max(1, settings.rate_limit_process_count)
        self._auth_policy = RateLimitPolicy(
            name="auth",
            limit=settings.rate_limit_auth_attempts,
            window_seconds=float(settings.rate_limit_auth_window_seconds),
        ).scaled(count)
        self._api_policy = RateLimitPolicy(
            name="api",
            limit=settings.rate_limit_api_requests,
            window_seconds=float(settings.rate_limit_api_window_seconds),
        ).scaled(count)

    async def dispatch(self, request: Request, call_next) -> Response:
        policy = self._policy_for(request)
        if policy is None:
            return await call_next(request)

        identity = self._identity_for(request, policy)
        decision = self._limiter.check(policy, identity)
        if not decision.allowed:
            # The log names the policy and the path. It never names the identity: that would
            # write an operator's address or user id into every access log on a busy day, and
            # §26 keeps values out of logs.
            logger.warning(
                "rate limit exceeded",
                extra={"policy": decision.policy_name, "path": request.url.path},
            )
            response = JSONResponse(
                status_code=429,
                content=error_payload(
                    "rate_limited",
                    "Too many requests. Wait a moment and try again.",
                    {"retry_after_seconds": decision.retry_after_seconds},
                ),
            )
            response.headers["Retry-After"] = str(decision.retry_after_seconds)
            self._stamp(response, decision.limit, 0)
            return response

        response = await call_next(request)
        self._stamp(response, decision.limit, decision.remaining)
        return response

    def _policy_for(self, request: Request) -> RateLimitPolicy | None:
        if not self._settings.rate_limit_enabled:
            return None
        path = request.url.path
        if path.startswith(UNLIMITED_PATH_PREFIXES):
            return None
        # A preflight carries no credential and cannot be used to brute-force anything;
        # limiting it would break a legitimate browser client for no security gain.
        if request.method == "OPTIONS":
            return None
        if not path.startswith(self._settings.api_prefix):
            return None
        if any(path.endswith(suffix) for suffix in AUTH_PATH_SUFFIXES):
            return self._auth_policy
        return self._api_policy

    def _identity_for(self, request: Request, policy: RateLimitPolicy) -> str:
        address = client_address(
            peer=request.client.host if request.client else None,
            forwarded_for=request.headers.get("X-Forwarded-For"),
            trusted_proxy_hops=self._settings.rate_limit_trusted_proxy_hops,
        )
        # Credential exchange is always limited by address: there is no trustworthy subject
        # yet, and keying on the submitted email would let anyone lock out a named operator.
        if policy.name == "auth":
            return f"addr:{address}"
        subject = _verified_subject(request.headers.get("Authorization"))
        return f"sub:{subject}" if subject else f"addr:{address}"

    @staticmethod
    def _stamp(response: Response, limit: int, remaining: int) -> None:
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))


def _verified_subject(authorization: str | None) -> str | None:
    """The subject of a signature-verified token, or None.

    Any failure — malformed header, bad signature, expired token — is None. The caller then
    falls back to the address, which is the safe direction: an attacker cannot choose a
    victim's bucket, and a legitimate caller with an expired token is limited slightly more
    tightly for the moment before they notice.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except Exception:
        return None
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        return None
    # An extension installation gets its own bucket. Two browsers signed in as one operator
    # are two clients, and one runaway browser should not starve the other.
    installation = claims.get("installation_id")
    return f"{subject}:{installation}" if isinstance(installation, str) and installation else subject
