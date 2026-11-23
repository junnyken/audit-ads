"""v5.3 Core IP Protection, Server-Side Watermarked Extension Packager & Anti-Scraping Tests.

Runs standalone with `--noconftest` (SQLite in-memory + StaticPool).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

os.environ.setdefault("JWT_SECRET", "test-v53-secret-not-for-production-use")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("NOTIFICATION_TRANSPORT", "fake")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ["META_ACCESS_TOKEN"] = ""
os.environ["META_ACCESS_TOKENS_BY_BUSINESS"] = "{}"
for _o4 in (
    "META_APP_ID",
    "META_APP_SECRET",
    "META_LOGIN_CONFIG_ID",
    "META_OAUTH_REDIRECT_URI",
    "CREDENTIAL_VAULT_KEY",
):
    os.environ[_o4] = ""

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.api.v1.routers import extension as extension_router  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import AuditLog, User, Workspace, WorkspaceMember  # noqa: E402
from app.services import ip_shield  # noqa: E402


def _mint_challenge(code: str = "K7M9P", math_ans: str = "15") -> tuple[str, str, str]:
    settings = get_settings()
    issued_at = int(time.time()) - 5
    nonce = uuid.uuid4().hex[:24]
    payload_obj = {
        "n": nonce,
        "iat": issued_at,
        "exp": issued_at + 300,
        "c_hash": hashlib.sha256(f"{code.upper()}:{math_ans}:{nonce}".encode()).hexdigest(),
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload_obj, separators=(",", ":")).encode()
    ).decode("ascii").rstrip("=")
    sig = hmac.new(settings.jwt_secret.encode(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}", code.upper(), math_ans


@contextmanager
def _temp_env(**overrides: str | None) -> Iterator[None]:
    prev = {k: os.environ.get(k) for k in overrides}
    for k, v in overrides.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    get_settings.cache_clear()
    try:
        yield
    finally:
        for k, old in prev.items():
            if old is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = old
        get_settings.cache_clear()


@pytest.fixture()
def ip_env():
    ip_shield._VELOCITY_BUCKETS.clear()
    ip_shield._CONSUMED_TICKETS.clear()
    vault_key = Fernet.generate_key().decode()
    with _temp_env(
        JWT_SECRET="test-v53-secret-not-for-production-use",
        CREDENTIAL_VAULT_KEY=vault_key,
        COMMUNITY_REQUIRE_INVITE_CODE=None,
        RATE_LIMIT_ENABLED="false",
        BOOTSTRAP_OWNER_EMAIL="superadmin@gmail.com",
        ANTI_HARVEST_BURST_LIMIT="12",
        ANTI_HARVEST_BURST_WINDOW_SECONDS="30",
        FREE_DAILY_EXTENSION_BUNDLES="3",
        FREE_DAILY_DESKTOP_DOWNLOADS="3",
        FREE_DAILY_POLICY_SCANS="30",
    ):
        eng = sa.create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(eng)
        TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

        with TestingSession() as seed:
            ws_agency = Workspace(
                name="Alpha Enterprise",
                slug=f"alpha-{uuid.uuid4().hex[:6]}",
                plan_tier="agency",
                max_vias=500,
                max_ad_accounts=500,
                max_members=25,
                max_desktop_devices=10,
            )
            ws_free = Workspace(
                name="Free Community Lab",
                slug=f"free-{uuid.uuid4().hex[:6]}",
                plan_tier="community_free",
                max_vias=10,
                max_ad_accounts=10,
                max_members=3,
                max_desktop_devices=1,
            )
            admin_user = User(
                email="superadmin@gmail.com",
                full_name="Platform Super Admin",
                password_hash=hash_password("SuperAdmin99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=True,
            )
            buyer_user = User(
                email="buyer@gmail.com",
                full_name="Agency Operator",
                password_hash=hash_password("Operator99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=False,
            )
            free_owner = User(
                email="free-owner@gmail.com",
                full_name="Community Free Owner",
                password_hash=hash_password("FreeOwner99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=False,
            )
            seed.add_all([ws_agency, ws_free, admin_user, buyer_user, free_owner])
            seed.flush()
            seed.add_all(
                [
                    WorkspaceMember(workspace_id=ws_agency.id, user_id=admin_user.id, role=WorkspaceRole.OWNER),
                    WorkspaceMember(workspace_id=ws_agency.id, user_id=buyer_user.id, role=WorkspaceRole.BUYER),
                    WorkspaceMember(workspace_id=ws_free.id, user_id=free_owner.id, role=WorkspaceRole.OWNER),
                ]
            )
            seed.commit()

        app = create_app()

        def _override_db() -> Iterator[Session]:
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override_db
        with TestClient(app) as client:
            yield {
                "client": client,
                "session_maker": TestingSession,
                "ws_agency": ws_agency,
                "ws_free": ws_free,
                "admin": admin_user,
                "buyer": buyer_user,
                "free_owner": free_owner,
            }
        ip_shield._VELOCITY_BUCKETS.clear()
        ip_shield._CONSUMED_TICKETS.clear()


def _login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_invite_only_default_blocks_uninvited_registration(ip_env) -> None:
    assert Settings(_env_file=None).community_require_invite_code is True
    assert get_settings().community_require_invite_code is True

    client: TestClient = ip_env["client"]
    chal, cap, math_ans = _mint_challenge()
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Curious Visitor",
            "workspace_name": "Uninvited Co",
            "email": "visitor99@gmail.com",
            "password": "StrongPass99!",
            "challenge_token": chal,
            "captcha_code": cap,
            "math_answer": math_ans,
            "human_confirmed": True,
            "website_honeypot": "",
        },
    )
    assert resp.status_code == 409, resp.text


def test_package_bundle_watermarks_canary_and_forbids_secret_smuggling(ip_env) -> None:
    client: TestClient = ip_env["client"]
    unauth = client.post("/api/v1/extension/package-bundle", json={"via_name": "Test Via"})
    assert unauth.status_code == 401

    headers = _login_headers(client, "buyer@gmail.com", "Operator99!")

    smuggle_root = client.post(
        "/api/v1/extension/package-bundle",
        headers=headers,
        json={"via_name": "Test Via", "raw_proxy": "1.2.3.4:8080:u:p"},
    )
    assert smuggle_root.status_code == 422

    smuggle_2fa = client.post(
        "/api/v1/extension/package-bundle",
        headers=headers,
        json={"via_name": "Test Via", "two_fa_secret": "JBSWY3DPEHPK3PXP"},
    )
    assert smuggle_2fa.status_code == 422

    ok = client.post(
        "/api/v1/extension/package-bundle",
        headers=headers,
        json={
            "folder_root": "AdsOps-Test",
            "via_name": "Camp Via #7",
            "profile_dir": "Profile 7",
            "via_tier": "camp",
            "via_id": "via-7",
        },
    )
    assert ok.status_code == 200, ok.text
    data = ok.json()
    cid = data["canary_id"]
    assert cid.startswith("CNRY-")

    by_name = {f["name"]: f["content"] for f in data["files"]}
    manifest = json.loads(by_name["AdsOps-Test/manifest.json"])
    integrity = json.loads(by_name["AdsOps-Test/_release_integrity.json"])
    bg_js = by_name["AdsOps-Test/background.js"]

    assert cid in manifest["version_name"]
    assert integrity["canary_id"] == cid
    assert cid in bg_js
    assert '"__ADSOPS_PROXY_RAW_JSON__"' in bg_js
    assert '"__ADSOPS_TOTP_SECRET_JSON__"' in bg_js
    assert '"__ADSOPS_BRIDGE_TOKEN_JSON__"' in bg_js


def test_canary_leak_forensics_admin_vs_buyer_and_tamper_detection(ip_env) -> None:
    client: TestClient = ip_env["client"]
    buyer_headers = _login_headers(client, "buyer@gmail.com", "Operator99!")
    admin_headers = _login_headers(client, "superadmin@gmail.com", "SuperAdmin99!")

    bundle = client.post(
        "/api/v1/extension/package-bundle",
        headers=buyer_headers,
        json={"via_name": "Leaker Via"},
    )
    assert bundle.status_code == 200
    cid = bundle.json()["canary_id"]
    manifest_content = next(f["content"] for f in bundle.json()["files"] if f["name"].endswith("manifest.json"))

    forbidden = client.post(
        "/api/v1/community/admin/verify-canary",
        headers=buyer_headers,
        json={"text": cid},
    )
    assert forbidden.status_code == 403

    verified = client.post(
        "/api/v1/community/admin/verify-canary",
        headers=admin_headers,
        json={"text": manifest_content},
    )
    assert verified.status_code == 200, verified.text
    vdata = verified.json()
    assert vdata["found"] is True
    assert vdata["hmac_verified"] is True
    assert vdata["canary_id"] == cid
    assert vdata["workspace_name"] == "Alpha Enterprise"
    assert vdata["user_email"] == "buyer@gmail.com"

    # Flip 1 hex digit of HMAC signature to simulate forgery
    prefix, ts_hex, mac_hex = cid.split("-")
    bad_char = "0" if mac_hex[0] != "0" else "1"
    forged_cid = f"{prefix}-{ts_hex}-{bad_char}{mac_hex[1:]}"
    forged = client.post(
        "/api/v1/community/admin/verify-canary",
        headers=admin_headers,
        json={"text": forged_cid},
    )
    assert forged.status_code == 200
    assert forged.json()["hmac_verified"] is False


def test_signed_desktop_download_ticket_single_use_and_expiry(ip_env, tmp_path, monkeypatch) -> None:
    client: TestClient = ip_env["client"]
    fake_zip = tmp_path / "AdsOps-Desktop-Pro-latest.zip"
    fake_zip.write_bytes(b"PK\x05\x06" + b"\x00" * 18)

    monkeypatch.setattr(ip_shield, "get_desktop_release_zip_path", lambda: fake_zip)
    monkeypatch.setattr(extension_router, "get_desktop_release_zip_path", lambda: fake_zip)

    # Missing & forged tickets rejected
    assert client.get("/api/v1/extension/desktop-release").status_code == 401
    assert client.get("/api/v1/extension/desktop-release?ticket=invalid.sig").status_code == 401

    headers = _login_headers(client, "buyer@gmail.com", "Operator99!")
    ticket_resp = client.post("/api/v1/extension/desktop-download-ticket", headers=headers, json={})
    assert ticket_resp.status_code == 200, ticket_resp.text
    download_path = ticket_resp.json()["download_path"]

    # First valid download succeeds with no-store & noai headers
    first = client.get(download_path)
    assert first.status_code == 200
    assert first.content.startswith(b"PK\x05\x06")
    assert first.headers.get("cache-control") == "no-store"
    assert first.headers.get("x-robots-tag") == "noindex, nofollow, noai, noimageai"

    # Single-use replay blocked with 401
    replay = client.get(download_path)
    assert replay.status_code == 401

    # Expired ticket blocked with 401
    settings = get_settings()
    expired_payload = base64.urlsafe_b64encode(
        json.dumps(
            {
                "ws": str(ip_env["ws_agency"].id),
                "uid": str(ip_env["buyer"].id),
                "cid": "CNRY-0001-0000000000000000",
                "iat": int(time.time()) - 500,
                "exp": int(time.time()) - 10,
                "n": "expirednonce01",
            },
            separators=(",", ":"),
        ).encode()
    ).decode("ascii").rstrip("=")
    sig = hmac.new(settings.jwt_secret.encode(), expired_payload.encode("ascii"), hashlib.sha256).hexdigest()
    expired_resp = client.get(f"/api/v1/extension/desktop-release?ticket={expired_payload}.{sig}")
    assert expired_resp.status_code == 401


def test_community_free_daily_quota_blocks_fourth_extension_bundle(ip_env) -> None:
    client: TestClient = ip_env["client"]
    headers = _login_headers(client, "free-owner@gmail.com", "FreeOwner99!")

    for i in range(3):
        res = client.post(
            "/api/v1/extension/package-bundle",
            headers=headers,
            json={"via_name": f"Free Via {i + 1}"},
        )
        assert res.status_code == 200, res.text

    blocked = client.post(
        "/api/v1/extension/package-bundle",
        headers=headers,
        json={"via_name": "Free Via 4"},
    )
    assert blocked.status_code == 429, blocked.text
    err = blocked.json()["error"]
    assert err["details"]["reason"] == "daily_ip_quota_exceeded"


def test_anti_harvesting_burst_blocks_rapid_policy_scans_and_audits(ip_env) -> None:
    client: TestClient = ip_env["client"]
    headers = _login_headers(client, "buyer@gmail.com", "Operator99!")

    for i in range(12):
        ok = client.post(
            "/api/v1/ai-studio/policy-check",
            headers=headers,
            json={"text": f"Mẫu nội dung quảng cáo hợp lệ số {i}", "mode": "ad_copy"},
        )
        assert ok.status_code == 200, ok.text

    burst = client.post(
        "/api/v1/ai-studio/policy-check",
        headers=headers,
        json={"text": "Probe rule #13", "mode": "ad_copy"},
    )
    assert burst.status_code == 429, burst.text
    err = burst.json()["error"]
    assert err["details"]["reason"] == "ai_harvesting_rate_limited"

    with ip_env["session_maker"]() as db:
        alert_row = (
            db.execute(sa.select(AuditLog).where(AuditLog.action == "security.ai_harvesting_suspected"))
            .scalars()
            .first()
        )
        assert alert_row is not None


@pytest.mark.parametrize(
    "bot_ua",
    [
        "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
        "ClaudeBot/1.0 (+mailto:claudebot@anthropic.com)",
        "FirecrawlAgent/1.0",
        "Mozilla/5.0 HeadlessChrome/120.0.0.0 Safari/537.36",
    ],
)
def test_anti_scraper_middleware_blocks_ai_bots_and_sets_noai_header(ip_env, bot_ua: str) -> None:
    client: TestClient = ip_env["client"]

    blocked = client.get("/api/v1/auth/bot-challenge", headers={"User-Agent": bot_ua})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "bot_access_denied"

    health = client.get("/health/live", headers={"User-Agent": bot_ua})
    assert health.status_code == 200
    assert "noai" in (health.headers.get("x-robots-tag") or "")
