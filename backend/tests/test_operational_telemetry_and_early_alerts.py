"""Tests for v4.2.0 Operational Telemetry, Proxy Cluster Health, Early 80% Threshold & Spend Spike Alerts."""
from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta

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
from app.core.enums import (  # noqa: E402
    AccountStatus,
    AccountType,
    AlertStatus,
    MetaEnvironment,
    ReferenceStatus,
    SpendObservationStatus,
    SpendObservationTrigger,
    WorkspaceRole,
)
from app.core.security import hash_password  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.alerts import Alert  # noqa: E402
from app.models.entities import (  # noqa: E402
    AdAccount,
    AuditLog,
    PersonalAccountReference,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.meta_operations import MetaConnection  # noqa: E402
from app.models.spend import AdAccountSpendObservation  # noqa: E402
from app.services.audit import AuditLogService  # noqa: E402
from app.services.early_risk_detector import (  # noqa: E402
    EARLY_RISK_SOURCE_ENTITY_TYPE,
    evaluate_and_reconcile_early_risks,
)
from app.services.notification_transport import reset_fake_transport  # noqa: E402
from app.services.telegram_bot_helper import dispatch_operational_telegram_alerts  # noqa: E402


@pytest.fixture()
def sqlite_ops():
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
        ws = Workspace(name="OpsTelemetryWS", slug=f"ops-{uuid.uuid4().hex[:6]}")
        usr = User(
            email="ops-owner@example.com",
            full_name="Ops Owner",
            password_hash=hash_password("correct-horse-battery"),
            is_active=True,
        )
        seed.add_all([ws, usr])
        seed.flush()
        mem = WorkspaceMember(workspace_id=ws.id, user_id=usr.id, role=WorkspaceRole.OWNER)
        seed.add(mem)
        seed.flush()
        conn = MetaConnection(
            workspace_id=ws.id,
            label="Test Conn",
            business_manager_reference="bm_test_1",
            environment=MetaEnvironment.PRODUCTION,
            status=ReferenceStatus.ACTIVE,
            created_by=usr.id,
        )
        seed.add(conn)
        seed.commit()
        ws_id, usr_id, mem_id, conn_id = ws.id, usr.id, mem.id, conn.id

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
    with TestClient(app) as client, TestingSession() as db:
        yield client, db, ws_id, usr_id, conn_id
    app.dependency_overrides.clear()
    eng.dispose()


def test_zero_run_workspace_returns_null_success_rate_and_telemetry_computes_proxy_health(sqlite_ops):
    client, db, ws_id, usr_id, _ = sqlite_ops

    # Initial empty state: no fabricated success rate!
    r0 = client.get("/api/v1/automation/operational-telemetry")
    assert r0.status_code == 200, r0.text
    d0 = r0.json()
    assert d0["automation_health"]["total_ops_7d"] == 0
    assert d0["automation_health"]["success_rate_pct"] is None
    assert d0["proxy_clusters"] == []
    assert d0["early_risks"] == []

    # Add 5 Vias across 2 proxies (one crowded direct/shared, one incident, one clean)
    v1 = PersonalAccountReference(
        workspace_id=ws_id,
        label="Via Alpha",
        status=ReferenceStatus.ACTIVE,
        network_label="103.11.22.33:8080",
    )
    v2 = PersonalAccountReference(
        workspace_id=ws_id,
        label="Via Beta",
        status=ReferenceStatus.ACTIVE,
        network_label="103.11.22.33:8080",
    )
    v3 = PersonalAccountReference(
        workspace_id=ws_id,
        label="Via Clean",
        status=ReferenceStatus.ACTIVE,
        network_label="45.77.88.99:9000",
    )
    db.add_all([v1, v2, v3])
    db.flush()

    audit = AuditLogService(db, ws_id, usr_id)
    for _ in range(3):
        audit.record(action="page.via_keepalive", entity_type="page", entity_id=str(v3.id), metadata={"via_id": str(v3.id), "via_label": v3.label})
    audit.record(action="page.warmup_posted", entity_type="page", entity_id="pg-1", metadata={"post_mode": "chrome_assist"})
    audit.record(
        action="page.via_alert",
        entity_type="page",
        entity_id=str(v1.id),
        metadata={"via_id": str(v1.id), "via_label": v1.label, "alert_type": "COOKIE_LOGGED_OUT"},
    )
    db.commit()

    r1 = client.get("/api/v1/automation/operational-telemetry")
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    ah = d1["automation_health"]
    assert ah["ok_ops_7d"] == 4
    assert ah["fail_ops_7d"] == 1
    assert ah["total_ops_7d"] == 5
    assert ah["success_rate_pct"] == 80.0

    # Worst proxy cluster ("103.11.22.33:8080" with 1 incident) must rank ahead of clean proxy
    clusters = d1["proxy_clusters"]
    assert len(clusters) == 2
    assert clusters[0]["proxy_key"] == "103.11.22.33:8080"
    assert clusters[0]["status"] == "incident"
    assert clusters[0]["incident_count_7d"] == 1
    assert clusters[0]["via_count"] == 2
    assert clusters[1]["proxy_key"] == "45.77.88.99:9000"
    assert clusters[1]["status"] == "healthy"


def test_threshold_80_and_spend_spike_detection_reconcile_and_resolve(sqlite_ops):
    client, db, ws_id, usr_id, conn_id = sqlite_ops
    now = datetime.now(UTC)

    # Meta account near billing threshold (85%) + flat daily spend (no spike)
    meta_acc = AdAccount(
        workspace_id=ws_id,
        display_name="TK Meta Ngưỡng Cao",
        external_account_id="act_123456",
        account_type=AccountType.BUSINESS_MANAGER,
        currency="VND",
        status=AccountStatus.ACTIVE,
        tags=[],
    )
    # Google Ads account with 3x daily spend spike + flat baseline
    gads_acc = AdAccount(
        workspace_id=ws_id,
        display_name="Google Ads Spike Co",
        external_account_id="gads_9998887777",
        account_type=AccountType.BUSINESS_MANAGER,
        currency="VND",
        status=AccountStatus.ACTIVE,
        tags=["platform:google_ads"],
    )
    db.add_all([meta_acc, gads_acc])
    db.flush()

    today = date.today()
    meta_obs = AdAccountSpendObservation(
        workspace_id=ws_id,
        ad_account_id=meta_acc.id,
        meta_connection_id=conn_id,
        external_account_id="123456",
        reader_source="server_default",
        trigger=SpendObservationTrigger.MANUAL_REFRESH,
        observed_at=now,
        status=SpendObservationStatus.SUCCEEDED,
        observed_currency="VND",
        balance_raw="1700000",
        amount_spent_raw="5000000",
        spend_cap_raw="20000000",
        daily_json=[
            {"date_start": (today - timedelta(days=3)).isoformat(), "spend": "300000"},
            {"date_start": (today - timedelta(days=2)).isoformat(), "spend": "310000"},
            {"date_start": (today - timedelta(days=1)).isoformat(), "spend": "305000"},
            {"date_start": today.isoformat(), "spend": "320000"},
        ],
    )
    gads_obs = AdAccountSpendObservation(
        workspace_id=ws_id,
        ad_account_id=gads_acc.id,
        meta_connection_id=conn_id,
        external_account_id="gads_9998887777",
        reader_source="google_ads_script",
        trigger=SpendObservationTrigger.SCHEDULED_SWEEP,
        observed_at=now,
        status=SpendObservationStatus.SUCCEEDED,
        observed_currency="VND",
        amount_spent_raw="12000000",
        spend_cap_raw="500000",  # Google Ads stores daily budget here; must NOT trigger spend_cap_85!
        daily_json=[
            {"date_start": (today - timedelta(days=3)).isoformat(), "spend": "400000"},
            {"date_start": (today - timedelta(days=2)).isoformat(), "spend": "420000"},
            {"date_start": (today - timedelta(days=1)).isoformat(), "spend": "410000"},
            {"date_start": today.isoformat(), "spend": "1250000"},  # ~3.0x baseline + >1.25x daily budget!
        ],
    )
    db.add_all([meta_obs, gads_obs])

    audit = AuditLogService(db, ws_id, usr_id)
    audit.record(
        action="ad_account.billing_meta_updated",
        entity_type="ad_account",
        entity_id=str(meta_acc.id),
        metadata={
            "balance_raw": "1700000",
            "billing_threshold_raw": "2000000",
            "payment_card_display": "Visa ···· 4242",
        },
    )
    audit.record(
        action="ad_account.billing_meta_synced",
        entity_type="ad_account",
        entity_id=str(gads_acc.id),
        metadata={"meta_daily_limit_raw": "500000"},
    )
    db.commit()

    res1 = evaluate_and_reconcile_early_risks(db, ws_id, reconcile_alerts=True)
    db.commit()

    kinds = {(r["ad_account_id"], r["kind"]) for r in res1["items"]}
    assert (str(meta_acc.id), "billing_threshold_80") in kinds
    assert (str(gads_acc.id), "daily_spend_spike") in kinds
    assert (str(gads_acc.id), "spend_cap_85") not in kinds

    # Verify Alert rows created cleanly
    open_alerts = db.execute(
        sa.select(Alert).where(
            Alert.workspace_id == ws_id,
            Alert.source_entity_type == EARLY_RISK_SOURCE_ENTITY_TYPE,
            Alert.status == AlertStatus.OPEN,
        )
    ).scalars().all()
    assert len(open_alerts) == 2

    # Verify API exposes early_risks
    tel_resp = client.get("/api/v1/automation/operational-telemetry")
    assert tel_resp.status_code == 200
    tel = tel_resp.json()
    assert tel["early_risk_summary"]["threshold_warnings"] == 1
    assert tel["early_risk_summary"]["spend_spikes"] == 1

    # Simulate card billed: balance drops to 200,000 VND (10%) -> threshold alert must auto-resolve!
    audit.record(
        action="ad_account.billing_meta_updated",
        entity_type="ad_account",
        entity_id=str(meta_acc.id),
        metadata={"balance_raw": "200000", "billing_threshold_raw": "2000000"},
    )
    db.commit()
    res2 = evaluate_and_reconcile_early_risks(db, ws_id, reconcile_alerts=True)
    db.commit()
    assert res2["reconciled"]["resolved"] == 1
    meta_alert = db.execute(
        sa.select(Alert).where(
            Alert.workspace_id == ws_id,
            Alert.ad_account_id == meta_acc.id,
            Alert.source_entity_type == EARLY_RISK_SOURCE_ENTITY_TYPE,
        )
    ).scalar_one()
    assert meta_alert.status == AlertStatus.RESOLVED
    assert meta_alert.active_key is None


def test_telegram_config_flags_and_dispatch_early_alerts(sqlite_ops, monkeypatch):
    client, db, ws_id, usr_id, conn_id = sqlite_ops

    # Persist Telegram config with threshold & spike toggles
    cfg_r = client.post(
        "/api/v1/telegram-bot/config",
        json={
            "enabled": True,
            "chat_id": "-100999888",
            "notify_threshold_80": True,
            "notify_spend_spike": True,
            "quiet_hours_respect": False,
        },
    )
    assert cfg_r.status_code == 200, cfg_r.text
    assert cfg_r.json()["notify_threshold_80"] is True
    assert cfg_r.json()["notify_spend_spike"] is True

    acc = AdAccount(
        workspace_id=ws_id,
        display_name="TK Telegram Thresh",
        external_account_id="act_777888",
        account_type=AccountType.BUSINESS_MANAGER,
        currency="VND",
        status=AccountStatus.ACTIVE,
    )
    db.add(acc)
    db.flush()
    audit = AuditLogService(db, ws_id, usr_id)
    audit.record(
        action="ad_account.billing_meta_updated",
        entity_type="ad_account",
        entity_id=str(acc.id),
        metadata={"balance_raw": "1800000", "billing_threshold_raw": "2000000", "payment_card_display": "Visa 1234"},
    )
    db.commit()

    sent_messages: list[str] = []

    class _FakeTg:
        def __init__(self, *args, **kwargs):
            pass

        def send(self, msg):
            sent_messages.append(msg.text)
            return type("Res", (), {"ok": True, "failure_summary": None})()

    class _FakeSettings:
        telegram_transport_configured = True
        telegram_bot_token = "123456:fake-token-for-test-only"
        telegram_api_base_url = "https://api.telegram.org"
        telegram_timeout_seconds = 5
        public_app_url = "https://adsops-app.vibe.tinhgon.xyz"
        secret_vault_key = ""

    monkeypatch.setattr("app.services.telegram_bot_helper.TelegramTransport", _FakeTg)
    res = dispatch_operational_telegram_alerts(db, ws_id, audit, _FakeSettings())
    db.commit()

    assert res["sent"] >= 1
    assert len(sent_messages) == 1
    assert "90%" in sent_messages[0]
    assert "TK Telegram Thresh" in sent_messages[0]

    # Second run same day is deduped -> 0 messages sent
    res_dup = dispatch_operational_telegram_alerts(db, ws_id, audit, _FakeSettings())
    assert res_dup["sent"] == 0
