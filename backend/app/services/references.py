"""Generic workspace-scoped reference CRUD.

Business Managers, personal-account references, Pages, Pixels, payment-profile references,
browser-profile references and proxy references share the same lifecycle: create, update,
soft-archive, restore — each audited, each workspace-bound. One implementation keeps that
behaviour identical across all seven instead of drifting per router.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.services.audit import AuditLogService
from app.services.base import apply_sort, diff, get_or_404, paginate, require_active, snapshot


@dataclass(frozen=True)
class ReferenceSpec:
    model: type
    entity_type: str
    label: str
    search_fields: tuple[str, ...]
    unique_fields: tuple[tuple[str, ...], ...] = ()
    sortable: frozenset[str] = frozenset({"updated_at", "created_at"})


class ReferenceService:
    def __init__(
        self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService, spec: ReferenceSpec
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.spec = spec

    def get(self, entity_id: uuid.UUID) -> Any:
        return get_or_404(self.session, self.spec.model, entity_id, self.workspace_id, label=self.spec.label)

    def list(
        self,
        *,
        search: str | None = None,
        status: str | None = None,
        archived: bool = False,
        page: int = 1,
        page_size: int = 50,
        sort: str = "updated_at",
        sort_direction: str = "desc",
    ) -> tuple[Sequence[Any], int]:
        model = self.spec.model
        stmt = sa.select(model).where(model.workspace_id == self.workspace_id)
        stmt = (
            stmt.where(model.archived_at.is_not(None))
            if archived
            else stmt.where(model.archived_at.is_(None))
        )
        if search and self.spec.search_fields:
            needle = f"%{search.strip()}%"
            stmt = stmt.where(
                sa.or_(*[getattr(model, field).ilike(needle) for field in self.spec.search_fields])
            )
        if status:
            stmt = stmt.where(model.status == status)
        stmt = apply_sort(stmt, model, sort, sort_direction, set(self.spec.sortable))
        return paginate(self.session, stmt, page=page, page_size=page_size)

    def _assert_unique(self, payload: dict[str, Any], *, exclude_id: uuid.UUID | None = None) -> None:
        model = self.spec.model
        for combination in self.spec.unique_fields:
            values = {field: payload.get(field) for field in combination}
            if any(value in (None, "") for value in values.values()):
                continue
            stmt = sa.select(model.id).where(model.workspace_id == self.workspace_id)
            for field, value in values.items():
                stmt = stmt.where(getattr(model, field) == value)
            if exclude_id:
                stmt = stmt.where(model.id != exclude_id)
            if self.session.execute(stmt).first() is not None:
                raise ConflictError(
                    f"Another {self.spec.label.lower()} in this workspace already uses "
                    f"{', '.join(combination)}.",
                    details={"fields": list(combination)},
                )

    def create(self, payload: dict[str, Any]) -> Any:
        self._assert_unique(payload)
        instance = self.spec.model(workspace_id=self.workspace_id, **payload)
        self.session.add(instance)
        self.session.flush()
        self.audit.record(
            action=f"{self.spec.entity_type}.created",
            entity_type=self.spec.entity_type,
            entity_id=instance.id,
            after=snapshot(instance),
        )
        return instance

    def update(self, instance: Any, payload: dict[str, Any]) -> Any:
        require_active(instance, label=self.spec.label)
        merged = {**{k: getattr(instance, k, None) for combo in self.spec.unique_fields for k in combo}, **payload}
        self._assert_unique(merged, exclude_id=instance.id)
        before = snapshot(instance)
        for key, value in payload.items():
            setattr(instance, key, value)
        self.session.flush()
        after = snapshot(instance)
        changed = diff(before, after)
        if changed:
            self.audit.record(
                action=f"{self.spec.entity_type}.updated",
                entity_type=self.spec.entity_type,
                entity_id=instance.id,
                before={k: before.get(k) for k in changed},
                after=changed,
            )
        return instance

    def archive(self, instance: Any) -> Any:
        if instance.archived_at is not None:
            raise ConflictError(f"This {self.spec.label.lower()} is already archived.")
        before = snapshot(instance)
        instance.archived_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action=f"{self.spec.entity_type}.archived",
            entity_type=self.spec.entity_type,
            entity_id=instance.id,
            before=before,
            after=snapshot(instance),
        )
        return instance

    def restore(self, instance: Any) -> Any:
        if instance.archived_at is None:
            raise ConflictError(f"This {self.spec.label.lower()} is not archived.")
        before = snapshot(instance)
        instance.archived_at = None
        self.session.flush()
        self.audit.record(
            action=f"{self.spec.entity_type}.restored",
            entity_type=self.spec.entity_type,
            entity_id=instance.id,
            before=before,
            after=snapshot(instance),
        )
        return instance
