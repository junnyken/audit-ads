from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import Ctx, WriteCtx
from app.core.enums import EvaluationTrigger
from app.models.entities import AccountEvent, AdAccount
from app.schemas import events as s
from app.services.base import get_or_404
from app.services.events import AccountEventService
from app.services.health_triggers import trigger_health
from app.services.registry import AdAccountRegistryService

router = APIRouter(tags=["events"])


@router.get("/ad-accounts/{ad_account_id}/events", response_model=list[s.AccountEventOut])
def list_events(ctx: Ctx, ad_account_id: uuid.UUID, include_archived: bool = False) -> list[AccountEvent]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)
    return AccountEventService(ctx.session, ctx.workspace_id, ctx.audit).list_for_account(
        account.id, include_archived=include_archived
    )


@router.post("/ad-accounts/{ad_account_id}/events", status_code=201)
def create_event(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AccountEventCreate) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)
    event = AccountEventService(ctx.session, ctx.workspace_id, ctx.audit).create(
        account,
        event_type=payload.event_type,
        severity=payload.severity,
        source=payload.source,
        occurred_at=payload.occurred_at,
        summary=payload.summary,
        evidence_reference=payload.evidence_reference,
    )
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_EVENT_MUTATION, reference_id=str(event.id))
    ctx.commit()
    return {
        "event": s.AccountEventOut.model_validate(event).model_dump(),
        "readiness_status": result.readiness_status,
    }


def _event_and_account(ctx, event_id: uuid.UUID) -> tuple[AccountEvent, AdAccount]:
    event = get_or_404(ctx.session, AccountEvent, event_id, ctx.workspace_id, label="Account event")
    account = get_or_404(ctx.session, AdAccount, event.ad_account_id, ctx.workspace_id, label="Ad account")
    return event, account


@router.patch("/account-events/{event_id}")
def update_event(ctx: WriteCtx, event_id: uuid.UUID, payload: s.AccountEventUpdate) -> dict[str, Any]:
    event, account = _event_and_account(ctx, event_id)
    AccountEventService(ctx.session, ctx.workspace_id, ctx.audit).update(
        event,
        severity=payload.severity,
        status=payload.status,
        summary=payload.summary,
        evidence_reference=payload.evidence_reference,
    )
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_EVENT_MUTATION, reference_id=str(event.id))
    ctx.commit()
    return {
        "event": s.AccountEventOut.model_validate(event).model_dump(),
        "readiness_status": result.readiness_status,
    }


@router.post("/account-events/{event_id}/resolve")
def resolve_event(ctx: WriteCtx, event_id: uuid.UUID, payload: s.AccountEventResolve) -> dict[str, Any]:
    event, account = _event_and_account(ctx, event_id)
    AccountEventService(ctx.session, ctx.workspace_id, ctx.audit).resolve(
        event, resolution_note=payload.resolution_note, actor_id=ctx.actor_id
    )
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    result = registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_EVENT_MUTATION, reference_id=str(event.id))
    ctx.commit()
    return {
        "event": s.AccountEventOut.model_validate(event).model_dump(),
        "readiness_status": result.readiness_status,
    }
