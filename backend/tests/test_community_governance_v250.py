"""Tests for v2.5.0 Community Multi-Tenant Governance, Invite Codes, Quotas & Super-Admin Portal."""
from __future__ import annotations

import os

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

from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import AuditLog  # noqa: E402


@pytest.fixture()
def community_client():
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

    def _override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    from datetime import UTC, datetime
    from sqlalchemy.orm.attributes import set_committed_value
    from app.models.entities import CommunityInviteCode, User, Workspace
    from app.models.team import DeviceSession

    def _normalize_naive_dt(target, *_args):
        for attr in ("expires_at", "last_seen_at", "revoked_at", "created_at", "updated_at", "locked_until"):
            val = getattr(target, attr, None)
            if isinstance(val, datetime) and val.tzinfo is None:
                set_committed_value(target, attr, val.replace(tzinfo=UTC))

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    models_with_dt = (DeviceSession, CommunityInviteCode, User, Workspace)
    for cls in models_with_dt:
        sa.event.listen(cls, "load", _normalize_naive_dt)
        sa.event.listen(cls, "refresh", _normalize_naive_dt)
    try:
        with TestClient(app) as client, TestingSession() as inspect_db:
            yield client, inspect_db
    finally:
        for cls in models_with_dt:
            sa.event.remove(cls, "load", _normalize_naive_dt)
            sa.event.remove(cls, "refresh", _normalize_naive_dt)
        app.dependency_overrides.clear()
        eng.dispose()


def _solve_challenge(client: TestClient) -> tuple[str, str, str]:
    import base64
    import hashlib
    import hmac
    import json
    import time
    import uuid
    from app.core.config import get_settings

    nonce = uuid.uuid4().hex
    now = int(time.time())
    cap = "ADSO9"
    math_ans = "12"
    c_hash = hashlib.sha256(f"{cap}:{math_ans}:{nonce}".encode("utf-8")).hexdigest()
    payload = {"n": nonce, "iat": now - 5, "exp": now + 300, "c_hash": c_hash}
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii").rstrip("=")
    sig = hmac.new(get_settings().jwt_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}", cap, math_ans


