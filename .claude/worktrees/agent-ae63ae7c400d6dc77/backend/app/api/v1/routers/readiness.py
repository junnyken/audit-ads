from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.core.enums import EvaluationTrigger, ReadinessStatus
from app.models.entities import AdAccount, ReadinessChecklistItem, ReadinessEvidence
from app.schemas import readiness as s
from app.schemas.registry import ManualReviewRequest
from app.services.base import get_or_404
from app.services.checklist import ReadinessChecklistService, ReadinessEvidenceService
from app.services.health_triggers import trigger_health
from app.services.registry import AdAccountRegistryService
from app.services.rollup import ReadinessRollupService

router = APIRouter(tags=["readiness"])


def _readiness_payload(result) -> dict[str, Any]:
    return s.ReadinessOut(**result.to_dict()).model_dump()


# The static "/readiness/summary" and "/readiness/board" paths are declared before
# "/{ad_account_id}/readiness" so FastAPI never tries to parse the literal as a UUID.
@router.get("/ad-accounts/readiness/summary", response_model=s.ReadinessSummaryOut)
def readiness_summary(ctx: Ctx) -> s.ReadinessSummaryOut:
    counts = ReadinessRollupService(ctx.session, ctx.workspace_id, ctx.audit).summary()
    return s.ReadinessSummaryOut(
        total_active=counts["total_active"],
        operationally_ready=counts[ReadinessStatus.OPERATIONALLY_READY.value],
        ready_with_warnings=counts[ReadinessStatus.READY_WITH_WARNINGS.value],
        not_ready=counts[ReadinessStatus.NOT_READY.value],
        unknown=counts[ReadinessStatus.UNKNOWN.value],
        archived=counts["archived"],
    )


@router.get("/ad-accounts/readiness/board")
def readiness_board(
    ctx: Ctx,
    readiness_status: str | None = None,
    page_size: int = Query(200, ge=1, le=500),
) -> dict[str, Any]:
    """Cross-account readiness view, grouped by the reason holding accounts back.

    Read-only by design: A1 §G.6 forbids a mass "mark complete" action, so this endpoint
    exposes no mutation.
    """
    stmt = sa.select(AdAccount).where(
        AdAccount.workspace_id == ctx.workspace_id, AdAccount.archived_at.is_(None)
    )
    if readiness_status:
        stmt = stmt.where(AdAccount.readiness_status == ReadinessStatus(readiness_status))
    accounts = list(ctx.session.execute(stmt.limit(page_size)).scalars().all())

    rollup = ReadinessRollupService(ctx.session, ctx.workspace_id, ctx.audit)
    evaluations = rollup.evaluate_many(accounts)

    rows: list[dict[str, Any]] = []
    groups: dict[str, dict[str, Any]] = {}
    for account in accounts:
        result = evaluations[str(account.id)]
        blocking = [r for r in result.reasons if r.severity in ("warning", "critical")]
        rows.append(
            {
                "ad_account_id": str(account.id),
                "display_name": account.display_name,
                "external_account_id": account.external_account_id,
                "readiness_status": result.readiness_status,
                "status": account.status.value,
                "required_item_count": result.required_item_count,
                "completed_item_count": result.completed_item_count,
                "reasons": [vars(reason) for reason in blocking],
            }
        )
        for reason in blocking:
            group = groups.setdefault(
                reason.code,
                {
                    "code": reason.code,
                    "message": reason.message,
                    "severity": reason.severity,
                    "accounts": [],
                },
            )
            group["accounts"].append(
                {"ad_account_id": str(account.id), "display_name": account.display_name}
            )

    ordered = sorted(groups.values(), key=lambda group: (-len(group["accounts"]), group["code"]))
    return {"rows": rows, "groups": ordered}


