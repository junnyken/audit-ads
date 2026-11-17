"""Work the notification outbox from the command line.

A3 ships no scheduler, for the same reason A2 shipped none: A1 has no worker and the target VPS
has no headroom. This command is the seam. Run it from cron, a systemd timer, or by hand::

    python -m app.commands.dispatch_notifications --batch 10
    python -m app.commands.dispatch_notifications --recovery-sweep

It sends only what the policy already decided to send. It takes no recipient and no message
body, so it cannot be used to force a message out.
"""
from __future__ import annotations

import argparse
import logging

import sqlalchemy as sa

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models.entities import Workspace, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.notification_service import NotificationDispatcherService

logger = logging.getLogger(__name__)


def run(*, workspace_slug: str | None, batch: int, recovery: bool) -> int:
    settings = get_settings()
    print(f"transport: {settings.notification_transport}")
    with session_scope() as session:
        stmt = sa.select(Workspace).where(Workspace.archived_at.is_(None))
        if workspace_slug:
            stmt = stmt.where(Workspace.slug == workspace_slug)
        workspaces = list(session.execute(stmt).scalars().all())
        if not workspaces:
            print("No workspace found.")
            return 1

        failures = 0
        for workspace in workspaces:
            member = session.execute(
                sa.select(WorkspaceMember)
                .where(WorkspaceMember.workspace_id == workspace.id)
                .order_by(WorkspaceMember.created_at.asc())
            ).scalars().first()
            audit = AuditLogService(session, workspace.id, member.user_id if member else None)
            service = NotificationDispatcherService(session, workspace.id, audit)

            if recovery:
                summary = service.recovery_sweep()
                print(f"{workspace.slug}\trecovered={summary['recovered']}\tdue={summary['due']}")
                continue

            result = service.dispatch_due(batch_size=batch)
            failures += result.failed_final
            print(
                f"{workspace.slug}\tclaimed={result.claimed}\tsent={result.sent}"
                f"\tretry={result.failed_transient}\tfailed={result.failed_final}"
                f"\tcancelled={result.cancelled}\tdue_remaining={service.due_count()}"
            )
        return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Dispatch due notification deliveries.")
    parser.add_argument("--workspace", help="Workspace slug. Omit to cover every workspace.")
    parser.add_argument("--batch", type=int, default=10, help="Deliveries per workspace (max 50).")
    parser.add_argument(
        "--recovery-sweep",
        action="store_true",
        help="Reclaim deliveries stranded by a dispatcher that died mid-send. Sends nothing.",
    )
    args = parser.parse_args()
    if args.batch < 1 or args.batch > 50:
        parser.error("--batch must be between 1 and 50")
    configure_logging("INFO")
    raise SystemExit(run(workspace_slug=args.workspace, batch=args.batch, recovery=args.recovery_sweep))


if __name__ == "__main__":
    main()
