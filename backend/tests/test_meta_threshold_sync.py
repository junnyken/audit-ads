"""Tests for Package 1A: Meta Graph API billing threshold (`adspaymentcycle`) & daily limit (`adtrust_dsl`) auto-sync."""
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
for _k in ("META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_OAUTH_REDIRECT_URI", "CREDENTIAL_VAULT_KEY"):
    os.environ[_k] = ""

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.api.v1.routers.ad_accounts import _build_billing_meta_map  # noqa: E402
from app.api.v1.routers.meta_operations import (  # noqa: E402
    META_AD_ACCOUNT_BASE_FIELDS,
    META_AD_ACCOUNT_EXTENDED_FIELDS,
    _extract_adspaymentcycle_threshold,
    _extract_daily_spend_limit,
    _fetch_ad_accounts_with_fallback,
    meta_minor_to_major_raw,
    run_workspace_quick_sync,
)
from app.core.enums import AlertStatus, MetaEnvironment, WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.alerts import Alert  # noqa: E402
from app.models.entities import AdAccount, AuditLog, User, Workspace, WorkspaceMember  # noqa: E402
from app.models.meta_discovery import BusinessManagerDiscoveryRun  # noqa: E402
from app.models.meta_operations import MetaConnection  # noqa: E402
from app.services.audit import AuditLogService  # noqa: E402
from app.services.early_risk_detector import EARLY_RISK_SOURCE_ENTITY_TYPE  # noqa: E402
from app.services.meta_graph_transport import GraphResponse  # noqa: E402
from app.services.meta_provider import MetaFailureCode  # noqa: E402


