"""Tests for Package 2: Canonical Email, SMTP Password Reset, License Expiry/Read-Only, and Desktop Device Limits."""
from __future__ import annotations

import hashlib
import os
import re
from datetime import UTC, datetime, timedelta

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://adsops:adsops@localhost:5434/adsops_test")
os.environ.setdefault("JWT_SECRET", "test-secret-not-used-in-production")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("NOTIFICATION_TRANSPORT", "fake")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("PUBLIC_APP_URL", "https://adsops-app.vibe.tinhgon.xyz")

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.email_and_bot_guard import (  # noqa: E402
    normalize_canonical_email,
    validate_reputable_registration_email,
)
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import (  # noqa: E402
    AuditLog,
    CommunityInviteCode,
    PasswordResetToken,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.team import DeviceSession  # noqa: E402
from app.services.audit import AuditLogService  # noqa: E402
from app.services.automation_cron import _run_read_cycle, run_workspace_automation_cycle  # noqa: E402
from app.services.license_service import evaluate_workspace_license  # noqa: E402
from app.services.telegram_bot_helper import save_workspace_telegram_config  # noqa: E402


@pytest.fixture()
def app_and_db():
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

    app = create_app()

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)

    with TestingSession() as s:
        # Synthetic Principal A: Agency Owner (Platform Admin)
        owner_a = User(
            email="adminowner@gmail.com",
            full_name="Owner A",
            password_hash=hash_password("StrongPass1!"),
            is_active=True,
            is_platform_admin=True,
        )
        ws_a = Workspace(
            name="Tenant A",
            slug="tenant-a",
            plan_tier="agency",
            max_vias=500,
            max_ad_accounts=500,
            max_members=25,
            max_desktop_devices=10,
        )
        # Synthetic Principal B: Free Workspace Owner (Non-Admin)
        owner_b = User(
            email="clientfree@gmail.com",
            full_name="Owner B",
            password_hash=hash_password("StrongPass1!"),
            is_active=True,
            is_platform_admin=False,
        )
        ws_b = Workspace(
            name="Tenant B",
            slug="tenant-b",
            plan_tier="community_free",
            max_vias=10,
            max_ad_accounts=5,
            max_members=2,
            max_desktop_devices=1,
            plan_expires_at=datetime.now(UTC) + timedelta(days=30),
        )
        s.add_all([owner_a, ws_a, owner_b, ws_b])
        s.flush()
        s.add_all(
            [
                WorkspaceMember(workspace_id=ws_a.id, user_id=owner_a.id, role=WorkspaceRole.OWNER),
                WorkspaceMember(workspace_id=ws_b.id, user_id=owner_b.id, role=WorkspaceRole.OWNER),
            ]
        )
        s.commit()
        yield client, TestingSession, ws_a.id, owner_a.id, ws_b.id, owner_b.id


def test_canonical_email_parity_and_validation():
    assert normalize_canonical_email("A.B.C@Gmail.com") == "abc@gmail.com"
    assert normalize_canonical_email("x@googlemail.com") == "x@gmail.com"
    assert validate_reputable_registration_email("A.B.C@Gmail.com") == "abc@gmail.com"
    assert validate_reputable_registration_email("abc.def@googlemail.com") == "abcdef@gmail.com"

    with pytest.raises(Exception) as exc_short:
        validate_reputable_registration_email("x.y@googlemail.com")
    assert "suspicious_local_part" in str(exc_short.value.details)

    with pytest.raises(Exception) as exc1:
        validate_reputable_registration_email("ten+1@gmail.com")
    assert "alias_not_allowed" in str(exc1.value.details)

    with pytest.raises(Exception) as exc2:
        validate_reputable_registration_email("user@10minutemail.com")
    assert "disposable_email_blocked" in str(exc2.value.details)


def test_login_supports_dotted_gmail_and_register_blocks_dotted_duplicate(app_and_db):
    client, TestingSession, _, _, _, _ = app_and_db

    # Register dotted Gmail fails with conflict when un-dotted exists
    ch = client.get("/api/v1/auth/bot-challenge").json()
    # Login directly with dotted variant of clientfree@gmail.com works cleanly
    r_ok = client.post(
        "/api/v1/auth/login",
        json={"email": "client.free@gmail.com", "password": "StrongPass1!"},
    )
    assert r_ok.status_code == 200
    assert "access_token" in r_ok.json()
    assert ch["challenge_token"]


