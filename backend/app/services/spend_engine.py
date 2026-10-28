"""S1 — pure spend facts. No database access, no clock reads except the `now` passed in.

Turns stored spend observations into the one shape both the health rules and the API read, so a
rule and the screen can never disagree about which day is "yesterday" or what a missing row means.

Three decisions live here and nowhere else:

* **A day is the account's local day** — the `date_start` Meta returned, in the timezone Meta
  reported for the account. Nothing is converted to UTC. `observed_at` is UTC and is used only for
  freshness and for deciding whether a day had ended when it was read.
* **A day is complete in an observation only if that observation was taken after the day ended**
  in the account's timezone. The latest complete day is "yesterday" as seen from the latest
  successful observation, not from the moment someone opens a page.
* **No row is not zero.** A complete day inside a requested window that Meta returned no row for is
  `has_row=False`; it is never summed, never fed to a baseline and never fires a rule (rule 4).
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.enums import SpendFreshness, SpendObservationStatus
from app.services.platform_status import (
    PlatformAccountStatus,
    PlatformDisableReason,
    interpret_account_status,
    interpret_disable_reason,
)

#: How many complete days the facts carry. The baseline needs at most 7 before the latest day.
SPEND_HISTORY_DAYS = 14
#: The baseline is the median of at most this many complete days before the latest one.
SPEND_BASELINE_MAX_DAYS = 7
#: Consecutive failed reads that are reported even while an older success is still current.
SPEND_REPEATED_FAILURE_THRESHOLD = 3

#: Fixed. Shown with every spend number this product displays.
SPEND_DISCLAIMER = (
    "Chi tiêu là số Meta trả về cho reader đã nêu, tại thời điểm quan sát. Không phải hoá đơn, "
    "không phải số đã đối soát, và không nói gì về việc tài khoản có bị hạn chế hay không."
)


def zone(timezone_name: str | None) -> ZoneInfo | None:
    if not timezone_name:
        return None
    try:
        return ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def local_date(moment: datetime, tz: ZoneInfo) -> date:
    return _aware(moment).astimezone(tz).date()


def parse_amount(raw: str | None) -> Decimal | None:
    """A raw Meta string as a Decimal, or `None` when it is absent or not a finite number."""
    if raw is None:
        return None
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        return None
    return value if value.is_finite() else None


def amount_text(value: Decimal) -> str:
    """A Decimal as plain text, never in exponent notation and never through a float."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _parse_day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class ObservationView:
    """One stored observation, detached from the ORM so the engine stays pure."""

    id: str
    observed_at: datetime
    status: SpendObservationStatus
    failure_code: str | None = None
    failure_summary: str | None = None
    currency: str | None = None
    timezone_name: str | None = None
    account_status_raw: str | None = None
    disable_reason_raw: str | None = None
    amount_spent_raw: str | None = None
    spend_cap_raw: str | None = None
    balance_raw: str | None = None
    daily: tuple[dict, ...] = ()
    window_since: date | None = None
    window_until: date | None = None
    reader_source: str | None = None
    provider_actor_external_id: str | None = None
    provider_actor_name: str | None = None
    trigger: str | None = None
    meta_connection_id: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status == SpendObservationStatus.SUCCEEDED

    def row_for(self, day: date) -> dict | None:
        for row in self.daily:
            if _parse_day(row.get("date_start")) == day and _parse_day(
                row.get("date_stop") or row.get("date_start")
            ) == day:
                return row
        return None


@dataclass(frozen=True)
class DayValue:
    day: date
    has_row: bool
    spend_raw: str | None
    currency: str | None
    observation_id: str
    observed_at: datetime
    #: `False` only for today's still-running day, which no rule ever reads.
    complete: bool = True

    @property
    def amount(self) -> Decimal | None:
        return parse_amount(self.spend_raw) if self.has_row else None


@dataclass(frozen=True)
class PlatformStatusFacts:
    """S2. What Meta last said about the account's status, and since when. Pure.

    Built from the newest observation that **carries a status code**, whether or not that read
    succeeded: the node answering is Meta speaking, even when the insights half of the read failed.
    That is deliberately different from `SpendFacts.latest_success`, and `observation_status` says
    which kind of row it was.

    `previous_*` and `since_observed_at` are for the person reading, never an input to a rule; both
    are bounded by the lookback window, so `since_observed_at` is "at least since".
    """

    observation_id: str
    observed_at: datetime
    observation_status: SpendObservationStatus
    account_status_raw: str
    status: PlatformAccountStatus
    disable_reason_raw: str | None
    disable_reason: PlatformDisableReason | None
    #: The four S1 freshness states, measured from `observed_at` of this observation.
    freshness: SpendFreshness
    reader_source: str | None = None
    previous_account_status_raw: str | None = None
    previous_status: PlatformAccountStatus | None = None
    previous_observed_at: datetime | None = None
    since_observed_at: datetime | None = None
    failure_code: str | None = None

    @property
    def is_current(self) -> bool:
        return self.freshness == SpendFreshness.CURRENT


