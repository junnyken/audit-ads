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
    python -m app.commands.run_dispatcher --spend-sweep  # one S1 spend read pass, then exit
    python -m app.commands.run_dispatcher --discovery-sweep  # one O3 discovery pass, then exit
"""
from __future__ import annotations

import argparse
import logging
import signal
import time
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.core.config import get_settings
from app.core.enums import (
    EvaluationTrigger,
    OperationalRunKind,
    OperationalRunStatus,
    SpendObservationTrigger,
)
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models.entities import AdAccount, Workspace, WorkspaceMember
from app.models.health import AccountHealthSnapshot
from app.services import discovery_sweep, spend_service
from app.services.audit import (
    SYSTEM_DISCOVERY_SWEEP_ACTOR,
    AuditLogService,
    SystemAuditLogService,
)
from app.services.health_service import AccountHealthEvaluationService
from app.services.meta_provider import MetaFailureCode
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


def spend_sweep_pass(*, batch: int) -> dict[str, int]:
    """S1. Read spend from Meta for accounts whose spend observation is missing or stale.

    **The first path in this product that calls Meta without a person pressing a button**, so it
    is fenced on every side: off by default (`spend_sweep_every_n_passes = 0`), bounded
    (`batch` accounts per workspace, two GETs each), read-only (the real provider cannot write and
    this pass never asks it to), and it stops reading through a connection the moment Meta says
    `rate_limited` — no sleep, no retry; what it could not reach is `due_remaining` and the next
    pass picks it up.

    Every read is recorded, failures included, and is followed by a health evaluation in its own
    SAVEPOINT (rules 15/21) that reads the stored observation — never the platform. Each
    workspace commits on its own, together with its audit row (rule 3), so reads already paid for
    are not thrown away by a later workspace's failure.

    Never-observed and stale stay separate counters (rule 28); accounts nothing can read are
    `not_observable` and are never due. `AdAccount.last_synced_at` is not written.
    """
    settings = get_settings()
    totals = {
        "never_observed": 0, "stale": 0, "observed": 0, "failed": 0, "rate_limited": 0,
        "not_observable": 0, "due_remaining": 0, "workspaces": 0,
    }
    started = datetime.now(UTC)
    cutoff = started - timedelta(hours=settings.spend_observation_stale_after_hours)

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
                evaluation = AccountHealthEvaluationService(session, workspace.id, audit, actor)
                observations = spend_service.SpendObservationService(session, workspace.id)
                totals["workspaces"] += 1

                selection = spend_service.select_due_accounts(
                    session, workspace.id, cutoff=cutoff, settings=settings
                )
                totals["not_observable"] += selection.not_observable
                stopped: set = set()
                providers: dict = {}
                identities: dict = {}
                read_ids: list[str] = []
                counts = {"observed": 0, "failed": 0, "rate_limited": 0}
                for position, due in enumerate(selection.due):
                    if position >= batch:
                        totals["due_remaining"] += len(selection.due) - position
                        break
                    connection_id = due.reader.connection.id
                    if connection_id in stopped:
                        # Meta already said "slow down" for this connection in this pass.
                        totals["due_remaining"] += 1
                        continue
                    if connection_id not in providers:
                        providers[connection_id] = spend_service.provider_for_connection(due.reader)
                        # Once per connection per pass: who read is evidence, and asking per
                        # account would spend a call per account to learn the same answer.
                        identities[connection_id] = providers[connection_id].identify()
                    if due.never_observed:
                        totals["never_observed"] += 1
                    else:
                        totals["stale"] += 1
                    observation, read = observations.read_and_record(
                        due.account,
                        due.reader,
                        providers[connection_id],
                        trigger=SpendObservationTrigger.SCHEDULED_SWEEP,
                        identity=identities[connection_id],
                    )
                    read_ids.append(str(due.account.id))
                    if read.ok:
                        counts["observed"] += 1
                    elif read.failure_code is MetaFailureCode.RATE_LIMITED:
                        counts["rate_limited"] += 1
                        stopped.add(connection_id)
                    else:
                        counts["failed"] += 1
                    evaluation.evaluate_account_safe(
                        due.account,
                        trigger=EvaluationTrigger.SPEND_OBSERVATION,
                        trigger_reference_id=str(observation.id),
                    )
                for key, value in counts.items():
                    totals[key] += value
                if read_ids:
                    # One row per workspace per pass, not per observation: 30 accounts read hourly
                    # would otherwise be 720 audit rows a day saying the same thing.
                    audit.record(
                        action="spend.observations_recorded",
                        entity_type="spend_sweep_pass",
                        entity_id=uuid.uuid4(),
                        after={**counts, "ad_account_ids": read_ids},
                        metadata={"trigger": SpendObservationTrigger.SCHEDULED_SWEEP.value},
                    )
                session.commit()
        except Exception as exc:
            session.rollback()
            runs.record(
                kind=OperationalRunKind.SPEND_SWEEP,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                error_code=type(exc).__name__[:64],
                error_summary="The spend sweep failed; see the process log.",
            )
            session.commit()
            raise

        runs.record(
            kind=OperationalRunKind.SPEND_SWEEP,
            status=(
                OperationalRunStatus.PARTIAL
                if totals["failed"] or totals["rate_limited"]
                else OperationalRunStatus.SUCCEEDED
            ),
            started_at=started,
            summary=totals,
        )
    return totals


def discovery_sweep_pass(*, batch: int) -> dict[str, int]:
    """O3. Run discovery for automatic connections that are due, and — where the owner allowed
    it — import the ad accounts a usable run returned that the registry does not hold.

    The second path in this product that calls Meta without a person pressing a button, and the
    first that **writes the registry** without one, so it carries every fence S1 has and more:

    * two switches held by different people — this cadence (`discovery_sweep_every_n_passes`,
      **0 = off, the default**: a release decision) and the per-connection
      `auto_discovery_enabled` / `auto_import_enabled` the owner sets with an audited PATCH;
    * `fake`/`sandbox` connections are never selected, so fake data can never be imported;
    * bounded (`batch` connections per workspace, about six GETs each), one 24 h cadence per
      connection (`discovery_stale_after_hours`), read-only, and it stops reading through a
      credential the moment Meta says `rate_limited` — no sleep, no retry;
    * one SAVEPOINT per connection and one per imported account, so a race or a defect costs
      that one row, not the pass; an archived account Meta still returns is counted, never
      imported and never restored; absence archives nothing;
    * the actor is the system — `actor_id = NULL`, `metadata.actor = "system:discovery_sweep"` —
      never "the first member of the workspace";
    * one summary alert per pass per connection when there is something new, never one message
      per imported account.

    Each workspace commits on its own, with its audit rows (rule 3).
    """
    settings = get_settings()
    totals = {
        "never_discovered": 0, "stale": 0, "runs": 0, "succeeded": 0, "warnings": 0,
        "failed": 0, "rate_limited": 0, "not_configured": 0, "imported": 0,
        "already_in_registry": 0, "archived_returned": 0, "conflicts": 0, "awaiting_import": 0,
        "pixels_new": 0, "not_returned_complete": 0, "summaries": 0, "due_remaining": 0,
        "workspaces": 0,
    }
    started = datetime.now(UTC)
    cutoff = started - timedelta(hours=settings.discovery_stale_after_hours)
    operational_run_id = uuid.uuid4()

    with session_scope() as session:
        runs = OperationalRunService(session)
        try:
            workspaces = list(
                session.execute(
                    sa.select(Workspace).where(Workspace.archived_at.is_(None))
                ).scalars().all()
            )
            for workspace in workspaces:
                audit = SystemAuditLogService(
                    session,
                    workspace.id,
                    actor=SYSTEM_DISCOVERY_SWEEP_ACTOR,
                    operational_run_id=operational_run_id,
                )
                service = discovery_sweep.DiscoverySweepService(
                    session, workspace.id, audit, settings=settings
                )
                totals["workspaces"] += 1
                selection = discovery_sweep.select_due_connections(
                    session, workspace.id, cutoff=cutoff, settings=settings
                )
                totals["not_configured"] += selection.not_configured
                stopped: set[str] = set()
                swept: list[dict] = []
                imported_ids: list[str] = []
                for position, due in enumerate(selection.due):
                    if position >= batch:
                        totals["due_remaining"] += len(selection.due) - position
                        break
                    budget = discovery_sweep.budget_key(due.reader)
                    if budget in stopped:
                        # Meta already said "slow down" to this credential in this pass.
                        totals["due_remaining"] += 1
                        continue
                    totals["never_discovered" if due.never_discovered else "stale"] += 1
                    provider = spend_service.provider_for_connection(due.reader)
                    outcome = service.sweep_connection(due, provider)
                    totals["runs"] += 1
                    totals[outcome.status] += 1
                    if outcome.rate_limited:
                        totals["rate_limited"] += 1
                        stopped.add(budget)
                    for key, value in outcome.counters().items():
                        totals[key] += value
                    if outcome.summary_alert is not None:
                        totals["summaries"] += 1
                    imported_ids.extend(account_id for account_id, _, _ in outcome.imported)
                    swept.append(
                        {
                            "meta_connection_id": str(due.connection.id),
                            "discovery_run_id": str(outcome.run.id) if outcome.run else None,
                            "status": outcome.status,
                            **outcome.counters(),
                        }
                    )
                if swept:
                    # One row per workspace per pass (the S1 precedent), naming every account the
                    # pass imported — the per-account provenance rows sit beside it.
                    audit.record(
                        action="meta_discovery.sweep_pass_recorded",
                        entity_type="discovery_sweep_pass",
                        entity_id=operational_run_id,
                        after={"connections": swept, "ad_account_ids": imported_ids},
                        metadata={"trigger": "scheduled_sweep"},
                    )
                session.commit()
        except Exception as exc:
            session.rollback()
            runs.record(
                kind=OperationalRunKind.DISCOVERY_SWEEP,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                error_code=type(exc).__name__[:64],
                error_summary="The discovery sweep failed; see the process log.",
                run_id=operational_run_id,
            )
            session.commit()
            raise

        runs.record(
            kind=OperationalRunKind.DISCOVERY_SWEEP,
            status=(
                OperationalRunStatus.PARTIAL
                if totals["failed"] or totals["rate_limited"] or totals["conflicts"]
                else OperationalRunStatus.SUCCEEDED
            ),
            started_at=started,
            summary=totals,
            run_id=operational_run_id,
        )
    return totals


def run_loop(
    *,
    batch: int,
    interval: int,
    recovery_every: int,
    health_every: int = 0,
    health_batch: int = 10,
    spend_every: int = 0,
    spend_batch: int = 10,
    discovery_every: int = 0,
    discovery_batch: int = 5,
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
            # S1: a pass here that calls Meta. Zero means it never runs.
            "spend_sweep_every_n_passes": spend_every,
            # O3: calls Meta and may write the registry. Zero means it never runs.
            "discovery_sweep_every_n_passes": discovery_every,
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
            if spend_every and passes % spend_every == 0:
                spend = spend_sweep_pass(batch=spend_batch)
                logger.info("spend sweep", extra=spend)
            if discovery_every and passes % discovery_every == 0:
                # An account imported here is `never_observed`, so the next spend pass puts it
                # first in line — S1/S2 take over without anyone pressing anything.
                discovery = discovery_sweep_pass(batch=discovery_batch)
                logger.info("discovery sweep", extra=discovery)
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
    parser.add_argument(
        "--spend-sweep",
        action="store_true",
        help=(
            "One spend read pass only, then exit. Reads Meta (GET only) for accounts whose spend is "
            "missing or stale, bounded by SPEND_SWEEP_BATCH."
        ),
    )
    parser.add_argument(
        "--discovery-sweep",
        action="store_true",
        help=(
            "One discovery pass only, then exit. Reads Meta (GET only) for connections whose owner "
            "switched them to automatic, and imports new ad accounts where that is allowed too."
        ),
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

    if args.spend_sweep:
        # One pass by hand, before the cadence is ever switched on: run it, read what Meta said
        # about rate limits and units, then decide whether to enable it at all.
        totals = spend_sweep_pass(batch=settings.spend_sweep_batch)
        print(" ".join(f"{key}={value}" for key, value in sorted(totals.items())))
        raise SystemExit(0)

    if args.discovery_sweep:
        # One pass by hand before the cadence is switched on. It still only touches connections
        # whose owner turned `auto_discovery_enabled` on — a person's switch, not this flag.
        totals = discovery_sweep_pass(batch=settings.discovery_sweep_batch)
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
            spend_every=settings.spend_sweep_every_n_passes,
            spend_batch=settings.spend_sweep_batch,
            discovery_every=settings.discovery_sweep_every_n_passes,
            discovery_batch=settings.discovery_sweep_batch,
        )
    )


if __name__ == "__main__":
    main()
