"""Tests for v2.6.0 Team Playbooks Marketplace, Proxy IP-Timezone Guard & Team Launch RBAC/Audit."""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://adsops:adsops@localhost:5434/adsops_test")
os.environ.setdefault("JWT_SECRET", "test-secret-not-used-in-production")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("NOTIFICATION_TRANSPORT", "fake")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ["META_ACCESS_TOKEN"] = ""
os.environ["META_ACCESS_TOKENS_BY_BUSINESS"] = "{}"
for _k in (
    "META_APP_ID",
    "META_APP_SECRET",
    "META_LOGIN_CONFIG_ID",
    "META_OAUTH_REDIRECT_URI",
    "CREDENTIAL_VAULT_KEY",
):
    os.environ[_k] = ""

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.api.deps import ApiContext, get_context  # noqa: E402
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import (  # noqa: E402
    AuditLog,
    PersonalAccountReference,
    User,
    Workspace,
    WorkspaceMember,
)
from app.services.audit import AuditLogService  # noqa: E402
from app.services.proxy_health_transport import _parse_geo_json, evaluate_proxy_timezone_match  # noqa: E402


@pytest.fixture()
def v260_env():
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

    with TestingSession() as seed:
        ws = Workspace(name="MultiEngineWS", slug=f"me-{uuid.uuid4().hex[:6]}")
        owner_u = User(
            email="owner@adsops.local",
            full_name="Lead Owner",
            password_hash=hash_password("StrongPass!2026"),
            is_active=True,
        )
        buyer_a_u = User(
            email="buyer.a@adsops.local",
            full_name="Media Buyer A",
            password_hash=hash_password("StrongPass!2026"),
            is_active=True,
        )
        buyer_b_u = User(
            email="buyer.b@adsops.local",
            full_name="Media Buyer B",
            password_hash=hash_password("StrongPass!2026"),
            is_active=True,
        )
        seed.add_all([ws, owner_u, buyer_a_u, buyer_b_u])
        seed.flush()
        owner_m = WorkspaceMember(workspace_id=ws.id, user_id=owner_u.id, role=WorkspaceRole.OWNER)
        buyer_a_m = WorkspaceMember(workspace_id=ws.id, user_id=buyer_a_u.id, role=WorkspaceRole.BUYER)
        buyer_b_m = WorkspaceMember(workspace_id=ws.id, user_id=buyer_b_u.id, role=WorkspaceRole.BUYER)
        seed.add_all([owner_m, buyer_a_m, buyer_b_m])
        seed.flush()

        via_owned_by_a = PersonalAccountReference(
            workspace_id=ws.id,
            label="Via Camp A (AdsPower)",
            browser_profile_label="Profile 2",
            network_label="1.2.3.4:8080:u:p",
            timezone="Asia/Ho_Chi_Minh",
            owner_member_id=buyer_a_m.id,
            notes="[ADENG:adspower] [ADID:k9988]",
        )
        seed.add(via_owned_by_a)
        seed.commit()
        ids = {
            "ws": ws.id,
            "owner_u": owner_u.id,
            "owner_m": owner_m.id,
            "buyer_a_u": buyer_a_u.id,
            "buyer_a_m": buyer_a_m.id,
            "buyer_b_u": buyer_b_u.id,
            "buyer_b_m": buyer_b_m.id,
            "via_a": via_owned_by_a.id,
        }

    active_actor = {"u": "owner_u", "m": "owner_m"}

    def _override_get_context():
        ds = TestingSession()
        try:
            u = ds.get(User, ids[active_actor["u"]])
            m = ds.get(WorkspaceMember, ids[active_actor["m"]])
            w = ds.get(Workspace, ids["ws"])
            yield ApiContext(
                session=ds,
                user=u,
                membership=m,
                workspace=w,
                audit=AuditLogService(ds, ids["ws"], u.id),
            )
        finally:
            ds.close()

    app = create_app()
    app.dependency_overrides[get_context] = _override_get_context
    with TestClient(app) as client:
        yield client, ids, active_actor
    app.dependency_overrides.clear()
    eng.dispose()


def test_proxy_timezone_extraction_and_mismatch_detection():
    ipwho_geo = _parse_geo_json(
        {
            "ip": "14.232.10.22",
            "country_code": "VN",
            "country": "Vietnam",
            "city": "Ho Chi Minh City",
            "connection": {"isp": "VNPT"},
            "timezone": {"id": "Asia/Ho_Chi_Minh", "utc": "+07:00"},
        }
    )
    assert ipwho_geo["timezone"] == "Asia/Ho_Chi_Minh"
    assert ipwho_geo["utc_offset"] == "+07:00"

    ok_saigon, warn_none = evaluate_proxy_timezone_match("Asia/Saigon", "VN", "Asia/Ho_Chi_Minh")
    assert ok_saigon is True
    assert warn_none is None

    ok_mismatch, warn_msg = evaluate_proxy_timezone_match("America/New_York", "US", "Asia/Ho_Chi_Minh")
    assert ok_mismatch is False
    assert "America/New_York" in (warn_msg or "")
    assert "Asia/Ho_Chi_Minh" in (warn_msg or "")


