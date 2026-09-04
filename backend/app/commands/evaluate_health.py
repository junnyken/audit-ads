"""Bounded health evaluation from the command line.

This is the scheduler seam. A2 ships no Celery, no Redis and no cron job — A1 has none and the
target VPS has no headroom for one — so periodic evaluation is a command an operator or a future
A3 scheduler invokes, not a daemon this release starts on its own::

    python -m app.commands.evaluate_health --workspace <slug> --batch 5

It contacts no advertising platform and starts no browser: it re-reads stored records.
"""
from __future__ import annotations

import argparse
import logging
import sys

import sqlalchemy as sa

from app.core.enums import EvaluationTrigger
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models.entities import AdAccount, Workspace, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.health_service import AccountHealthEvaluationService

logger = logging.getLogger(__name__)


def run(workspace_slug: str | None, batch: int) -> int:
    with session_scope() as session:
        stmt = sa.select(Workspace).where(Workspace.archived_at.is_(None))
        if workspace_slug:
            stmt = stmt.where(Workspace.slug == workspace_slug)
        workspaces = list(session.execute(stmt).scalars().all())
        if not workspaces:
            print("No workspace found.", file=sys.stderr)
            return 1

        failures = 0
        for workspace in workspaces:
            member = session.execute(
                sa.select(WorkspaceMember)
                .where(WorkspaceMember.workspace_id == workspace.id)
                .order_by(WorkspaceMember.created_at.asc())
            ).scalars().first()
            audit = AuditLogService(session, workspace.id, member.user_id if member else None)
            service = AccountHealthEvaluationService(
                session, workspace.id, audit, member.user_id if member else None
            )
            accounts = list(
                session.execute(
                    sa.select(AdAccount)
                    .where(
                        AdAccount.workspace_id == workspace.id, AdAccount.archived_at.is_(None)
                    )
                    .order_by(AdAccount.updated_at.asc())
                    .limit(batch)
                ).scalars().all()
            )
            for account in accounts:
                evaluation = service.evaluate_account_safe(
                    account, trigger=EvaluationTrigger.SCHEDULED_RECALCULATE
                )
                if evaluation.status.value == "failed":
                    failures += 1
                print(f"{workspace.slug}\t{account.display_name}\t{evaluation.status.value}")
        return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate account health for a bounded batch.")
    parser.add_argument("--workspace", help="Workspace slug. Omit to cover every workspace.")
    parser.add_argument("--batch", type=int, default=5, help="Accounts per workspace (default 5).")
    args = parser.parse_args()
    if args.batch < 1 or args.batch > 200:
        parser.error("--batch must be between 1 and 200")
    configure_logging("INFO")
    raise SystemExit(run(args.workspace, args.batch))


if __name__ == "__main__":
    main()
