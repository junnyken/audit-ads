from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import AuditCtx, Ctx, WriteCtx
from app.core.config import get_settings
from app.core.enums import (
    ACTIVE_SIGNAL_STATUSES,
    EvaluationRunStatus,
    EvaluationTrigger,
    HealthFreshness,
    HealthStatus,
    SignalSeverity,
    WorkspaceRole,
)
from app.core.errors import AuthorizationError, NotFoundError, ValidationError
from app.models.entities import AdAccount, AuditLog, User
from app.models.health import (
    AccountHealthSignal,
    AccountHealthSnapshot,
    HealthEvaluationRun,
)
from app.schemas import health as s
from app.schemas.audit import AuditLogOut
from app.schemas.common import page_response
from app.services.base import get_or_404
from app.services.health_presenter import present_snapshot
from app.services.health_rules import HEALTH_RULES_BY_KEY
from app.services.health_service import (
    AccountHealthEvaluationService,
    AccountHealthSnapshotService,
    HealthBackfillService,
    HealthRuleRegistryService,
    HealthSignalActionService,
)
from app.services.registry import AdAccountRegistryService

router = APIRouter(tags=["account-health"])

SORTABLE = {"health_severity", "last_evaluated_at", "freshness", "display_name", "updated_at"}


def _stale_threshold(now: datetime) -> datetime:
    return now - timedelta(hours=get_settings().health_evaluation_stale_after_hours)


def _effective_status_expr(threshold: datetime):
    """The status a reader actually sees, expressed in SQL.

    Filtering on the stored column alone would disagree with the page: a stale `clear_signals`
    snapshot is presented as `unknown`, and the filter has to follow the same rule or the counts
    on the Overview will not match the rows behind them.

    Every branch is bound with the column's own Enum type. SQLAlchemy persists enum *names*
    ("CLEAR_SIGNALS"), so a hand-written string literal would silently match nothing.
    """
    column = AccountHealthSnapshot.health_status
    unknown = sa.literal(HealthStatus.UNKNOWN, column.type)
    return sa.case(
        (AdAccount.archived_at.is_not(None), unknown),
        (AccountHealthSnapshot.id.is_(None), unknown),
        (
            sa.and_(
                column == HealthStatus.CLEAR_SIGNALS,
                sa.or_(
                    AccountHealthSnapshot.last_evaluated_at.is_(None),
                    AccountHealthSnapshot.last_evaluated_at < threshold,
                ),
            ),
            unknown,
        ),
        else_=column,
    )


def _effective_freshness_expr(threshold: datetime):
    column = AccountHealthSnapshot.freshness_status
    return sa.case(
        (
            AdAccount.archived_at.is_not(None),
            sa.literal(HealthFreshness.NOT_APPLICABLE, column.type),
        ),
        (
            AccountHealthSnapshot.last_evaluated_at.is_(None),
            sa.literal(HealthFreshness.UNKNOWN, column.type),
        ),
        (
            AccountHealthSnapshot.last_evaluated_at < threshold,
            sa.literal(HealthFreshness.STALE, column.type),
        ),
        else_=sa.literal(HealthFreshness.CURRENT, column.type),
    )


_SEVERITY_ORDER = sa.case(
    (AccountHealthSnapshot.open_critical_count > 0, 0),
    (AccountHealthSnapshot.open_warning_count > 0, 1),
    (AccountHealthSnapshot.open_attention_count > 0, 2),
    (AccountHealthSnapshot.open_unknown_count > 0, 3),
    else_=4,
)


