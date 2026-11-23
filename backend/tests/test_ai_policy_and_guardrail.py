"""Tests for v5.1 Hybrid AI Policy & Content Studio and Audited Owner Via Role Guardrail."""
from __future__ import annotations

import io
import json
import os
import uuid

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
from app.core.config import get_settings  # noqa: E402
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.secret_vault import (  # noqa: E402
    StateInvalidError,
    encrypt_ai_provider_key,
    open_ai_provider_key,
    verify_guardrail_override,
)
from app.core.security import hash_password  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import AuditLog, User, Workspace, WorkspaceMember  # noqa: E402
from app.services import ai_provider_transport  # noqa: E402
from app.services.ai_policy_studio import scan_ad_policy_compliance  # noqa: E402
from app.services.audit import AuditLogService  # noqa: E402


class _FakeHttpResponse(io.BytesIO):
    headers: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@pytest.fixture()
def sqlite_ai_app():
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

    with TestingSession() as seed:
        ws = Workspace(name="AiStudioWS", slug=f"aistudio-{uuid.uuid4().hex[:6]}")
        owner_u = User(
            email="ai-owner@example.com",
            full_name="AI Owner",
            password_hash=hash_password("correct-horse-battery"),
            is_active=True,
        )
        member_u = User(
            email="ai-member@example.com",
            full_name="AI Member",
            password_hash=hash_password("correct-horse-battery"),
            is_active=True,
        )
        seed.add_all([ws, owner_u, member_u])
        seed.flush()
        owner_m = WorkspaceMember(workspace_id=ws.id, user_id=owner_u.id, role=WorkspaceRole.OWNER)
        member_m = WorkspaceMember(workspace_id=ws.id, user_id=member_u.id, role=WorkspaceRole.BUYER)
        seed.add_all([owner_m, member_m])
        seed.commit()
        ws_id = ws.id
        owner_uid, owner_mid = owner_u.id, owner_m.id
        member_uid, member_mid = member_u.id, member_m.id

    def _override_get_db():
        ds = TestingSession()
        try:
            yield ds
        finally:
            ds.close()

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db

    def make_client(as_owner: bool = True) -> TestClient:
        uid = owner_uid if as_owner else member_uid
        mid = owner_mid if as_owner else member_mid

        def _ctx_override():
            ds = TestingSession()
            try:
                yield ApiContext(
                    session=ds,
                    user=ds.get(User, uid),
                    membership=ds.get(WorkspaceMember, mid),
                    workspace=ds.get(Workspace, ws_id),
                    audit=AuditLogService(ds, ws_id, uid),
                )
            finally:
                ds.close()

        app.dependency_overrides[get_context] = _ctx_override
        return TestClient(app)

    yield make_client, TestingSession, ws_id
    app.dependency_overrides.clear()
    eng.dispose()


def test_policy_scanner_detects_all_seven_violation_categories():
    text = (
        "Bạn đang béo bụng? Dùng ngay liệu trình giảm 5kg trong 7 ngày, "
        "cam kết 100% dứt điểm vĩnh viễn không tái phát! "
        "Giải ngân trong 5 phút và hàng rep 1:1 siêu cấp!!! MUANGAY HOMNAY SIEURE CHOTDON. "
        "Xem ngay https://bit.ly/khuyen-mai-2026"
    )
    res = scan_ad_policy_compliance(text, mode="ad_copy")
    cats = {f["category"] for f in res["findings"]}
    assert {
        "medical_exaggeration",
        "personal_attributes",
        "before_after_rapid",
        "financial_claims",
        "restricted_products_trademark",
        "engagement_spam_format",
    } <= cats
    assert res["verdict"] == "high_risk"
    assert res["score"] < 40

    # Category 7: New Fanpage warmup hard-sell check
    warmup_res = scan_ad_policy_compliance(
        "Chào tuần mới! Gọi ngay 0912345678 hoặc https://shop.example.com",
        mode="page_warmup",
        is_new_page=True,
    )
    assert any(f["category"] == "new_page_hard_sell" for f in warmup_res["findings"])

    # Clean deterministic rewrite lifts the score significantly
    clean_res = scan_ad_policy_compliance(res["sanitized_text"], mode="ad_copy")
    assert clean_res["score"] > res["score"]


