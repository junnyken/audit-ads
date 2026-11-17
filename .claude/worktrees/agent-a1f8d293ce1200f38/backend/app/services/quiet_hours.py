"""Quiet-hours evaluation (MINI-SPEC A3 §C).

Pure functions over a policy and an instant. Timezone-aware by construction: the decision is
made in the policy's IANA zone, never the server's, because "23:00" means nothing without
saying where.

A window that crosses midnight is the normal case for a night-time quiet period, so it is the
first thing these functions get right rather than an afterthought.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class QuietHoursDecision:
    in_quiet_hours: bool
    #: When the current quiet window ends, in UTC. None when not in quiet hours.
    next_end_utc: datetime | None
    timezone: str | None
    reason: str

    def to_dict(self) -> dict:
        return {
            "in_quiet_hours": self.in_quiet_hours,
            "next_end_utc": self.next_end_utc.isoformat() if self.next_end_utc else None,
            "timezone": self.timezone,
            "reason": self.reason,
        }


def resolve_timezone(name: str | None) -> ZoneInfo | None:
    """Return the zone, or None when it cannot be resolved. Never guesses a default."""
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None


def is_valid_timezone(name: str | None) -> bool:
    return resolve_timezone(name) is not None


def within_window(moment: time, start: time, end: time) -> bool:
    """Inclusive of the start, exclusive of the end, and correct across midnight."""
    if start == end:
        return False
    if start < end:
        return start <= moment < end
    # Crosses midnight: 23:00 → 07:00 means "at or after 23:00, or before 07:00".
    return moment >= start or moment < end


def evaluate(
    *,
    now_utc: datetime,
    timezone_name: str | None,
    quiet_hours_enabled: bool,
    start: time | None,
    end: time | None,
) -> QuietHoursDecision:
    if not quiet_hours_enabled or start is None or end is None:
        return QuietHoursDecision(False, None, timezone_name, "quiet_hours_disabled")

    zone = resolve_timezone(timezone_name)
    if zone is None:
        # A missing or invalid zone is reported, never guessed. The caller skips the delivery
        # with a reason instead of sending at an hour nobody agreed to.
        return QuietHoursDecision(False, None, timezone_name, "timezone_unresolved")

    local = now_utc.astimezone(zone)
    if not within_window(local.time(), start, end):
        return QuietHoursDecision(False, None, timezone_name, "outside_quiet_hours")

    # The next end is today's `end` if it is still ahead, otherwise tomorrow's.
    candidate = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if candidate <= local:
        candidate = candidate + timedelta(days=1)
    return QuietHoursDecision(True, candidate.astimezone(now_utc.tzinfo), timezone_name, "inside_quiet_hours")
