"""Transport boundary (MINI-SPEC A3 §D).

One narrow interface separates "decide what to send" from "actually send it". Everything above
this line is deterministic and testable; everything below it is a network call that automated
tests never make.

`FakeNotificationTransport` is what the test suite and the live pilot use. It records what would
have been sent so a pilot can assert on real rendered messages without a real network call.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

from app.core.enums import DeliveryFailureCode

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutboundMessage:
    """Everything a transport is allowed to know. No token, no evidence, no internal ids."""

    chat_id: str
    text: str


@dataclass(frozen=True)
class TransportResult:
    ok: bool
    provider_message_id: str | None = None
    provider_response_code: int | None = None
    failure_code: DeliveryFailureCode | None = None
    #: A short, safe sentence. Never a provider body, never a stack trace.
    failure_summary: str | None = None


class NotificationTransport(Protocol):
    name: str

    def send(self, message: OutboundMessage) -> TransportResult: ...


@dataclass
class FakeNotificationTransport:
    """Records messages instead of sending them.

    `queue_failure` lets a test or a pilot stage a specific failure so retry and final-failure
    paths are exercised for real rather than asserted about.
    """

    name: str = "fake"
    sent: list[OutboundMessage] = field(default_factory=list)
    _staged: list[TransportResult] = field(default_factory=list)

    def queue_failure(self, result: TransportResult) -> None:
        self._staged.append(result)

    def send(self, message: OutboundMessage) -> TransportResult:
        if self._staged:
            staged = self._staged.pop(0)
            logger.info("notification_send_started", extra={"transport": self.name, "staged": True})
            return staged
        self.sent.append(message)
        logger.info("notification_send_started", extra={"transport": self.name})
        return TransportResult(
            ok=True,
            provider_message_id=f"fake-{len(self.sent)}",
            provider_response_code=200,
        )


@dataclass(frozen=True)
class DisabledTransport:
    """The default. Refuses to send and says why, instead of failing obscurely."""

    name: str = "disabled"

    def send(self, message: OutboundMessage) -> TransportResult:
        return TransportResult(
            ok=False,
            failure_code=DeliveryFailureCode.TRANSPORT_NOT_CONFIGURED,
            failure_summary=(
                "Notification transport is disabled. Set NOTIFICATION_TRANSPORT and configure a "
                "bot token to enable delivery."
            ),
        )


#: One shared fake instance so tests and the live pilot can inspect what *would* have been sent.
#: A per-call instance would throw the evidence away the moment the request ended.
_FAKE_TRANSPORT = FakeNotificationTransport()


def get_fake_transport() -> FakeNotificationTransport:
    return _FAKE_TRANSPORT


def reset_fake_transport() -> FakeNotificationTransport:
    _FAKE_TRANSPORT.sent.clear()
    _FAKE_TRANSPORT._staged.clear()
    return _FAKE_TRANSPORT