def test_community_register_invite_codes_quotas_and_super_admin(community_client):
    client, _ = community_client

    # 1. First user becomes Super-Admin + Agency tier (500 Vias / 500 AdAccounts)
    tok, cap, math_ans = _solve_challenge(client)
    r1 = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Platform Owner",
            "workspace_name": "Root Agency",
            "email": "platform.owner@gmail.com",
            "password": "StrongPassword!2026",
            "challenge_token": tok,
            "captcha_code": cap,
            "math_answer": math_ans,
            "human_confirmed": True,
        },
    )
    assert r1.status_code == 201, r1.text
    admin_headers = {"Authorization": f"Bearer {r1.json()['access_token']}"}

    me1 = client.get("/api/v1/auth/me", headers=admin_headers)
    assert me1.status_code == 200
    assert me1.json()["is_platform_admin"] is True
    assert me1.json()["workspace"]["plan_tier"] == "agency"

    # 2. Second user registers without invite code -> community_free (max 10 vias, 5 ad accounts, 2 members)
    tok2, cap2, math2 = _solve_challenge(client)
    r2 = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Community Member",
            "workspace_name": "Mini Shop Ads",
            "email": "community.member@gmail.com",
            "password": "StrongPassword!2026",
            "challenge_token": tok2,
            "captcha_code": cap2,
            "math_answer": math2,
            "human_confirmed": True,
        },
    )
    assert r2.status_code == 201, r2.text
    member_headers = {"Authorization": f"Bearer {r2.json()['access_token']}"}

    q2 = client.get("/api/v1/community/my-quota", headers=member_headers)
    assert q2.status_code == 200
    assert q2.json()["plan_tier"] == "community_free"
    assert q2.json()["max_vias"] == 10
    assert q2.json()["is_platform_admin"] is False

    # Non-admin must be blocked from /community/admin/overview
    forb = client.get("/api/v1/community/admin/overview", headers=member_headers)
    assert forb.status_code == 403

    # 3. Super-Admin lowers Member workspace quota to 1 Via -> creating 2nd Via must be rejected (409)
    ov = client.get("/api/v1/community/admin/overview", headers=admin_headers)
    assert ov.status_code == 200
    target_ws_id = next(w["id"] for w in ov.json()["workspaces"] if w["name"] == "Mini Shop Ads")

    patch_ws = client.patch(
        f"/api/v1/community/admin/workspaces/{target_ws_id}",
        headers=admin_headers,
        json={"max_vias": 1},
    )
    assert patch_ws.status_code == 200
    assert patch_ws.json()["max_vias"] == 1

    v1 = client.post(
        "/api/v1/personal-account-references",
        headers=member_headers,
        json={"label": "Via 01", "status": "active"},
    )
    assert v1.status_code == 201, v1.text

    v2 = client.post(
        "/api/v1/personal-account-references",
        headers=member_headers,
        json={"label": "Via 02 Over Quota", "status": "active"},
    )
    assert v2.status_code == 409, v2.text

    # 4. Super-Admin generates Pro invite code & Member redeems it -> limit rises to 50 Vias -> Via 02 succeeds
    code_resp = client.post(
        "/api/v1/community/admin/invite-codes",
        headers=admin_headers,
        json={"code": "ADSOPS-PRO-VIP", "label": "Cong Dong Pro", "plan_tier": "pro", "max_vias": 50, "max_uses": 5},
    )
    assert code_resp.status_code == 201, code_resp.text

    redeem = client.post(
        "/api/v1/community/redeem-code",
        headers=member_headers,
        json={"code": "adsops-pro-vip"},
    )
    assert redeem.status_code == 200, redeem.text
    assert redeem.json()["plan_tier"] == "pro"
    assert redeem.json()["max_vias"] == 50

    v2_retry = client.post(
        "/api/v1/personal-account-references",
        headers=member_headers,
        json={"label": "Via 02 Unlocked", "status": "active"},
    )
    assert v2_retry.status_code == 201, v2_retry.text

    # 5. Super-Admin toggles Invite-Only registration policy -> registration without invite code is blocked (409)
    pol = client.put(
        "/api/v1/community/admin/policy",
        headers=admin_headers,
        json={"require_invite_code": True},
    )
    assert pol.status_code == 200
    assert pol.json()["require_invite_code"] is True

    tok3, cap3, math3 = _solve_challenge(client)
    r3_blocked = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Blocked User",
            "workspace_name": "Blocked WS",
            "email": "blocked.user@gmail.com",
            "password": "StrongPassword!2026",
            "challenge_token": tok3,
            "captcha_code": cap3,
            "math_answer": math3,
            "human_confirmed": True,
        },
    )
    assert r3_blocked.status_code == 409, r3_blocked.text

    # Registering WITH valid invite code succeeds and joins with Pro limits!
    tok4, cap4, math4 = _solve_challenge(client)
    r4_ok = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Invited Pro",
            "workspace_name": "Invited Pro Agency",
            "email": "invited.pro@gmail.com",
            "password": "StrongPassword!2026",
            "challenge_token": tok4,
            "captcha_code": cap4,
            "math_answer": math4,
            "human_confirmed": True,
            "invite_code": "ADSOPS-PRO-VIP",
        },
    )
    assert r4_ok.status_code == 201, r4_ok.text
    inv_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {r4_ok.json()['access_token']}"})
    assert inv_me.status_code == 200
    assert inv_me.json()["workspace"]["plan_tier"] == "pro"
    assert inv_me.json()["workspace"]["max_vias"] == 50

    # 6. Suspending Member workspace locks out all API calls immediately (403)
    susp = client.patch(
        f"/api/v1/community/admin/workspaces/{target_ws_id}",
        headers=admin_headers,
        json={"community_status": "suspended"},
    )
    assert susp.status_code == 200
    locked_call = client.get("/api/v1/auth/me", headers=member_headers)
    assert locked_call.status_code == 403