@router.get("/ad-accounts/{ad_account_id}/readiness")
def get_readiness(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    return _readiness_payload(registry.rollup.evaluate(account, persist=False))


@router.post("/ad-accounts/{ad_account_id}/readiness/recalculate")
def recalculate_readiness(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    registry.checklists.initialise(account)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    return _readiness_payload(result)


@router.post("/ad-accounts/{ad_account_id}/readiness/manual-review")
def record_manual_review(
    ctx: WriteCtx, ad_account_id: uuid.UUID, payload: ManualReviewRequest
) -> dict[str, Any]:
    """Stamp the account-level manual review. This is what makes `last_manual_review_completed`
    current; it expires again once the configured interval passes."""
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.record_manual_review(registry.get(ad_account_id), note=payload.note)
    result = registry.rollup.evaluate(account, persist=False)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    return _readiness_payload(result)


@router.get("/ad-accounts/{ad_account_id}/readiness/checklist")
def get_checklist(ctx: Ctx, ad_account_id: uuid.UUID) -> list[dict[str, Any]]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    result = registry.rollup.evaluate(account, persist=False)
    evaluation_by_key = {item.item_key: item for item in result.items}
    evidence_service = ReadinessEvidenceService(ctx.session, ctx.workspace_id, ctx.audit)

    payload: list[dict[str, Any]] = []
    for item in sorted(registry.checklists.list_items(account.id), key=lambda row: row.item_key):
        evaluation = evaluation_by_key.get(item.item_key)
        payload.append(
            {
                "item": s.ChecklistItemOut.model_validate(item).model_dump(),
                "evidence": [
                    s.EvidenceOut.model_validate(row).model_dump()
                    for row in evidence_service.list_for_item(item.id)
                ],
                "evaluation": evaluation.to_dict() if evaluation else None,
            }
        )
    return payload


@router.patch("/ad-accounts/{ad_account_id}/readiness/checklist/{item_key}")
def update_checklist_item(
    ctx: WriteCtx, ad_account_id: uuid.UUID, item_key: str, payload: s.ChecklistItemUpdate
) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    checklists = ReadinessChecklistService(ctx.session, ctx.workspace_id, ctx.audit)
    item = checklists.get_item(account.id, item_key)
    checklists.update_review(
        item,
        review_status=payload.review_status,
        notes=payload.notes,
        expires_at=payload.expires_at,
        waiver_reason=payload.waiver_reason,
        actor_id=ctx.actor_id,
    )
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.CHECKLIST_MUTATION, reference_id=str(item.id))
    ctx.commit()
    return {
        "item": s.ChecklistItemOut.model_validate(item).model_dump(),
        "readiness": _readiness_payload(result),
    }


@router.post("/ad-accounts/{ad_account_id}/readiness/checklist/{item_key}/evidence", status_code=201)
def add_evidence(
    ctx: WriteCtx, ad_account_id: uuid.UUID, item_key: str, payload: s.EvidenceCreate
) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    checklists = ReadinessChecklistService(ctx.session, ctx.workspace_id, ctx.audit)
    item = checklists.get_item(account.id, item_key)
    evidence = ReadinessEvidenceService(ctx.session, ctx.workspace_id, ctx.audit).add(
        item,
        evidence_type=payload.evidence_type,
        summary=payload.summary,
        storage_reference=payload.storage_reference,
        external_url=payload.external_url,
        expires_at=payload.expires_at,
        status=payload.status,
        actor_id=ctx.actor_id,
    )
    checklists.recompute_evidence_status(item)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.EVIDENCE_MUTATION, reference_id=str(evidence.id))
    ctx.commit()
    return {
        "evidence": s.EvidenceOut.model_validate(evidence).model_dump(),
        "item": s.ChecklistItemOut.model_validate(item).model_dump(),
        "readiness": _readiness_payload(result),
    }


def _account_for_evidence(ctx, evidence: ReadinessEvidence) -> tuple[AdAccount, ReadinessChecklistItem]:
    item = get_or_404(
        ctx.session,
        ReadinessChecklistItem,
        evidence.checklist_item_id,
        ctx.workspace_id,
        label="Checklist item",
    )
    account = get_or_404(ctx.session, AdAccount, item.ad_account_id, ctx.workspace_id, label="Ad account")
    return account, item


@router.patch("/readiness-evidence/{evidence_id}")
def update_evidence(ctx: WriteCtx, evidence_id: uuid.UUID, payload: s.EvidenceUpdate) -> dict[str, Any]:
    evidence = get_or_404(ctx.session, ReadinessEvidence, evidence_id, ctx.workspace_id, label="Evidence")
    account, item = _account_for_evidence(ctx, evidence)
    evidence_service = ReadinessEvidenceService(ctx.session, ctx.workspace_id, ctx.audit)
    evidence_service.update(
        evidence,
        status=payload.status,
        summary=payload.summary,
        expires_at=payload.expires_at,
        actor_id=ctx.actor_id,
    )
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    registry.checklists.recompute_evidence_status(item)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.EVIDENCE_MUTATION, reference_id=str(evidence.id))
    ctx.commit()
    return {
        "evidence": s.EvidenceOut.model_validate(evidence).model_dump(),
        "readiness": _readiness_payload(result),
    }


@router.post("/readiness-evidence/{evidence_id}/archive")
def archive_evidence(ctx: WriteCtx, evidence_id: uuid.UUID) -> dict[str, Any]:
    evidence = get_or_404(ctx.session, ReadinessEvidence, evidence_id, ctx.workspace_id, label="Evidence")
    account, item = _account_for_evidence(ctx, evidence)
    ReadinessEvidenceService(ctx.session, ctx.workspace_id, ctx.audit).archive(evidence)
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    registry.checklists.recompute_evidence_status(item)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.EVIDENCE_MUTATION, reference_id=str(evidence.id))
    ctx.commit()
    return {
        "evidence": s.EvidenceOut.model_validate(evidence).model_dump(),
        "readiness": _readiness_payload(result),
    }