def _row(account: AdAccount, snapshot: AccountHealthSnapshot | None, now: datetime) -> dict[str, Any]:
    presented = present_snapshot(account, snapshot, now=now)
    reasons = presented["summary_reasons"]
    return {
        "ad_account_id": str(account.id),
        "display_name": account.display_name,
        "external_account_id": account.external_account_id,
        "business_manager_name": account.business_manager.name if account.business_manager else None,
        "personal_account_reference_label": (
            account.personal_account_reference.label if account.personal_account_reference else None
        ),
        "owner_label": account.owner_label,
        "account_status": account.status.value,
        "account_type": account.account_type.value,
        "readiness_status": account.readiness_status.value,
        "health_status": presented["health_status"],
        "freshness_status": presented["freshness_status"],
        "open_critical_count": presented["counts"]["critical"],
        "open_warning_count": presented["counts"]["warning"],
        "open_attention_count": presented["counts"]["attention"],
        "open_unknown_count": presented["counts"]["unknown"],
        "last_evaluated_at": presented["evaluated_at"],
        "top_reason": reasons[0] if reasons else None,
        "archived": account.archived_at is not None,
    }


# ------------------------------------------------------------------------------ summary
@router.get("/account-health/summary", response_model=s.HealthSummaryOut)
def health_summary(ctx: Ctx) -> s.HealthSummaryOut:
    now = datetime.now(UTC)
    threshold = _stale_threshold(now)
    status_expr = _effective_status_expr(threshold)
    freshness_expr = _effective_freshness_expr(threshold)

    # Grouped by the expressions themselves, not by output aliases: `ad_accounts.status`
    # already exists, so PostgreSQL would resolve a bare "status" alias to that column.
    rows = ctx.session.execute(
        sa.select(
            status_expr.label("effective_health_status"),
            freshness_expr.label("effective_freshness"),
            sa.func.count(),
        )
        .select_from(AdAccount)
        .outerjoin(AccountHealthSnapshot, AccountHealthSnapshot.ad_account_id == AdAccount.id)
        .where(AdAccount.workspace_id == ctx.workspace_id, AdAccount.archived_at.is_(None))
        .group_by(status_expr, freshness_expr)
    ).all()

    counts = {status.value: 0 for status in HealthStatus}
    stale = total = 0
    for status_value, freshness_value, count in rows:
        key = status_value.value if hasattr(status_value, "value") else str(status_value)
        counts[key] = counts.get(key, 0) + count
        total += count
        if freshness_value == HealthFreshness.STALE:
            stale += count

    never_evaluated = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(AdAccount)
            .outerjoin(AccountHealthSnapshot, AccountHealthSnapshot.ad_account_id == AdAccount.id)
            .where(
                AdAccount.workspace_id == ctx.workspace_id,
                AdAccount.archived_at.is_(None),
                AccountHealthSnapshot.id.is_(None),
            )
        ).scalar_one()
    )
    last_evaluation = ctx.session.execute(
        sa.select(sa.func.max(AccountHealthSnapshot.last_evaluated_at)).where(
            AccountHealthSnapshot.workspace_id == ctx.workspace_id
        )
    ).scalar()
    failed_runs = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(HealthEvaluationRun)
            .where(
                HealthEvaluationRun.workspace_id == ctx.workspace_id,
                HealthEvaluationRun.status == EvaluationRunStatus.FAILED,
                HealthEvaluationRun.started_at >= now - timedelta(hours=24),
            )
        ).scalar_one()
    )

    return s.HealthSummaryOut(
        total_active=total,
        critical=counts[HealthStatus.CRITICAL.value],
        warning=counts[HealthStatus.WARNING.value],
        attention_needed=counts[HealthStatus.ATTENTION_NEEDED.value],
        unknown=counts[HealthStatus.UNKNOWN.value],
        clear_signals=counts[HealthStatus.CLEAR_SIGNALS.value],
        stale_data=stale,
        never_evaluated=never_evaluated,
        last_evaluation_at=last_evaluation,
        failed_runs_recent=failed_runs,
    )


