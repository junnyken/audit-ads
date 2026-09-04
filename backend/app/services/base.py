"""Shared helpers for the service layer."""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime
from enum import Enum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ArchivedEntityError, NotFoundError
from app.core.redaction import redact


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    return value


def snapshot(instance: Any) -> dict[str, Any]:
    """Redacted column snapshot of an ORM instance, safe for an audit diff."""
    mapper = sa.inspect(instance).mapper
    data = {attr.key: to_jsonable(getattr(instance, attr.key)) for attr in mapper.column_attrs}
    data.pop("password_hash", None)
    return redact(data)


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Only the keys that actually changed, so audit rows stay small and readable."""
    changed = {k: v for k, v in after.items() if before.get(k) != v}
    changed.pop("updated_at", None)
    return changed


def get_or_404(
    session: Session,
    model: type,
    entity_id: uuid.UUID,
    workspace_id: uuid.UUID,
    *,
    label: str | None = None,
) -> Any:
    """Fetch inside the workspace boundary. A row in another workspace is reported as missing,
    never as forbidden, so the API cannot be used to probe for foreign object ids."""
    stmt = sa.select(model).where(model.id == entity_id, model.workspace_id == workspace_id)
    instance = session.execute(stmt).scalar_one_or_none()
    if instance is None:
        name = label or model.__name__
        raise NotFoundError(f"{name} was not found in this workspace.", details={"id": str(entity_id)})
    return instance


def require_active(instance: Any, *, label: str) -> Any:
    if getattr(instance, "archived_at", None) is not None:
        raise ArchivedEntityError(
            f"{label} is archived. Restore it before making changes.",
            details={"id": str(instance.id)},
        )
    return instance


def parse_uuid(value: str, *, field: str = "id") -> uuid.UUID:
    from app.core.errors import ValidationError

    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:  # pragma: no cover - defensive
        raise ValidationError(f"{field} must be a UUID.", details={"field": field}) from exc


def paginate(
    session: Session,
    stmt: sa.Select,
    *,
    page: int,
    page_size: int,
) -> tuple[Sequence[Any], int]:
    total = session.execute(
        sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).scalars().all()
    return rows, int(total)


def apply_sort(stmt: sa.Select, model: type, sort: str | None, direction: str, allowed: set[str]) -> sa.Select:
    column_name = sort if sort in allowed else "updated_at"
    column = getattr(model, column_name)
    ordering = sa.desc(column) if direction.lower() == "desc" else sa.asc(column)
    # Stable tie-break so pagination cannot repeat or skip rows with equal sort keys.
    return stmt.order_by(ordering, sa.asc(model.id))
