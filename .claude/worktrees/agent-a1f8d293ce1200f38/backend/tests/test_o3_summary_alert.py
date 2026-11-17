"""O3 — alert storm control for the first automatic import.

Three layers, each pinned: one summary alert per pass per connection (never one per account),
rendered with its own template; a 24 h grace that skips the *warning* deliveries of a freshly
auto-imported account — never a critical one; and no re-announcement of an unchanged condition.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.commands.run_dispatcher import discovery_sweep_pass
from app.core.enums import (
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    DeliverySkipReason,
    DeliveryStatus,
)
from app.models.alerts import Alert, AlertPolicy, NotificationDelivery
from app.models.entities import AdAccount, AuditLog
from app.services.alert_service import AlertPolicyService
from app.services.audit import AuditLogService
from app.services.notification_service import NotificationDispatcherService, NotificationPlannerService
from app.services.notification_templates import (
    SUMMARY_MAX_IDS,
    SUMMARY_TEMPLATE_VERSION,
    SummaryMessageInputs,
    render_summary,
)
from tests.o3_helpers import automatic_connection, stage
from tests.s1_spend_helpers import make_account, make_bm


def summaries(db_session) -> list[Alert]:
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(Alert)
            .where(Alert.source_type == AlertSourceType.DISCOVERY_SWEEP)
            .order_by(Alert.created_at)
        ).scalars().all()
    )


def deliveries(db_session) -> list[NotificationDelivery]:
    db_session.expire_all()
    return list(db_session.execute(sa.select(NotificationDelivery)).scalars().all())


@pytest.fixture()
def chat(api):
    """A recipient on the policy, so a skip reason is a decision, not `no_recipient_configured`.
    The transport in tests is the fake one; nothing reaches Telegram."""
    response = api.patch(
        "/api/v1/notification-policies/current",
        json={"telegram_chat_id": "-1001234567890", "quiet_hours_enabled": False},
    )
    assert response.status_code == 200, response.text


def test_one_summary_per_pass_however_many_accounts_were_imported(api, db_session, sweep_env, chat):
    automatic_connection(api)
    stage(sweep_env["provider"], *[(f"10{i}", "client_ad_accounts") for i in range(12)])

    totals = discovery_sweep_pass(batch=5)

    assert totals["imported"] == 12 and totals["summaries"] == 1
    (alert,) = summaries(db_session)
    assert alert.ad_account_id is None
    assert alert.severity == AlertSeverity.WARNING
    assert alert.source_snapshot_json["counters"]["imported"] == 12
    assert len(alert.source_snapshot_json["new_accounts"]) == SUMMARY_MAX_IDS
    summary_deliveries = [d for d in deliveries(db_session) if d.alert_id == alert.id]
    assert len(summary_deliveries) == 1
    assert summary_deliveries[0].status == DeliveryStatus.PENDING
    assert summary_deliveries[0].message_template_version == SUMMARY_TEMPLATE_VERSION


def test_the_freshly_imported_accounts_warnings_are_held_by_the_grace(api, db_session, sweep_env, chat):
    """Rule 9 (`manual_review_due_or_stale`, warning) opens for every imported account. Without
    the grace that is one Telegram message per account; with it, the summary is the only one."""
    automatic_connection(api)
    stage(sweep_env["provider"], *[(f"10{i}", "client_ad_accounts") for i in range(3)])

    discovery_sweep_pass(batch=5)

    rows = deliveries(db_session)
    pending = [d for d in rows if d.status == DeliveryStatus.PENDING]
    assert len(pending) == 1, "only the summary is due to be sent"
    graced = [d for d in rows if d.skip_reason == DeliverySkipReason.AUTO_IMPORT_GRACE]
    assert len(graced) == 3
    for delivery in graced:
        alert = db_session.get(Alert, delivery.alert_id)
        assert alert.severity == AlertSeverity.WARNING
        assert alert.status == AlertStatus.OPEN, "the alert stays open and counted (rule 17)"


def _plan_for(db_session, account: AdAccount, severity: AlertSeverity, *, key: str) -> NotificationDelivery:
    audit = AuditLogService(db_session, account.workspace_id, None)
    policy = AlertPolicyService(db_session, account.workspace_id, audit).get_or_create()
    now = datetime.now(UTC)
    alert = Alert(
        workspace_id=account.workspace_id, ad_account_id=account.id,
        source_type=AlertSourceType.HEALTH_SIGNAL, source_entity_type="account_health_signal",
        source_entity_id=None, alert_key=key, active_key=key, category="account_status",
        severity=severity, status=AlertStatus.OPEN, title="Test", summary="Test",
        source_snapshot_json={}, first_observed_at=now, last_observed_at=now,
    )
    db_session.add(alert)
    db_session.flush()
    outcome = NotificationPlannerService(db_session, account.workspace_id, audit).plan(alert, policy, account)
    db_session.commit()
    return outcome.delivery


def test_the_grace_never_applies_to_critical(api, db_session, sweep_env, chat):
    """Row: grace never on `critical` — an account that arrives disabled must still page."""
    automatic_connection(api)
    stage(sweep_env["provider"], ("101", "client_ad_accounts"))
    discovery_sweep_pass(batch=5)
    db_session.expire_all()
    account = db_session.execute(sa.select(AdAccount)).scalar_one()

    critical = _plan_for(db_session, account, AlertSeverity.CRITICAL, key="test:critical")
    warning = _plan_for(db_session, account, AlertSeverity.WARNING, key="test:warning")

    assert critical.status == DeliveryStatus.PENDING and critical.skip_reason is None
    assert warning.skip_reason == DeliverySkipReason.AUTO_IMPORT_GRACE


def test_after_the_grace_a_warning_is_sent_again(api, db_session, sweep_env, chat):
    automatic_connection(api)
    stage(sweep_env["provider"], ("101", "client_ad_accounts"))
    discovery_sweep_pass(batch=5)
    db_session.execute(
        sa.update(AuditLog)
        .where(AuditLog.action == "meta_discovery.ad_account_auto_imported")
        .values(created_at=datetime.now(UTC) - timedelta(hours=25))
    )
    db_session.commit()
    account = db_session.execute(sa.select(AdAccount)).scalar_one()

    later = _plan_for(db_session, account, AlertSeverity.WARNING, key="test:later")

    assert later.status == DeliveryStatus.PENDING and later.skip_reason is None


def test_a_hand_imported_or_typed_account_gets_no_grace(api, db_session, sweep_env, chat):
    bm = make_bm(api, "999", "Other")
    typed = make_account(api, bm=bm, external_id="555")
    account = db_session.get(AdAccount, typed["id"])

    delivery = _plan_for(db_session, account, AlertSeverity.WARNING, key="test:typed")

    assert delivery.skip_reason is None


def test_an_unchanged_condition_is_not_announced_again(api, db_session, sweep_env, chat):
    """Discovery only (no import): the same awaiting account on the next window is the same news."""
    automatic_connection(api, imports=False)
    stage(sweep_env["provider"], ("101", "owned_ad_accounts"))
    discovery_sweep_pass(batch=5)
    from app.models.meta_discovery import BusinessManagerDiscoveryRun

    db_session.execute(
        sa.update(BusinessManagerDiscoveryRun).values(completed_at=datetime.now(UTC) - timedelta(hours=30))
    )
    db_session.commit()

    second = discovery_sweep_pass(batch=5)

    assert second["runs"] == 1 and second["summaries"] == 0
    assert len(summaries(db_session)) == 1


def test_a_changed_condition_supersedes_the_previous_summary(api, db_session, sweep_env, chat):
    automatic_connection(api, imports=False)
    stage(sweep_env["provider"], ("101", "owned_ad_accounts"))
    discovery_sweep_pass(batch=5)
    from app.models.meta_discovery import BusinessManagerDiscoveryRun

    db_session.execute(
        sa.update(BusinessManagerDiscoveryRun).values(completed_at=datetime.now(UTC) - timedelta(hours=30))
    )
    db_session.commit()
    stage(sweep_env["provider"], ("101", "owned_ad_accounts"), ("102", "owned_ad_accounts"))

    second = discovery_sweep_pass(batch=5)

    assert second["summaries"] == 1
    old, new = summaries(db_session)
    assert old.status == AlertStatus.RESOLVED and old.active_key is None
    assert new.status == AlertStatus.OPEN
    assert new.source_snapshot_json["counters"]["awaiting_import"] == 2


def test_nothing_new_means_no_summary(api, db_session, sweep_env, chat):
    bm = make_bm(api, "1993884657458857", "Hub BM")
    make_account(api, bm=bm, external_id="101")
    automatic_connection(api)
    stage(sweep_env["provider"], ("101", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["already_in_registry"] == 1 and totals["summaries"] == 0
    assert summaries(db_session) == []


def test_the_summary_message_is_its_own_template_and_carries_no_raw_payload(
    api, db_session, sweep_env, chat, transport
):
    automatic_connection(api)
    stage(
        sweep_env["provider"],
        ("101", "client_ad_accounts"),
        owners={"101": ("7770001", "Partner Shop")},
    )
    discovery_sweep_pass(batch=5)
    (alert,) = summaries(db_session)
    workspace_id = alert.workspace_id

    result = NotificationDispatcherService(
        db_session, workspace_id, AuditLogService(db_session, workspace_id, None)
    ).dispatch_due(batch_size=10)
    db_session.commit()

    assert result.sent == 1
    (message,) = transport.sent
    text = message.text
    assert text.startswith("[AdsOps] WARNING — Discovery sweep")
    assert "Account:" not in text, "not the per-account template"
    assert "Imported automatically: 1" in text
    assert "- 101 — shared from Business Manager 7770001" in text
    assert "Read as: adsops-readonly" in text
    lowered = text.lower()
    for word in ("safe", "cannot be restricted", "approved", "guarantee", "token", "traceback"):
        assert word not in lowered
    assert "Partner Shop" not in text, "names Meta returned for accounts stay out of the message"


def test_render_summary_names_at_most_ten_ids_and_counts_the_rest():
    inputs = SummaryMessageInputs(
        severity="warning", alert_title="Discovery sweep — Hub", connection_label="Hub",
        business_manager_reference="1", business_manager_name="Hub BM", read_as="reader",
        coverage_status="complete", observed_at=datetime(2026, 10, 27, tzinfo=UTC),
        counters={"imported": 15},
        new_accounts=tuple({"external_id": str(i), "owner_business_reference": None} for i in range(15)),
        recommended_next_step="Review.",
    )
    text = render_summary(inputs)
    assert sum(1 for line in text.splitlines() if line.startswith("- ")) == SUMMARY_MAX_IDS
    assert "…and 5 more in the dashboard." in text
    assert inputs.to_payload()["template_version"] == SUMMARY_TEMPLATE_VERSION
    assert len(inputs.to_payload()["new_accounts"]) == SUMMARY_MAX_IDS


def test_the_summary_respects_the_policy_like_any_warning(api, db_session, sweep_env):
    """§9 8.3: no new policy column — `warning_telegram_enabled=false` holds it back."""
    api.patch("/api/v1/notification-policies/current", json={"telegram_chat_id": "-100123", "warning_telegram_enabled": False})
    automatic_connection(api)
    stage(sweep_env["provider"], ("101", "client_ad_accounts"))

    discovery_sweep_pass(batch=5)

    (alert,) = summaries(db_session)
    (delivery,) = [d for d in deliveries(db_session) if d.alert_id == alert.id]
    assert delivery.skip_reason == DeliverySkipReason.SEVERITY_DELIVERY_DISABLED
    assert db_session.execute(sa.select(AlertPolicy)).scalar_one().warning_telegram_enabled is False
