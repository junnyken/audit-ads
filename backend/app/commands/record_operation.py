"""Record an operational run from a shell script (A4).

The backup and restore-drill scripts run outside the application, but their outcome belongs on
the same status page as the dispatcher's. This is the seam: a tiny command that writes one
allowlisted row and nothing else.

    python -m app.commands.record_operation backup succeeded --size-bytes 91234
    python -m app.commands.record_operation restore_drill failed --table-count 0

It accepts counters only. There is deliberately no ``--path`` and no ``--message``: a backup
path or a shell error is exactly the sort of detail that should not end up on a screen.
"""
from __future__ import annotations

import argparse
from datetime import UTC, datetime

from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.db.session import session_scope
from app.services.operations import OperationalRunService


def main() -> None:
    parser = argparse.ArgumentParser(description="Record one operational run.")
    parser.add_argument("kind", choices=[kind.value for kind in OperationalRunKind])
    parser.add_argument("status", choices=[status.value for status in OperationalRunStatus])
    parser.add_argument("--size-bytes", type=int, default=None)
    parser.add_argument("--table-count", type=int, default=None)
    parser.add_argument("--revision", default=None)
    parser.add_argument("--database-label", default=None)
    parser.add_argument("--duration-seconds", type=float, default=None)
    parser.add_argument("--error-code", default=None)
    args = parser.parse_args()

    summary = {
        "size_bytes": args.size_bytes,
        "table_count": args.table_count,
        "revision": args.revision,
        "database_label": args.database_label,
        "duration_seconds": args.duration_seconds,
        "checksum_algorithm": "sha256" if args.size_bytes is not None else None,
    }
    started = datetime.now(UTC)
    if args.duration_seconds:
        started = datetime.fromtimestamp(
            started.timestamp() - args.duration_seconds, tz=UTC
        )

    with session_scope() as session:
        run = OperationalRunService(session).record(
            kind=OperationalRunKind(args.kind),
            status=OperationalRunStatus(args.status),
            started_at=started,
            summary={k: v for k, v in summary.items() if v is not None},
            error_code=args.error_code,
        )
        print(f"recorded {run.kind.value} {run.status.value}")


if __name__ == "__main__":
    main()
