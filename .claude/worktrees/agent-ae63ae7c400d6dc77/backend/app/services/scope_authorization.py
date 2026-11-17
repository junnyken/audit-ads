"""ScopeAuthorizationService (A9 Step 4) — the centralized answer to "can this member see this
resource," per `docs/AUDIT_BEFORE_BUILD_A9.md` §7: **no per-resource scope check exists
anywhere in this codebase before A9.** `READ_ROLES = frozenset(WorkspaceRole)` in
`app/services/workspace.py` means every route today trusts "any active member of any role" —
this service is what a route calls to narrow that down to "this member's actual assigned scope."

Only the two foundational primitives (`can_view_business_manager`, `can_view_ad_account`) land
in this step. `can_view_page_or_pixel` and `can_view_operation_batch` are deferred to Step 5
(API), when they get wired into an actual route — building them now, with no call site to prove
them against, would be exactly the kind of speculative code this project's own working style
avoids ("don't design for hypothetical future requirements").
"""
from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AssignmentStatus, WorkspaceRole
from app.core.errors import NotFoundError
from app.models.entities import AdAccount, WorkspaceMember
from app.models.team import MemberAdAccountAssignment, MemberBusinessManagerAssignment


class ScopeAuthorizationService:
    def __init__(self, session: Session, workspace_id: uuid.UUID) -> None:
        self.session = session
        self.workspace_id = workspace_id

    def can_view_business_manager(self, member: WorkspaceMember, business_manager_id: uuid.UUID) -> bool:
        if member.role == WorkspaceRole.OWNER:
            return True
        return self.session.execute(
            sa.select(sa.literal(True)).where(
                sa.exists().where(
                    MemberBusinessManagerAssignment.workspace_id == self.workspace_id,
                    MemberBusinessManagerAssignment.member_id == member.id,
                    MemberBusinessManagerAssignment.business_manager_id == business_manager_id,
                    MemberBusinessManagerAssignment.status == AssignmentStatus.ACTIVE,
                    MemberBusinessManagerAssignment.archived_at.is_(None),
                )
            )
        ).scalar_one_or_none() is True

    def can_view_ad_account(self, member: WorkspaceMember, ad_account: AdAccount) -> bool:
        if member.role == WorkspaceRole.OWNER:
            return True
        direct = self.session.execute(
            sa.select(sa.literal(True)).where(
                sa.exists().where(
                    MemberAdAccountAssignment.workspace_id == self.workspace_id,
                    MemberAdAccountAssignment.member_id == member.id,
                    MemberAdAccountAssignment.ad_account_id == ad_account.id,
                    MemberAdAccountAssignment.status == AssignmentStatus.ACTIVE,
                    MemberAdAccountAssignment.archived_at.is_(None),
                )
            )
        ).scalar_one_or_none() is True
        if direct:
            return True
        if ad_account.business_manager_id is None:
            return False
        return self.can_view_business_manager(member, ad_account.business_manager_id)

    def visible_business_manager_ids(self, member: WorkspaceMember) -> set[uuid.UUID] | None:
        """`None` means "no filter needed" (owner — sees everything already visible to the
        workspace). A non-owner gets the concrete set, even if empty."""
        if member.role == WorkspaceRole.OWNER:
            return None
        rows = self.session.execute(
            sa.select(MemberBusinessManagerAssignment.business_manager_id).where(
                MemberBusinessManagerAssignment.workspace_id == self.workspace_id,
                MemberBusinessManagerAssignment.member_id == member.id,
                MemberBusinessManagerAssignment.status == AssignmentStatus.ACTIVE,
                MemberBusinessManagerAssignment.archived_at.is_(None),
            )
        ).scalars().all()
        return set(rows)

    def require_ad_account(self, member: WorkspaceMember, ad_account: AdAccount) -> AdAccount:
        """Non-disclosing: a resource outside the member's scope is `404`, the same answer they
        get for one in another workspace entirely (A9 §6.2). Never `403` — that would confirm
        the record exists."""
        if not self.can_view_ad_account(member, ad_account):
            raise NotFoundError("Ad account not found.")
        return ad_account

    def require_business_manager(self, member: WorkspaceMember, business_manager) -> Any:
        if not self.can_view_business_manager(member, business_manager.id):
            raise NotFoundError("Business Manager not found.")
        return business_manager

    def visible_ad_account_ids(self, member: WorkspaceMember) -> set[uuid.UUID] | None:
        """Union of direct account assignments and every account under an assigned BM
        (A9 §6.1 rule 6). `None` again means "owner, no filter needed"."""
        if member.role == WorkspaceRole.OWNER:
            return None
        direct = set(
            self.session.execute(
                sa.select(MemberAdAccountAssignment.ad_account_id).where(
                    MemberAdAccountAssignment.workspace_id == self.workspace_id,
                    MemberAdAccountAssignment.member_id == member.id,
                    MemberAdAccountAssignment.status == AssignmentStatus.ACTIVE,
                    MemberAdAccountAssignment.archived_at.is_(None),
                )
            ).scalars().all()
        )
        bm_ids = self.visible_business_manager_ids(member) or set()
        if bm_ids:
            via_bm = set(
                self.session.execute(
                    sa.select(AdAccount.id).where(
                        AdAccount.workspace_id == self.workspace_id,
                        AdAccount.business_manager_id.in_(bm_ids),
                    )
                ).scalars().all()
            )
            direct |= via_bm
        return direct
