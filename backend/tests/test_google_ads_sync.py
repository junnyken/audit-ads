"""Tests for v4.0.0 Zero-Risk Official Google Ads Script Sync (`2 MCC + 5 Standalone Client Accounts`)."""
from __future__ import annotations

import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

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

from app.api.deps import ApiContext, get_context, get_owner_context  # noqa: E402
from app.core.enums import AlertSeverity, SpendFreshness, WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.alerts import Alert  # noqa: E402
from app.models.entities import (  # noqa: E402
    AdAccount,
    AuditLog,
    BusinessManager,
    User,
    Workspace,
    WorkspaceMember,
)
from app.services import spend_service  # noqa: E402
from app.services.audit import AuditLogService  # noqa: E402
from app.services.notification_transport import reset_fake_transport  # noqa: E402


@pytest.fixture()
def sqlite_gads():
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
        ws = Workspace(name="AgencyGoogleWS", slug=f"gads-{uuid.uuid4().hex[:6]}")
        usr = User(
            email="agency-owner@example.com",
            full_name="Agency Owner",
            password_hash=hash_password("correct-horse-battery"),
            is_active=True,
        )
        seed.add_all([ws, usr])
        seed.flush()
        mem = WorkspaceMember(workspace_id=ws.id, user_id=usr.id, role=WorkspaceRole.OWNER)
        seed.add(mem)
        seed.commit()
        ws_id, usr_id, mem_id = ws.id, usr.id, mem.id

    def _override_get_db():
        ds = TestingSession()
        try:
            yield ds
        finally:
            ds.close()

    def _override_ctx():
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
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_context] = _override_ctx
    app.dependency_overrides[get_owner_context] = _override_ctx
    with TestClient(app) as client, TestingSession() as inspect_session:
        yield client, inspect_session, ws_id
    app.dependency_overrides.clear()
    eng.dispose()


def _extract_ingest_key(script_text: str) -> str:
    m = re.search(r'ADSOPS_INGEST_KEY\s*=\s*"([^"]+)"', script_text)
    assert m, "Missing ADSOPS_INGEST_KEY in generated Google Ads script"
    return m.group(1)


def test_script_config_generates_distinct_mcc_and_standalone_scripts(sqlite_gads):
    client, _, ws_id = sqlite_gads
    resp = client.get("/api/v1/google-ads/script-config")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["workspace_id"] == str(ws_id)
    assert data["key_configured"] is True
    assert "AdsManagerApp.accounts()" in data["mcc_script_code"]
    assert "AdsApp.currentAccount()" in data["single_account_script_code"]
    assert "AdsManagerApp" not in data["single_account_script_code"]

    key1 = _extract_ingest_key(data["mcc_script_code"])
    assert key1.startswith("gads_")
    assert key1 == _extract_ingest_key(data["single_account_script_code"])

    rot = client.post("/api/v1/google-ads/rotate-key")
    assert rot.status_code == 200, rot.text
    key2 = _extract_ingest_key(rot.json()["mcc_script_code"])
    assert key2 != key1


def test_webhook_rejects_invalid_ingest_key(sqlite_gads):
    client, _, ws_id = sqlite_gads
    client.get("/api/v1/google-ads/script-config")
    bad = client.post(
        "/api/v1/google-ads/script-report",
        headers={"X-AdsOps-Ingest-Key": "wrong-key"},
        json={"workspace_id": str(ws_id), "mode": "standalone", "accounts": []},
    )
    assert bad.status_code == 401


