"""Slice C1 & C2 — Client budget, pacing evaluation, and automatic budget drift alerts."""
from __future__ import annotations

from app.core.enums import IdentityBusinessRole, WorkspaceRole
from app.core.security import hash_password
from app.models.entities import User, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.notification_service import NotificationDispatcherService
from tests.s1_spend_helpers import good_read, make_account, make_bm, make_connection

BM = "1993884657458857"


def _setup_account(
    api,
    *,
    external_id: str = "123456789",
    currency: str = "VND",
    client_name: str = "Thẩm mỹ viện Ánh Dương",
    planned_daily_budget_raw: str | None = "1000000",
    planned_monthly_budget_raw: str | None = "20000000",
):
    bms = {bm["external_id"]: bm for bm in api.get("/api/v1/business-managers").json()["items"]}
    bm = bms.get(BM) or make_bm(api, BM)
    if not api.get("/api/v1/meta-connections").json():
        make_connection(api, bm_external_id=BM)
    acc = make_account(api, bm=bm, external_id=external_id, currency=currency)
    patched = api.patch(
        f"/api/v1/ad-accounts/{acc['id']}",
        json={
            "client_name": client_name,
            "planned_daily_budget_raw": planned_daily_budget_raw,
            "planned_monthly_budget_raw": planned_monthly_budget_raw,
        },
    )
    assert patched.status_code == 200, patched.text
    return patched.json(), bm


def test_c1_budget_fields_on_ad_account_crud_and_validation(api, client, auth):
    account, _ = _setup_account(
        api,
        client_name="Khách hàng Thời trang X",
        planned_daily_budget_raw="1500000.00",
        planned_monthly_budget_raw="45000000",
    )
    assert account["client_name"] == "Khách hàng Thời trang X"
    assert account["planned_daily_budget_raw"] == "1500000"
    assert account["planned_monthly_budget_raw"] == "45000000"

    # Search by client_name
    found = api.get("/api/v1/ad-accounts?search=Thời trang X").json()
    assert found["total"] == 1
    assert found["items"][0]["id"] == account["id"]

    # Reject zero, negative, or non-numeric budget
    for bad in ("0", "-500", "not-a-number"):
        res = client.patch(
            f"/api/v1/ad-accounts/{account['id']}",
            headers=auth,
            json={"planned_daily_budget_raw": bad},
        )
        assert res.status_code == 422, (bad, res.text)

    # Reject login secret in client_name (Rule 1)
    bad_secret = client.patch(
        f"/api/v1/ad-accounts/{account['id']}",
        headers=auth,
        json={"client_name": "password: MySecretPassword123"},
    )
    assert bad_secret.status_code == 422


def test_c1_spend_payload_and_summary_compute_budget_pacing_accurately(api, spend_env):
    account, _ = _setup_account(
        api,
        planned_daily_budget_raw="1000000",
        planned_monthly_budget_raw="20000000",
    )

    before = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert before["budget_pacing"]["pacing_status"] == "insufficient_data"
    assert before["budget_pacing"]["planned_daily_budget_raw"] == "1000000"
    assert before["budget_pacing"]["planned_monthly_budget_raw"] == "20000000"

    # Yesterday spent 1,600,000 against 1,000,000 daily budget -> 160% -> overspending
    spend_env["provider"].queue_spend_result(
        "123456789",
        good_read(
            {1: "1600000", 2: "1000000", 3: "1000000"},
            amount_spent="3600000",
            spend_cap="50000000",
        ),
    )
    after = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh").json()
    pacing = after["budget_pacing"]
    assert pacing["pacing_status"] == "overspending"
    assert pacing["latest_day_spend_raw"] == "1600000"
    assert pacing["daily_utilization_pct"] == 160.0
    assert pacing["mtd_days_counted"] >= 1
    assert pacing["currency"] == "VND"

    summary = api.get("/api/v1/spend/summary").json()
    assert summary["budget_pacing_counts"]["overspending"] == 1


