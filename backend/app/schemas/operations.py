"""A4 operational schemas.

Every field here is safe to render on a screen an operator leaves open: counters, bands,
booleans and masked references. No path, no host, no credential.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.common import StrictPayload


class OperationalRunOut(BaseModel):
    id: str
    kind: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    summary: dict[str, Any] = {}
    error_code: str | None = None
    release_version: str | None = None


class OperationsOverviewOut(BaseModel):
    release_version: str
    application_version: str
    environment: str
    server_time: datetime
    database_status: str
    migration_revision: str | None
    api_status: str

    notification_transport: str
    telegram_transport_configured: bool
    test_send_enabled: bool

    #: "current" | "stale" | "never" — never collapsed into a single healthy/unhealthy flag.
    dispatcher_state: str
    dispatcher_last_run: OperationalRunOut | None = None
    dispatcher_last_success_at: datetime | None = None
    due_delivery_count: int
    failed_final_delivery_count: int
    oldest_due_delivery_at: datetime | None = None
    oldest_due_delivery_minutes: float | None = None

    backup_state: str
    backup_last_success_at: datetime | None = None
    backup_last_run: OperationalRunOut | None = None
    restore_drill_last_run: OperationalRunOut | None = None
    migration_last_run: OperationalRunOut | None = None

    host: dict[str, Any]
    host_bands: dict[str, str]
    thresholds: dict[str, float]


class ConfigurationFindingOut(BaseModel):
    code: str
    severity: str
    message: str


class ConfigurationReportOut(BaseModel):
    environment: str
    production_mode: bool
    release_version: str
    api_docs_enabled: bool
    cors_origin_count: int
    public_app_url_configured: bool
    public_app_url_is_https: bool
    notification_transport: str
    telegram_transport_configured: bool
    test_send_enabled: bool
    error_count: int
    warning_count: int
    findings: list[ConfigurationFindingOut]


class PreSendCheckOut(BaseModel):
    code: str
    passed: bool
    detail: str


class TestSendPreviewOut(BaseModel):
    message: str
    recipient_masked: str | None
    environment: str
    timezone: str
    template_version: str
    approval_code: str
    transport_mode: str
    already_sent: bool
    ready_to_send: bool
    checks: list[PreSendCheckOut]


class TestSendExecuteRequest(StrictPayload):
    """No recipient and no message body: both are server-side, by design.

    The field is an *approval code* rather than a token: it references a preview the caller
    has seen, and A1's credential guard rightly refuses any field named like a secret.
    """

    approval_code: str
    confirm: bool = False


class TestSendResultOut(BaseModel):
    sent: bool
    detail: str
    message_id: str | None = None
    preview: TestSendPreviewOut