def test_2_mcc_and_5_standalone_sync_spend_and_alerts(sqlite_gads):
    client, inspect_session, ws_id = sqlite_gads
    cfg = client.get("/api/v1/google-ads/script-config").json()
    ingest_key = _extract_ingest_key(cfg["mcc_script_code"])

    vn_today = datetime.now(UTC).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    vn_yesterday = vn_today - timedelta(days=1)

    # 1) Push 2 MCCs
    for idx, (mcc_id, acc_cid, daily_y, daily_t) in enumerate(
        [
            ("900-111-0001", "101-202-3001", "1500000", "450000"),
            ("900-111-0002", "101-202-3002", "2200000", "800000"),
        ],
        start=1,
    ):
        r = client.post(
            "/api/v1/google-ads/script-report",
            headers={"X-AdsOps-Ingest-Key": ingest_key},
            json={
                "workspace_id": str(ws_id),
                "mode": "mcc",
                "mcc_id": mcc_id,
                "mcc_name": f"Agency MCC #{idx}",
                "accounts": [
                    {
                        "customer_id": acc_cid,
                        "name": f"MCC Client Acc {idx}",
                        "currency": "VND",
                        "timezone": "Asia/Ho_Chi_Minh",
                        "status": "ENABLED",
                        "daily_budget_raw": "3000000",
                        "total_spend_raw": "25000000",
                        "daily": [
                            {"date": vn_yesterday.isoformat(), "spend_raw": daily_y},
                            {"date": vn_today.isoformat(), "spend_raw": daily_t},
                        ],
                    }
                ],
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["synced_count"] == 1

    # 2) Push 5 independent client Gmails (mode="standalone"), with client #5 SUSPENDED
    standalone_payload = {
        "workspace_id": str(ws_id),
        "mode": "standalone",
        "accounts": [
            {
                "customer_id": f"555-000-000{i}",
                "name": f"Khách Lẻ Độc Lập #{i}",
                "currency": "VND",
                "timezone": "Asia/Ho_Chi_Minh",
                "status": "SUSPENDED" if i == 5 else "ENABLED",
                "daily_budget_raw": "1000000",
                "total_spend_raw": str(i * 5000000),
                "disapproved_ads_count": 2 if i == 4 else 0,
                "billing_issue": i == 5,
                "daily": [
                    {"date": vn_yesterday.isoformat(), "spend_raw": str(i * 400000)},
                    {"date": vn_today.isoformat(), "spend_raw": str(i * 100000)},
                ],
            }
            for i in range(1, 6)
        ],
    }
    r_st = client.post(
        "/api/v1/google-ads/script-report",
        headers={"X-AdsOps-Ingest-Key": ingest_key},
        json=standalone_payload,
    )
    assert r_st.status_code == 200, r_st.text
    st_body = r_st.json()
    assert st_body["synced_count"] == 5
    # Account #4 (2 disapproved ads -> warning) and #5 (SUSPENDED + billing_issue -> critical)
    assert st_body["alerts_triggered"] == 2

    inspect_session.expire_all()
    accounts = list(
        inspect_session.execute(
            sa.select(AdAccount).where(AdAccount.workspace_id == ws_id)
        ).scalars().all()
    )
    assert len(accounts) == 7  # 2 MCC sub-accounts + 5 isolated standalone client accounts

    bms = list(
        inspect_session.execute(
            sa.select(BusinessManager).where(BusinessManager.workspace_id == ws_id)
        ).scalars().all()
    )
    assert len(bms) == 3  # 2 MCCs + gads_standalone_pool

    # Verify spend_service treats Google Ads script observations as observable=True & CURRENT
    acc_1 = next(a for a in accounts if a.external_account_id == "gads_5550000001")
    facts = spend_service.build_spend_facts(inspect_session, ws_id, acc_1)
    assert facts.observable is True
    assert facts.freshness == SpendFreshness.CURRENT
    assert facts.reader_source == "google_ads_script"
    assert facts.today_partial is not None and facts.today_partial.spend_raw == "100000"
    latest_day = facts.day(facts.latest_complete_day)
    assert latest_day is not None and latest_day.spend_raw == "400000"

    # Verify Alert created for suspended account #5
    acc_5 = next(a for a in accounts if a.external_account_id == "gads_5550000005")
    alert_5 = inspect_session.execute(
        sa.select(Alert).where(Alert.workspace_id == ws_id, Alert.ad_account_id == acc_5.id)
    ).scalar_one()
    assert alert_5.severity == AlertSeverity.CRITICAL
    assert "SUSPENDED" in alert_5.title

    # Verify /api/v1/spend/summary aggregates all 7 VND accounts
    sum_resp = client.get("/api/v1/spend/summary")
    assert sum_resp.status_code == 200, sum_resp.text
    sum_json = sum_resp.json()
    assert sum_json["freshness_counts"]["current"] == 7
    assert sum_json["currencies"][0]["currency"] == "VND"
    assert sum_json["currencies"][0]["accounts_included"] == 7
