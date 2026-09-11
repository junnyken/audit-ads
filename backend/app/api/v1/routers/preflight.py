"""A6 — Preflight Compliance Gate API. Mirrors A1's `ad_accounts.py` conventions: `Ctx` for
reads, `WriteCtx` for mutations, workspace scope always from the authenticated membership, and
every mutation is audited by the underlying service.

No route here ever creates, edits, publishes, pauses or duplicates anything on an advertising
platform — there is no such capability anywhere in this module.
"""
from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.core.enums import FindingStatus
from app.models.entities import AdAccount
from app.models.preflight import LandingPageEvidence, PreflightEvaluationRun, PreflightFinding
from app.schemas import preflight as s
from app.schemas.common import page_response
from app.services.preflight_draft import CampaignDraftService, DraftFilters
from app.services.preflight_evaluation import PreflightEvaluationService
from app.services.preflight_finding import PreflightFindingService

router = APIRouter(prefix="/campaign-drafts", tags=["preflight"])
findings_router = APIRouter(prefix="/preflight-findings", tags=["preflight"])


def _serialize_draft(draft, counts: dict[str, int] | None = None, *, account_name: str | None = None) -> dict[str, Any]:
    data = s.CampaignDraftOut.model_validate(draft).model_dump()
    data["account_display_name"] = account_name
    data["open_blocking_count"] = (counts or {}).get("blocking", 0)
    data["open_warning_count"] = (counts or {}).get("warning", 0)
    return data


def _account_name(ctx, ad_account_id: uuid.UUID | None) -> str | None:
    if ad_account_id is None:
        return None
    account = ctx.session.get(AdAccount, ad_account_id)
    return account.display_name if account else None


def _serialize_with_context(ctx, draft) -> dict[str, Any]:
    """Every mutation response carries the same fields the list/detail views do, so the
    frontend never has to special-case a "thin" response right after a write."""
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    counts = service.open_finding_counts([draft.id]).get(draft.id)
    return _serialize_draft(draft, counts, account_name=_account_name(ctx, draft.ad_account_id))


@router.get("")
def list_drafts(
    ctx: Ctx,
    search: str | None = None,
    draft_status: str | None = None,
    ad_account_id: uuid.UUID | None = None,
    has_blocking_findings: bool | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "updated_at",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    rows, total = service.list(
        DraftFilters(
            search=search,
            draft_status=draft_status,
            ad_account_id=ad_account_id,
            has_blocking_findings=has_blocking_findings,
            archived=archived,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_direction=sort_direction,
        )
    )
    counts = service.open_finding_counts([row.id for row in rows])
    account_ids = [row.ad_account_id for row in rows if row.ad_account_id is not None]
    names: dict[uuid.UUID, str] = {}
    if account_ids:
        for account_id, display_name in ctx.session.execute(
            sa.select(AdAccount.id, AdAccount.display_name).where(AdAccount.id.in_(account_ids))
        ).all():
            names[account_id] = display_name
    items = [
        _serialize_draft(row, counts.get(row.id), account_name=names.get(row.ad_account_id))
        for row in rows
    ]
    return page_response(items, page=page, page_size=page_size, total=total)


@router.post("", status_code=201)
def create_draft(ctx: WriteCtx, payload: s.CampaignDraftCreate) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.create(payload.model_dump(), actor_id=ctx.user.id)
    ctx.commit()
    return _serialize_with_context(ctx, draft)


@router.get("/{draft_id}")
def get_draft(ctx: Ctx, draft_id: uuid.UUID) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.get(draft_id)
    return _serialize_with_context(ctx, draft)


@router.patch("/{draft_id}")
def update_draft(ctx: WriteCtx, draft_id: uuid.UUID, payload: s.CampaignDraftUpdate) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.update(
        service.get(draft_id), payload.model_dump(exclude_unset=True), actor_id=ctx.user.id
    )
    ctx.commit()
    return _serialize_with_context(ctx, draft)


@router.post("/{draft_id}/archive")
def archive_draft(ctx: WriteCtx, draft_id: uuid.UUID) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.archive(service.get(draft_id))
    ctx.commit()
    return _serialize_with_context(ctx, draft)


@router.post("/{draft_id}/restore")
def restore_draft(ctx: WriteCtx, draft_id: uuid.UUID) -> dict[str, Any]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.restore(service.get(draft_id))
    ctx.commit()
    return _serialize_with_context(ctx, draft)


@router.post("/{draft_id}/evaluate")
def evaluate_draft(ctx: WriteCtx, draft_id: uuid.UUID) -> s.PreflightEvaluationRunOut:
    draft_service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = draft_service.get(draft_id)
    evaluation = PreflightEvaluationService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    run = evaluation.evaluate(draft)
    ctx.commit()
    return s.PreflightEvaluationRunOut.model_validate(run)


@router.get("/{draft_id}/evaluation-runs")
def list_evaluation_runs(ctx: Ctx, draft_id: uuid.UUID) -> list[s.PreflightEvaluationRunOut]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.get(draft_id)
    rows = (
        ctx.session.execute(
            sa.select(PreflightEvaluationRun)
            .where(PreflightEvaluationRun.draft_id == draft.id)
            .order_by(sa.desc(PreflightEvaluationRun.created_at))
        )
        .scalars()
        .all()
    )
    return [s.PreflightEvaluationRunOut.model_validate(row) for row in rows]


@router.get("/{draft_id}/findings")
def list_findings(ctx: Ctx, draft_id: uuid.UUID, include_superseded: bool = False) -> list[s.PreflightFindingOut]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.get(draft_id)
    stmt = sa.select(PreflightFinding).where(PreflightFinding.draft_id == draft.id)
    if not include_superseded:
        stmt = stmt.where(PreflightFinding.status != FindingStatus.SUPERSEDED)
    stmt = stmt.order_by(sa.desc(PreflightFinding.created_at))
    rows = ctx.session.execute(stmt).scalars().all()
    return [s.PreflightFindingOut.model_validate(row) for row in rows]


@router.get("/{draft_id}/landing-page-evidence")
def list_landing_page_evidence(ctx: Ctx, draft_id: uuid.UUID) -> list[s.LandingPageEvidenceOut]:
    service = CampaignDraftService(ctx.session, ctx.workspace_id, ctx.audit)
    draft = service.get(draft_id)
    rows = (
        ctx.session.execute(
            sa.select(LandingPageEvidence)
            .where(LandingPageEvidence.draft_id == draft.id)
            .order_by(sa.desc(LandingPageEvidence.checked_at))
        )
        .scalars()
        .all()
    )
    return [s.LandingPageEvidenceOut.model_validate(row) for row in rows]


# ------------------------------------------------------------------------- findings actions


@findings_router.post("/{finding_id}/acknowledge")
def acknowledge_finding(ctx: WriteCtx, finding_id: uuid.UUID, payload: s.FindingActionRequest) -> s.PreflightFindingOut:
    service = PreflightFindingService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    finding = service.acknowledge(service.get(finding_id), reason=payload.reason)
    ctx.commit()
    return s.PreflightFindingOut.model_validate(finding)


@findings_router.post("/{finding_id}/resolve")
def resolve_finding(ctx: WriteCtx, finding_id: uuid.UUID, payload: s.FindingActionRequest) -> s.PreflightFindingOut:
    service = PreflightFindingService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    finding = service.resolve(service.get(finding_id), reason=payload.reason)
    ctx.commit()
    return s.PreflightFindingOut.model_validate(finding)
