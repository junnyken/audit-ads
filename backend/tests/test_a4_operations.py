"""A4 §10.6/§10.7 — dispatcher scheduling, observability, and the controlled test send.

Every test here uses the fake transport. No real Telegram call is made anywhere in this file,
and no bot token exists in the test environment.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.core.config import Settings
from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.models.operations import OperationalRun
from app.services.operations import (
    OperationalRunService,
    collect_host_metrics,
    evaluate_thresholds,
    sanitise_summary,
    staleness,
)
from app.services.test_send import TestSendService, mask_chat_reference, render_test_message

# ---- run recording -------------------------------------------------------------------


def test_a_run_is_recorded_with_duration_and_release(session):
    service = OperationalRunService(session)
    started = datetime.now(UTC) - timedelta(seconds=2)
    run = service.record(
        kind=OperationalRunKind.DISPATCH,
        status=OperationalRunStatus.SUCCEEDED,
        started_at=started,
        summary={"claimed": 3, "sent": 3},
    )
    session.commit()
    assert run.duration_ms >= 1900
    assert run.summary_json == {"claimed": 3, "sent": 3}
    assert run.release_version is not None


def test_a_summary_drops_anything_not_on_the_allowlist():
    clean = sanitise_summary(
        {
            "sent": 2,
            "chat_id": "-1001234567890",
            "bot_token": "123456:AAsecret",
            "backup_path": "/var/backups/adsops/x.sql.gz",
            "database_label": "adsops",
        }
    )
    assert clean == {"sent": 2, "database_label": "adsops"}


def test_a_failed_run_records_a_code_and_never_the_exception_text(session):
    service = OperationalRunService(session)
    try:
        with service.track(OperationalRunKind.BACKUP):
            raise RuntimeError("pg_dump: connection to server at 10.0.0.5 failed: password xyz")
    except RuntimeError:
        pass
    session.commit()
    run = service.latest(OperationalRunKind.BACKUP)
    assert run.status == OperationalRunStatus.FAILED
    assert run.error_code == "RuntimeError"
    assert "10.0.0.5" not in (run.error_summary or "")
    assert "xyz" not in (run.error_summary or "")


def test_latest_successful_ignores_a_later_failure(session):
    service = OperationalRunService(session)
    now = datetime.now(UTC)
    service.record(
        kind=OperationalRunKind.BACKUP,
        status=OperationalRunStatus.SUCCEEDED,
        started_at=now - timedelta(hours=2),
        summary={"size_bytes": 1024},
    )
    service.record(
        kind=OperationalRunKind.BACKUP,
        status=OperationalRunStatus.FAILED,
        started_at=now,
        error_code="disk_full",
    )
    session.commit()
    assert service.latest(OperationalRunKind.BACKUP).status == OperationalRunStatus.FAILED
    ok = service.latest_successful(OperationalRunKind.BACKUP)
    assert ok.status == OperationalRunStatus.SUCCEEDED


def test_operational_runs_carry_no_tenant_column():
    """Infrastructure history is not workspace data; pretending otherwise breaks the signal."""
    assert "workspace_id" not in OperationalRun.__table__.columns


# ---- staleness and thresholds ---------------------------------------------------------


def test_never_run_is_distinct_from_stale():
    assert staleness(None, limit=timedelta(minutes=15)) == "never"
    assert staleness(datetime.now(UTC) - timedelta(hours=1), limit=timedelta(minutes=15)) == "stale"
    assert staleness(datetime.now(UTC), limit=timedelta(minutes=15)) == "current"


def test_a_naive_timestamp_is_treated_as_utc_rather_than_crashing():
    assert staleness(datetime.now(UTC).replace(tzinfo=None), limit=timedelta(hours=1)) == "current"


def test_host_metrics_are_read_without_the_docker_socket():
    metrics = collect_host_metrics()
    assert metrics.cpu_count is None or metrics.cpu_count > 0
    assert metrics.disk_total_gb is None or metrics.disk_total_gb > 0
    import inspect

    import app.services.operations as module

    source = inspect.getsource(module)
    assert "docker.sock" not in source
    assert "import docker" not in source


def test_a_missing_metric_reports_unknown_rather_than_ok():
    from app.services.operations import HostMetrics

    empty = HostMetrics(*([None] * 10))
    assert evaluate_thresholds(empty) == {"cpu": "unknown", "memory": "unknown", "disk": "unknown"}


def test_threshold_bands_escalate():
    from app.services.operations import HostMetrics

    def at(percent: float) -> HostMetrics:
        return HostMetrics(
            cpu_count=4, load_average_1m=None, load_percent=percent,
            memory_total_mb=1000, memory_available_mb=None, memory_used_percent=percent,
            disk_total_gb=100.0, disk_free_gb=None, disk_used_percent=percent, swap_total_mb=0,
        )

    assert evaluate_thresholds(at(10.0))["cpu"] == "ok"
    assert evaluate_thresholds(at(82.0))["cpu"] == "warning"
    assert evaluate_thresholds(at(96.0))["cpu"] == "critical"
    assert evaluate_thresholds(at(78.0))["memory"] == "warning"  # the memory band is tighter
    assert evaluate_thresholds(at(86.0))["memory"] == "critical"


# ---- test-send preview -----------------------------------------------------------------


def _settings(**overrides) -> Settings:
    base = {
        "environment": "staging",
        "environment_label": "staging",
        "notification_transport": "fake",
        "telegram_bot_token": "",
        "public_app_url": "https://adsops.example.com",
        "allow_test_send": False,
    }
    base.update(overrides)
    return Settings(**base)


def test_the_test_message_matches_the_required_template_and_carries_nothing_else():
    message = render_test_message(
        environment="staging",
        moment=datetime(2026, 9, 5, 3, 0, tzinfo=UTC),
        timezone_name="Asia/Ho_Chi_Minh",
        dashboard_link="https://adsops.example.com",
    )
    assert message.startswith("[AdsOps] TEST NOTIFICATION")
    assert "This is a controlled delivery verification for AdsOps Control Center." in message
    assert "Environment: staging" in message
    assert "Transport: Telegram" in message
    assert "Result expected: one message only" in message
    assert "2026-09-05 10:00" in message  # rendered in the policy timezone, not UTC
    lowered = message.lower()
    for forbidden in ("account", "token", "password", "cookie", "proxy", "signal", "traceback"):
        assert forbidden not in lowered


def test_an_unsafe_public_url_is_omitted_rather_than_sent(session, workspace, alert_policy):
    service = TestSendService(session, _settings(public_app_url="http://127.0.0.1:5173"))
    preview = service.build_preview(alert_policy)
    assert "127.0.0.1" not in preview.message
    link_check = next(c for c in preview.checks if c.code == "dashboard_link_safe")
    assert link_check.passed


def test_a_preview_never_reveals_the_recipient_in_full(session, workspace, alert_policy):
    alert_policy.telegram_chat_id = "-1009876543210"
    session.flush()
    preview = TestSendService(session, _settings()).build_preview(alert_policy)
    assert preview.recipient_masked == "…3210"
    assert "-1009876543210" not in preview.as_dict()["message"]
    assert "9876543210" not in str(preview.as_dict())


def test_masking_keeps_a_public_name_readable():
    assert mask_chat_reference("@adsops_alerts") == "@adsops_alerts"
    assert mask_chat_reference("-1001234567890") == "…7890"
    assert mask_chat_reference(None) is None


def test_a_preview_blocks_when_the_transport_is_not_ready(session, workspace, alert_policy):
    preview = TestSendService(session, _settings()).build_preview(alert_policy)
    failed = {check.code for check in preview.checks if not check.passed}
    assert {"transport_is_telegram", "bot_token_configured", "send_explicitly_enabled"} <= failed
    assert preview.ready is False


def test_a_preview_never_sends_anything(session, workspace, alert_policy, transport):
    TestSendService(session, _settings()).build_preview(alert_policy)
    assert transport.sent == []


# ---- test-send execution (fake transport only) -----------------------------------------


def _ready_settings(**overrides) -> Settings:
    return _settings(
        notification_transport="telegram",
        telegram_bot_token="fake-token-for-tests-only",
        allow_test_send=True,
        **overrides,
    )


def test_a_send_refuses_without_the_matching_approval_code(session, workspace, alert_policy, transport):
    alert_policy.telegram_chat_id = "-1001234567890"
    session.flush()
    service = TestSendService(session, _ready_settings())
    sent, detail, _ = service.send(
        policy=alert_policy, transport=transport, approval_code="not-the-token"
    )
    assert sent is False
    assert detail == "approval_code_mismatch"
    assert transport.sent == []


def test_a_send_refuses_while_a_pre_send_check_is_failing(session, workspace, alert_policy, transport):
    alert_policy.telegram_chat_id = None
    session.flush()
    service = TestSendService(session, _ready_settings())
    preview = service.build_preview(alert_policy)
    sent, detail, _ = service.send(
        policy=alert_policy, transport=transport, approval_code=preview.approval_code
    )
    assert sent is False
    assert "recipient_resolved" in detail
    assert transport.sent == []


def test_exactly_one_message_is_sent_and_a_second_attempt_is_refused(
    session, workspace, alert_policy, transport
):
    alert_policy.telegram_chat_id = "-1001234567890"
    session.flush()
    service = TestSendService(session, _ready_settings())
    preview = service.build_preview(alert_policy)
    assert preview.ready is True

    sent, detail, _ = service.send(
        policy=alert_policy, transport=transport, approval_code=preview.approval_code
    )
    session.commit()
    assert sent is True
    assert len(transport.sent) == 1
    assert detail.startswith("fake-")

    again, reason, _ = service.send(
        policy=alert_policy, transport=transport, approval_code=preview.approval_code
    )
    assert again is False
    assert reason == "already_sent_for_this_preview"
    assert len(transport.sent) == 1


def test_the_test_send_dedupe_key_is_isolated_from_alert_delivery(
    session, workspace, alert_policy, transport
):
    """It records an operational run, not a NotificationDelivery: no alert outbox collision."""
    from app.models.alerts import NotificationDelivery

    alert_policy.telegram_chat_id = "-1001234567890"
    session.flush()
    before = session.execute(
        sa.select(sa.func.count()).select_from(NotificationDelivery)
    ).scalar_one()

    service = TestSendService(session, _ready_settings())
    preview = service.build_preview(alert_policy)
    service.send(policy=alert_policy, transport=transport, approval_code=preview.approval_code)
    session.commit()

    after = session.execute(
        sa.select(sa.func.count()).select_from(NotificationDelivery)
    ).scalar_one()
    assert after == before
    run = OperationalRunService(session).latest(OperationalRunKind.TEST_SEND)
    assert run.status == OperationalRunStatus.SUCCEEDED
    assert run.summary_json["message_count"] == 1


def test_a_test_send_creates_no_alert_and_changes_no_source_record(
    session, workspace, alert_policy, transport
):
    from app.models.alerts import Alert
    from app.models.entities import AdAccount
    from app.models.health import AccountHealthSignal

    alert_policy.telegram_chat_id = "-1001234567890"
    session.flush()
    counts_before = {
        model.__name__: session.execute(sa.select(sa.func.count()).select_from(model)).scalar_one()
        for model in (Alert, AdAccount, AccountHealthSignal)
    }

    service = TestSendService(session, _ready_settings())
    preview = service.build_preview(alert_policy)
    service.send(policy=alert_policy, transport=transport, approval_code=preview.approval_code)
    session.commit()

    counts_after = {
        model.__name__: session.execute(sa.select(sa.func.count()).select_from(model)).scalar_one()
        for model in (Alert, AdAccount, AccountHealthSignal)
    }
    assert counts_after == counts_before


def test_a_transport_failure_is_recorded_safely_and_sends_nothing(
    session, workspace, alert_policy, transport
):
    from app.core.enums import DeliveryFailureCode
    from app.services.notification_transport import TransportResult

    alert_policy.telegram_chat_id = "-1001234567890"
    session.flush()
    transport.queue_failure(
        TransportResult(
            ok=False,
            failure_code=DeliveryFailureCode.UNAUTHORIZED,
            failure_summary="The bot token was rejected.",
        )
    )
    service = TestSendService(session, _ready_settings())
    preview = service.build_preview(alert_policy)
    sent, detail, _ = service.send(
        policy=alert_policy, transport=transport, approval_code=preview.approval_code
    )
    session.commit()
    assert sent is False
    assert detail == "transport_failed"
    run = OperationalRunService(session).latest(OperationalRunKind.TEST_SEND)
    assert run.status == OperationalRunStatus.FAILED
    assert run.error_code == "unauthorized"
    assert "token" not in (run.error_summary or "").lower() or "bot token" in (
        run.error_summary or ""
    ).lower()
    # The failure summary is a sentence, never a provider body or a URL.
    assert "http" not in (run.error_summary or "").lower()
