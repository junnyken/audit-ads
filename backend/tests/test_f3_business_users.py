"""F3 — Business Manager `business_users` discovery, reconciliation, suggestion & drift alerting."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa

from alembic import command
from alembic.config import Config
from app import startup_migration
from app.core.config import get_settings
from app.core.enums import AlertSeverity, AlertStatus, WorkspaceRole
from app.core.security import hash_password
from app.db.session import engine
from app.models.entities import User, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.meta_graph_transport import GraphResponse
from app.services.meta_provider import DiscoveredAsset
from app.services.meta_real_provider import BUSINESS_USER_FIELDS, RealMetaBusinessProvider
from app.services.notification_service import NotificationDispatcherService
from app.services.notification_transport import FakeNotificationTransport

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BM = "1993884657458857"


def _config() -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return config


def _revision() -> str:
    with engine.connect() as connection:
        return connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()


@dataclass
class _StubTransport:
    responses: list[GraphResponse]
    calls: list[tuple[str, dict[str, Any] | None]] = field(default_factory=list)

    def get(self, path: str, params: dict[str, Any] | None = None) -> GraphResponse:
        self.calls.append((path, params))
        return self.responses.pop(0)


def test_0020_migration_round_trips_and_startup_migration_accepts_off(migrated_database, monkeypatch):
    assert _revision() in ("0020_f3_business_users", "0021_c1_client_budget_and_pacing")
    tables_before = set(sa.inspect(engine).get_table_names())
    assert "discovered_business_user_observations" in tables_before
    engine.dispose()
    try:
        command.downgrade(_config(), "0019_f1_facebook_identities")
        assert _revision() == "0019_f1_facebook_identities"
        inspector = sa.inspect(engine)
        assert "discovered_business_user_observations" not in set(inspector.get_table_names())
        assert "external_business_user_id" not in {
            c["name"] for c in inspector.get_columns("personal_account_business_links")
        }
    finally:
        command.upgrade(_config(), "head")
    assert _revision() in ("0020_f3_business_users", "0021_c1_client_budget_and_pacing")

    calls: list[str] = []
    monkeypatch.setattr(startup_migration.command, "upgrade", lambda cfg, target: calls.append(target))
    monkeypatch.setenv("MIGRATE_ON_START", "off")
    startup_migration.run_if_requested(BACKEND_DIR)
    assert calls == []


def test_real_provider_business_users_requests_only_allowlisted_fields_and_strips_email():
    """Rule 1: `business_users` must only request `id,name,role` and strip any email if returned."""
    assert BUSINESS_USER_FIELDS == "id,name,role"
    assert "email" not in BUSINESS_USER_FIELDS

    transport = _StubTransport(
        [
            GraphResponse(
                ok=True,
                payload={
                    "data": [
                        {
                            "id": "90001",
                            "name": "Minh Nguyen",
                            "role": "ADMIN",
                            "email": "never-keep@example.com",
                        }
                    ]
                },
            )
        ]
    )
    provider = RealMetaBusinessProvider(transport=transport, business_id=BM)  # type: ignore[arg-type]
    result = provider.discover_business_users(BM)

    assert len(transport.calls) == 1
    assert transport.calls[0][0] == f"{BM}/business_users"
    assert transport.calls[0][1] is not None
    assert transport.calls[0][1]["fields"] == "id,name,role"
    assert result.complete is True
    assert len(result.assets) == 1
    asset = result.assets[0]
    assert asset.external_id == "90001"
    assert asset.name == "Minh Nguyen"
    assert asset.safe_metadata == {"role": "ADMIN"}
    assert "never-keep@example.com" not in repr(asset)


def test_f3_business_users_suggest_confirm_and_alert_on_stranger_or_removed_admin(
    api, client, auth, owner, db_session, meta_provider, monkeypatch
):
    """End-to-end F3:
    1. Discovering an unlinked user in BM suggests a matching internal Facebook profile without
       auto-linking (Rule 31), and opens a `bm_user_access_drift` alert + Telegram notification.
    2. Operator confirms the link with 1 click -> reconciliation becomes `linked` and the alert
       auto-resolves.
    3. Next discovery run where a confirmed Admin is removed opens a CRITICAL alert naming the
       removed Admin and the BM's login identity.
    """
    settings = get_settings()
    prev_bm = settings.meta_business_id
    settings.meta_business_id = BM
    monkeypatch.setattr(settings, "telegram_bot_token", "test-bot-token")
    try:
        # Create a workspace member & two Facebook profiles (FB1 Admin, FB2 Employee)
        u = User(
            email="minh.holder@example.com",
            full_name="Minh Nguyen",
            password_hash=hash_password("ValidPassword123!"),
            is_active=True,
        )
        db_session.add(u)
        db_session.flush()
        m = WorkspaceMember(
            workspace_id=owner["workspace"].id,
            user_id=u.id,
            role=WorkspaceRole.ADMIN,
        )
        db_session.add(m)
        db_session.flush()
        db_session.commit()

        fb1 = api.post(
            "/api/v1/personal-account-references",
            json={
                "label": "FB1 — Minh giữ",
                "display_name": "Minh Nguyen",
                "owner_member_id": str(m.id),
                "two_factor_method": "app",
                "vault_reference": "1Password > Agency > FB1",
            },
        ).json()
        fb2 = api.post(
            "/api/v1/personal-account-references",
            json={
                "label": "FB2 — Lan giữ",
                "display_name": "Lan Tran",
                "two_factor_method": "security_key",
                "vault_reference": "1Password > Agency > FB2",
            },
        ).json()

        # Enable Telegram notifications in notification policy
        patch_res = api.patch(
            "/api/v1/notification-policies/current",
            json={"telegram_chat_id": "-10099887766", "quiet_hours_enabled": False},
        )
        assert patch_res.status_code == 200

        # Create MetaConnection and stage 2 business_users: Minh (ADMIN) and Lan (EMPLOYEE)
        conn = api.post(
            "/api/v1/meta-connections",
            json={"label": "BM Chính", "environment": "fake", "business_manager_reference": BM},
        ).json()
        meta_provider.business_managers.append({"external_id": BM, "name": "BM Chính Agency"})
        meta_provider.discovered_business_users.extend(
            [
                DiscoveredAsset(
                    "bu_minh_01",
                    "Minh Nguyen",
                    "business_users",
                    safe_metadata={"role": "ADMIN"},
                ),
                DiscoveredAsset(
                    "bu_lan_02",
                    "Lan Tran",
                    "business_users",
                    safe_metadata={"role": "EMPLOYEE"},
                ),
            ]
        )

        # 1. Run discovery: neither is auto-linked (Rule 31), both get `suggested_identity`,
        # and a CRITICAL `bm_user_access_drift` alert is opened because `bu_minh_01` is an unlinked ADMIN!
        run1 = api.post(f"/api/v1/meta-connections/{conn['id']}/discoveries").json()
        assert run1["business_users"]["coverage_status"] == "complete"
        assert run1["business_users"]["complete"] is True
        bu_rows = {r["external_user_id"]: r for r in run1["business_users"]["reconciliation"]}
        assert set(bu_rows) == {"bu_minh_01", "bu_lan_02"}
        assert bu_rows["bu_minh_01"]["status"] == "unlinked"
        assert bu_rows["bu_minh_01"]["linked_identity"] is None
        assert bu_rows["bu_minh_01"]["suggested_identity"]["id"] == fb1["id"]
        assert bu_rows["bu_lan_02"]["status"] == "unlinked"
        assert bu_rows["bu_lan_02"]["suggested_identity"]["id"] == fb2["id"]

        alerts_page = api.get("/api/v1/alerts").json()
        drift_alerts = [
            a for a in alerts_page["items"] if a["category"] == "bm_access"
        ]
        assert len(drift_alerts) == 1
        drift_alert = drift_alerts[0]
        assert drift_alert["severity"] == AlertSeverity.CRITICAL.value
        assert drift_alert["status"] == AlertStatus.OPEN.value
        assert "bu_minh_01" in drift_alert["summary"]
        assert len(drift_alert["remediation_checklist"]) >= 3

        # 2. Confirm both links via the F3 endpoint -> alert auto-resolves!
        c1 = api.post(
            f"/api/v1/meta-connections/{conn['id']}/discoveries/{run1['id']}/business-user-links",
            json={
                "external_user_id": "bu_minh_01",
                "personal_account_reference_id": fb1["id"],
            },
        )
        assert c1.status_code == 201
        assert c1.json()["role"] == "admin"

        c2 = api.post(
            f"/api/v1/meta-connections/{conn['id']}/discoveries/{run1['id']}/business-user-links",
            json={
                "external_user_id": "bu_lan_02",
                "personal_account_reference_id": fb2["id"],
            },
        )
        assert c2.status_code == 201
        assert c2.json()["role"] == "employee"

        latest = api.get(f"/api/v1/meta-connections/{conn['id']}/discoveries/latest").json()
        for r in latest["business_users"]["reconciliation"]:
            assert r["status"] == "linked"
            assert r["linked_identity"] is not None

        resolved_detail = api.get(f"/api/v1/alerts/{drift_alert['id']}").json()
        assert resolved_detail["alert"]["status"] == AlertStatus.RESOLVED.value

        # 3. Next run: Admin `bu_minh_01` is removed from BM, and a stranger `bu_stranger_99` enters!
        meta_provider.discovered_business_users.clear()
        meta_provider.discovered_business_users.extend(
            [
                DiscoveredAsset(
                    "bu_lan_02",
                    "Lan Tran",
                    "business_users",
                    safe_metadata={"role": "EMPLOYEE"},
                ),
                DiscoveredAsset(
                    "bu_stranger_99",
                    "Strange Account",
                    "business_users",
                    safe_metadata={"role": "ADMIN"},
                ),
            ]
        )
        run2 = api.post(f"/api/v1/meta-connections/{conn['id']}/discoveries").json()
        bu_rows2 = {r["external_user_id"]: r for r in run2["business_users"]["reconciliation"]}
        assert bu_rows2["bu_lan_02"]["status"] == "linked"
        assert bu_rows2["bu_stranger_99"]["status"] == "unlinked"
        assert bu_rows2["bu_minh_01"]["status"] == "missing_from_latest_discovery"
        assert bu_rows2["bu_minh_01"]["is_admin_drift"] is True

        # Check the newly opened CRITICAL alert and dispatch its Telegram notification
        alerts_page2 = api.get("/api/v1/alerts").json()
        active_drift = [
            a for a in alerts_page2["items"] if a["category"] == "bm_access"
        ]
        assert len(active_drift) == 1
        new_alert = active_drift[0]
        assert new_alert["severity"] == AlertSeverity.CRITICAL.value
        assert "bu_stranger_99" in new_alert["summary"]
        assert "bu_minh_01" in new_alert["summary"]
        # And the BM-level alert includes FB1 & FB2 in facebook_identities (with Admin FB1 first)!
        assert len(new_alert["facebook_identities"]) == 2
        assert new_alert["facebook_identities"][0]["label"] == "FB1 — Minh giữ"

        transport = FakeNotificationTransport()
        sys_audit = AuditLogService(db_session, owner["workspace"].id, owner["user"].id)
        NotificationDispatcherService(
            db_session, owner["workspace"].id, sys_audit, transport=transport
        ).dispatch_due()
        db_session.commit()

        assert len(transport.sent) >= 1
        last_text = transport.sent[-1].text
        assert "Login to fix: Đăng nhập FB1 — Minh giữ" in last_text
        assert "người giữ: Minh Nguyen" in last_text
        assert "Checklist: 1) " in last_text
    finally:
        settings.meta_business_id = prev_bm
