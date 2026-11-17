"""A3 integration tests against real PostgreSQL with the fake transport (§10.2)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.models.alerts import Alert, NotificationDelivery
from app.models.health import AccountHealthSignal
from app.services.notification_transport import TransportResult
from tests.test_health_api import active as active_signals
from tests.test_readiness_api import make_ready_account


def alerts(api, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return api.get("/api/v1/alerts" + (f"?{query}" if query else "")).json()["items"]


def alert_for(api, rule_key, **params):
    return next(
        row
        for row in alerts(api, page_size=200, **params)
        if row["title"] and rule_key in str(row["summary"] + row["title"]) or True
        if _snapshot_rule(api, row) == rule_key
    )


def _snapshot_rule(api, row):
    detail = api.get(f"/api/v1/alerts/{row['id']}").json()
    return detail["alert"]["source_snapshot_json"].get("rule_key")


def deliveries(api, alert_id):
    return api.get(f"/api/v1/alerts/{alert_id}/notifications").json()


def configure_policy(api, **overrides):
    payload = {"telegram_chat_id": "-1001234567890"}
    payload.update(overrides)
    response = api.patch("/api/v1/notification-policies/current", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def restricted_account(api, name="Blocked", ext="blk"):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    return account


# --------------------------------------------------------------------------- derivation
def test_a_critical_health_signal_derives_one_open_critical_alert(api):
    configure_policy(api)
    account = restricted_account(api)

    rows = alerts(api, page_size=100)
    critical = [row for row in rows if row["severity"] == "critical"]
    assert len(critical) == 1
    alert = critical[0]
    assert alert["status"] == "open"
    assert alert["ad_account_id"] == account["id"]
    assert alert["health_status"] == "critical"
    assert alert["readiness_status"] == "not_ready"
    assert alert["source_type"] == "health_signal"

    detail = api.get(f"/api/v1/alerts/{alert['id']}").json()
    snapshot = detail["alert"]["source_snapshot_json"]
    assert snapshot["rule_key"] == "account_restricted_status"
    assert snapshot["rule_version"] == 1
    assert snapshot["health_severity"] == "critical"
    assert snapshot["recommended_next_step"]
    assert "not a platform decision" in detail["disclaimer"]


def test_re_evaluating_an_unchanged_condition_creates_no_duplicate_alert_or_delivery(api, db_session):
    configure_policy(api)
    account = restricted_account(api)
    before = len(alerts(api, page_size=100))
    before_deliveries = db_session.execute(
        sa.select(sa.func.count()).select_from(NotificationDelivery)
    ).scalar_one()

    for _ in range(3):
        api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")

    assert len(alerts(api, page_size=100)) == before
    assert (
        db_session.execute(sa.select(sa.func.count()).select_from(NotificationDelivery)).scalar_one()
        == before_deliveries
    )


def test_an_attention_condition_creates_an_alert_but_no_telegram_candidate(api):
    configure_policy(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete", "external_account_id": "inc"})

    info = [row for row in alerts(api, page_size=100) if row["severity"] == "info"]
    assert info, "attention conditions must still be visible in the Alert Center"
    for row in info:
        sent = [d for d in deliveries(api, row["id"]) if d["status"] == "sent"]
        assert sent == []
        skipped = [d for d in deliveries(api, row["id"]) if d["status"] == "skipped"]
        assert skipped and skipped[0]["skip_reason"] == "severity_delivery_disabled"


def test_a_warning_signal_derives_a_warning_alert(api):
    configure_policy(api)
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "spend_anomaly", "severity": "warning", "summary": "Spend spike."},
    )
    warnings = [row for row in alerts(api, page_size=100) if row["severity"] == "warning"]
    assert warnings
    assert any("Unresolved warning account event" in row["title"] for row in warnings)


def test_raising_an_event_severity_replaces_the_alert_with_exactly_one_new_candidate(api):
    """A2 models warning and critical events as different rules, so raising an event's severity
    resolves the warning alert and opens a critical one. The requirement that matters is met:
    exactly one new immediate delivery, and no duplicate."""
    configure_policy(api, quiet_hours_enabled=False)
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Watch this."},
    )
    warning_alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "warning")
    assert len(deliveries(api, warning_alert["id"])) == 1

    event_id = api.get(f"/api/v1/ad-accounts/{account['id']}/events").json()[0]["id"]
    api.patch(f"/api/v1/account-events/{event_id}", json={"severity": "critical"})

    assert api.get(f"/api/v1/alerts/{warning_alert['id']}").json()["alert"]["status"] == "resolved"
    critical = [row for row in alerts(api, page_size=100) if row["severity"] == "critical"]
    assert len(critical) == 1
    critical_deliveries = deliveries(api, critical[0]["id"])
    assert len(critical_deliveries) == 1
    assert critical_deliveries[0]["status"] == "pending"
    assert len(deliveries(api, warning_alert["id"])) == 1, "the old alert gains no new delivery"


def test_a_severity_change_on_one_alert_key_escalates_and_plans_one_new_delivery(api, db_session):
    """Direct test of the escalation path.

    A2 v1 fixes severity per rule, so an alert key's severity does not change in practice today.
    The path still has to be right for the day a rule changes, so it is exercised here by moving
    the source signal's severity and re-deriving.
    """
    from app.core.enums import SignalSeverity
    from app.services.alert_service import AlertDerivationService
    from app.services.audit import AuditLogService
    from app.services.notification_service import NotificationPlannerService

    configure_policy(api, quiet_hours_enabled=False)
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Watch this."},
    )
    alert_row = next(row for row in alerts(api, page_size=100) if row["severity"] == "warning")
    assert len(deliveries(api, alert_row["id"])) == 1

    signal = db_session.execute(
        sa.select(AccountHealthSignal).where(
            AccountHealthSignal.rule_key == "warning_account_event_open"
        )
    ).scalar_one()
    signal.severity = SignalSeverity.CRITICAL
    db_session.commit()

    from app.models.entities import AdAccount as AdAccountModel

    workspace_id = signal.workspace_id
    audit = AuditLogService(db_session, workspace_id, None)
    derivation = AlertDerivationService(db_session, workspace_id, audit)
    account_row = db_session.get(AdAccountModel, account["id"])
    result, to_plan = derivation.derive_for_account(account_row, health_status="critical")
    policy = derivation.policies.get_or_create()
    planner = NotificationPlannerService(db_session, workspace_id, audit)
    for alert, reason in to_plan:
        planner.plan(alert, policy, account_row, reason=__import__(
            "app.core.enums", fromlist=["DeliveryReason"]
        ).DeliveryReason(reason))
    db_session.commit()

    assert result.escalated == 1
    after = api.get(f"/api/v1/alerts/{alert_row['id']}").json()["alert"]
    assert after["severity"] == "critical"
    records = deliveries(api, alert_row["id"])
    assert len(records) == 2
    assert {r["reason"] for r in records} == {"initial", "escalation"}


def test_source_resolution_resolves_the_alert_without_deleting_history(api):
    configure_policy(api)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")

    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "active"})

    resolved = api.get(f"/api/v1/alerts/{alert['id']}").json()["alert"]
    assert resolved["status"] == "resolved"
    assert resolved["resolved_by"] is None, "closed by the source condition, not by a person"
    assert "no longer active" in resolved["resolution_reason"]
    assert deliveries(api, alert["id"]), "delivery history survives resolution"


def test_a_failed_health_evaluation_derives_a_warning_alert_with_no_stack_trace(api, monkeypatch):
    configure_policy(api)
    account = make_ready_account(api)

    def explode(*args, **kwargs):
        raise RuntimeError("simulated failure with sensitive detail: password=hunter2")

    monkeypatch.setattr("app.services.health_service.build_candidates", explode)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "Renamed"})
    monkeypatch.undo()
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")

    failure_alerts = [
        row for row in alerts(api, page_size=100, status="resolved")
        if row["source_type"] == "health_evaluation_run"
    ] + [
        row for row in alerts(api, page_size=100) if row["source_type"] == "health_evaluation_run"
    ]
    assert failure_alerts, "a failed evaluation must be visible as an alert"
    alert = failure_alerts[0]
    detail = api.get(f"/api/v1/alerts/{alert['id']}").json()["alert"]
    blob = str(detail)
    assert "Traceback" not in blob and "hunter2" not in blob and "password" not in blob
    assert detail["source_snapshot_json"]["error_code"] == "RuntimeError"


def test_a_recovered_evaluation_resolves_its_failure_alert(api, monkeypatch):
    configure_policy(api)
    account = make_ready_account(api)

    def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.services.health_service.build_candidates", explode)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "R1"})
    monkeypatch.undo()

    failure = [row for row in alerts(api, page_size=100) if row["source_type"] == "health_evaluation_run"]
    assert failure, "the failure alert should be open while the failure is the latest word"

    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    after = api.get(f"/api/v1/alerts/{failure[0]['id']}").json()["alert"]
    assert after["status"] == "resolved"


# ------------------------------------------------------------------------------ actions
def test_acknowledge_requires_a_note_and_does_not_touch_the_source(api, db_session):
    configure_policy(api)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")

    assert api.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "  "}).status_code == 422

    body = api.post(
        f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "Seen; appealing manually."}
    ).json()
    assert body["alert"]["status"] == "acknowledged"
    assert body["alert"]["resolved_at"] is None

    signal = next(
        s for s in active_signals(api, account["id"]) if s["rule_key"] == "account_restricted_status"
    )
    assert signal["status"] == "open", "acknowledging an alert must not resolve the A2 signal"
    db_session.expire_all()
    assert (
        db_session.execute(
            sa.select(AccountHealthSignal).where(AccountHealthSignal.id == signal["id"])
        ).scalar_one().status.value
        == "open"
    )
    assert api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()["health_status"] == "critical"


def test_acknowledgement_creates_no_new_delivery(api):
    configure_policy(api)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    before = len(deliveries(api, alert["id"]))
    api.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "Seen."})
    assert len(deliveries(api, alert["id"])) == before


def test_resolve_requires_a_reason_and_leaves_the_source_signal_open(api):
    configure_policy(api)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")

    assert api.post(f"/api/v1/alerts/{alert['id']}/resolve", json={"reason": " "}).status_code == 422

    body = api.post(
        f"/api/v1/alerts/{alert['id']}/resolve", json={"reason": "Tracked elsewhere."}
    ).json()
    assert body["alert"]["status"] == "resolved"
    assert body["alert"]["resolved_by"] is not None

    signal = next(
        s for s in active_signals(api, account["id"]) if s["rule_key"] == "account_restricted_status"
    )
    assert signal["status"] == "open"
    logs = api.get(f"/api/v1/alerts/{alert['id']}/audit-logs").json()["items"]
    assert any(entry["action"] == "alert.resolved" for entry in logs)


def test_suppression_requires_a_reason_and_a_future_expiry(api):
    configure_policy(api)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    future = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()

    assert api.post(f"/api/v1/alerts/{alert['id']}/suppress", json={"reason": "x"}).status_code == 422
    assert (
        api.post(
            f"/api/v1/alerts/{alert['id']}/suppress", json={"reason": "  ", "expires_at": future}
        ).status_code
        == 422
    )
    assert (
        api.post(
            f"/api/v1/alerts/{alert['id']}/suppress", json={"reason": "Known", "expires_at": past}
        ).status_code
        == 422
    ), "suppression expiry must be in the future"

    body = api.post(
        f"/api/v1/alerts/{alert['id']}/suppress",
        json={"reason": "Appeal already filed.", "expires_at": future},
    ).json()
    assert body["alert"]["status"] == "suppressed"
    assert body["alert"]["suppression_expires_at"] is not None


def test_a_suppressed_critical_alert_stays_visible_and_keeps_its_history(api):
    configure_policy(api)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    before_deliveries = len(deliveries(api, alert["id"]))
    api.post(
        f"/api/v1/alerts/{alert['id']}/suppress",
        json={
            "reason": "Appeal filed.",
            "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        },
    )
    visible = [row for row in alerts(api, page_size=100) if row["id"] == alert["id"]]
    assert visible, "suppression mutes delivery, never visibility"
    assert visible[0]["status"] == "suppressed"
    assert len(deliveries(api, alert["id"])) == before_deliveries
    assert api.get("/api/v1/alerts/summary").json()["suppressed"] >= 1


def test_expired_suppression_returns_the_alert_to_open_when_the_source_is_still_active(api, db_session):
    configure_policy(api)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    api.post(
        f"/api/v1/alerts/{alert['id']}/suppress",
        json={
            "reason": "Short mute.",
            "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        },
    )
    row = db_session.get(Alert, alert["id"])
    row.suppression_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db_session.commit()

    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    after = api.get(f"/api/v1/alerts/{alert['id']}").json()["alert"]
    assert after["status"] == "open"
    assert after["suppression_expires_at"] is None


def test_unsuppress_restores_the_previous_status_and_audits(api):
    configure_policy(api)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    api.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "Seen."})
    api.post(
        f"/api/v1/alerts/{alert['id']}/suppress",
        json={"reason": "Mute.", "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat()},
    )
    body = api.post(f"/api/v1/alerts/{alert['id']}/unsuppress", json={"note": "Back on."}).json()
    assert body["alert"]["status"] == "acknowledged"
    logs = api.get(f"/api/v1/alerts/{alert['id']}/audit-logs").json()["items"]
    assert any(entry["action"] == "alert.unsuppressed" for entry in logs)


# ------------------------------------------------------------------ policy and planning
def test_default_policy_is_seeded_safely_with_no_recipient(api):
    policy = api.get("/api/v1/notification-policies/current").json()
    assert policy["timezone"] == "Asia/Ho_Chi_Minh"
    assert policy["quiet_hours_enabled"] is True
    assert policy["quiet_hours_start"] == "23:00:00"
    assert policy["quiet_hours_end"] == "07:00:00"
    assert policy["critical_bypasses_quiet_hours"] is True
    assert policy["warning_telegram_enabled"] is True
    assert policy["attention_telegram_enabled"] is False
    assert policy["reminder_enabled"] is False
    assert policy["recipient_configured"] is False
    assert policy["telegram_chat_id_masked"] is None
    assert "telegram_chat_id" not in policy and "token" not in str(policy).lower()


def test_policy_rejects_an_invalid_timezone_and_accepts_an_iana_one(api):
    assert api.patch("/api/v1/notification-policies/current", json={"timezone": "Mars/Olympus"}).status_code == 422
    ok = api.patch("/api/v1/notification-policies/current", json={"timezone": "Europe/London"})
    assert ok.status_code == 200 and ok.json()["timezone"] == "Europe/London"


def test_policy_masks_the_recipient_and_never_returns_it_in_full(api):
    body = configure_policy(api, telegram_chat_id="-1001234567890")
    assert body["recipient_configured"] is True
    assert body["telegram_chat_id_masked"] == "…7890"
    assert "-1001234567890" not in str(body)


def test_policy_refuses_anything_that_is_not_a_chat_reference(api):
    for bad in ("123456:AAH-bot-token-looking-value", "https://api.telegram.org/bot123", "hello"):
        assert api.patch(
            "/api/v1/notification-policies/current", json={"telegram_chat_id": bad}
        ).status_code == 422


def test_no_recipient_means_the_alert_still_exists_and_delivery_is_skipped_with_a_reason(api):
    restricted_account(api)  # policy left unconfigured on purpose
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    records = deliveries(api, alert["id"])
    assert records and records[0]["status"] == "skipped"
    assert records[0]["skip_reason"] == "no_recipient_configured"
    assert alert["status"] == "open", "the alert remains fully usable in the Alert Center"


def test_a_critical_alert_during_quiet_hours_bypasses_them_by_default(api, db_session):
    # Quiet hours all day, so "now" is always inside the window.
    configure_policy(api, quiet_hours_start="00:00:00", quiet_hours_end="23:59:00")
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "pending"
    assert delivery["quiet_hours_decision"]["in_quiet_hours"] is True
    assert delivery["quiet_hours_decision"]["critical_bypass"] is True
    assert delivery["quiet_hours_decision"]["deferred"] is False
    scheduled = datetime.fromisoformat(delivery["scheduled_for"])
    assert scheduled <= datetime.now(UTC) + timedelta(seconds=5)


def test_a_warning_during_quiet_hours_is_deferred_to_the_window_end_not_discarded(api, db_session):
    from app.models.alerts import AlertPolicy

    configure_policy(api, quiet_hours_start="00:00:00", quiet_hours_end="23:59:00", timezone="UTC")
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Quiet-hours warning."},
    )
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "warning")
    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "pending", "deferred, never discarded"
    assert delivery["quiet_hours_decision"]["deferred"] is True
    assert delivery["quiet_hours_decision"]["timezone"] == "UTC"

    policy = db_session.execute(sa.select(AlertPolicy)).scalar_one()
    expected_end = datetime.now(UTC).replace(
        hour=policy.quiet_hours_end.hour, minute=policy.quiet_hours_end.minute,
        second=0, microsecond=0,
    )
    if expected_end <= datetime.now(UTC):
        expected_end += timedelta(days=1)
    scheduled = datetime.fromisoformat(delivery["scheduled_for"])
    assert abs((scheduled - expected_end).total_seconds()) < 90


def test_disabling_warning_delivery_skips_it_with_a_reason(api):
    configure_policy(api, warning_telegram_enabled=False)
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Muted class."},
    )
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "warning")
    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "skipped"
    assert delivery["skip_reason"] == "severity_delivery_disabled"


def test_a_disabled_policy_skips_delivery_but_keeps_the_alert(api):
    configure_policy(api, enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    assert deliveries(api, alert["id"])[0]["skip_reason"] == "policy_disabled"
    assert alert["status"] == "open"


# ---------------------------------------------------------------------------- dispatch
def dispatch(api, batch_size=10):
    response = api.post(
        "/api/v1/notifications/dispatch-due", json={"confirm": True, "batch_size": batch_size}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_due_delivery_is_sent_through_the_fake_transport_and_records_an_attempt(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")

    result = dispatch(api)
    assert result["sent"] == 1 and result["transport"] == "fake"
    assert len(transport.sent) == 1
    assert "[AdsOps] CRITICAL" in transport.sent[0].text
    assert transport.sent[0].chat_id == "-1001234567890"

    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "sent"
    assert delivery["telegram_message_id"] == "fake-1"
    assert delivery["attempt_count"] == 1

    attempts = api.get(f"/api/v1/notifications/{delivery['id']}/attempts").json()
    assert len(attempts) == 1 and attempts[0]["status"] == "sent"
    assert attempts[0]["provider_response_code"] == 200


def test_dispatch_requires_confirmation(api):
    assert api.post("/api/v1/notifications/dispatch-due", json={"confirm": False}).status_code == 422


def test_a_sent_delivery_is_never_sent_again(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    assert len(transport.sent) == 1
    for _ in range(3):
        assert dispatch(api)["sent"] == 0
    assert len(transport.sent) == 1


def test_a_transient_failure_schedules_a_bounded_retry_then_succeeds(api, transport, db_session):
    from app.core.enums import DeliveryFailureCode

    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    transport.queue_failure(
        TransportResult(ok=False, failure_code=DeliveryFailureCode.NETWORK_ERROR, failure_summary="Network error.")
    )

    result = dispatch(api)
    assert result["failed_transient"] == 1 and result["sent"] == 0
    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "failed_transient"
    assert delivery["attempt_count"] == 1
    assert delivery["next_retry_at"] is not None

    # Not due yet, so nothing happens.
    assert dispatch(api)["claimed"] == 0

    row = db_session.get(NotificationDelivery, delivery["id"])
    row.next_retry_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()

    assert dispatch(api)["sent"] == 1
    after = deliveries(api, alert["id"])[0]
    assert after["status"] == "sent" and after["attempt_count"] == 2
    attempts = api.get(f"/api/v1/notifications/{delivery['id']}/attempts").json()
    assert [a["status"] for a in attempts] == ["failed_transient", "sent"]


def test_a_final_failure_stops_retrying_and_keeps_the_alert_visible(api, transport):
    from app.core.enums import DeliveryFailureCode

    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    transport.queue_failure(
        TransportResult(
            ok=False,
            failure_code=DeliveryFailureCode.INVALID_RECIPIENT,
            failure_summary="The configured Telegram chat is not reachable by this bot.",
        )
    )
    result = dispatch(api)
    assert result["failed_final"] == 1

    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "failed_final"
    assert delivery["failure_code"] == "invalid_recipient"
    assert delivery["next_retry_at"] is None
    assert dispatch(api)["claimed"] == 0, "a final failure is never retried"
    assert any(row["id"] == alert["id"] for row in alerts(api, page_size=100))
    assert api.get("/api/v1/alerts/summary").json()["failed_final_notifications"] == 1


def test_repeated_transient_failures_end_as_failed_final_after_the_attempt_bound(api, transport, db_session):
    from app.core.enums import DeliveryFailureCode

    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    for _ in range(3):
        transport.queue_failure(
            TransportResult(ok=False, failure_code=DeliveryFailureCode.RATE_LIMITED, failure_summary="Rate limited.")
        )
    for _ in range(3):
        dispatch(api)
        row = db_session.get(NotificationDelivery, deliveries(api, alert["id"])[0]["id"])
        if row.next_retry_at:
            row.next_retry_at = datetime.now(UTC) - timedelta(seconds=1)
            db_session.commit()

    final = deliveries(api, alert["id"])[0]
    assert final["status"] == "failed_final"
    assert final["attempt_count"] == 3
    assert len(api.get(f"/api/v1/notifications/{final['id']}/attempts").json()) == 3


def test_an_alert_resolved_before_send_cancels_its_pending_delivery(api, transport, db_session):
    configure_policy(api, quiet_hours_enabled=False)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "active"})

    result = dispatch(api)
    assert result["cancelled"] >= 1 and result["sent"] == 0
    assert transport.sent == []
    delivery = deliveries(api, alert["id"])[0]
    assert delivery["status"] == "cancelled"


def test_recovery_sweep_reclaims_a_delivery_stranded_by_a_dead_dispatcher(api, db_session, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    delivery_id = deliveries(api, alert["id"])[0]["id"]

    row = db_session.get(NotificationDelivery, delivery_id)
    row.status = "sending"
    row.lease_expires_at = datetime.now(UTC) - timedelta(minutes=5)
    db_session.commit()

    swept = api.post("/api/v1/notifications/recovery-sweep", json={}).json()
    assert swept["recovered"] == 1
    assert dispatch(api)["sent"] == 1
    assert len(transport.sent) == 1


def test_a_claimed_delivery_is_not_claimed_twice_by_a_concurrent_dispatcher(api, db_session):
    """Two dispatchers, one row: `FOR UPDATE SKIP LOCKED` must let exactly one take it."""
    from app.db.session import SessionLocal
    from app.services.audit import AuditLogService
    from app.services.notification_service import NotificationDispatcherService

    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    workspace_id = db_session.execute(sa.select(NotificationDelivery.workspace_id)).scalars().first()

    session_a, session_b = SessionLocal(), SessionLocal()
    try:
        claimed_a = NotificationDispatcherService(
            session_a, workspace_id, AuditLogService(session_a, workspace_id, None)
        )._claim(10, datetime.now(UTC))
        claimed_b = NotificationDispatcherService(
            session_b, workspace_id, AuditLogService(session_b, workspace_id, None)
        )._claim(10, datetime.now(UTC))
        assert claimed_a, "the first dispatcher must claim the due work"
        assert claimed_b == [], "the second dispatcher must skip every locked row"
        overlap = {d.id for d in claimed_a} & {d.id for d in claimed_b}
        assert overlap == set(), "no delivery may be claimed twice"
    finally:
        session_a.rollback(), session_b.rollback()
        session_a.close(), session_b.close()


# ------------------------------------------------------------------- filters and history
def test_alert_list_filters_sort_and_pagination(api):
    configure_policy(api, quiet_hours_enabled=False)
    account = restricted_account(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete", "external_account_id": "inc"})
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "A warning."},
    )

    everything = api.get("/api/v1/alerts?page_size=100").json()
    assert everything["total"] >= 3
    assert api.get("/api/v1/alerts?severity=critical").json()["total"] >= 1
    assert api.get("/api/v1/alerts?severity=warning").json()["total"] >= 1
    assert api.get("/api/v1/alerts?severity=info").json()["total"] >= 1
    assert api.get("/api/v1/alerts?source_type=health_signal").json()["total"] >= 3
    assert api.get(f"/api/v1/alerts?ad_account_id={account['id']}").json()["total"] >= 2
    assert api.get("/api/v1/alerts?readiness_status=not_ready").json()["total"] >= 1
    assert api.get("/api/v1/alerts?health_status=critical").json()["total"] >= 1
    assert api.get("/api/v1/alerts?search=restricted").json()["total"] >= 1
    assert api.get("/api/v1/alerts?status=open").json()["total"] >= 3

    worst_first = api.get("/api/v1/alerts?sort=severity&sort_direction=desc&page_size=100").json()["items"]
    assert worst_first[0]["severity"] == "critical"

    paged = api.get("/api/v1/alerts?page_size=2&page=2").json()
    assert paged["page"] == 2 and len(paged["items"]) <= 2


def test_notification_history_endpoints(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)

    listing = api.get("/api/v1/notifications?page_size=100").json()
    assert listing["total"] >= 1
    sent = api.get("/api/v1/notifications?status=sent").json()
    assert sent["total"] == 1
    assert api.get("/api/v1/notifications?failed_only=true").json()["total"] == 0

    delivery = sent["items"][0]
    assert delivery["recipient_masked"] == "…7890"
    detail = api.get(f"/api/v1/notifications/{delivery['id']}").json()
    assert detail["id"] == delivery["id"]
    assert api.get(f"/api/v1/notifications/{delivery['id']}/attempts").json()


def test_alert_summary_counts(api):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete", "external_account_id": "inc"})
    summary = api.get("/api/v1/alerts/summary").json()
    assert summary["open_critical"] >= 1
    assert summary["open_info"] >= 1
    assert summary["total_active"] >= 2
    assert summary["recipient_configured"] is True
    assert summary["telegram_transport_configured"] is False, "fake transport is not Telegram"
    assert "not a platform decision" in summary["disclaimer"]


def test_notification_status_summary_exposes_only_safe_counters(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    status = api.get("/api/v1/notifications/status/summary").json()
    assert status["transport_mode"] == "fake"
    assert status["telegram_transport_configured"] is False
    assert status["recipient_configured"] is True
    assert status["due_deliveries"] == 0
    assert status["last_successful_notification_at"] is not None
    assert "1001234567890" not in str(status)


def test_archived_account_resolves_its_alerts(api):
    configure_policy(api, quiet_hours_enabled=False)
    account = restricted_account(api)
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    assert api.get(f"/api/v1/alerts/{alert['id']}").json()["alert"]["status"] == "resolved"