def _status_key(raw: str | None) -> str | None:
    return None if raw is None else str(raw).strip()


def assemble_platform_status(
    ordered: Sequence[ObservationView], *, observable: bool, now: datetime, stale_after_hours: int
) -> PlatformStatusFacts | None:
    """`ordered` newest first. `None` when no observation carries an `account_status` code."""
    coded = [o for o in ordered if o.account_status_raw is not None]
    if not coded:
        return None
    latest = coded[0]
    status = interpret_account_status(latest.account_status_raw)
    if status is None:  # pragma: no cover - `coded` excludes None
        return None
    key = _status_key(latest.account_status_raw)
    since = latest.observed_at
    previous: ObservationView | None = None
    for observation in coded[1:]:
        if _status_key(observation.account_status_raw) == key:
            since = observation.observed_at
            continue
        previous = observation
        break
    return PlatformStatusFacts(
        observation_id=latest.id,
        observed_at=latest.observed_at,
        observation_status=latest.status,
        account_status_raw=str(latest.account_status_raw),
        status=status,
        disable_reason_raw=latest.disable_reason_raw,
        disable_reason=interpret_disable_reason(latest.disable_reason_raw),
        freshness=derive_freshness(
            observable=observable, latest_success=latest, now=now, stale_after_hours=stale_after_hours
        ),
        reader_source=latest.reader_source,
        previous_account_status_raw=previous.account_status_raw if previous else None,
        previous_status=interpret_account_status(previous.account_status_raw) if previous else None,
        previous_observed_at=previous.observed_at if previous else None,
        since_observed_at=since,
        failure_code=None if latest.succeeded else latest.failure_code,
    )


@dataclass
class SpendFacts:
    """Everything a spend rule or the spend API may read about one account."""

    observable: bool
    freshness: SpendFreshness
    now: datetime
    stale_after_hours: int
    reader_source: str | None = None
    meta_connection_id: str | None = None
    registry_currency: str | None = None
    latest_success: ObservationView | None = None
    latest_attempt: ObservationView | None = None
    #: Failed reads in a row, newest first, capped at the reporting threshold.
    consecutive_failures: int = 0
    timezone_usable: bool = False
    latest_complete_day: date | None = None
    #: Newest first. Complete days only, with and without a row. At most `SPEND_HISTORY_DAYS`.
    complete_days: list[DayValue] = field(default_factory=list)
    today_partial: DayValue | None = None
    baseline_min_days: int = 5
    change_ratio_threshold: float = 0.5
    change_min_amounts: dict[str, float] = field(default_factory=dict)
    cap_ratio_threshold: float = 0.9
    #: S2. Meta's latest account status, from the same observations. `None`: no code observed.
    platform_status: PlatformStatusFacts | None = None

    @property
    def observed_currency(self) -> str | None:
        if self.latest_success is None or not self.latest_success.currency:
            return None
        return self.latest_success.currency.upper()

    @property
    def is_current(self) -> bool:
        return self.freshness == SpendFreshness.CURRENT

    @property
    def insights_currencies(self) -> set[str]:
        days = list(self.complete_days) + ([self.today_partial] if self.today_partial else [])
        return {(d.currency or "").upper() for d in days if d.has_row and d.currency}

    @property
    def insights_currency_conflict(self) -> bool:
        """The node and the insights rows disagree about the currency. Contradictory data is not
        evidence of anything, so no amount-based rule may use it."""
        node = self.observed_currency
        others = self.insights_currencies
        return bool(others) and (len(others) > 1 or (node is not None and others != {node}))

    @property
    def missing_input(self) -> str | None:
        if self.latest_success is not None and not self.timezone_usable:
            return "timezone_name"
        return None

    def day(self, value: date) -> DayValue | None:
        for entry in self.complete_days:
            if entry.day == value:
                return entry
        return None

    def baseline_days(self) -> list[DayValue]:
        """Complete days before the latest one that have a parseable row, newest first, capped."""
        if self.latest_complete_day is None:
            return []
        usable = [
            d
            for d in self.complete_days
            if d.day < self.latest_complete_day and d.has_row and d.amount is not None
        ]
        return usable[:SPEND_BASELINE_MAX_DAYS]

    def baseline_median(self) -> Decimal | None:
        days = self.baseline_days()
        if len(days) < max(1, self.baseline_min_days):
            return None
        values = sorted(d.amount for d in days if d.amount is not None)
        middle = len(values) // 2
        if len(values) % 2:
            return values[middle]
        return (values[middle - 1] + values[middle]) / 2

    def min_amount_for(self, currency: str | None) -> Decimal | None:
        if not currency:
            return None
        for key, value in (self.change_min_amounts or {}).items():
            if str(key).upper() == currency.upper():
                parsed = parse_amount(str(value))
                return parsed if parsed is not None and parsed > 0 else None
        return None


