"""S2 — a Meta status change travels the existing signal → alert → delivery path. Fake provider and
fake transport only: nothing here reaches Meta or Telegram.

The engine already knows transitions (open / unchanged / superseded / resolved); these tests pin
that S2's evidence drives it the way `docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` §2c/§2d says.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.commands.run_dispatcher import spend_sweep_pass
from app.core.enums import (
    DeliveryStatus,
    OperationalRunKind,
    OperationalRunStatus,
    SignalStatus,
)
from app.models.alerts import Alert, NotificationDelivery
from app.models.entities import AdAccount
from app.models.health import AccountHealthSignal
from app.models.operations import OperationalRun
from app.models.spend import AdAccountSpendObservation
from app.services.audit import AuditLogService
from app.services.meta_provider import MetaFailureCode, SpendRead
from app.services.notification_service import NotificationDispatcherService
from app.services.operations import SAFE_SUMMARY_KEYS
from tests.s1_spend_helpers import good_read, make_account, make_bm, make_connection

BM = "1993884657458857"
BLOCKING = "platform_account_status_blocking"
PENDING = "platform_account_status_pending"
MISMATCH = "platform_vs_recorded_status_mismatch"
STALE = "spend_observation_missing_or_stale"
STEADY = {1: "1600000", 2: "1000000"}


def read(status: str | None, reason: str | None = "0") -> SpendRead:
    return replace(good_read(STEADY), account_status_raw=status, disable_reason_raw=reason)


def setup(api, *, status="unknown", ext="7001"):
    # Quiet hours cover the whole day, so a critical delivery can only be "now" by bypassing them.
    response = api.patch(
        "/api/v1/notification-policies/current",
        json={
            "telegram_chat_id": "-1001234567890",
            "quiet_hours_start": "00:00:00",
            "quiet_hours_end": "23:59:00",
            "timezone": "UTC",
        },
    )
    assert response.status_code == 200, response.text
    bm = make_bm(api, BM)
    make_connection(api, bm_external_id=BM)
    account = make_account(api, bm=bm, external_id=ext)
    if status != "unknown":
        assert api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": status}).status_code == 200
    return account


def refresh(api, spend_env, account, result: SpendRead, ext="7001"):
    spend_env["provider"].queue_spend_result(ext, result)
    response = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    assert response.status_code == 200, response.text
    return response.json()


def signals(db_session, account, rule_key):
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(AccountHealthSignal)
            .where(
                AccountHealthSignal.ad_account_id == account["id"],
                AccountHealthSignal.rule_key == rule_key,
            )
            .order_by(AccountHealthSignal.created_at)
        ).scalars().all()
    )


def alert_for(db_session, account, rule_key):
    db_session.expire_all()
    return db_session.execute(
        sa.select(Alert).where(
            Alert.ad_account_id == account["id"],
            Alert.alert_key == f"health_signal:{account['id']}:{rule_key}:"
            + ("registry" if rule_key == MISMATCH else "platform_status"),
        )
    ).scalars().one_or_none()


def deliveries(db_session, alert):
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(NotificationDelivery)
            .where(NotificationDelivery.alert_id == alert.id)
            .order_by(NotificationDelivery.created_at)
        ).scalars().all()
    )


def test_active_raises_nothing(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("1"))
    for key in (BLOCKING, PENDING, MISMATCH):
        assert signals(db_session, account, key) == []


def test_disabled_opens_a_critical_signal_alert_and_an_immediate_delivery(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("1"))
    refresh(api, spend_env, account, read("2", "3"))

    [signal] = signals(db_session, account, BLOCKING)
    assert signal.status == SignalStatus.OPEN
    assert signal.severity.value == "critical"
    assert signal.source_type.value == "provider_observation"
    assert signal.evidence_json["previous_account_status_raw"] == "1"

    alert = alert_for(db_session, account, BLOCKING)
    assert alert is not None and alert.severity.value == "critical" and alert.status.value == "open"
    assert alert.title == "Meta reports the account as not operable"
    assert "account_status 2" in alert.summary

    [delivery] = deliveries(db_session, alert)
    assert delivery.status == DeliveryStatus.PENDING
    assert delivery.quiet_hours_decision["in_quiet_hours"] is True
    assert delivery.quiet_hours_decision["critical_bypass"] is True
    assert delivery.quiet_hours_decision["deferred"] is False


def test_the_same_code_on_every_read_is_one_signal_and_one_delivery(api, db_session, spend_env):
    account = setup(api)
    for _ in range(3):
        refresh(api, spend_env, account, read("2"))
    [signal] = signals(db_session, account, BLOCKING)
    assert signal.status == SignalStatus.OPEN
    assert len(deliveries(db_session, alert_for(db_session, account, BLOCKING))) == 1


def test_a_code_change_inside_the_class_supersedes_without_a_new_delivery(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    refresh(api, spend_env, account, read("101"))

    rows = signals(db_session, account, BLOCKING)
    assert [row.status for row in rows] == [SignalStatus.SUPERSEDED, SignalStatus.OPEN]
    assert rows[0].superseded_by_signal_id == rows[1].id
    alert = alert_for(db_session, account, BLOCKING)
    assert alert.status.value == "open"
    assert len(deliveries(db_session, alert)) == 1, "same severity: updated, not re-sent"


def test_current_to_stale_supersedes_once_and_sends_nothing_new(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    db_session.execute(
        sa.update(AdAccountSpendObservation).values(observed_at=datetime.now(UTC) - timedelta(days=3))
    )
    db_session.commit()
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")

    rows = signals(db_session, account, BLOCKING)
    assert [row.status for row in rows] == [SignalStatus.SUPERSEDED, SignalStatus.OPEN]
    assert rows[1].evidence_json["spend_freshness"] == "stale"
    assert rows[1].severity.value == "critical", "old is not recovered"
    assert len(deliveries(db_session, alert_for(db_session, account, BLOCKING))) == 1


def test_return_to_active_resolves_by_the_engine_and_sends_no_recovery_message(
    api, db_session, owner, transport, spend_env
):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    alert = alert_for(db_session, account, BLOCKING)
    [first] = deliveries(db_session, alert)
    assert first.status == DeliveryStatus.PENDING

    refresh(api, spend_env, account, read("1"))

    [signal] = signals(db_session, account, BLOCKING)
    assert signal.status == SignalStatus.RESOLVED
    assert signal.resolved_by is None
    assert signal.resolution_reason == "The source condition is no longer true."
    alert = alert_for(db_session, account, BLOCKING)
    assert alert.status.value == "resolved"
    # No new delivery is planned for the recovery, and the one still waiting is cancelled at
    # dispatch because its alert is no longer active — nothing reaches the transport.
    assert [row.status for row in deliveries(db_session, alert)] == [DeliveryStatus.PENDING]
    audit = AuditLogService(db_session, owner["workspace"].id, owner["user"].id)
    result = NotificationDispatcherService(db_session, owner["workspace"].id, audit).dispatch_due(batch_size=10)
    db_session.commit()
    assert result.cancelled == 1 and result.sent == 0
    assert [row.status for row in deliveries(db_session, alert)] == [DeliveryStatus.CANCELLED]
    assert transport.sent == [], "no 'recovered' message, and no stale 'disabled' one either"


def test_refused_reads_after_disabled_keep_the_critical_and_add_attention(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    db_session.execute(
        sa.update(AdAccountSpendObservation).values(observed_at=datetime.now(UTC) - timedelta(days=2))
    )
    db_session.commit()
    refused = SpendRead(ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING, failure_summary="x")
    for _ in range(3):
        body = refresh(api, spend_env, account, refused)

    [blocking] = [s for s in signals(db_session, account, BLOCKING) if s.status == SignalStatus.OPEN]
    assert blocking.severity.value == "critical"
    assert blocking.evidence_json["spend_freshness"] == "stale"
    [stale] = [s for s in signals(db_session, account, STALE) if s.status == SignalStatus.OPEN]
    assert stale.severity.value == "attention"
    assert body["platform_status"]["status"] == "disabled"
    assert body["platform_status"]["freshness"] == "stale"
    assert body["latest_attempt"]["failure_code"] == "permission_missing"


def test_mismatch_opens_beside_blocking_and_closes_when_the_record_agrees(api, db_session, spend_env):
    account = setup(api, status="active")
    refresh(api, spend_env, account, read("2"))
    assert [s.status for s in signals(db_session, account, MISMATCH)] == [SignalStatus.OPEN]
    assert [s.status for s in signals(db_session, account, BLOCKING)] == [SignalStatus.OPEN]

    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "disabled"})

    assert [s.status for s in signals(db_session, account, MISMATCH)] == [SignalStatus.RESOLVED]


def test_health_never_writes_the_recorded_status(api, db_session, spend_env):
    account = setup(api, status="active")
    refresh(api, spend_env, account, read("2"))
    db_session.expire_all()
    row = db_session.get(AdAccount, account["id"])
    assert row.status.value == "active", "Meta's status is never written to the registry (rule 11)"


def test_one_sweep_pass_opens_the_signal_and_keeps_the_run_shape(api, db_session, spend_env):
    account = setup(api)
    spend_env["provider"].queue_spend_result("7001", read("2"))

    totals = spend_sweep_pass(batch=10)

    assert set(totals) <= SAFE_SUMMARY_KEYS
    assert totals["observed"] == 1
    db_session.expire_all()
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.SPEND_SWEEP)
    ).scalars().one()
    assert run.status == OperationalRunStatus.SUCCEEDED and run.summary_json == totals
    [signal] = signals(db_session, account, BLOCKING)
    assert signal.status == SignalStatus.OPEN


def test_archiving_expires_the_status_signal(api, db_session, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    [signal] = signals(db_session, account, BLOCKING)
    assert signal.status == SignalStatus.EXPIRED