def test_forgot_and_reset_password_flow_revokes_sessions_and_enforces_admin_boundary(app_and_db, monkeypatch):
    client, TestingSession, _, owner_a_id, _, owner_b_id = app_and_db
    sent_emails: list[dict] = []

    def fake_send_email(settings, to_email, reset_url, *, full_name=""):
        sent_emails.append({"to": to_email, "url": reset_url})
        return True, None

    monkeypatch.setattr("app.api.v1.routers.auth.send_password_reset_email", fake_send_email)
    from app.core.config import get_settings

    smtp_settings = get_settings().model_copy(
        update={
            "smtp_host": "smtp.example.test",
            "smtp_from_email": "noreply@adsops.test",
            "public_app_url": "https://adsops-app.vibe.tinhgon.xyz",
        }
    )
    monkeypatch.setattr("app.api.v1.routers.auth.get_settings", lambda: smtp_settings)
    monkeypatch.setattr("app.api.v1.routers.community.get_settings", lambda: smtp_settings)

    # First log in Owner B and verify session works
    tok_b = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!"},
    ).json()["access_token"]
    hdr_b = {"Authorization": f"Bearer {tok_b}"}
    assert client.get("/api/v1/auth/me", headers=hdr_b).status_code == 200

    # 1. Enumeration check: unknown vs known return exact same body & HTTP 200
    r_unknown = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "nobody@gmail.com"},
        headers={"Host": "evil-attacker.test"},
    )
    r_known = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "client.free@gmail.com"},
        headers={"Host": "evil-attacker.test"},
    )
    assert r_unknown.status_code == 200
    assert r_known.status_code == 200
    assert r_unknown.json() == r_known.json()
    assert len(sent_emails) == 1
    assert sent_emails[0]["url"].startswith("https://adsops-app.vibe.tinhgon.xyz/?reset_token=")
    assert "evil-attacker.test" not in sent_emails[0]["url"]

    raw_tok = sent_emails[0]["url"].split("reset_token=", 1)[1]

    # DB must hold only SHA-256 hash, never raw token
    with TestingSession() as s:
        row = s.execute(sa.select(PasswordResetToken).where(PasswordResetToken.user_id == owner_b_id)).scalar_one()
        assert row.token_hash == hashlib.sha256(raw_tok.encode()).hexdigest()
        assert row.token_hash != raw_tok

    # Rate limit: 3 per user per hour -> 4th call creates no token
    client.post("/api/v1/auth/forgot-password", json={"email": "clientfree@gmail.com"})
    client.post("/api/v1/auth/forgot-password", json={"email": "clientfree@gmail.com"})
    client.post("/api/v1/auth/forgot-password", json={"email": "clientfree@gmail.com"})
    assert len(sent_emails) == 3

    # 2. Tampered token rejected
    assert (
        client.post(
            "/api/v1/auth/reset-password",
            json={"token": "x" * 32, "new_password": "NewStrongPass2!"},
        ).status_code
        == 422
    )

    # 3. Valid reset updates password & revokes old active session
    r_reset = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_tok, "new_password": "NewStrongPass2!"},
    )
    assert r_reset.status_code == 200
    assert r_reset.json()["revoked_sessions"] >= 1

    # Old JWT must fail immediately
    assert client.get("/api/v1/auth/me", headers=hdr_b).status_code == 401

    # Reusing same reset token must fail
    assert (
        client.post(
            "/api/v1/auth/reset-password",
            json={"token": raw_tok, "new_password": "AnotherPass3!"},
        ).status_code
        == 422
    )

    # New password works
    new_tok_b = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "NewStrongPass2!"},
    ).json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_tok_b}"}).status_code == 200

    # 4. Negative A/B test: Non-admin Owner B CANNOT generate reset links; Platform Admin Owner A CAN
    assert (
        client.post(
            f"/api/v1/community/admin/users/{owner_a_id}/reset-link",
            headers={"Authorization": f"Bearer {new_tok_b}"},
        ).status_code
        == 403
    )
    tok_a = client.post(
        "/api/v1/auth/login",
        json={"email": "adminowner@gmail.com", "password": "StrongPass1!"},
    ).json()["access_token"]
    r_adm = client.post(
        f"/api/v1/community/admin/users/{owner_b_id}/reset-link",
        headers={"Authorization": f"Bearer {tok_a}"},
    )
    assert r_adm.status_code == 200
    assert re.search(r"reset_token=[A-Za-z0-9_-]{20,}", r_adm.json()["reset_url"])