def derive_freshness(
    *, observable: bool, latest_success: ObservationView | None, now: datetime, stale_after_hours: int
) -> SpendFreshness:
    if not observable:
        return SpendFreshness.NOT_OBSERVABLE
    if latest_success is None:
        return SpendFreshness.NEVER_OBSERVED
    if _aware(latest_success.observed_at) < _aware(now) - timedelta(hours=stale_after_hours):
        return SpendFreshness.STALE
    return SpendFreshness.CURRENT


def _completed_in(observation: ObservationView, day: date) -> bool:
    """Whether `day` had already ended, in the account's timezone, when this was read."""
    tz = zone(observation.timezone_name)
    if tz is None:
        return False
    if observation.window_since is None or observation.window_until is None:
        return False
    if not (observation.window_since <= day <= observation.window_until):
        return False
    return day < local_date(observation.observed_at, tz)


def assemble(
    *,
    observable: bool,
    observations: Sequence[ObservationView],
    now: datetime,
    stale_after_hours: int,
    reader_source: str | None = None,
    meta_connection_id: str | None = None,
    registry_currency: str | None = None,
    baseline_min_days: int = 5,
    change_ratio_threshold: float = 0.5,
    change_min_amounts: dict[str, float] | None = None,
    cap_ratio_threshold: float = 0.9,
) -> SpendFacts:
    """`observations` newest first, successes and failures together."""
    ordered = sorted(observations, key=lambda o: _aware(o.observed_at), reverse=True)
    successes = [o for o in ordered if o.succeeded]
    latest_success = successes[0] if successes else None

    failures = 0
    for observation in ordered:
        if observation.succeeded:
            break
        failures += 1
        if failures >= SPEND_REPEATED_FAILURE_THRESHOLD:
            break

    facts = SpendFacts(
        observable=observable,
        freshness=derive_freshness(
            observable=observable,
            latest_success=latest_success,
            now=now,
            stale_after_hours=stale_after_hours,
        ),
        now=now,
        stale_after_hours=stale_after_hours,
        reader_source=reader_source,
        meta_connection_id=meta_connection_id,
        registry_currency=(registry_currency or "").upper() or None,
        latest_success=latest_success,
        latest_attempt=ordered[0] if ordered else None,
        consecutive_failures=failures,
        baseline_min_days=baseline_min_days,
        change_ratio_threshold=change_ratio_threshold,
        change_min_amounts=dict(change_min_amounts or {}),
        cap_ratio_threshold=cap_ratio_threshold,
        platform_status=assemble_platform_status(
            ordered, observable=observable, now=now, stale_after_hours=stale_after_hours
        ),
    )
    if latest_success is None:
        return facts

    tz = zone(latest_success.timezone_name)
    if tz is None:
        # Without the account's timezone there is no "yesterday" to speak of. Every day-based
        # answer stays empty rather than guessing from UTC.
        return facts
    facts.timezone_usable = True

    observed_day = local_date(latest_success.observed_at, tz)
    facts.latest_complete_day = observed_day - timedelta(days=1)

    for offset in range(SPEND_HISTORY_DAYS):
        day = facts.latest_complete_day - timedelta(days=offset)
        # The newest successful observation that read this day after it had ended decides it —
        # including deciding that there is no row, which a later read is entitled to say.
        source = next((o for o in successes if _completed_in(o, day)), None)
        if source is None:
            continue
        row = source.row_for(day)
        facts.complete_days.append(
            DayValue(
                day=day,
                has_row=row is not None,
                spend_raw=(row.get("spend") if row else None),
                currency=((row.get("account_currency") or source.currency) if row else source.currency),
                observation_id=source.id,
                observed_at=source.observed_at,
            )
        )

    today_row = latest_success.row_for(observed_day)
    if today_row is not None:
        facts.today_partial = DayValue(
            day=observed_day,
            has_row=True,
            spend_raw=today_row.get("spend"),
            currency=today_row.get("account_currency") or latest_success.currency,
            observation_id=latest_success.id,
            observed_at=latest_success.observed_at,
            complete=False,
        )
    return facts


