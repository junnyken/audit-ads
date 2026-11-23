"""First-run provisioning and owner credential recovery.

Creates one workspace and one owner from environment variables when the database has none, and
keeps the configured bootstrap owner account active and in sync with `BOOTSTRAP_OWNER_EMAIL` /
`BOOTSTRAP_OWNER_PASSWORD` when those variables are set. On a platform with an internal-only
database and no shell access, updating `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD`
in the environment and redeploying is the only way an operator can recover owner access.
"""
from __future__ import annotations

import logging
import re

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import WorkspaceRole
from app.core.security import hash_password, verify_password
from app.models.entities import User, Workspace, WorkspaceMember

logger = logging.getLogger(__name__)


def ensure_commercial_schema_idempotent(session: Session) -> str:
    """Idempotent additive DDL guard for commercial license/reset columns on Postgres."""
    bind = session.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect_name != "postgresql":
        return "skipped_non_postgres"
    try:
        locked = bool(session.execute(sa.text("SELECT pg_try_advisory_xact_lock(440025)")).scalar())
        if not locked:
            session.rollback()
            return "skipped_locked"
        stmts = (
            "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ NULL",
            "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS max_desktop_devices INTEGER NULL",
            "ALTER TABLE community_invite_codes ADD COLUMN IF NOT EXISTS duration_days INTEGER NULL",
            "ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS client_channel VARCHAR(20) NOT NULL DEFAULT 'web'",
            "ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS installation_hash VARCHAR(64) NULL",
            "CREATE INDEX IF NOT EXISTS ix_device_sessions_installation_hash ON device_sessions (installation_hash)",
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ NULL,
                requested_ip_hash VARCHAR(64) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """.strip(),
            "CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)",
        )
        for stmt in stmts:
            session.execute(sa.text(stmt))
        session.commit()
        logger.info("commercial schema guard verified")
        return "installed"
    except Exception as exc:
        session.rollback()
        logger.warning("commercial schema guard warning", extra={"error_type": type(exc).__name__})
        return f"error:{type(exc).__name__}"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "workspace"


def bootstrap_owner(session: Session) -> Workspace | None:
    settings = get_settings()
    if not settings.bootstrap_owner_email or not settings.bootstrap_owner_password:
        logger.info("bootstrap skipped: no bootstrap owner configured")
        return None

    email = settings.bootstrap_owner_email.strip().lower()
    password = settings.bootstrap_owner_password

    workspace = session.execute(
        sa.select(Workspace).where(Workspace.archived_at.is_(None)).order_by(Workspace.created_at.asc()).limit(1)
    ).scalar_one_or_none()
    if workspace is None:
        workspace = session.execute(sa.select(Workspace).order_by(Workspace.created_at.asc()).limit(1)).scalar_one_or_none()

    created_workspace = False
    if workspace is None:
        workspace = Workspace(
            name=settings.bootstrap_workspace_name, slug=_slugify(settings.bootstrap_workspace_name)
        )
        session.add(workspace)
        session.flush()
        created_workspace = True

    user = session.execute(sa.select(User).where(User.email == email)).scalar_one_or_none()
    changed = created_workspace
    if user is None:
        user = User(
            email=email,
            full_name=email.split("@")[0],
            password_hash=hash_password(password),
            is_active=True,
        )
        session.add(user)
        session.flush()
        changed = True
    else:
        if not user.is_active:
            user.is_active = True
            changed = True
        if not verify_password(password, user.password_hash):
            user.password_hash = hash_password(password)
            changed = True

    membership = session.execute(
        sa.select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        )
    ).scalar_one_or_none()
    if membership is None:
        session.add(
            WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER)
        )
        changed = True
    else:
        if membership.archived_at is not None:
            membership.archived_at = None
            changed = True
        if membership.role != WorkspaceRole.OWNER:
            membership.role = WorkspaceRole.OWNER
            changed = True

    if changed:
        session.commit()
        logger.info(
            "bootstrap created workspace and owner" if created_workspace else "bootstrap synchronised owner account",
            extra={"workspace_slug": workspace.slug},
        )
    return workspace



def bootstrap_meta_sync(session: Session, workspace: Workspace | None) -> None:
    """Auto-sync configured Meta Business Manager on production startup so real assets are always present."""
    try:
        session.execute(
            sa.text(
                "UPDATE personal_account_references SET ownership_type = UPPER(ownership_type) WHERE ownership_type != UPPER(ownership_type)"
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    settings = get_settings()
    if workspace is None:
        return
    if settings.environment.lower() not in ("production", "prod", "staging"):
        return
    if not (settings.meta_access_token or "").strip() or not (settings.meta_business_id or "").strip():
        return
    owner_member = (
        session.execute(
            sa.select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.archived_at.is_(None),
                WorkspaceMember.role == WorkspaceRole.OWNER,
            )
        )
        .scalars()
        .first()
    )
    if owner_member is None:
        return
    from app.api.v1.routers.meta_operations import run_workspace_quick_sync

    try:
        res = run_workspace_quick_sync(
            session,
            workspace.id,
            owner_member.user_id,
            bm_ref=settings.meta_business_id.strip(),
        )
        session.commit()
        logger.info("bootstrap_meta_sync completed", extra={"status": res.get("status"), "imported": res.get("imported_ad_accounts")})
    except Exception:
        session.rollback()
        logger.exception("bootstrap_meta_sync failed")
