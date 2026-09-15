"""Standalone notification dispatcher (A4 §E).

A3 shipped a durable outbox with no scheduler, so a deferred message waited for a human. This
is the scheduler, chosen as a **dedicated bounded process** rather than a systemd timer or a
cron entry, because the deployment targets available to this project (Docker Compose, Coolify,
Vibe Host) run containers and give no host-unit access. One mechanism that works everywhere
beats three that each work somewhere.

It is deliberately unexciting:

* one pass, then ``sleep`` — a bounded loop, never a busy one;
* concurrency 1 and a bounded batch, so it cannot crowd a 4 vCPU host;
* it sends only what the policy already decided to send, and takes no recipient or body;
* it records every pass, so "the dispatcher stopped" is a visible state instead of silence;
* with the transport disabled or fake it still runs, still records, and sends nothing real.

    python -m app.commands.run_dispatcher              # loop until stopped
    python -m app.commands.run_dispatcher --once       # a single pass, for a timer or a check
"""
from __future__ import annotations

import argparse
import logging
import signal
import time
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.core.config import get_settings
from app.core.enums import EvaluationTrigger, OperationalRunKind, OperationalRunStatus
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models.entities import AdAccount, Workspace, WorkspaceMember
from app.models.health import AccountHealthSnapshot
from app.services.audit import AuditLogService
from app.services.health_service import AccountHealthEvaluationService
from app.services.notification_service import NotificationDispatcherService
from app.services.operations import OperationalRunService

logger = logging.getLogger(__name__)

_stop = False


def _request_stop(signum, _frame) -> None:  # pragma: no cover - signal path
    global _stop
    _stop = True
    logger.info("dispatcher stopping", extra={"signal": signum})


def one_pass(*, batch: int, recovery: bool) -> dict[str, int]:
    """A single dispatch (or recovery) pass across every workspace, recorded as one run."""
    totals = {
        "claimed": 0, "sent": 0, "failed_transient": 0, "failed_final": 0,
        "cancelled": 0, "recovered": 0, "due_remaining": 0, "workspaces": 0,
    }
    started = datetime.now(UTC)
    kind = OperationalRunKind.RECOVERY_SWEEP if recovery else OperationalRunKind.DISPATCH

    with session_scope() as session:
        runs = OperationalRunService(session)
        try:
            workspaces = list(
                session.execute(
                    sa.select(Workspace).where(Workspace.archived_at.is_(None))
                ).scalars().all()
            )
            for workspace in workspaces:
                member = session.execute(
                    sa.select(WorkspaceMember)
                    .where(WorkspaceMember.workspace_id == workspace.id)
                    .order_by(WorkspaceMember.created_at.asc())
                ).scalars().first()
                audit = AuditLogService(session, workspace.id, member.user_id if member else None)
                service = NotificationDispatcherService(session, workspace.id, audit)
                totals["workspaces"] += 1
                if recovery:
                    summary = service.recovery_sweep()
                    totals["recovered"] += int(summary.get("recovered", 0))
                else:
                    result = service.dispatch_due(batch_size=batch)
                    totals["claimed"] += result.claimed
                    totals["sent"] += result.sent
                    totals["failed_transient"] += result.failed_transient
                    totals["failed_final"] += result.failed_final
                    totals["cancelled"] += result.cancelled
                totals["due_remaining"] += service.due_count()
        except Exception as exc:
            session.rollback()
            runs.record(
                kind=kind,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                error_code=type(exc).__name__[:64],
                error_summary="The dispatcher pass failed; see the process log.",
            )
            session.commit()
            raise

        runs.record(
            kind=kind,
            status=(
                OperationalRunStatus.PARTIAL
                if totals["failed_final"]
                else OperationalRunStatus.SUCCEEDED
            ),
            started_at=started,
            summary=totals,
        )
    return totals


def _due_accounts(session, workspace_id, *, cutoff: datetime, batch: int):
    """Accounts whose health nobody has looked at recently, oldest first.

    Two different reasons to be due, kept apart on purpose (rule 28): an account with **no
    snapshot** has never been evaluated, and an account whose snapshot has aged is stale. Adding
    them together would make the first sweep of a fresh workspace report a large "stale" count that
    is not stale at all.

    The threshold is `health_evaluation_stale_after_hours` — the same one the read path uses — so
    the sweep and the badge on the screen agree by construction rather than by coincidence.
    """
    rows = session.execute(
        sa.select(AdAccount, AccountHealthSnapshot.last_evaluated_at)
        .outerjoin(
            AccountHealthSnapshot,
            sa.and_(
                AccountHealthSnapshot.ad_account_id == AdAccount.id,
                AccountHealthSnapshot.archived_at.is_(None),
            ),
        )
        .where(
            AdAccount.workspace_id == workspace_id,
            AdAccount.archived_at.is_(None),
            sa.or_(
                AccountHealthSnapshot.last_evaluated_at.is_(None),
                AccountHealthSnapshot.last_evaluated_at < cutoff,
            ),
        )
        # Never-evaluated first: nulls sort first ascending, which is the order we want anyway —
        # an account nobody has ever assessed is the more urgent of the two.
        .order_by(AccountHealthSnapshot.last_evaluated_at.asc().nullsfirst())
        .limit(batch)
    ).all()
    return list(rows)