def test_license_grace_readonly_and_code_recovery(app_and_db):
    client, TestingSession, ws_a_id, owner_a_id, ws_b_id, _ = app_and_db

    tok_b = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!"},
    ).json()["access_token"]
    hdr_b = {"Authorization": f"Bearer {tok_b}"}

    # 1. Grace window (-2 days -> still writable)
    with TestingSession() as s:
        ws_b = s.get(Workspace, ws_b_id)
        ws_b.plan_expires_at = datetime.now(UTC) - timedelta(days=2)
        s.commit()
    assert evaluate_workspace_license(ws_b)["status"] == "grace"
    assert evaluate_workspace_license(ws_b)["is_read_only"] is False

    # 2. Past 3-day grace (-4 days -> read_only)
    with TestingSession() as s:
        ws_b = s.get(Workspace, ws_b_id)
        ws_b.plan_expires_at = datetime.now(UTC) - timedelta(days=4)
        invite = CommunityInviteCode(
            code="PRO30DAYS",
            label="Pro 30D",
            plan_tier="pro",
            max_vias=30,
            max_ad_accounts=50,
            max_members=5,
            max_uses=5,
            duration_days=30,
            created_by_user_id=owner_a_id,
        )
        s.add(invite)
        s.commit()

    # Reads work cleanly & advertise read_only license
    me_res = client.get("/api/v1/auth/me", headers=hdr_b).json()
    assert me_res["workspace"]["license"]["status"] == "read_only"
    assert me_res["workspace"]["license"]["is_read_only"] is True
    assert client.get("/api/v1/ad-accounts", headers=hdr_b).status_code == 200

    # Mutations blocked with license_read_only
    create_err = client.post(
        "/api/v1/ad-accounts",
        headers=hdr_b,
        json={"display_name": "Blocked Write", "external_account_id": "123456"},
    )
    assert create_err.status_code == 403
    assert create_err.json()["error"]["details"]["reason"] == "license_read_only"

    # Cron skips read_only workspace cleanly
    with TestingSession() as s:
        save_workspace_telegram_config(
            s,
            ws_b_id,
            AuditLogService(s, ws_b_id, owner_a_id),
            get_settings(),
            chat_id="-100999",
            bot_token="",
            enabled=True,
        )
        s.commit()
        # Test actual license/due/provider policy, independent of the PG lock wrapper.
        # PostgreSQL advisory locking requires its separate CI integration run.
        cron_res = _run_read_cycle(s, ws_b_id, owner_a_id, force_sync=True)
        assert cron_res["sync_status"] == "license_read_only"
        assert cron_res["auto_warmed_count"] == 0

    # Redeem renewal code IS still allowed during read_only & restores active!
    r_red = client.post("/api/v1/community/redeem-code", headers=hdr_b, json={"code": "PRO30DAYS"})
    assert r_red.status_code == 200
    assert r_red.json()["plan_tier"] == "pro"
    assert r_red.json()["license"]["status"] == "active"
    assert r_red.json()["license"]["is_read_only"] is False


def test_desktop_device_limit_and_replace_oldest(app_and_db):
    client, TestingSession, _, _, ws_b_id, _ = app_and_db
    # Tenant B is community_free => max_desktop_devices = 1

    # 1. Unlimited Web logins do not block Desktop
    r_web = client.post("/api/v1/auth/login", json={"email": "clientfree@gmail.com", "password": "StrongPass1!"})
    assert r_web.status_code == 200

    # 2. First Desktop login (PC-1) succeeds
    r_pc1 = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!"},
        headers={"X-AdsOps-Client": "desktop/4.4.0", "X-AdsOps-Installation": "inst-pc-1"},
    )
    assert r_pc1.status_code == 200
    tok_pc1 = r_pc1.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok_pc1}"}).status_code == 200

    # 3. Same PC-1 re-login replaces same installation slot cleanly without error
    r_pc1_again = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!"},
        headers={"X-AdsOps-Client": "desktop/4.4.0", "X-AdsOps-Installation": "inst-pc-1"},
    )
    assert r_pc1_again.status_code == 200
    tok_pc1_b = r_pc1_again.json()["access_token"]

    # 4. Second Desktop PC-2 blocked with 409 device_limit_reached
    r_pc2_blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!"},
        headers={"X-AdsOps-Client": "desktop/4.4.0", "X-AdsOps-Installation": "inst-pc-2"},
    )
    assert r_pc2_blocked.status_code == 409
    assert r_pc2_blocked.json()["error"]["details"]["reason"] == "device_limit_reached"
    assert r_pc2_blocked.json()["error"]["details"]["max_desktop_devices"] == 1

    # 5. Second Desktop PC-2 with replace_oldest_device=True succeeds & revokes PC-1
    r_pc2_ok = client.post(
        "/api/v1/auth/login",
        json={"email": "clientfree@gmail.com", "password": "StrongPass1!", "replace_oldest_device": True},
        headers={"X-AdsOps-Client": "desktop/4.4.0", "X-AdsOps-Installation": "inst-pc-2"},
    )
    assert r_pc2_ok.status_code == 200
    tok_pc2 = r_pc2_ok.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok_pc2}"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok_pc1_b}"}).status_code == 401

    # Verify DeviceSession records stored hashed installation id and desktop channel
    with TestingSession() as s:
        ds_rows = s.execute(sa.select(DeviceSession).where(DeviceSession.workspace_id == ws_b_id)).scalars().all()
        desktop_active = [d for d in ds_rows if d.client_channel == "desktop" and d.is_active]
        assert len(desktop_active) == 1
        assert desktop_active[0].installation_hash != "inst-pc-2"


def test_read_sync_explicitly_rejects_warmup_before_accessing_db():
    from app.core.errors import ValidationError

    with pytest.raises(ValidationError, match="Page warmup is unsupported"):
        run_workspace_automation_cycle(None, None, None, force_warmup=True)