# --------------------------------------------------------------------------------- list
@router.get("/account-health")
def list_account_health(
    ctx: Ctx,
    search: str | None = None,
    health_status: str | None = None,
    freshness_status: str | None = None,
    severity: str | None = None,
    signal_status: str | None = None,
    rule_key: str | None = None,
    business_manager_id: uuid.UUID | None = None,
    account_type: str | None = None,
    readiness_status: str | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "health_severity",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    threshold = _stale_threshold(now)
    status_expr = _effective_status_expr(threshold)
    freshness_expr = _effective_freshness_expr(threshold)

    stmt = (
        sa.select(AdAccount, AccountHealthSnapshot)
        .outerjoin(AccountHealthSnapshot, AccountHealthSnapshot.ad_account_id == AdAccount.id)
        .where(AdAccount.workspace_id == ctx.workspace_id)
    )
    stmt = (
        stmt.where(AdAccount.archived_at.is_not(None))
        if archived
        else stmt.where(AdAccount.archived_at.is_(None))
    )
    if search:
        needle = f"%{search.strip()}%"
        stmt = stmt.where(
            sa.or_(
                AdAccount.display_name.ilike(needle),
                AdAccount.external_account_id.ilike(needle),
                AdAccount.owner_label.ilike(needle),
            )
        )
    if health_status:
        stmt = stmt.where(status_expr == HealthStatus(health_status))
    if freshness_status:
        stmt = stmt.where(freshness_expr == HealthFreshness(freshness_status))
    if account_type:
        stmt = stmt.where(AdAccount.account_type == account_type)
    if readiness_status:
        stmt = stmt.where(AdAccount.readiness_status == readiness_status)
    if business_manager_id:
        stmt = stmt.where(AdAccount.business_manager_id == business_manager_id)

    if severity or signal_status or rule_key:
        signal_filter = sa.select(AccountHealthSignal.id).where(
            AccountHealthSignal.ad_account_id == AdAccount.id
        )
        if severity:
            signal_filter = signal_filter.where(AccountHealthSignal.severity == SignalSeverity(severity))
        if rule_key:
            signal_filter = signal_filter.where(AccountHealthSignal.rule_key == rule_key)
        signal_filter = (
            signal_filter.where(AccountHealthSignal.status == signal_status)
            if signal_status
            else signal_filter.where(AccountHealthSignal.status.in_(list(ACTIVE_SIGNAL_STATUSES)))
        )
        stmt = stmt.where(signal_filter.exists())

    column = {
        "health_severity": _SEVERITY_ORDER,
        "last_evaluated_at": AccountHealthSnapshot.last_evaluated_at,
        "freshness": AccountHealthSnapshot.last_evaluated_at,
        "display_name": AdAccount.display_name,
        "updated_at": AdAccount.updated_at,
    }.get(sort if sort in SORTABLE else "health_severity")
    # "desc" means "worst first" for severity, which is ascending rank.
    if sort == "health_severity":
        ordering = sa.asc(column) if sort_direction == "desc" else sa.desc(column)
    else:
        ordering = sa.desc(column) if sort_direction == "desc" else sa.asc(column)
    stmt = stmt.order_by(ordering, sa.asc(AdAccount.id))

    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    items = [_row(account, snapshot, now) for account, snapshot in rows]
    return page_response(items, page=page, page_size=page_size, total=total)


# ----------------------------------------------------------------------- per-account
def _account_health_payload(ctx, account: AdAccount) -> dict[str, Any]:
    now = datetime.now(UTC)
    snapshot = AccountHealthSnapshotService(ctx.session, ctx.workspace_id, ctx.audit).get(account.id)
    presented = present_snapshot(account, snapshot, now=now)
    return {
        "ad_account_id": str(account.id),
        **presented,
        # Readiness travels beside health, never merged into it (A2 §4.1).
        "readiness": {
            "status": account.readiness_status.value,
            "evaluated_at": (
                account.readiness_evaluated_at.isoformat() if account.readiness_evaluated_at else None
            ),
        },
    }


@router.get("/ad-accounts/{ad_account_id}/health", response_model=s.AccountHealthOut)
def account_health(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    account = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids()).get(ad_account_id)
    return _account_health_payload(ctx, account)


def _decorate_signal(signal: AccountHealthSignal) -> dict[str, Any]:
    data = s.HealthSignalOut.model_validate(signal).model_dump()
    rule = HEALTH_RULES_BY_KEY.get(signal.rule_key)
    if rule:
        data["rule_name"] = rule.name
        data["why_it_matters"] = rule.why_it_matters
        data["recommended_next_step"] = rule.recommended_next_step
        data["resolution_guidance"] = rule.resolution_guidance
    return data


@router.get("/ad-accounts/{ad_account_id}/health/signals")
def account_health_signals(
    ctx: Ctx,
    ad_account_id: uuid.UUID,
    status: str | None = None,
    include_historical: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
) -> dict[str, Any]:
    account = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids()).get(ad_account_id)
    stmt = sa.select(AccountHealthSignal).where(
        AccountHealthSignal.ad_account_id == account.id,
        AccountHealthSignal.workspace_id == ctx.workspace_id,
    )
    if status:
        stmt = stmt.where(AccountHealthSignal.status == status)
    elif not include_historical:
        stmt = stmt.where(AccountHealthSignal.status.in_(list(ACTIVE_SIGNAL_STATUSES)))
    stmt = stmt.order_by(AccountHealthSignal.observed_at.desc(), AccountHealthSignal.id.desc())

    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).scalars().all()
    return page_response([_decorate_signal(row) for row in rows], page=page, page_size=page_size, total=total)