def test_c2_budget_pacing_drift_opens_alert_notifies_telegram_with_identity_and_auto_resolves(
    api, client, auth, db_session, owner, transport, spend_env
):
    account, bm = _setup_account(
        api,
        client_name="Spa Ngọc Lan",
        planned_daily_budget_raw="1000000",
        planned_monthly_budget_raw="30000000",
    )

    # Create holder & Facebook profile linked to the BM
    holder_user = User(
        email="holder-c2@example.com",
        full_name="Nguyễn Văn Giữ",
        password_hash=hash_password("correct-horse-battery"),
        is_active=True,
    )
    db_session.add(holder_user)
    db_session.flush()
    holder_member = WorkspaceMember(
        workspace_id=owner["workspace"].id,
        user_id=holder_user.id,
        role=WorkspaceRole.ADMIN,
    )
    db_session.add(holder_member)
    db_session.commit()

    fb = api.post(
        "/api/v1/personal-account-references",
        json={
            "label": "FB2 – Nguyễn A",
            "owner_member_id": str(holder_member.id),
            "two_factor_method": "app",
            "vault_reference": "Bitwarden → Agency/FB2",
        },
    ).json()
    api.post(
        f"/api/v1/personal-account-references/{fb['id']}/business-links",
        json={
            "business_manager_id": bm["id"],
            "role": IdentityBusinessRole.ADMIN.value,
            "note": "Cầm BM chính",
        },
    )

    # Enable warning Telegram notifications
    pol_res = client.patch(
        "/api/v1/notification-policies/current",
        headers=auth,
        json={
            "enabled": True,
            "quiet_hours_enabled": False,
            "warning_telegram_enabled": True,
            "telegram_chat_id": "-100987654321",
        },
    )
    assert pol_res.status_code == 200, pol_res.text

    # Trigger spend refresh with 1,500,000 daily spend (150% of 1,000,000 daily budget)
    spend_env["provider"].queue_spend_result(
        "123456789",
        good_read({1: "1500000", 2: "1000000"}),
    )
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    # Verify alert is opened
    alerts = api.get(f"/api/v1/alerts?ad_account_id={account['id']}").json()["items"]
    pacing_alerts = [a for a in alerts if a["title"] == "Chi tiêu vượt ngân sách cam kết"]
    assert len(pacing_alerts) == 1
    alert_row = pacing_alerts[0]
    assert alert_row["status"] == "open"
    assert alert_row["severity"] == "warning"
    assert "Spa Ngọc Lan" in alert_row["summary"]
    assert "150.0%" in alert_row["summary"]
    assert len(alert_row["facebook_identities"]) == 1
    assert alert_row["facebook_identities"][0]["label"] == "FB2 – Nguyễn A"
    assert len(alert_row["remediation_checklist"]) == 3

    # Dispatch Telegram notification and verify content
    wid = owner["workspace"].id
    NotificationDispatcherService(
        db_session,
        wid,
        AuditLogService(db_session, wid, owner["user"].id),
        transport=transport,
    ).dispatch_due()
    db_session.commit()
    assert len(transport.sent) >= 1
    msg_text = transport.sent[-1].text
    assert "Chi tiêu vượt ngân sách cam kết" in msg_text
    assert "FB2 – Nguyễn A" in msg_text
    assert "Bitwarden → Agency/FB2" in msg_text

    # Now raise planned_daily_budget_raw to 2,000,000 (1,500,000 / 2,000,000 = 75% -> on_track)
    patched = api.patch(
        f"/api/v1/ad-accounts/{account['id']}",
        json={"planned_daily_budget_raw": "2000000"},
    )
    assert patched.status_code == 200

    # Verify the alert auto-resolves!
    detail = api.get(f"/api/v1/alerts/{alert_row['id']}").json()
    assert detail["alert"]["status"] == "resolved"
    assert detail["alert"]["resolution_reason"] == "The source condition is no longer active."
