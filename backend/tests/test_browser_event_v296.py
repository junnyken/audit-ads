"""Tests for Chrome Extension v2.9.6 & Desktop v2.4.0 `/api/v1/facebook-pages/browser-event` stewardship events."""
from __future__ import annotations

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
from app.services.notification_transport import reset_fake_transport  # noqa: E402


@pytest.fixture()
def sqlite_ctx():
    reset_fake_transport()
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

    with TestingSession() as seed:
        ws = Workspace(name="StewardshipWS", slug=f"stewardship-{uuid.uuid4().hex[:6]}")
        usr = User(
            email="steward@example.com",
            full_name="Steward",
            password_hash=hash_password("correct-horse-battery"),
            is_active=True,
        )
        seed.add_all([ws, usr])
        seed.flush()
        mem = WorkspaceMember(workspace_id=ws.id, user_id=usr.id, role=WorkspaceRole.OWNER)
        seed.add(mem)
        seed.commit()
        ws_id, usr_id, mem_id = ws.id, usr.id, mem.id

    def _override_get_context():
        ds = TestingSession()
        try:
            yield ApiContext(
                session=ds,
                user=ds.get(User, usr_id),
                membership=ds.get(WorkspaceMember, mem_id),
                workspace=ds.get(Workspace, ws_id),
                audit=AuditLogService(ds, ws_id, usr_id),
            )
        finally:
            ds.close()

    app = create_app()
    app.dependency_overrides[get_context] = _override_get_context
    with TestClient(app) as client, TestingSession() as inspect_session:
        yield client, inspect_session
    app.dependency_overrides.clear()
    eng.dispose()


def test_browser_event_ip_leak_blocked_records_alert_and_returns_summary(sqlite_ctx):
    client, inspect_session = sqlite_ctx
    response = client.post(
        "/api/v1/facebook-pages/browser-event",
        json={
            "event_type": "IP_LEAK_BLOCKED",
            "via_id": "via-silo-01",
            "via_label": "Via Khach Hang A",
            "browser_profile": "Profile 9",
            "detail": "",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["event_type"] == "IP_LEAK_BLOCKED"

    rows = (
        inspect_session.execute(
            sa.select(AuditLog).where(AuditLog.action == "page.via_alert")
        )
        .scalars()
        .all()
    )
    assert len(rows) >= 1
    meta = rows[-1].metadata_json or {}
    assert meta.get("alert_type") == "IP_LEAK_BLOCKED"
    assert meta.get("via_label") == "Via Khach Hang A"
    assert meta.get("browser_profile") == "Profile 9"
    assert "Kill-Switch" in str(meta.get("detail") or "")


def test_browser_event_keepalive_ok_persists_v29_keepalive_audit(sqlite_ctx):
    client, inspect_session = sqlite_ctx
    response = client.post(
        "/api/v1/facebook-pages/browser-event",
        json={
            "event_type": "KEEPALIVE_OK",
            "via_id": "via-ka-02",
            "via_label": "Via Nuoi 72h",
            "browser_profile": "Profile 3",
            "via_tier": "camp",
            "route_summary": "feed -> watch -> groups",
            "duration_sec": 38,
            "detail": "Soak 72h passive warm-up",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["event_type"] == "KEEPALIVE_OK"

    rows = (
        inspect_session.execute(
            sa.select(AuditLog).where(AuditLog.action == "page.via_keepalive")
        )
        .scalars()
        .all()
    )
    assert len(rows) >= 1
    meta = rows[-1].metadata_json or {}
    assert meta.get("mode") == "DESKTOP_EXTENSION_KEEPALIVE_V29"
    assert meta.get("via_label") == "Via Nuoi 72h"
    assert meta.get("route_summary") == "feed -> watch -> groups"
    assert meta.get("duration_sec") == 38


def test_browser_event_rejects_unknown_event_type(sqlite_ctx):
    client, _ = sqlite_ctx
    response = client.post(
        "/api/v1/facebook-pages/browser-event",
        json={
            "event_type": "INVALID_EVENT",
            "via_label": "Via Test",
        },
    )
    assert response.status_code == 422, response.text


def test_residential_proxy_cluster_allows_4_vias_and_warns_at_5(sqlite_ctx):
    client, inspect_session = sqlite_ctx
    ws = inspect_session.execute(sa.select(Workspace)).scalars().first()
    assert ws is not None

    shared_proxy = "103.10.20.30:8080:u:p"
    for idx in range(1, 5):
        inspect_session.add(
            PersonalAccountReference(
                workspace_id=ws.id,
                external_reference_id=f"100099900000{idx}",
                label=f"Via Dan Cu {idx}",
                browser_profile_label=f"Profile {idx}",
                network_label=shared_proxy,
            )
        )
    inspect_session.commit()

    res4 = client.get("/api/v1/facebook-pages/summary")
    assert res4.status_code == 200, res4.text
    qa4 = res4.json()["quota_alerts_summary"]
    assert qa4["overloaded_proxy_clusters"] == []

    inspect_session.add(
        PersonalAccountReference(
            workspace_id=ws.id,
            external_reference_id="1000999000005",
            label="Via Dan Cu 5",
            browser_profile_label="Profile 5",
            network_label=shared_proxy,
        )
    )
    inspect_session.commit()

    res5 = client.get("/api/v1/facebook-pages/summary")
    assert res5.status_code == 200, res5.text
    qa5 = res5.json()["quota_alerts_summary"]
    clusters = qa5["overloaded_proxy_clusters"]
    assert len(clusters) == 1
    assert clusters[0]["via_count"] == 5
