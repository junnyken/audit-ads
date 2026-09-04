from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.common import ORMModel


class AuditLogOut(ORMModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    actor_email: str | None = None
    action: str
    entity_type: str
    entity_id: str
    before_json: dict[str, Any] | None
    after_json: dict[str, Any] | None
    metadata_json: dict[str, Any] | None
    request_id: str | None
    created_at: datetime


class SystemStatusOut(BaseModel):
    """Deliberately narrow: no hostnames, no environment values, no connection strings."""

    application: str
    version: str
    environment: str
    api_status: str
    database_status: str
    database_migration_revision: str | None
    worker_status: str
    redis_status: str
    last_readiness_recalculation_at: datetime | None
    account_count: int
    server_time: datetime