def health_sweep_pass(*, batch: int) -> dict[str, int]:
    """Re-evaluate health for accounts nothing has touched, across every workspace.

    Health has always been recalculated on mutation and on request, which means an untouched
    account's evaluation ages and is then honestly reported as stale. This is what stops that from
    being the only outcome. It contacts no advertising platform: it re-reads stored records, the
    same as every other evaluation path.

    One account failing does not end the pass — `evaluate_account_safe()` keeps each evaluation in
    its own SAVEPOINT (rule 15), so a failure degrades that account to `unknown` and the sweep
    carries on.
    """
    settings = get_settings()
    totals = {
        "never_evaluated": 0, "stale": 0, "evaluated": 0,
        "failed": 0, "due_remaining": 0, "workspaces": 0,
    }
    started = datetime.now(UTC)
    cutoff = started - timedelta(hours=settings.health_evaluation_stale_after_hours)

    with session_scope() as session:
        runs = OperationalRunService(session)
        try:
            workspaces = list(
                session.execute(
                    sa.select(Workspace).where(Workspace.archived_at.is_(None))
                ).scalars().all()
            )
            for workspace in workspaces:
                member = session.execute(
                    sa.select(WorkspaceMember)
                    .where(WorkspaceMember.workspace_id == workspace.id)
                    .order_by(WorkspaceMember.created_at.asc())
                ).scalars().first()
                actor = member.user_id if member else None
                audit = AuditLogService(session, workspace.id, actor)
                service = AccountHealthEvaluationService(session, workspace.id, audit, actor)
                totals["workspaces"] += 1

                due = _due_accounts(session, workspace.id, cutoff=cutoff, batch=batch)
                for account, last_evaluated_at in due:
                    if last_evaluated_at is None:
                        totals["never_evaluated"] += 1
                    else:
                        totals["stale"] += 1
                    evaluation = service.evaluate_account_safe(
                        account, trigger=EvaluationTrigger.SCHEDULED_RECALCULATE
                    )
                    if evaluation.status.value == "failed":
                        totals["failed"] += 1
                    else:
                        totals["evaluated"] += 1

                # Measured after the batch, so "the sweep is not keeping up" is a number an
                # operator can see rather than something they have to infer.
                totals["due_remaining"] += len(
                    _due_accounts(session, workspace.id, cutoff=cutoff, batch=batch + 1)
                )
        except Exception as exc:
            session.rollback()
            runs.record(
                kind=OperationalRunKind.HEALTH_SWEEP,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                error_code=type(exc).__name__[:64],
                error_summary="The health sweep failed; see the process log.",
            )
            session.commit()
            raise

        runs.record(
            kind=OperationalRunKind.HEALTH_SWEEP,
            status=(
                OperationalRunStatus.PARTIAL
                if totals["failed"]
                else OperationalRunStatus.SUCCEEDED
            ),
            started_at=started,
            summary=totals,
        )
    return totals


def run_loop(
    *,
    batch: int,
    interval: int,
    recovery_every: int,
    health_every: int = 0,
    health_batch: int = 10,
) -> int:
    settings = get_settings()
    logger.info(
        "dispatcher started",
        extra={
            "transport": settings.notification_transport,
            "interval_seconds": interval,
            "batch": batch,
            # Logged so the answer to "is the sweep on?" is in the first line of the log rather
            # than inferred from whether runs appear later.
            "health_sweep_every_n_passes": health_every,
        },
    )
    passes = 0
    while not _stop:
        passes += 1
        try:
            totals = one_pass(batch=batch, recovery=False)
            logger.info("dispatch pass", extra=totals)
            if recovery_every and passes % recovery_every == 0:
                sweep = one_pass(batch=batch, recovery=True)
                logger.info("recovery sweep", extra=sweep)
            if health_every and passes % health_every == 0:
                health = health_sweep_pass(batch=health_batch)
                logger.info("health sweep", extra=health)
        except Exception:  # pragma: no cover - the loop must outlive one bad pass
            logger.exception("dispatcher pass failed; continuing")

        # Sleep in short slices so a stop signal is honoured promptly instead of after a
        # full interval. Still one wake-up per second at most: bounded, not busy.
        for _ in range(max(1, interval)):
            if _stop:
                break
            time.sleep(1)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the notification outbox dispatcher.")
    parser.add_argument("--once", action="store_true", help="A single pass, then exit.")
    parser.add_argument("--recovery-sweep", action="store_true", help="One recovery pass only.")
    parser.add_argument(
        "--health-sweep",
        action="store_true",
        help="One health re-evaluation pass only, then exit. Contacts no advertising platform.",
    )
    parser.add_argument("--batch", type=int, default=None, help="Deliveries per workspace.")
    parser.add_argument("--interval", type=int, default=None, help="Seconds between passes.")
    args = parser.parse_args()

    settings = get_settings()
    configure_logging(settings.log_level)
    batch = args.batch or settings.notification_dispatch_batch_size
    interval = args.interval or settings.dispatcher_interval_seconds
    if not 1 <= batch <= 50:
        parser.error("--batch must be between 1 and 50")
    if not 5 <= interval <= 3600:
        parser.error("--interval must be between 5 and 3600 seconds")

    if args.health_sweep:
        # Usable before the cadence is ever switched on: an operator can run one sweep by hand and
        # read exactly what it did, which is how you decide whether to enable it at all.
        totals = health_sweep_pass(batch=settings.health_sweep_batch)
        print(" ".join(f"{key}={value}" for key, value in sorted(totals.items())))
        raise SystemExit(0)

    if args.once or args.recovery_sweep:
        totals = one_pass(batch=batch, recovery=args.recovery_sweep)
        print(" ".join(f"{key}={value}" for key, value in sorted(totals.items())))
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)
    raise SystemExit(
        run_loop(
            batch=batch,
            interval=interval,
            recovery_every=settings.dispatcher_recovery_every_n_passes,
            health_every=settings.health_sweep_every_n_passes,
            health_batch=settings.health_sweep_batch,
        )
    )


if __name__ == "__main__":
    main()
