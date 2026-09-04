"""The one module in this backend permitted to make an outbound network request.

It talks to exactly one host — the configured Telegram API base — and to nothing else. It never
contacts an advertising platform, and a structural test asserts that no other module imports an
HTTP client.

What leaves this process: a chat id and a rendered message. What never leaves it, and never
enters a log, an audit row or an attempt record: the bot token, the authorization URL, and the
raw response body.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.core.enums import DeliveryFailureCode
from app.services.notification_transport import OutboundMessage, TransportResult

logger = logging.getLogger(__name__)

#: Telegram error descriptions that mean "do not bother retrying".
_FINAL_DESCRIPTION_MARKERS = (
    "chat not found",
    "bot was blocked",
    "user is deactivated",
    "unauthorized",
    "not enough rights",
    "chat_id is empty",
)


@dataclass
class TelegramTransport:
    """Sends through the Bot API `sendMessage` method.

    The token is held in memory for the lifetime of the call and interpolated into the request
    URL, which is why that URL is never logged: it *is* the credential.
    """

    bot_token: str
    api_base_url: str = "https://api.telegram.org"
    timeout_seconds: int = 10
    name: str = "telegram"

    def send(self, message: OutboundMessage) -> TransportResult:
        if not self.bot_token:
            return TransportResult(
                ok=False,
                failure_code=DeliveryFailureCode.TRANSPORT_NOT_CONFIGURED,
                failure_summary="No Telegram bot token is configured on the server.",
            )
        if not message.chat_id:
            return TransportResult(
                ok=False,
                failure_code=DeliveryFailureCode.INVALID_RECIPIENT,
                failure_summary="No Telegram chat is configured for this workspace.",
            )

        url = f"{self.api_base_url.rstrip('/')}/bot{self.bot_token}/sendMessage"
        body = json.dumps(
            {"chat_id": message.chat_id, "text": message.text, "disable_web_page_preview": True}
        ).encode()
        request = urllib.request.Request(  # noqa: S310 - scheme is fixed by configuration
            url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read() or b"{}")
                status = response.status
        except urllib.error.HTTPError as exc:
            return self._from_http_error(exc)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # Network-level problems are transient by nature; the type name is safe to record,
            # the message may contain a host or path and is not.
            logger.warning("notification_failed_transient", extra={"error_type": type(exc).__name__})
            return TransportResult(
                ok=False,
                failure_code=DeliveryFailureCode.NETWORK_ERROR,
                failure_summary=f"Network error contacting Telegram ({type(exc).__name__}).",
            )
        except json.JSONDecodeError:
            return TransportResult(
                ok=False,
                failure_code=DeliveryFailureCode.PROVIDER_SERVER_ERROR,
                failure_summary="Telegram returned a response that could not be read.",
            )

        if payload.get("ok") and isinstance(payload.get("result"), dict):
            message_id = payload["result"].get("message_id")
            return TransportResult(
                ok=True,
                provider_message_id=str(message_id) if message_id is not None else None,
                provider_response_code=status,
            )
        return TransportResult(
            ok=False,
            provider_response_code=status,
            failure_code=DeliveryFailureCode.MESSAGE_REJECTED,
            failure_summary="Telegram did not accept the message.",
        )

    @staticmethod
    def _from_http_error(exc: urllib.error.HTTPError) -> TransportResult:
        """Map an HTTP status to an allowlisted code.

        The provider body is read only to classify the failure, and only a fixed sentence is
        ever returned — the body itself is deliberately discarded.
        """
        description = ""
        try:
            parsed = json.loads(exc.read() or b"{}")
            description = str(parsed.get("description", "")).lower()
        except Exception:  # noqa: BLE001 - a body we cannot parse tells us nothing useful
            description = ""

        if exc.code == 429:
            code = DeliveryFailureCode.RATE_LIMITED
            summary = "Telegram rate-limited this request."
        elif exc.code in (401, 403):
            code = DeliveryFailureCode.UNAUTHORIZED
            summary = "Telegram rejected the bot credentials or blocked the chat."
        elif exc.code >= 500:
            code = DeliveryFailureCode.PROVIDER_SERVER_ERROR
            summary = "Telegram returned a server error."
        elif any(marker in description for marker in _FINAL_DESCRIPTION_MARKERS):
            code = DeliveryFailureCode.INVALID_RECIPIENT
            summary = "The configured Telegram chat is not reachable by this bot."
        else:
            code = DeliveryFailureCode.MESSAGE_REJECTED
            summary = "Telegram rejected the message."
        logger.warning("notification_failed", extra={"failure_code": code.value, "status": exc.code})
        return TransportResult(
            ok=False, provider_response_code=exc.code, failure_code=code, failure_summary=summary
        )


def build_transport(settings):
    """Select the transport from configuration. Disabled unless explicitly turned on."""
    from app.core.enums import NotificationTransportMode
    from app.services.notification_transport import DisabledTransport, get_fake_transport

    mode = settings.notification_transport
    if mode == NotificationTransportMode.FAKE.value:
        return get_fake_transport()
    if mode == NotificationTransportMode.TELEGRAM.value:
        if not settings.telegram_bot_token:
            # Clear, but safe: the process keeps running and every attempt fails with a code
            # that says exactly what is missing, rather than crashing the API on boot.
            logger.critical(
                "telegram transport is enabled but no bot token is configured; delivery is disabled"
            )
            return DisabledTransport()
        return TelegramTransport(
            bot_token=settings.telegram_bot_token,
            api_base_url=settings.telegram_api_base_url,
            timeout_seconds=settings.telegram_timeout_seconds,
        )
    return DisabledTransport()
