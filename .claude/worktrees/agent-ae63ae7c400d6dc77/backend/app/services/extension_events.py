"""Event ingestion from the browser extension (A5).

The extension is the least trusted client in this system: its code runs in a page context an
operator did not write, and its token sits in browser storage. So this service treats every
field as a claim to be checked rather than a value to be stored:

* the event type must be on an allowlist — a free string would let a compromised extension
  write something that reads like a system event;
* the severity is decided here, not by the caller;
* the account is resolved from the registry, never taken as an id from the payload;
* the context is filtered through an allowlist before it is stored.

Once past those checks it goes through the *existing* A1 `AccountEventService`, so an extension
event is an ordinary account event with an audit row and a readiness recalculation, and it
appears in the same timeline as everything else.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.enums import (
    EXTENSION_EVENT_SEVERITY,
    EventSeverity,
    EventSource,
    ExtensionContextStatus,
    ExtensionEventType,
    ExtensionPageType,
)
from app.core.errors import ValidationError
from app.models.entities import AccountEvent, AdAccount
from app.services.audit import AuditLogService
from app.services.events import AccountEventService
from app.services.extension_context import sanitise_path

#: Event types that describe a real operator action and therefore require a note. The three
#: context events are automatic breadcrumbs and are allowed to stand alone.
REQUIRES_NOTE = frozenset(
    {
        ExtensionEventType.MANUAL_REVIEW_COMPLETED,
        ExtensionEventType.CAMPAIGN_CHANGE_INTENT,
        ExtensionEventType.CAMPAIGN_CHANGE_COMPLETED,
        ExtensionEventType.ACCOUNT_NOTE_ADDED,
        ExtensionEventType.POLICY_ISSUE_REPORTED,
        ExtensionEventType.PAYMENT_ISSUE_REPORTED,
    }
)

#: The only keys that may be persisted in AccountEvent.source_context_json.
CONTEXT_ALLOWLIST = frozenset(
    {"page_type", "context_status", "safe_path", "extension_version", "external_account_id"}
)

MAX_NOTE_LENGTH = 2000

#: A default sentence for the breadcrumb events, so the timeline reads as prose rather than as
#: an enum dump.
DEFAULT_SUMMARY: dict[str, str] = {
    ExtensionEventType.CONTEXT_CONFIRMED: "Browser context confirmed this account by exact account id.",
    ExtensionEventType.CONTEXT_AMBIGUOUS: "Browser context could not identify the account safely.",
    ExtensionEventType.CONTEXT_UNKNOWN: "Browser context found no registered account for this page.",
    ExtensionEventType.MANUAL_REVIEW_STARTED: "Manual review started from the browser extension.",
}


def build_source_context(
    *,
    page_type: ExtensionPageType | str | None,
    context_status: ExtensionContextStatus | str | None,
    raw_path: str | None,
    extension_version: str,
    external_account_id: str | None,
) -> dict[str, Any]:
    """Everything that is allowed to be stored about where an event came from, and nothing else.

    The path is sanitised here as well as in the browser: the browser side is a convenience,
    this side is the guarantee.
    """
    safe_path, derived_type = sanitise_path(raw_path)
    resolved_type = page_type or derived_type
    context = {
        "page_type": str(getattr(resolved_type, "value", resolved_type) or "unknown"),
        "context_status": str(getattr(context_status, "value", context_status) or "unknown"),
        "safe_path": safe_path,
        "extension_version": extension_version[:32],
        "external_account_id": (external_account_id or None),
    }
    return {key: value for key, value in context.items() if key in CONTEXT_ALLOWLIST}


class ExtensionEventIngestService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.events = AccountEventService(session, workspace_id, audit)

    def ingest(
        self,
        account: AdAccount,
        *,
        event_type: str,
        note: str,
        occurred_at: datetime | None,
        source_context: dict[str, Any],
    ) -> AccountEvent:
        try:
            resolved = ExtensionEventType(event_type)
        except ValueError as exc:
            raise ValidationError(
                "That event type cannot be recorded from the extension.",
                details={"event_type": event_type},
            ) from exc

        cleaned_note = (note or "").strip()
        if resolved in REQUIRES_NOTE and not cleaned_note:
            raise ValidationError(
                "This event records an operator decision, so it needs a short reason.",
                details={"field": "note"},
            )
        if len(cleaned_note) > MAX_NOTE_LENGTH:
            raise ValidationError(f"The note may be at most {MAX_NOTE_LENGTH} characters.")

        summary = cleaned_note or DEFAULT_SUMMARY.get(resolved) or resolved.value.replace("_", " ")
        severity = EventSeverity(EXTENSION_EVENT_SEVERITY.get(resolved, "info"))

        # An extension cannot date an event into the future or rewrite history: an occurred_at
        # outside a small window around now is replaced rather than trusted.
        now = datetime.now(UTC)
        when = occurred_at or now
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when > now or (now - when).total_seconds() > 86_400:
            when = now

        event = self.events.create(
            account,
            event_type=resolved.value,
            severity=severity,
            source=EventSource.CHROME_EXTENSION.value,
            occurred_at=when,
            summary=summary,
            evidence_reference=None,
        )
        event.source_context_json = {
            key: value for key, value in source_context.items() if key in CONTEXT_ALLOWLIST
        }
        self.session.flush()
        return event