@router.post("/ad-accounts/{ad_account_id}/health/recalculate", response_model=s.AccountHealthOut)
def recalculate_account_health(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    """Recomputes internal signals from stored evidence and events.

    It contacts no advertising platform and changes nothing outside this product.
    """
    account = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids()).get(ad_account_id)
    service = AccountHealthEvaluationService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    run = service.evaluate_account_safe(account, trigger=EvaluationTrigger.MANUAL_RECALCULATE)
    ctx.commit()
    payload = _account_health_payload(ctx, account)
    payload["last_run_status"] = run.status.value
    return payload


# --------------------------------------------------------------------- signal actions
def _get_signal(ctx, signal_id: uuid.UUID) -> AccountHealthSignal:
    return get_or_404(ctx.session, AccountHealthSignal, signal_id, ctx.workspace_id, label="Health signal")


def _signal_account(ctx, signal: AccountHealthSignal) -> AdAccount:
    return get_or_404(ctx.session, AdAccount, signal.ad_account_id, ctx.workspace_id, label="Ad account")


@router.get("/account-health/signals/{signal_id}")
def signal_detail(ctx: Ctx, signal_id: uuid.UUID) -> dict[str, Any]:
    signal = _get_signal(ctx, signal_id)
    account = _signal_account(ctx, signal)
    return {
        "signal": _decorate_signal(signal),
        "account": {
            "id": str(account.id),
            "display_name": account.display_name,
            "external_account_id": account.external_account_id,
            "status": account.status.value,
            "readiness_status": account.readiness_status.value,
        },
        "disclaimer": s.HEALTH_DISCLAIMER,
    }


def _act(ctx, signal: AccountHealthSignal, action, *args, **kwargs) -> dict[str, Any]:
    account = _signal_account(ctx, signal)
    if account.archived_at is not None:
        raise ValidationError("This account is archived; its signals are read-only.")
    action(*args, **kwargs)
    # Re-roll the snapshot so the account list reflects the action immediately. The underlying
    # A1 event/checklist record is deliberately untouched.
    AccountHealthEvaluationService(
        ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id
    ).evaluate_account_safe(account, trigger=EvaluationTrigger.MANUAL_RECALCULATE)
    ctx.commit()
    return {"signal": _decorate_signal(signal), "health": _account_health_payload(ctx, account)}


@router.post("/account-health/signals/{signal_id}/acknowledge")
def acknowledge_signal(ctx: WriteCtx, signal_id: uuid.UUID, payload: s.AcknowledgeRequest) -> dict[str, Any]:
    signal = _get_signal(ctx, signal_id)
    service = HealthSignalActionService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, signal, service.acknowledge, signal, note=payload.note)


