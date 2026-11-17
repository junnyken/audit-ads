"""WorkspaceAccessService — the single place that answers "may this actor do this?".

Roles exist in data from the first release even though only `owner` is provisioned, so a later
RBAC MINI-SPEC changes this module rather than hunting for a hard-coded user id in services
(A1 Guardrail 12).
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import WorkspaceRole
from app.core.errors import AuthorizationError
from app.models.entities import WorkspaceMember

MUTATION_ROLES = frozenset({WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUYER})
READ_ROLES = frozenset(WorkspaceRole)
AUDIT_READ_ROLES = frozenset(
    {WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.AUDITOR, WorkspaceRole.VIEWER}
)

#: A9's own role vocabulary (`owner`/`admin`/`operator`/`viewer`, per
#: `docs/ADSOPS_MINI_SPEC_A9_TEAM_SEATS_DEVICE_SECURITY.md` §5.1) is not this codebase's
#: `WorkspaceRole` enum (`owner`/`admin`/`buyer`/`viewer`/`auditor`) — decided with the product
#: owner (`docs/AUDIT_BEFORE_BUILD_A9.md` §5) to keep the existing enum rather than rename it,
#: and map `operator`≈`buyer` at this one boundary. `owner` and `auditor` are deliberately not
#: keys here: `owner` can never be invited or role-changed through A9 (guardrail 13), and
#: `auditor` keeps its own existing meaning rather than being folded into `viewer`.
A9_ROLE_TO_WORKSPACE_ROLE: dict[str, WorkspaceRole] = {
    "admin": WorkspaceRole.ADMIN,
    "operator": WorkspaceRole.BUYER,
    "viewer": WorkspaceRole.VIEWER,
}
WORKSPACE_ROLE_TO_A9_ROLE: dict[WorkspaceRole, str] = {
    value: key for key, value in A9_ROLE_TO_WORKSPACE_ROLE.items()
}


class WorkspaceAccessService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_membership(self, *, user_id: uuid.UUID, workspace_id: uuid.UUID) -> WorkspaceMember:
        stmt = sa.select(WorkspaceMember).where(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.archived_at.is_(None),
        )
        membership = self.session.execute(stmt).scalar_one_or_none()
        if membership is None:
            raise AuthorizationError("You do not have access to this workspace.")
        return membership

    @staticmethod
    def require_mutation(membership: WorkspaceMember) -> None:
        if membership.role not in MUTATION_ROLES:
            raise AuthorizationError(
                f"Role '{membership.role.value}' is read-only and cannot change data."
            )

    @staticmethod
    def require_audit_read(membership: WorkspaceMember) -> None:
        if membership.role not in AUDIT_READ_ROLES:
            raise AuthorizationError(
                f"Role '{membership.role.value}' cannot read audit history."
            )
