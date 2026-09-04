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
from datetime import UTC, datetime

import sqlalchemy as sa

from app.core.config import get_settings
from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models.entities import Workspace, WorkspaceMember
from app.services.audit import AuditLogService
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


def run_loop(*, batch: int, interval: int, recovery_every: int) -> int:
    settings = get_settings()
    logger.info(
        "dispatcher started",
        extra={
            "transport": settings.notification_transport,
            "interval_seconds": interval,
            "batch": batch,
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
        )
    )


if __name__ == "__main__":
    main()