def test_team_playbooks_marketplace_versioning_ratings_and_launch_rbac(v260_env):
    client, ids, active_actor = v260_env

    # 1. Seeded built-in playbooks across Meta / Google Ads / TikTok / Multi (0 fake ratings/runs)
    r_list = client.get("/api/v1/playbooks")
    assert r_list.status_code == 200, r_list.text
    items = r_list.json()
    platforms = {i["platform"] for i in items}
    assert {"meta", "google_ads", "tiktok", "multi"}.issubset(platforms)
    assert all(i["rating_count"] == 0 and i["avg_rating"] is None and i["run_count"] == 0 for i in items)

    # 2. Buyer A creates custom playbook, bumps version, and both Owner + Buyer A rate it cleanly
    active_actor["u"], active_actor["m"] = "buyer_a_u", "buyer_a_m"
    r_create = client.post(
        "/api/v1/playbooks",
        json={
            "title": "Team VN Spa Warmup Chống 956",
            "platform": "meta",
            "category": "warmup",
            "description": "Kịch bản đảo ấm chuyên ngành Spa có nghỉ lệch pha.",
            "version_tag": "1.0.0",
            "default_stagger_sec": 62,
            "jitter_pct": 40,
            "steps": [{"action": "open_url", "target": "https://www.facebook.com/", "wait_sec": 12}],
        },
    )
    assert r_create.status_code == 201, r_create.text
    pb_id = r_create.json()["id"]
    assert r_create.json()["author_name"] == "Media Buyer A"

    r_patch = client.patch(
        f"/api/v1/playbooks/{pb_id}",
        json={"version_tag": "1.1.0", "changelog": "Tăng thời gian xem Watch lên 15s"},
    )
    assert r_patch.status_code == 200
    assert r_patch.json()["version_tag"] == "1.1.0"

    r_rate_a = client.post(f"/api/v1/playbooks/{pb_id}/rate", json={"stars": 4, "comment": "Ổn"})
    assert r_rate_a.status_code == 200
    assert r_rate_a.json()["rating_count"] == 1
    assert r_rate_a.json()["avg_rating"] == 4.0

    active_actor["u"], active_actor["m"] = "owner_u", "owner_m"
    r_rate_o = client.post(f"/api/v1/playbooks/{pb_id}/rate", json={"stars": 5, "comment": "Chuẩn"})
    assert r_rate_o.status_code == 200
    assert r_rate_o.json()["rating_count"] == 2
    assert r_rate_o.json()["avg_rating"] == 4.5

    r_run = client.post(
        f"/api/v1/playbooks/{pb_id}/record-run",
        json={"via_ids": [str(ids["via_a"])], "engine": "adspower", "stagger_sec": 62, "jitter_pct": 40, "workstation": "WIN-OPS-01"},
    )
    assert r_run.status_code == 200
    assert r_run.json()["run_count"] == 1

    # 3. Team Assignee RBAC: Buyer B CANNOT launch Via owned by Buyer A (403); Buyer A & Owner CAN (200)
    active_actor["u"], active_actor["m"] = "buyer_b_u", "buyer_b_m"
    r_forbid = client.post(
        "/api/v1/facebook-pages/browser-event",
        json={
            "event_type": "PROFILE_LAUNCHED",
            "via_id": str(ids["via_a"]),
            "via_label": "Via Camp A (AdsPower)",
            "antidetect_engine": "adspower",
            "antidetect_profile_id": "k9988",
            "workstation": "WIN-BUYER-B",
        },
    )
    assert r_forbid.status_code == 403, r_forbid.text

    active_actor["u"], active_actor["m"] = "buyer_a_u", "buyer_a_m"
    r_allow = client.post(
        "/api/v1/facebook-pages/browser-event",
        json={
            "event_type": "PROFILE_LAUNCHED",
            "via_id": str(ids["via_a"]),
            "via_label": "Via Camp A (AdsPower)",
            "antidetect_engine": "adspower",
            "antidetect_profile_id": "k9988",
            "browser_profile": "AdsPower #k9988",
            "workstation": "WIN-BUYER-A",
            "startup_ms": 3420,
        },
    )
    assert r_allow.status_code == 200, r_allow.text

    # 4. Launch Audit records exact actor email/name, engine, workstation, startup_ms
    r_audit = client.get("/api/v1/playbooks/launch-audit")
    assert r_audit.status_code == 200, r_audit.text
    rows = r_audit.json()
    launched = next(r for r in rows if r["action"] == "via.profile_launched")
    assert launched["actor_email"] == "buyer.a@adsops.local"
    assert launched["antidetect_engine"] == "adspower"
    assert launched["antidetect_profile_id"] == "k9988"
    assert launched["workstation"] == "WIN-BUYER-A"
    assert launched["startup_ms"] == 3420
