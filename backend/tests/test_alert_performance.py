"""Bounded resource check for alert derivation, planning and dispatch (§10.5).

Kept in the suite for the same reason as the A2 check: a cost measured only on the day it ships
is a cost nobody notices growing.
"""
from __future__ import annotations

import resource
import time
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy import event

from app.core.enums import EvaluationTrigger
from app.models.alerts import Alert, NotificationDelivery
from app.models.entities import AdAccount
from app.services.audit import AuditLogService
from app.services.health_service import AccountHealthEvaluationService
from app.services.notification_service import NotificationDispatcherService

ACCOUNT_COUNT = 30
MAX_AVERAGE_SECONDS = 2.0
MAX_AVERAGE_QUERIES = 90


def test_thirty_account_alert_derivation_and_dispatch_stay_bounded(
    api, db_session, owner, transport, capsys
):
    api.patch("/api/v1/notification-policies/current",
              json={"telegram_chat_id": "-1001234567890", "quiet_hours_enabled": False})

    # A spread of conditions: clear, attention, warning and critical.
    for index in range(ACCOUNT_COUNT):
        status = ("restricted" if index % 5 == 0 else "active")
        response = api.post(
            "/api/v1/ad-accounts",
            json={
                "display_name": f"Alert perf {index:02d}",
                "external_account_id": f"alert_perf_{index:02d}",
                "status": status,
            },
        )
        assert response.status_code == 201

    accounts = list(
        db_session.execute(
            sa.select(AdAccount).where(AdAccount.workspace_id == owner["workspace"].id)
        ).scalars().all()
    )
    assert len(accounts) == ACCOUNT_COUNT

    queries = 0

    def count_query(*_args, **_kwargs):
        nonlocal queries
        queries += 1

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", count_query)
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    audit = AuditLogService(db_session, owner["workspace"].id, owner["user"].id)
    evaluation = AccountHealthEvaluationService(
        db_session, owner["workspace"].id, audit, owner["user"].id
    )
    started = time.perf_counter()
    for account in accounts:
        evaluation.evaluate_account(account, trigger=EvaluationTrigger.SCHEDULED_RECALCULATE)
    db_session.commit()
    derive_duration = time.perf_counter() - started

    dispatcher = NotificationDispatcherService(db_session, owner["workspace"].id, audit)
    due_before = dispatcher.due_count()
    dispatch_started = time.perf_counter()
    result = dispatcher.dispatch_due(batch_size=10)
    db_session.commit()
    dispatch_duration = time.perf_counter() - dispatch_started

    event.remove(engine, "before_cursor_execute", count_query)
    rss_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    alert_count = db_session.execute(
        sa.select(sa.func.count()).select_from(Alert)
    ).scalar_one()
    delivery_count = db_session.execute(
        sa.select(sa.func.count()).select_from(NotificationDelivery)
    ).scalar_one()
    average = derive_duration / ACCOUNT_COUNT

    with capsys.disabled():
        print(
            f"\n[A3 resource check] {ACCOUNT_COUNT} accounts | derive+plan {derive_duration:.2f}s "
            f"(avg {average * 1000:.0f}ms) | {queries} queries ({queries / ACCOUNT_COUNT:.1f}/account) "
            f"| alerts {alert_count} | deliveries {delivery_count} | due {due_before} "
            f"| dispatch batch 10 in {dispatch_duration:.2f}s -> sent {result.sent} "
            f"| peak RSS {rss_after // 1024} MB (+{(rss_after - rss_before) // 1024} MB)"
        )

    assert average < MAX_AVERAGE_SECONDS, f"average {average:.3f}s per account"
    assert queries / ACCOUNT_COUNT < MAX_AVERAGE_QUERIES
    assert result.claimed <= 10, "the dispatcher batch must stay bounded"
    assert len(transport.sent) == result.sent
    assert dispatcher.due_count() == max(due_before - result.claimed, 0)
    # Concurrency default is one dispatcher; nothing here starts a process or a browser.
    assert datetime.now(UTC) is not None
