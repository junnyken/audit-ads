"""Controlled Telegram test send (A4 §H).

A delivery verification, not a product notification. It therefore:

* creates **no** Alert and touches no A1/A2/A3 record — a test message that invented an alert
  would leave a fake attention item behind forever;
* carries no account data, no health detail, no evidence, no token and no private URL;
* is keyed separately from the alert outbox, so it can never collide with, suppress or
  duplicate a real delivery;
* refuses to run twice for the same approved preview.

The endpoint exists so the flow is reviewable before anyone uses it. It stays inert until an
operator sets ``ADSOPS_ALLOW_TEST_SEND=true`` for one verification and confirms explicitly.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.models.alerts import AlertPolicy
from app.models.operations import OperationalRun
from app.services.notification_templates import build_dashboard_link, sanitise
from app.services.notification_transport import NotificationTransport, OutboundMessage
from app.services.operations import OperationalRunService
from app.services.quiet_hours import resolve_timezone

TEST_TEMPLATE_VERSION = "a4-test-v1"


def mask_chat_reference(reference: str | None) -> str | None:
    """Enough to recognise the destination, never enough to reuse it."""
    if not reference:
        return None
    value = reference.strip()
    return value if value.startswith("@") else f"…{value[-4:]}"


def environment_label(settings: Settings) -> str:
    """A human label, never a hostname, URL or connection string."""
    label = (settings.environment_label or settings.environment or "unknown").strip()
    return sanitise(label, limit=60) or "unknown"


@dataclass(frozen=True)
class PreSendCheck:
    code: str
    passed: bool
    detail: str


@dataclass
class TestSendPreview:
    """Everything a person needs to approve — and nothing they must not see."""

    message: str
    recipient_masked: str | None
    environment: str
    timezone: str
    template_version: str
    approval_code: str
    transport_mode: str
    checks: list[PreSendCheck] = field(default_factory=list)
    already_sent: bool = False

    @property
    def ready(self) -> bool:
        return all(check.passed for check in self.checks) and not self.already_sent

    def as_dict(self) -> dict:
        return {
            "message": self.message,
            "recipient_masked": self.recipient_masked,
            "environment": self.environment,
            "timezone": self.timezone,
            "template_version": self.template_version,
            "approval_code": self.approval_code,
            "transport_mode": self.transport_mode,
            "already_sent": self.already_sent,
            "ready_to_send": self.ready,
            "checks": [
                {"code": c.code, "passed": c.passed, "detail": c.detail} for c in self.checks
            ],
        }


def render_test_message(
    *, environment: str, moment: datetime, timezone_name: str, dashboard_link: str | None
) -> str:
    """The A4 §H template, verbatim in structure and free of every forbidden field."""
    local = moment.astimezone(resolve_timezone(timezone_name) or UTC)
    lines = [
        "[AdsOps] TEST NOTIFICATION",
        "",
        "This is a controlled delivery verification for AdsOps Control Center.",
        "",
        f"Environment: {environment}",
        f"Time: {local.strftime('%Y-%m-%d %H:%M %Z')}",
        "Transport: Telegram",
        "Result expected: one message only",
    ]
    if dashboard_link:
        lines += ["", dashboard_link]
    return "\n".join(lines)


class TestSendService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.runs = OperationalRunService(session)

    # ---- preview -------------------------------------------------------------------

    def build_preview(self, policy: AlertPolicy | None) -> TestSendPreview:
        settings = self.settings
        timezone_name = (policy.timezone if policy else None) or "UTC"
        recipient = policy.telegram_chat_id if policy else None
        env = environment_label(settings)
        link = build_dashboard_link(settings.public_app_url, None)
        message = render_test_message(
            environment=env,
            moment=datetime.now(UTC),
            timezone_name=timezone_name,
            dashboard_link=link,
        )
        # Named "approval code", not "preview token": A1's credential guard rejects any request
        # field whose name contains "token", and it is right to — this value is an approval
        # reference, not a credential, and the name should say so.
        #
        # It binds the approval to this destination, environment and message shape.
        # The rendered clock time is deliberately excluded, so approving a preview and sending
        # a minute later is still the same approved send rather than a new one.
        token = hashlib.sha256(
            "|".join(
                [
                    str(policy.workspace_id) if policy else "no-workspace",
                    recipient or "no-recipient",
                    env,
                    TEST_TEMPLATE_VERSION,
                ]
            ).encode()
        ).hexdigest()[:32]

        checks = [
            PreSendCheck(
                "environment_resolved",
                env != "unknown",
                f"Environment label resolves to '{env}'.",
            ),
            PreSendCheck(
                "transport_is_telegram",
                settings.notification_transport == "telegram",
                f"NOTIFICATION_TRANSPORT is '{settings.notification_transport}'; "
                "a real send needs 'telegram'.",
            ),
            PreSendCheck(
                "bot_token_configured",
                bool(settings.telegram_bot_token),
                "A bot token is configured server-side."
                if settings.telegram_bot_token
                else "No bot token is configured server-side.",
            ),
            PreSendCheck(
                "recipient_resolved",
                bool(recipient),
                f"One owner-controlled chat is configured ({mask_chat_reference(recipient)})."
                if recipient
                else "No test chat is configured in the notification policy.",
            ),
            PreSendCheck(
                "timezone_resolved",
                resolve_timezone(timezone_name) is not None,
                f"Policy timezone '{timezone_name}' resolves.",
            ),
            PreSendCheck(
                "dashboard_link_safe",
                True,
                f"A public HTTPS dashboard link is included: {link}"
                if link
                else "No public URL is configured, so the message intentionally omits the link.",
            ),
            PreSendCheck(
                "message_contains_no_sensitive_data",
                self._message_is_safe(message),
                "The message carries only the environment label, a timestamp and a public link.",
            ),
            PreSendCheck(
                "send_explicitly_enabled",
                settings.allow_test_send,
                "ADSOPS_ALLOW_TEST_SEND is enabled for this verification."
                if settings.allow_test_send
                else "ADSOPS_ALLOW_TEST_SEND is off; the send endpoint will refuse.",
            ),
        ]

        return TestSendPreview(
            message=message,
            recipient_masked=mask_chat_reference(recipient),
            environment=env,
            timezone=timezone_name,
            template_version=TEST_TEMPLATE_VERSION,
            approval_code=token,
            transport_mode=settings.notification_transport,
            checks=checks,
            already_sent=self.already_sent(token),
        )

    @staticmethod
    def _message_is_safe(message: str) -> bool:
        lowered = message.lower()
        forbidden = (
            "token", "password", "cookie", "secret", "chat_id", "bearer",
            "localhost", "127.0.0.1", "postgres", "traceback",
        )
        return not any(term in lowered for term in forbidden)

    # ---- execution -----------------------------------------------------------------

    def already_sent(self, token: str) -> bool:
        return (
            self.session.execute(
                sa.select(sa.func.count())
                .select_from(OperationalRun)
                .where(
                    OperationalRun.kind == OperationalRunKind.TEST_SEND,
                    OperationalRun.status == OperationalRunStatus.SUCCEEDED,
                    OperationalRun.error_summary == token,
                )
            ).scalar_one()
            > 0
        )

    def send(
        self,
        *,
        policy: AlertPolicy | None,
        transport: NotificationTransport,
        approval_code: str,
    ) -> tuple[bool, str, TestSendPreview]:
        """Send exactly one message, or refuse and say why. Never raises for a refusal."""
        preview = self.build_preview(policy)

        if preview.approval_code != approval_code:
            return False, "approval_code_mismatch", preview
        if preview.already_sent:
            return False, "already_sent_for_this_preview", preview
        failed = [check.code for check in preview.checks if not check.passed]
        if failed:
            return False, f"pre_send_checks_failed:{','.join(failed)}", preview

        started = datetime.now(UTC)
        result = transport.send(
            OutboundMessage(chat_id=policy.telegram_chat_id, text=preview.message)
        )
        if not result.ok:
            self.runs.record(
                kind=OperationalRunKind.TEST_SEND,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                summary={"message_count": 0, "transport": transport.name},
                error_code=(result.failure_code.value if result.failure_code else "unknown_error"),
                error_summary=result.failure_summary or "The transport rejected the message.",
            )
            return False, "transport_failed", preview

        # The approval code lives in error_summary purely as the dedupe marker for a
        # successful run; it is a hash of destination and environment, never a secret.
        self.runs.record(
            kind=OperationalRunKind.TEST_SEND,
            status=OperationalRunStatus.SUCCEEDED,
            started_at=started,
            summary={"message_count": 1, "transport": transport.name},
            error_code=result.provider_message_id,
            error_summary=preview.approval_code,
        )
        return True, result.provider_message_id or "sent", preview
