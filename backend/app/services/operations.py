"""Recording and reading operational runs, plus host resource observation (A4).

Two rules shape this module:

* Nothing it stores can identify a tenant, a recipient, a path or a secret. A status page has
  to be safe to leave open on a screen.
* Host metrics come from ``/proc`` and ``shutil.disk_usage``, never from the Docker socket.
  Mounting the socket into the API container would hand whoever compromises the API full
  control of the host — a far larger risk than the observability it buys.
"""
from __future__ import annotations

import os
import shutil
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.models.operations import OperationalRun

#: Summary keys that may be persisted. Anything else is dropped rather than trusted.
SAFE_SUMMARY_KEYS = frozenset(
    {
        "claimed", "sent", "failed_transient", "failed_final", "cancelled", "skipped",
        "due_remaining", "recovered", "workspaces", "passes",
        "size_bytes", "table_count", "revision", "checksum_algorithm", "database_label",
        "duration_seconds", "message_count", "transport",
    }
)


def sanitise_summary(summary: dict | None) -> dict:
    """Keep the allowlisted counters, coerce them to primitives, drop everything else."""
    if not summary:
        return {}
    clean: dict[str, object] = {}
    for key, value in summary.items():
        if key not in SAFE_SUMMARY_KEYS:
            continue
        if isinstance(value, bool | int | float):
            clean[key] = value
        elif isinstance(value, str):
            clean[key] = value[:120]
    return clean


