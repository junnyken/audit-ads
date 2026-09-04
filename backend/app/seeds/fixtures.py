"""Development fixtures — the three pilot scenarios from A1 §Live verification.

Run with::

    python -m app.seeds.fixtures

Idempotent by external account id, so re-running duplicates nothing. Every record here is
fabricated sample metadata: no real advertising account, no real payment reference, no
credential of any kind.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.core.enums import (
    AccountStatus,
    AccountType,
    AssetType,
    ChecklistReviewStatus,
    EventSeverity,
    EvidenceStatus,
    ReferenceStatus,
)
from app.db.session import session_scope
from app.models.entities import (
    AdAccount,
    BrowserProfileReference,
    BusinessManager,
    Page,
    PaymentProfileReference,
    PersonalAccountReference,
    Pixel,
    ProxyReference,
    Workspace,
    WorkspaceMember,
)
from app.services.audit import AuditLogService
from app.services.checklist import ReadinessChecklistService, ReadinessEvidenceService
from app.services.events import AccountEventService
from app.services.links import AssetLinkService
from app.services.references import ReferenceService, ReferenceSpec
from app.services.registry import AdAccountRegistryService

logger = logging.getLogger(__name__)

SEEDED_EXTERNAL_IDS = ("act_seed_a", "act_seed_b", "act_seed_c")


def seed(session) -> dict[str, str]:
    workspace = session.execute(sa.select(Workspace).limit(1)).scalar_one_or_none()
    if workspace is None:
        raise RuntimeError("No workspace exists. Start the API once so the owner is bootstrapped.")
    member = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id).limit(1)
    ).scalar_one()
    actor_id = member.user_id

    existing = session.execute(
        sa.select(AdAccount.external_account_id).where(
            AdAccount.workspace_id == workspace.id,
            AdAccount.external_account_id.in_(SEEDED_EXTERNAL_IDS),
        )
    ).scalars().all()
    if existing:
        return {"status": "already_seeded", "accounts": ", ".join(sorted(existing))}

    audit = AuditLogService(session, workspace.id, actor_id)
    registry = AdAccountRegistryService(session, workspace.id, audit)
    checklists = ReadinessChecklistService(session, workspace.id, audit)
    evidence_service = ReadinessEvidenceService(session, workspace.id, audit)
    links = AssetLinkService(session, workspace.id, audit)
    events = AccountEventService(session, workspace.id, audit)

    def reference(model, entity_type, label, payload):
        spec = ReferenceSpec(model=model, entity_type=entity_type, label=label, search_fields=())
        return ReferenceService(session, workspace.id, audit, spec).create(payload)

    now = datetime.now(UTC)

    bm = reference(
        BusinessManager,
        "business_manager",
        "Business Manager",
        {
            "name": "Sample BM - Retail VN",
            "external_id": "bm_seed_1",
            "status": ReferenceStatus.ACTIVE,
            "country": "VN",
            "currency": "VND",
            "notes": "Seeded development fixture.",
        },
    )
    personal = reference(
        PersonalAccountReference,
        "personal_account_reference",
        "Personal account reference",
        {
            "label": "Sample operator profile",
            "display_name": "Operator One",
            "external_reference_id": "per_seed_1",
            "status": ReferenceStatus.ACTIVE,
            "country": "VN",
            "timezone": "Asia/Ho_Chi_Minh",
            "notes": "Seeded development fixture. Reference metadata only.",
        },
    )
    page = reference(
        Page,
        "page",
        "Page",
        {"name": "Sample Page", "external_page_id": "page_seed_1", "status": ReferenceStatus.ACTIVE},
    )
    pixel = reference(
        Pixel,
        "pixel",
        "Pixel",
        {"name": "Sample Pixel", "external_pixel_id": "pixel_seed_1", "status": ReferenceStatus.ACTIVE},
    )
    payment = reference(
        PaymentProfileReference,
        "payment_profile_reference",
        "Payment profile reference",
        {
            "reference_code": "PAY-SEED-01",
            "label": "Sample payment arrangement",
            "provider": "internal-finance",
            "billing_country": "VN",
            "currency": "VND",
            "status": ReferenceStatus.ACTIVE,
        },
    )
    browsers = [
        reference(
            BrowserProfileReference,
            "browser_profile_reference",
            "Browser profile reference",
            {
                "profile_reference": f"chrome-profile-{index}",
                "provider": "chrome",
                "label": f"Chrome profile {index}",
                "local_or_remote": "local",
                "status": ReferenceStatus.ACTIVE,
            },
        )
        for index in (1, 2, 3)
    ]
    proxy = reference(
        ProxyReference,
        "proxy_reference",
        "Proxy reference",
        {
            "proxy_reference": "smartproxy-label-01",
            "provider": "smartproxy",
            "label": "VN residential pool (operator label)",
            "country": "VN",
            "protocol": "http",
            "status": ReferenceStatus.ACTIVE,
        },
    )

    def complete_review(account, item_key: str) -> None:
        item = checklists.get_item(account.id, item_key)
        checklists.update_review(
            item,
            review_status=ChecklistReviewStatus.COMPLETED,
            notes="Seeded fixture review.",
            expires_at=None,
            waiver_reason=None,
            actor_id=actor_id,
        )

    def verify_evidence(account, item_key: str, summary: str) -> None:
        item = checklists.get_item(account.id, item_key)
        evidence_service.add(
            item,
            evidence_type="operator_note",
            summary=summary,
            storage_reference=None,
            external_url=None,
            expires_at=now + timedelta(days=180),
            status=EvidenceStatus.VERIFIED,
            actor_id=actor_id,
        )
        checklists.recompute_evidence_status(item)
        complete_review(account, item_key)

    # --- Account A: complete record -------------------------------------------------
    account_a = registry.create(
        {
            "display_name": "Pilot A - complete record",
            "external_account_id": "act_seed_a",
            "account_type": AccountType.BUSINESS_MANAGER,
            "business_manager_id": bm.id,
            "personal_account_reference_id": None,
            "owner_label": "Operator One",
            "country": "VN",
            "currency": "VND",
            "timezone": "Asia/Ho_Chi_Minh",
            "status": AccountStatus.ACTIVE,
            "requires_page": True,
            "requires_pixel": True,
            "landing_page_url": None,
            "tags": ["pilot", "retail"],
            "notes": "Seeded fixture: every required item satisfied.",
        }
    )
    links.link(account_a, asset_type=AssetType.PAGE, asset_id=page.id, actor_id=actor_id)
    links.link(account_a, asset_type=AssetType.PIXEL, asset_id=pixel.id, actor_id=actor_id)
    links.link(account_a, asset_type=AssetType.PAYMENT_PROFILE, asset_id=payment.id, actor_id=actor_id)
    links.link(account_a, asset_type=AssetType.BROWSER_PROFILE, asset_id=browsers[0].id, actor_id=actor_id)
    verify_evidence(account_a, "ownership_confirmed", "Ownership verified against the BM member list.")
    verify_evidence(account_a, "payment_method_reviewed", "Payment reference verified with finance.")
    complete_review(account_a, "admin_access_reviewed")
    complete_review(account_a, "two_factor_reviewed")
    complete_review(account_a, "billing_issue_checked")
    registry.record_manual_review(account_a, note="Seeded fixture: initial manual review.")

    # --- Account B: payment review missing ------------------------------------------
    account_b = registry.create(
        {
            "display_name": "Pilot B - payment review missing",
            "external_account_id": "act_seed_b",
            "account_type": AccountType.PERSONAL_REFERENCE,
            "business_manager_id": None,
            "personal_account_reference_id": personal.id,
            "owner_label": "Operator One",
            "country": "VN",
            "currency": "VND",
            "timezone": "Asia/Ho_Chi_Minh",
            "status": AccountStatus.ACTIVE,
            "requires_page": False,
            "requires_pixel": False,
            "landing_page_url": None,
            "tags": ["pilot"],
            "notes": "Seeded fixture: payment review deliberately incomplete.",
        }
    )
    links.link(account_b, asset_type=AssetType.BROWSER_PROFILE, asset_id=browsers[1].id, actor_id=actor_id)
    links.link(account_b, asset_type=AssetType.PROXY, asset_id=proxy.id, actor_id=actor_id)
    verify_evidence(account_b, "ownership_confirmed", "Ownership verified against the operator reference.")
    complete_review(account_b, "admin_access_reviewed")
    complete_review(account_b, "two_factor_reviewed")
    complete_review(account_b, "billing_issue_checked")
    registry.record_manual_review(account_b, note="Seeded fixture: initial manual review.")

    # --- Account C: restricted with an unresolved critical event ---------------------
    account_c = registry.create(
        {
            "display_name": "Pilot C - restricted with critical event",
            "external_account_id": "act_seed_c",
            "account_type": AccountType.BUSINESS_MANAGER,
            "business_manager_id": bm.id,
            "personal_account_reference_id": None,
            "owner_label": "Operator One",
            "country": "VN",
            "currency": "VND",
            "timezone": "Asia/Ho_Chi_Minh",
            "status": AccountStatus.RESTRICTED,
            "requires_page": False,
            "requires_pixel": False,
            "landing_page_url": None,
            "tags": ["pilot", "review"],
            "notes": "Seeded fixture: restricted account under manual review.",
        }
    )
    links.link(account_c, asset_type=AssetType.BROWSER_PROFILE, asset_id=browsers[2].id, actor_id=actor_id)
    events.create(
        account_c,
        event_type="account_restriction_notice",
        severity=EventSeverity.CRITICAL,
        source="manual",
        occurred_at=now - timedelta(days=2),
        summary="Operator recorded a restriction notice observed in the ads interface.",
        evidence_reference=None,
    )

    for account in (account_a, account_b, account_c):
        registry.rollup.evaluate(account)

    return {
        "status": "seeded",
        "account_a": f"{account_a.display_name} -> {account_a.readiness_status.value}",
        "account_b": f"{account_b.display_name} -> {account_b.readiness_status.value}",
        "account_c": f"{account_c.display_name} -> {account_c.readiness_status.value}",
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    with session_scope() as session:
        for key, value in seed(session).items():
            print(f"{key}: {value}")


if __name__ == "__main__":
    main()