@router.post("/account-health/signals/{signal_id}/resolve")
def resolve_signal(ctx: WriteCtx, signal_id: uuid.UUID, payload: s.ResolveRequest) -> dict[str, Any]:
    signal = _get_signal(ctx, signal_id)
    service = HealthSignalActionService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(
        ctx,
        signal,
        service.resolve,
        signal,
        reason=payload.reason,
        evidence_reference=payload.evidence_reference,
    )


@router.post("/account-health/signals/{signal_id}/reopen")
def reopen_signal(ctx: WriteCtx, signal_id: uuid.UUID, payload: s.ReopenRequest) -> dict[str, Any]:
    signal = _get_signal(ctx, signal_id)
    service = HealthSignalActionService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, signal, service.reopen, signal, reason=payload.reason)


@router.get("/account-health/signals/{signal_id}/audit-logs")
def signal_audit_logs(
    ctx: AuditCtx,
    signal_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    signal = _get_signal(ctx, signal_id)
    stmt = (
        sa.select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(
            AuditLog.workspace_id == ctx.workspace_id,
            AuditLog.entity_type == "account_health_signal",
            AuditLog.entity_id == str(signal.id),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    items = []
    for entry, actor_email in rows:
        data = AuditLogOut.model_validate(entry).model_dump()
        data["actor_email"] = actor_email
        items.append(data)
    return page_response(items, page=page, page_size=page_size, total=total)


# --------------------------------------------------------------- rules and runs
@router.get("/account-health/rules")
def list_rules(ctx: Ctx) -> list[dict[str, Any]]:
    """Read-only in A2: there is no admin-settings architecture to hang rule tuning off yet."""
    definitions = HealthRuleRegistryService(ctx.session, ctx.workspace_id).ensure_seeded()
    ctx.commit()
    payload = []
    for definition in definitions:
        data = s.HealthRuleOut.model_validate(definition).model_dump()
        rule = HEALTH_RULES_BY_KEY.get(definition.rule_key)
        if rule:
            data["why_it_matters"] = rule.why_it_matters
            data["recommended_next_step"] = rule.recommended_next_step
            data["applicability"] = rule.applicability
        payload.append(data)
    return payload


@router.get("/account-health/evaluation-runs")
def list_runs(
    ctx: Ctx,
    ad_account_id: uuid.UUID | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    stmt = sa.select(HealthEvaluationRun).where(HealthEvaluationRun.workspace_id == ctx.workspace_id)
    if ad_account_id:
        stmt = stmt.where(HealthEvaluationRun.ad_account_id == ad_account_id)
    if status:
        stmt = stmt.where(HealthEvaluationRun.status == status)
    stmt = stmt.order_by(HealthEvaluationRun.started_at.desc(), HealthEvaluationRun.id.desc())
    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).scalars().all()
    return page_response(
        [s.EvaluationRunOut.model_validate(row).model_dump() for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/account-health/evaluation-runs/{run_id}", response_model=s.EvaluationRunOut)
def get_run(ctx: Ctx, run_id: uuid.UUID) -> HealthEvaluationRun:
    run = ctx.session.execute(
        sa.select(HealthEvaluationRun).where(
            HealthEvaluationRun.id == run_id, HealthEvaluationRun.workspace_id == ctx.workspace_id
        )
    ).scalar_one_or_none()
    if run is None:
        raise NotFoundError("Evaluation run was not found in this workspace.")
    return run


@router.post("/account-health/backfill")
def backfill(ctx: WriteCtx, payload: s.BackfillRequest) -> dict[str, Any]:
    """Owner-only, bounded, and synchronous because this release ships no worker."""
    if ctx.membership.role != WorkspaceRole.OWNER:
        raise AuthorizationError("Only the workspace owner can start a health backfill.")
    if not payload.confirm:
        raise ValidationError(
            "Backfill must be confirmed explicitly.", details={"field": "confirm"}
        )
    service = HealthBackfillService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    result = service.run(batch_size=payload.batch_size)
    ctx.commit()
    return result