class OperationalRunService:
    """Append-only run history. Nothing here updates a previous run's outcome."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def record(
        self,
        *,
        kind: OperationalRunKind,
        status: OperationalRunStatus,
        started_at: datetime,
        finished_at: datetime | None = None,
        summary: dict | None = None,
        error_code: str | None = None,
        error_summary: str | None = None,
    ) -> OperationalRun:
        finished = finished_at or datetime.now(UTC)
        run = OperationalRun(
            kind=kind,
            status=status,
            started_at=started_at,
            finished_at=finished,
            duration_ms=max(0, int((finished - started_at).total_seconds() * 1000)),
            summary_json=sanitise_summary(summary),
            error_code=(error_code or None),
            error_summary=(error_summary or None) and error_summary[:500],
            release_version=get_settings().release_version[:64],
        )
        self.session.add(run)
        self.session.flush()
        return run

    @contextmanager
    def track(self, kind: OperationalRunKind):
        """Record a run whether it succeeds or raises, without swallowing the exception."""
        started = datetime.now(UTC)
        box: dict[str, object] = {}
        try:
            yield box
        except Exception as exc:
            self.record(
                kind=kind,
                status=OperationalRunStatus.FAILED,
                started_at=started,
                error_code=type(exc).__name__[:64],
                error_summary="The run failed; see the process log for detail.",
            )
            raise
        self.record(
            kind=kind,
            status=OperationalRunStatus(str(box.pop("status", "succeeded"))),
            started_at=started,
            summary=dict(box),
        )

    def latest(self, kind: OperationalRunKind) -> OperationalRun | None:
        return self.session.execute(
            sa.select(OperationalRun)
            .where(OperationalRun.kind == kind)
            .order_by(OperationalRun.started_at.desc())
            .limit(1)
        ).scalars().first()

    def latest_successful(self, kind: OperationalRunKind) -> OperationalRun | None:
        return self.session.execute(
            sa.select(OperationalRun)
            .where(
                OperationalRun.kind == kind,
                OperationalRun.status == OperationalRunStatus.SUCCEEDED,
            )
            .order_by(OperationalRun.started_at.desc())
            .limit(1)
        ).scalars().first()

    def recent(self, *, limit: int = 50, kind: OperationalRunKind | None = None) -> list[OperationalRun]:
        stmt = sa.select(OperationalRun).order_by(OperationalRun.started_at.desc()).limit(limit)
        if kind is not None:
            stmt = stmt.where(OperationalRun.kind == kind)
        return list(self.session.execute(stmt).scalars().all())


# ---- host resource observation ---------------------------------------------------------


@dataclass(frozen=True)
class HostMetrics:
    """What one operator needs to know before the host runs out of something.

    Every field is optional: a container without ``/proc/meminfo`` reports ``None`` rather
    than a fabricated number.
    """

    cpu_count: int | None
    load_average_1m: float | None
    load_percent: float | None
    memory_total_mb: int | None
    memory_available_mb: int | None
    memory_used_percent: float | None
    disk_total_gb: float | None
    disk_free_gb: float | None
    disk_used_percent: float | None
    swap_total_mb: int | None

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _read_meminfo() -> dict[str, int]:
    try:
        with open("/proc/meminfo") as handle:
            lines = handle.readlines()
    except OSError:
        return {}
    values: dict[str, int] = {}
    for line in lines:
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0])  # kB
    return values


def collect_host_metrics(path: str = "/") -> HostMetrics:
    cpu_count = os.cpu_count()
    load_1m: float | None = None
    try:
        load_1m = round(os.getloadavg()[0], 2)
    except (OSError, AttributeError):  # pragma: no cover - platform dependent
        load_1m = None

    meminfo = _read_meminfo()
    total_kb = meminfo.get("MemTotal")
    available_kb = meminfo.get("MemAvailable")
    swap_kb = meminfo.get("SwapTotal")

    try:
        usage = shutil.disk_usage(path)
        disk_total = round(usage.total / 1024**3, 1)
        disk_free = round(usage.free / 1024**3, 1)
        disk_used_percent = round((usage.total - usage.free) / usage.total * 100, 1)
    except OSError:  # pragma: no cover - depends on the filesystem
        disk_total = disk_free = disk_used_percent = None

    return HostMetrics(
        cpu_count=cpu_count,
        load_average_1m=load_1m,
        load_percent=(
            round(load_1m / cpu_count * 100, 1) if load_1m is not None and cpu_count else None
        ),
        memory_total_mb=round(total_kb / 1024) if total_kb else None,
        memory_available_mb=round(available_kb / 1024) if available_kb else None,
        memory_used_percent=(
            round((total_kb - available_kb) / total_kb * 100, 1)
            if total_kb and available_kb is not None
            else None
        ),
        disk_total_gb=disk_total,
        disk_free_gb=disk_free,
        disk_used_percent=disk_used_percent,
        swap_total_mb=round(swap_kb / 1024) if swap_kb is not None else None,
    )


# ---- threshold evaluation ---------------------------------------------------------------

#: A4 §D defaults. Warning levels sit below exhaustion so an operator has time to act.
THRESHOLDS = {
    "cpu_warning_percent": 80.0,
    "cpu_critical_percent": 95.0,
    "memory_warning_percent": 75.0,
    "memory_critical_percent": 85.0,
    "disk_warning_percent": 75.0,
    "disk_critical_percent": 85.0,
}


def _band(value: float | None, warning: float, critical: float) -> str:
    if value is None:
        return "unknown"
    if value >= critical:
        return "critical"
    if value >= warning:
        return "warning"
    return "ok"


def evaluate_thresholds(metrics: HostMetrics) -> dict[str, str]:
    """Bands, not a score. "unknown" when a metric is unavailable — never a cheerful default."""
    return {
        "cpu": _band(
            metrics.load_percent,
            THRESHOLDS["cpu_warning_percent"],
            THRESHOLDS["cpu_critical_percent"],
        ),
        "memory": _band(
            metrics.memory_used_percent,
            THRESHOLDS["memory_warning_percent"],
            THRESHOLDS["memory_critical_percent"],
        ),
        "disk": _band(
            metrics.disk_used_percent,
            THRESHOLDS["disk_warning_percent"],
            THRESHOLDS["disk_critical_percent"],
        ),
    }


def staleness(last_at: datetime | None, *, limit: timedelta) -> str:
    """``never`` is a distinct answer from ``stale``: one has never run, the other stopped."""
    if last_at is None:
        return "never"
    reference = last_at if last_at.tzinfo else last_at.replace(tzinfo=UTC)
    return "stale" if datetime.now(UTC) - reference > limit else "current"
