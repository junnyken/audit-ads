"""S1 — spend tracking (Meta, read-only).

Same conventions as every A1 route: bearer session, workspace scope from the membership (never a
request body — rule 8), A9 resource scope through `AdAccountRegistryService`, `404` for anything
outside it. Money leaves as the raw strings Meta returned; a total is only ever per currency, and
there is no grand total anywhere (`FEATURES.md` A7 exclusion still holds).

Only `POST …/spend/refresh` contacts Meta, once, because the owner asked. Every `GET` here reads
stored observations and nothing else.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, OwnerCtx
from app.core.enums import EvaluationTrigger, SpendFreshness, SpendObservationTrigger
from app.core.errors import ConflictError
from app.models.entities import AdAccount
from app.models.spend import AdAccountSpendObservation
from app.schemas.common import page_response
from app.services import spend_service
from app.services.base import require_active
from app.services.health_service import AccountHealthEvaluationService
from app.services.platform_status import PLATFORM_STATUS_DISCLAIMER, status_class
from app.services.registry import AdAccountRegistryService
from app.services.spend_engine import (
    SPEND_DISCLAIMER,
    DayValue,
    PlatformStatusFacts,
    SpendFacts,
    amount_text,
    evaluate_budget_pacing,
)

router = APIRouter(tags=["spend"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _day(value: DayValue) -> dict[str, Any]:
    return {
        "date": value.day.isoformat(),
        "spend_raw": value.spend_raw,
        "currency": value.currency,
        "observation_id": value.observation_id,
        "observed_at": _iso(value.observed_at),
    }


def _observation_out(row: AdAccountSpendObservation) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "observed_at": _iso(row.observed_at),
        "status": row.status.value,
        "trigger": row.trigger.value,
        "failure_code": row.failure_code,
        "failure_summary": row.failure_summary,
        "meta_connection_id": str(row.meta_connection_id),
        "reader_source": row.reader_source,
        "read_as": {"external_id": row.provider_actor_external_id, "name": row.provider_actor_name},
        "currency": row.observed_currency,
        "timezone_name": row.observed_timezone_name,
        "account_status_raw": row.observed_account_status,
        "disable_reason_raw": row.observed_disable_reason,
        "amount_spent_raw": row.amount_spent_raw,
        "spend_cap_raw": row.spend_cap_raw,
        "balance_raw": row.balance_raw,
        "window_since": row.window_since.isoformat() if row.window_since else None,
        "window_until": row.window_until.isoformat() if row.window_until else None,
        "daily": list(row.daily_json or []),
    }


def platform_status_out(value: PlatformStatusFacts | None) -> dict[str, Any] | None:
    """S2. Meta's latest account status as stored — `None` when no observation carries a code.

    Interpreted through the allowlist in `platform_status.py`; the raw code always travels with
    the interpretation so nobody has to trust the mapping blindly.
    """
    if value is None:
        return None
    return {
        "status": value.status.value,
        "status_class": status_class(value.status),
        "account_status_raw": value.account_status_raw,
        "disable_reason": value.disable_reason.value if value.disable_reason else None,
        "disable_reason_raw": value.disable_reason_raw,
        "observed_at": _iso(value.observed_at),
        "observation_id": value.observation_id,
        "observation_status": value.observation_status.value,
        "failure_code": value.failure_code,
        "reader_source": value.reader_source,
        "freshness": value.freshness.value,
        "previous": (
            {
                "account_status_raw": value.previous_account_status_raw,
                "status": value.previous_status.value if value.previous_status else None,
                "observed_at": _iso(value.previous_observed_at),
            }
            if value.previous_account_status_raw is not None
            else None
        ),
        "since_observed_at": _iso(value.since_observed_at),
        "disclaimer": PLATFORM_STATUS_DISCLAIMER,
    }


def spend_payload(ctx, account: AdAccount, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    facts = spend_service.build_spend_facts(ctx.session, ctx.workspace_id, account, now=now)
    latest = None
    if facts.latest_success is not None:
        latest = _observation_out(ctx.session.get(AdAccountSpendObservation, uuid.UUID(facts.latest_success.id)))
    attempt = None
    if facts.latest_attempt is not None:
        a = facts.latest_attempt
        attempt = {
            "id": a.id,
            "observed_at": _iso(a.observed_at),
            "status": a.status.value,
            "failure_code": a.failure_code,
            "failure_summary": a.failure_summary,
        }
    median = facts.baseline_median()
    baseline_days = facts.baseline_days()
    return {
        "ad_account_id": str(account.id),
        "freshness": facts.freshness.value,
        "observable": facts.observable,
        # O4: the first missing link when the product cannot read this account — a code
        # (`no_business_manager`, `no_production_connection`, `no_reader`,
        # `reader_reconnect_required`, …), `None` when it can.
        "not_observable_reason": (
            None
            if facts.observable
            else spend_service.account_not_observable_reason(ctx.session, ctx.workspace_id, account)
        ),
        "reader_source": facts.reader_source,
        "meta_connection_id": facts.meta_connection_id,
        "stale_after_hours": facts.stale_after_hours,
        "registry_currency": facts.registry_currency,
        "observed_currency": facts.observed_currency,
        "currency_mismatch": (
            facts.observed_currency != facts.registry_currency
            if facts.observed_currency and facts.registry_currency
            else None
        ),
        "insights_currency_conflict": facts.insights_currency_conflict,
        "missing_input": facts.missing_input,
        "latest_observation": latest,
        "latest_attempt": attempt,
        "latest_complete_day": facts.latest_complete_day.isoformat() if facts.latest_complete_day else None,
        # Complete days that have an insights row, newest first. A day Meta returned no row for
        # is listed in `days_without_row` instead — never here as zero.
        "daily": [_day(d) for d in facts.complete_days if d.has_row],
        "days_without_row": [d.day.isoformat() for d in facts.complete_days if not d.has_row],
        # Today's still-running day, kept apart and labelled. No rule reads it.
        "today_partial": (
            {**_day(facts.today_partial), "label": "incomplete_day"} if facts.today_partial else None
        ),
        "baseline": (
            {
                "median_raw": amount_text(median),
                "currency": facts.observed_currency,
                "days_used": [d.day.isoformat() for d in baseline_days],
                "min_days_required": facts.baseline_min_days,
            }
            if median is not None
            else None
        ),
        "baseline_days_available": len(baseline_days),
        "platform_status": platform_status_out(facts.platform_status),
        "budget_pacing": evaluate_budget_pacing(
            facts,
            client_name=account.client_name,
            planned_daily_budget_raw=account.planned_daily_budget_raw,
            planned_monthly_budget_raw=account.planned_monthly_budget_raw,
        ).as_dict(),
        "disclaimer": SPEND_DISCLAIMER,
    }


def _account(ctx, ad_account_id: uuid.UUID) -> AdAccount:
    return AdAccountRegistryService(
        ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids()
    ).get(ad_account_id)


@router.get("/ad-accounts/{ad_account_id}/spend")
def account_spend(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    """Stored spend for one account. Contacts no platform."""
    return spend_payload(ctx, _account(ctx, ad_account_id))


@router.get("/ad-accounts/{ad_account_id}/spend/observations")
def account_spend_observations(
    ctx: Ctx,
    ad_account_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    """Every recorded read, newest first, failed reads included with their code."""
    account = _account(ctx, ad_account_id)
    base = sa.select(AdAccountSpendObservation).where(
        AdAccountSpendObservation.workspace_id == ctx.workspace_id,
        AdAccountSpendObservation.ad_account_id == account.id,
        AdAccountSpendObservation.archived_at.is_(None),
    )
    total = int(
        ctx.session.execute(sa.select(sa.func.count()).select_from(base.subquery())).scalar_one()
    )
    rows = ctx.session.execute(
        base.order_by(AdAccountSpendObservation.observed_at.desc(), AdAccountSpendObservation.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).scalars().all()
    return page_response([_observation_out(row) for row in rows], page=page, page_size=page_size, total=total)


@router.post("/ad-accounts/{ad_account_id}/spend/refresh")
def refresh_account_spend(ctx: OwnerCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    """Owner only. One read from Meta for one account, because a person asked.

    Exactly one provider read (two GETs: the account node and its daily insights); no retry. The
    observation and its audit row commit together (rule 3); health is then re-evaluated from the
    stored observation inside its own SAVEPOINT (rule 15).
    """
    account = require_active(_account(ctx, ad_account_id), label="Ad account")
    reader = spend_service.resolve_spend_connection(ctx.session, ctx.workspace_id, account)
    if reader is None:
        raise ConflictError(
            "This account cannot be read: it needs an external account id, a Business Manager, "
            "and a production Meta connection with a usable reader credential.",
            details={
                "freshness": SpendFreshness.NOT_OBSERVABLE.value,
                "not_observable_reason": spend_service.account_not_observable_reason(
                    ctx.session, ctx.workspace_id, account
                ),
            },
        )
    provider = spend_service.provider_for_connection(reader)
    observation, read = spend_service.SpendObservationService(ctx.session, ctx.workspace_id).read_and_record(
        account, reader, provider, trigger=SpendObservationTrigger.MANUAL_REFRESH
    )
    ctx.audit.record(
        action="spend.observation_refreshed",
        entity_type="ad_account_spend_observation",
        entity_id=observation.id,
        after={
            "status": observation.status.value,
            "failure_code": observation.failure_code,
            "reader_source": observation.reader_source,
        },
        metadata={"ad_account_id": str(account.id), "meta_connection_id": str(reader.connection.id)},
    )
    AccountHealthEvaluationService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id).evaluate_account_safe(
        account, trigger=EvaluationTrigger.SPEND_OBSERVATION, trigger_reference_id=str(observation.id)
    )
    ctx.commit()
    return spend_payload(ctx, account)


@router.get("/spend/summary")
def spend_summary(ctx: Ctx) -> dict[str, Any]:
    """Per-currency totals for each account's latest complete day, and freshness counts.

    There is no total across currencies, and no conversion. A currency group that is missing
    accounts — stale, no row for the day, contradictory currency — still shows its sum, marked
    `complete: false` with the counts that explain why.
    """
    now = datetime.now(UTC)
    visible = ctx.visible_ad_account_ids()
    stmt = sa.select(AdAccount).where(
        AdAccount.workspace_id == ctx.workspace_id, AdAccount.archived_at.is_(None)
    )
    if visible is not None:
        stmt = stmt.where(AdAccount.id.in_(visible))
    accounts = list(ctx.session.execute(stmt).scalars().unique().all())

    freshness_counts = {state.value: 0 for state in SpendFreshness}
    # S2: counts per status class, never a score. `none` is "no status code observed".
    platform_status_counts = {key: 0 for key in ("active", "blocking", "pending", "unknown", "none")}
    budget_pacing_counts = {
        key: 0
        for key in (
            "on_track",
            "overspending",
            "approaching_monthly_budget",
            "underspending",
            "unconfigured",
            "insufficient_data",
        )
    }
    groups: dict[str, dict[str, Any]] = {}
    unattributed = 0

    def group(currency: str) -> dict[str, Any]:
        return groups.setdefault(
            currency,
            {
                "currency": currency,
                "total": Decimal(0),
                "today_partial": Decimal(0),
                "today_included": 0,
                "last_7d": Decimal(0),
                "last_7d_included": 0,
                "mtd": Decimal(0),
                "mtd_included": 0,
                "amount_spent": Decimal(0),
                "amount_spent_included": 0,
                "days": set(),
                "accounts_included": 0,
                "accounts_without_row": 0,
                "accounts_not_current": 0,
                "accounts_currency_conflict": 0,
            },
        )

    for account in accounts:
        facts: SpendFacts = spend_service.build_spend_facts(ctx.session, ctx.workspace_id, account, now=now)
        freshness_counts[facts.freshness.value] += 1
        platform_status_counts[
            status_class(facts.platform_status.status if facts.platform_status else None)
        ] += 1
        pacing = evaluate_budget_pacing(
            facts,
            client_name=account.client_name,
            planned_daily_budget_raw=account.planned_daily_budget_raw,
            planned_monthly_budget_raw=account.planned_monthly_budget_raw,
        )
        budget_pacing_counts[pacing.pacing_status] = budget_pacing_counts.get(pacing.pacing_status, 0) + 1
        currency = facts.observed_currency
        if currency is None:
            # Never read successfully (or Meta named no currency): it cannot be attributed to any
            # group, and the summary as a whole says it is incomplete.
            unattributed += 1
            continue
        bucket = group(currency)
        if not facts.is_current:
            bucket["accounts_not_current"] += 1
            continue
        if facts.insights_currency_conflict:
            bucket["accounts_currency_conflict"] += 1
            continue
        if facts.latest_success and facts.latest_success.amount_spent_raw:
            from app.services.spend_engine import parse_amount
            amt_lt = parse_amount(facts.latest_success.amount_spent_raw)
            if amt_lt is not None and amt_lt > 0:
                if currency not in ("VND", "JPY", "KRW", "TWD", "CLP", "IDR"):
                    amt_lt = amt_lt / Decimal(100)
                bucket["amount_spent"] += amt_lt
                bucket["amount_spent_included"] += 1
        if facts.today_partial and facts.today_partial.has_row and facts.today_partial.amount is not None:
            bucket["today_partial"] += facts.today_partial.amount
            bucket["today_included"] += 1
        if facts.latest_complete_day is not None:
            cutoff_7d = facts.latest_complete_day - timedelta(days=6)
            acc_7d = Decimal(0)
            acc_7d_rows = 0
            acc_mtd = Decimal(0)
            acc_mtd_rows = 0
            for d_entry in facts.complete_days:
                if d_entry.has_row and d_entry.amount is not None:
                    if d_entry.day >= cutoff_7d:
                        acc_7d += d_entry.amount
                        acc_7d_rows += 1
                    if (
                        d_entry.day.year == facts.latest_complete_day.year
                        and d_entry.day.month == facts.latest_complete_day.month
                    ):
                        acc_mtd += d_entry.amount
                        acc_mtd_rows += 1
            if acc_7d_rows > 0:
                bucket["last_7d"] += acc_7d
                bucket["last_7d_included"] += 1
            if acc_mtd_rows > 0:
                bucket["mtd"] += acc_mtd
                bucket["mtd_included"] += 1
        day = facts.day(facts.latest_complete_day) if facts.latest_complete_day else None
        if day is None or not day.has_row or day.amount is None:
            bucket["accounts_without_row"] += 1
            continue
        bucket["total"] += day.amount
        bucket["days"].add(day.day.isoformat())
        bucket["accounts_included"] += 1

    currencies = []
    for currency in sorted(groups):
        bucket = groups[currency]
        missing = (
            bucket["accounts_without_row"]
            + bucket["accounts_not_current"]
            + bucket["accounts_currency_conflict"]
        )
        currencies.append(
            {
                "currency": currency,
                "total_raw": amount_text(bucket["total"]) if bucket["accounts_included"] else None,
                "today_partial_raw": (
                    amount_text(bucket["today_partial"]) if bucket["today_included"] else None
                ),
                "last_7d_raw": amount_text(bucket["last_7d"]) if bucket["last_7d_included"] else None,
                "mtd_raw": amount_text(bucket["mtd"]) if bucket["mtd_included"] else None,
                "amount_spent_raw": amount_text(bucket["amount_spent"]) if bucket["amount_spent_included"] else None,
                "days": sorted(bucket["days"]),
                "accounts_included": bucket["accounts_included"],
                "accounts_without_row": bucket["accounts_without_row"],
                "accounts_not_current": bucket["accounts_not_current"],
                "accounts_currency_conflict": bucket["accounts_currency_conflict"],
                "complete": missing == 0,
            }
        )
    return {
        "generated_at": now.isoformat(),
        "total_accounts": len(accounts),
        "freshness_counts": freshness_counts,
        "platform_status_counts": platform_status_counts,
        "budget_pacing_counts": budget_pacing_counts,
        "accounts_unattributed": unattributed,
        "currencies": currencies,
        "complete": unattributed == 0 and all(item["complete"] for item in currencies),
        "disclaimer": SPEND_DISCLAIMER,
    }
