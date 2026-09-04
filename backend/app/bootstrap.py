"""First-run provisioning.

Creates one workspace and one owner from environment variables when the database has none.
Idempotent: it does nothing once a workspace exists, so restarting the container never
resets or duplicates the operator account.
"""
from __future__ import annotations

import logging
import re

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import WorkspaceRole
from app.core.security import hash_password
from app.models.entities import User, Workspace, WorkspaceMember

logger = logging.getLogger(__name__)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "workspace"


def bootstrap_owner(session: Session) -> Workspace | None:
    settings = get_settings()
    if not settings.bootstrap_owner_email or not settings.bootstrap_owner_password:
        logger.info("bootstrap skipped: no bootstrap owner configured")
        return None

    existing = session.execute(sa.select(Workspace).limit(1)).scalar_one_or_none()
    if existing is not None:
        return existing

    email = settings.bootstrap_owner_email.strip().lower()
    user = session.execute(sa.select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            full_name=email.split("@")[0],
            password_hash=hash_password(settings.bootstrap_owner_password),
            is_active=True,
        )
        session.add(user)
        session.flush()

    workspace = Workspace(
        name=settings.bootstrap_workspace_name, slug=_slugify(settings.bootstrap_workspace_name)
    )
    session.add(workspace)
    session.flush()
    session.add(
        WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER)
    )
    session.commit()
    logger.info("bootstrap created workspace and owner", extra={"workspace_slug": workspace.slug})
    return workspace
