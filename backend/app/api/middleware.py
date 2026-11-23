from __future__ import annotations

import logging
import re
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.context import set_request_id
from app.core.errors import error_payload

_AI_SCRAPER_UA_RE = re.compile(
    r"(gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|"
    r"perplexitybot|ccbot|google-extended|bytespider|firecrawl|jinabot|diffbot|"
    r"cohere-ai|scrapy|httrack|headlesschrome|phantomjs)",
    re.IGNORECASE,
)


class AntiScraperBotMiddleware:
    """Block known AI training crawlers, LLM scrapers, and headless browsers with 403."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http":
            path = str(scope.get("path") or "")
            if not path.startswith("/health/"):
                headers = dict(scope.get("headers") or [])
                ua = (headers.get(b"user-agent") or b"").decode("latin-1", errors="ignore")
                if ua and _AI_SCRAPER_UA_RE.search(ua):
                    resp = JSONResponse(
                        status_code=403,
                        content=error_payload(
                            "bot_access_denied",
                            "Automated AI scraping and headless harvesting are prohibited.",
                        ),
                    )
                    await resp(scope, _empty_receive, send)
                    return
        await self.app(scope, receive, send)

logger = logging.getLogger("app.request")

REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns a correlation id, echoes it back, and logs one structured line per request.

    The line carries method, path, status and duration only — never query values or bodies,
    which is what keeps a mistyped credential out of the access log.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = set_request_id(request.headers.get(REQUEST_ID_HEADER))
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "request failed",
                extra={"method": request.method, "path": request.url.path},
            )
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers[REQUEST_ID_HEADER] = request_id
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response


class _PayloadTooLargeError(Exception):
    pass


class MaxBodySizeMiddleware:
    """Enforce maximum request body size without buffering unbounded payloads into RAM."""

    def __init__(self, app, *, max_body_bytes: int = 2 * 1024 * 1024) -> None:
        self.app = app
        self.max_body_bytes = max(1024, int(max_body_bytes))

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        raw_cl = headers.get(b"content-length")
        if raw_cl:
            try:
                if int(raw_cl.decode("ascii")) > self.max_body_bytes:
                    await self._send_413(scope, send)
                    return
            except ValueError:
                pass

        received_bytes = 0
        response_started = False
        sent_413 = False

        async def wrapped_send(message):
            nonlocal response_started
            if sent_413:
                return
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        async def bounded_receive():
            nonlocal received_bytes, sent_413
            message = await receive()
            if message.get("type") == "http.request":
                body = message.get("body") or b""
                received_bytes += len(body)
                if received_bytes > self.max_body_bytes:
                    if not response_started and not sent_413:
                        sent_413 = True
                        await self._send_413(scope, send)
                    raise _PayloadTooLargeError()
            return message

        try:
            await self.app(scope, bounded_receive, wrapped_send)
        except _PayloadTooLargeError:
            if not response_started and not sent_413:
                sent_413 = True
                await self._send_413(scope, send)

    async def _send_413(self, scope, send) -> None:
        resp = JSONResponse(
            status_code=413,
            content=error_payload(
                "payload_too_large",
                "Request payload exceeds maximum allowed size.",
                {"max_bytes": self.max_body_bytes},
            ),
        )
        await resp(scope, _empty_receive, send)


async def _empty_receive():
    return {"type": "http.disconnect"}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        response.headers.setdefault("X-Robots-Tag", "noindex, nofollow, noai, noimageai")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'",
        )
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault(
            "Permissions-Policy",
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
        )
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        return response