@pytest.fixture()
def sqlite_db():
    eng = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    AuditLog.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    with TestingSession() as session:
        user = User(email="owner@agency.test", full_name="Owner", password_hash=hash_password("StrongPass1!"))
        ws = Workspace(name="Agency Sync WS", slug="agency-sync-ws")
        session.add_all([user, ws])
        session.flush()
        session.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.OWNER))
        conn = MetaConnection(
            workspace_id=ws.id,
            label="Hub BM",
            environment=MetaEnvironment.PRODUCTION,
            business_manager_reference="999000111",
            auto_discovery_enabled=True,
            auto_import_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(conn)
        session.flush()
        session.commit()
        yield session, ws, user, conn


def test_meta_minor_to_major_raw_vnd_and_usd():
    assert meta_minor_to_major_raw("20000000", "VND") == "20000000"
    assert meta_minor_to_major_raw("5938844", "VND") == "5938844"
    assert meta_minor_to_major_raw("0", "VND", allow_zero=True) == "0"
    assert meta_minor_to_major_raw("0", "VND", allow_zero=False) is None
    assert meta_minor_to_major_raw("-100", "USD") is None
    assert meta_minor_to_major_raw("50000", "USD") == "500"
    assert meta_minor_to_major_raw("1250", "USD") == "12.5"
    assert meta_minor_to_major_raw("5000", "JPY") == "5000"


def test_extract_threshold_and_dsl_helpers():
    assert _extract_adspaymentcycle_threshold({"adspaymentcycle": {"data": [{"threshold_amount": 20000000}]}}, "VND") == "20000000"
    assert _extract_adspaymentcycle_threshold({"adspaymentcycle": {"threshold_amount": 25000}}, "USD") == "250"
    assert _extract_adspaymentcycle_threshold({"adspaymentcycle": {"data": []}}, "VND") is None
    assert _extract_daily_spend_limit(5000000) == "5000000"
    assert _extract_daily_spend_limit("-1") is None
    assert _extract_daily_spend_limit("0") is None


def test_fetch_ad_accounts_falls_back_to_base_fields_when_extended_denied():
    calls: list[dict] = []

    class FallbackTransport:
        def get(self, path, params):
            calls.append({"path": path, "fields": params.get("fields")})
            if params.get("fields") == META_AD_ACCOUNT_EXTENDED_FIELDS:
                return GraphResponse(
                    ok=False,
                    payload={"error": {"message": "nonexisting field adspaymentcycle"}},
                    failure_code=MetaFailureCode.INVALID_REQUEST,
                )
            return GraphResponse(ok=True, payload={"data": [{"id": "act_111", "account_id": "111"}]})

    resp = _fetch_ad_accounts_with_fallback(FallbackTransport(), "me/adaccounts")
    assert resp.ok is True
    assert len(calls) == 2
    assert calls[0]["fields"] == META_AD_ACCOUNT_EXTENDED_FIELDS
    assert calls[1]["fields"] == META_AD_ACCOUNT_BASE_FIELDS


def test_quick_sync_populates_threshold_preserves_extension_and_triggers_80pct_alert(sqlite_db, monkeypatch):
    session, ws, user, conn = sqlite_db

    # Seed an existing Extension billing override (must NOT be clobbered when Meta omits fields)
    acc_ext = AdAccount(
        workspace_id=ws.id,
        display_name="USD Extension Preserved",
        external_account_id="22222222",
        currency="USD",
        timezone="America/Los_Angeles",
        country="US",
    )
    session.add(acc_ext)
    session.flush()
    audit = AuditLogService(session, ws.id, user.id)
    audit.record(
        action="ad_account.billing_meta_updated",
        entity_type="ad_account",
        entity_id=acc_ext.id,
        after={
            "billing_threshold_raw": "300",
            "next_bill_date": "2026-12-01",
            "payment_card_display": "Visa ···· 4242",
        },
        metadata={"source": "chrome_extension_billing_hub"},
    )
    # Mark a prior discovery run so quick sync completes immediately after multi-BM Graph ingestion
    session.add(
        BusinessManagerDiscoveryRun(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            meta_connection_id=conn.id,
            configured_business_manager_reference="999000111",
            configured_business_manager_name="Hub BM",
            started_at=datetime.now(UTC),
        )
    )
    session.commit()

    class FakeGraphTransport:
        def __init__(self, **kwargs):
            pass

        def get(self, path, params=None):
            if path == "me/businesses":
                return GraphResponse(ok=True, payload={"data": [{"id": "999000111", "name": "Hub BM"}]})
            if path == "999000111/owned_ad_accounts":
                return GraphResponse(
                    ok=True,
                    payload={
                        "data": [
                            {
                                "id": "act_11111111",
                                "account_id": "11111111",
                                "name": "MBI Threshold Test",
                                "account_status": 1,
                                "currency": "VND",
                                "timezone_name": "Asia/Ho_Chi_Minh",
                                "balance": "17000000",
                                "adspaymentcycle": {"data": [{"threshold_amount": 20000000}]},
                                "adtrust_dsl": 5000000,
                                "business": {"id": "999000111", "name": "Hub BM"},
                            },
                            {
                                "id": "act_22222222",
                                "account_id": "22222222",
                                "name": "USD Extension Preserved",
                                "account_status": 1,
                                "currency": "USD",
                                "timezone_name": "America/Los_Angeles",
                                "balance": "12500",
                                "adtrust_dsl": -1,
                                # No adspaymentcycle returned here -> must keep Extension's "300"
                            },
                        ]
                    },
                )
            return GraphResponse(ok=True, payload={"data": []})

    from app.core.config import get_settings

    monkeypatch.setattr("app.services.meta_graph_transport.MetaGraphTransport", FakeGraphTransport)
    fake_settings = get_settings().model_copy(
        update={
            "environment": "production",
            "meta_business_id": "",
            "meta_access_token": "",
            "meta_access_tokens_by_business": {},
            "bootstrap_owner_email": "",
        }
    )
    monkeypatch.setattr("app.api.v1.routers.meta_operations.get_settings", lambda: fake_settings)

    res = run_workspace_quick_sync(
        session, ws.id, user.id, access_token="EAAfake_token_not_real"
    )
    session.commit()
    assert res["status"] == "succeeded", res

    acc_vnd = session.execute(
        sa.select(AdAccount).where(AdAccount.workspace_id == ws.id, AdAccount.external_account_id == "11111111")
    ).scalar_one()
    acc_usd = session.execute(
        sa.select(AdAccount).where(AdAccount.workspace_id == ws.id, AdAccount.external_account_id == "22222222")
    ).scalar_one()

    bmap = _build_billing_meta_map(session, ws.id, [acc_vnd, acc_usd], {}, {})
    assert bmap[acc_vnd.id]["balance_raw"] == "17000000"
    assert bmap[acc_vnd.id]["billing_threshold_raw"] == "20000000"
    assert bmap[acc_vnd.id]["meta_daily_limit_raw"] == "5000000"

    # Extension billing_threshold_raw="300" and card were NOT overwritten, while balance converted to major USD "125"
    assert bmap[acc_usd.id]["balance_raw"] == "125"
    assert bmap[acc_usd.id]["billing_threshold_raw"] == "300"
    assert bmap[acc_usd.id]["next_bill_date"] == "2026-12-01"
    assert bmap[acc_usd.id]["payment_card_display"] == "Visa ···· 4242"

    # Early risk alert (85% of threshold) created immediately without waiting for Chrome Extension!
    alerts = session.execute(
        sa.select(Alert).where(
            Alert.workspace_id == ws.id,
            Alert.source_entity_type == EARLY_RISK_SOURCE_ENTITY_TYPE,
            Alert.status == AlertStatus.OPEN,
        )
    ).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].ad_account_id == acc_vnd.id
    assert "85" in alerts[0].title or "85" in alerts[0].explanation
