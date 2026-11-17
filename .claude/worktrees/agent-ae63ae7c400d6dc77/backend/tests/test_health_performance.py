"""Bounded resource check for 30 accounts (MINI-SPEC A2 §10.5).

Kept in the suite rather than run once by hand: a cost that is only ever measured on the day it
ships is a cost nobody notices growing.
"""
from __future__ import annotations

import resource
import time

import sqlalchemy as sa
from sqlalchemy import event

from app.core.enums import EvaluationTrigger
from app.models.entities import AdAccount
from app.services.audit import AuditLogService
from app.services.health_service import AccountHealthEvaluationService

ACCOUNT_COUNT = 30
#: Generous ceilings: the point is to catch an order-of-magnitude regression, not to benchmark
#: this particular machine.
MAX_AVERAGE_SECONDS = 1.5
MAX_AVERAGE_QUERIES = 60


def test_thirty_account_evaluation_stays_bounded(api, db_session, owner, capsys):
    for index in range(ACCOUNT_COUNT):
        response = api.post(
            "/api/v1/ad-accounts",
            json={
                "display_name": f"Perf {index:02d}",
                "external_account_id": f"perf_{index:02d}",
                "status": "active" if index % 3 else "restricted",
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
    service = AccountHealthEvaluationService(
        db_session, owner["workspace"].id, audit, owner["user"].id
    )
    started = time.perf_counter()
    for account in accounts:
        service.evaluate_account(account, trigger=EvaluationTrigger.SCHEDULED_RECALCULATE)
    db_session.commit()
    duration = time.perf_counter() - started

    event.remove(engine, "before_cursor_execute", count_query)
    rss_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    average = duration / ACCOUNT_COUNT
    with capsys.disabled():
        print(
            f"\n[A2 resource check] {ACCOUNT_COUNT} accounts | total {duration:.2f}s | "
            f"avg {average * 1000:.0f}ms | {queries} queries "
            f"({queries / ACCOUNT_COUNT:.1f}/account) | peak RSS {rss_after // 1024} MB "
            f"(+{(rss_after - rss_before) // 1024} MB)"
        )

    assert average < MAX_AVERAGE_SECONDS, f"average evaluation {average:.3f}s"
    assert queries / ACCOUNT_COUNT < MAX_AVERAGE_QUERIES, f"{queries / ACCOUNT_COUNT:.1f} queries/account"