@dataclass(frozen=True)
class BudgetPacingFacts:
    """C1. Deterministic comparison between an account's agreed daily/monthly budget and stored
    Meta spend observations in the account's own currency. Never converts or mixes currencies."""

    client_name: str
    planned_daily_budget_raw: str | None
    planned_monthly_budget_raw: str | None
    currency: str | None
    latest_complete_day: str | None
    latest_day_spend_raw: str | None
    daily_utilization_pct: float | None
    mtd_spend_raw: str | None
    mtd_days_counted: int
    monthly_utilization_pct: float | None
    #: `unconfigured` / `insufficient_data` / `on_track` / `overspending` /
    #: `approaching_monthly_budget` / `underspending`.
    pacing_status: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "client_name": self.client_name,
            "planned_daily_budget_raw": self.planned_daily_budget_raw,
            "planned_monthly_budget_raw": self.planned_monthly_budget_raw,
            "currency": self.currency,
            "latest_complete_day": self.latest_complete_day,
            "latest_day_spend_raw": self.latest_day_spend_raw,
            "daily_utilization_pct": self.daily_utilization_pct,
            "mtd_spend_raw": self.mtd_spend_raw,
            "mtd_days_counted": self.mtd_days_counted,
            "monthly_utilization_pct": self.monthly_utilization_pct,
            "pacing_status": self.pacing_status,
        }


def evaluate_budget_pacing(
    facts: SpendFacts,
    *,
    client_name: str = "",
    planned_daily_budget_raw: str | None = None,
    planned_monthly_budget_raw: str | None = None,
) -> BudgetPacingFacts:
    """Pure C1 pacing evaluation from `SpendFacts` and the account's agreed budget strings."""
    daily_budget = parse_amount(planned_daily_budget_raw)
    monthly_budget = parse_amount(planned_monthly_budget_raw)
    if daily_budget is not None and daily_budget <= 0:
        daily_budget = None
    if monthly_budget is not None and monthly_budget <= 0:
        monthly_budget = None

    daily_raw = amount_text(daily_budget) if daily_budget is not None else None
    monthly_raw = amount_text(monthly_budget) if monthly_budget is not None else None
    currency = facts.observed_currency or facts.registry_currency
    latest_day_iso = facts.latest_complete_day.isoformat() if facts.latest_complete_day else None

    latest_spend_dec: Decimal | None = None
    latest_spend_raw: str | None = None
    mtd_dec = Decimal(0)
    mtd_days = 0

    if not facts.insights_currency_conflict and facts.latest_complete_day is not None:
        latest_entry = facts.day(facts.latest_complete_day)
        if latest_entry is not None and latest_entry.has_row and latest_entry.amount is not None:
            latest_spend_dec = latest_entry.amount
            latest_spend_raw = amount_text(latest_spend_dec)

        target_year = facts.latest_complete_day.year
        target_month = facts.latest_complete_day.month
        for entry in facts.complete_days:
            if (
                entry.day.year == target_year
                and entry.day.month == target_month
                and entry.has_row
                and entry.amount is not None
            ):
                mtd_dec += entry.amount
                mtd_days += 1

    mtd_raw = amount_text(mtd_dec) if mtd_days > 0 else None

    daily_pct: float | None = None
    if facts.is_current and daily_budget is not None and latest_spend_dec is not None:
        daily_pct = round(float((latest_spend_dec / daily_budget) * Decimal(100)), 1)

    monthly_pct: float | None = None
    if facts.is_current and monthly_budget is not None and mtd_days > 0:
        monthly_pct = round(float((mtd_dec / monthly_budget) * Decimal(100)), 1)

    if daily_budget is None and monthly_budget is None:
        status = "unconfigured"
    elif (
        not facts.is_current
        or facts.insights_currency_conflict
        or (
            (daily_budget is not None and latest_spend_dec is None)
            and (monthly_budget is None or mtd_days == 0)
        )
        or (daily_budget is None and monthly_budget is not None and mtd_days == 0)
    ):
        status = "insufficient_data"
    elif (daily_pct is not None and daily_pct > 120.0) or (
        monthly_pct is not None and monthly_pct > 100.0
    ):
        status = "overspending"
    elif monthly_pct is not None and 90.0 <= monthly_pct <= 100.0:
        status = "approaching_monthly_budget"
    elif daily_pct is not None and daily_pct < 50.0:
        status = "underspending"
    else:
        status = "on_track"

    return BudgetPacingFacts(
        client_name=(client_name or "").strip(),
        planned_daily_budget_raw=daily_raw,
        planned_monthly_budget_raw=monthly_raw,
        currency=currency,
        latest_complete_day=latest_day_iso,
        latest_day_spend_raw=latest_spend_raw,
        daily_utilization_pct=daily_pct,
        mtd_spend_raw=mtd_raw,
        mtd_days_counted=mtd_days,
        monthly_utilization_pct=monthly_pct,
        pacing_status=status,
    )
