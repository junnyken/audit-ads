from __future__ import annotations

from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import Ctx
from app.core.errors import AuthenticationError
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.entities import User, Workspace, WorkspaceMember
from app.schemas.auth import CurrentUserResponse, LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, session: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    user = session.execute(
        sa.select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    # One message for "no such user" and "wrong password" so the endpoint cannot be used to
    # enumerate which operator accounts exist.
    invalid = AuthenticationError("Email or password is incorrect.")
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise invalid

    membership = session.execute(
        sa.select(WorkspaceMember)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.archived_at.is_(None),
            Workspace.archived_at.is_(None),
        )
        .order_by(WorkspaceMember.created_at.asc())
    ).scalars().first()
    if membership is None:
        raise AuthenticationError("This user is not a member of any workspace.")

    token, expires_at = create_access_token(
        subject=str(user.id), workspace_id=str(membership.workspace_id), role=membership.role.value
    )
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.get("/me", response_model=CurrentUserResponse)
def me(ctx: Ctx) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=ctx.user.id,
        email=ctx.user.email,
        full_name=ctx.user.full_name,
        role=ctx.membership.role,
        workspace={"id": ctx.workspace.id, "name": ctx.workspace.name, "slug": ctx.workspace.slug},
    )