def test_ai_provider_vault_and_endpoints_never_leak_raw_key(sqlite_ai_app, monkeypatch):
    make_client, TestingSession, ws_id = sqlite_ai_app
    owner_client = make_client(as_owner=True)

    # Vault unit roundtrip
    settings = get_settings()
    fake_key = "AIzaSyFAKE-STUDIO-UNIT-TEST-KEY-9876"
    env = encrypt_ai_provider_key(settings, fake_key)
    assert fake_key not in env
    assert open_ai_provider_key(settings, env) == fake_key

    # Save AI config as owner
    save_r = owner_client.post(
        "/api/v1/ai-studio/config",
        json={
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "enabled": True,
            "provider_key": fake_key,
        },
    )
    assert save_r.status_code == 200
    saved = save_r.json()
    assert saved["enabled"] is True
    assert saved["key_configured"] is True
    assert fake_key not in json.dumps(saved)
    assert saved["key_mask"] == "AIza...9876"

    # Check raw AuditLog metadata never stores plaintext provider_key
    with TestingSession() as db:
        row = (
            db.execute(
                sa.select(AuditLog).where(
                    AuditLog.workspace_id == ws_id,
                    AuditLog.entity_type == "workspace_ai_studio",
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        raw_meta = json.dumps(row.metadata_json or {})
        assert fake_key not in raw_meta
        assert row.metadata_json["ai_envelope"] != ""
        assert open_ai_provider_key(settings, row.metadata_json["ai_envelope"]) == fake_key

    # Mock Gemini HTTP call and test both /ai-studio/test & /ai-studio/generate
    seen_headers = []

    def fake_urlopen(req, timeout=15):
        seen_headers.append((req.full_url, dict(req.header_items())))
        payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": "Giải pháp chăm sóc da dịu nhẹ mỗi ngày giúp làn da khỏe mạnh và rạng rỡ tự nhiên."
                            }
                        ]
                    }
                }
            ]
        }
        return _FakeHttpResponse(json.dumps(payload).encode("utf-8"))

    monkeypatch.setattr(ai_provider_transport.urllib.request, "urlopen", fake_urlopen)

    test_r = owner_client.post("/api/v1/ai-studio/test", json={})
    assert test_r.status_code == 200
    assert test_r.json()["ok"] is True
    assert fake_key not in seen_headers[0][0]  # Key stays in x-goog-api-key header, never URL

    gen_r = owner_client.post(
        "/api/v1/ai-studio/generate",
        json={
            "task": "rewrite_safe",
            "text": "Da bạn đầy mụn? Trị tận gốc cam kết 100%!",
            "mode": "ad_copy",
        },
    )
    assert gen_r.status_code == 200
    gen_data = gen_r.json()
    assert gen_data["engine"] == "workspace_ai"
    assert gen_data["after_score"] >= 85


def test_role_guardrail_override_is_owner_only_and_audited(sqlite_ai_app):
    make_client, TestingSession, ws_id = sqlite_ai_app

    # Member cannot modify AI config or request Owner guardrail override
    member_client = make_client(as_owner=False)
    res_ai = member_client.post("/api/v1/ai-studio/config", json={"provider": "openai", "enabled": True})
    assert res_ai.status_code == 403

    res_ov = member_client.post(
        "/api/v1/via-guardrail/override",
        json={
            "via_id": "via-1",
            "via_label": "Via Hold BM",
            "via_tier": "vault",
            "target_scope": "ads_manager_campaign",
            "reason": "Need urgent billing access",
        },
    )
    assert res_ov.status_code == 403

    # Owner override creates AuditLog and returns valid signed grant
    owner_client = make_client(as_owner=True)
    ok_ov = owner_client.post(
        "/api/v1/via-guardrail/override",
        json={
            "via_id": "via-1",
            "via_label": "Via Hold BM",
            "via_tier": "vault",
            "target_scope": "ads_manager_campaign",
            "reason": "Kiểm tra hóa đơn BM khẩn cấp",
        },
    )
    assert ok_ov.status_code == 200
    ov_data = ok_ov.json()
    assert ov_data["expires_in_seconds"] == 900
    grant = ov_data["override_grant"]

    settings = get_settings()
    claims = verify_guardrail_override(settings, grant)
    assert claims["v"] == "via-1"
    assert claims["t"] == "vault"
    with pytest.raises(StateInvalidError):
        verify_guardrail_override(settings, grant[:-4] + "ZZZZ")

    with TestingSession() as db:
        audit_row = (
            db.execute(
                sa.select(AuditLog).where(
                    AuditLog.workspace_id == ws_id,
                    AuditLog.action == "via_guardrail.owner_override",
                )
            )
            .scalars()
            .first()
        )
        assert audit_row is not None
        assert audit_row.metadata_json["via_tier"] == "vault"
        assert "khẩn cấp" in audit_row.metadata_json["reason"]
