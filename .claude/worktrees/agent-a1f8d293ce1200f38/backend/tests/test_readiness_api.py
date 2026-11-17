"""End-to-end readiness lifecycle: checklist → evidence → events → recalculation."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta


def make_ready_account(api, *, status="active", account_type="business_manager"):
    """Drive an account all the way to operationally_ready through the public API."""
    bm = api.post("/api/v1/business-managers", json={"name": "BM", "external_id": "bm_r"}).json()
    browser = api.post(
        "/api/v1/browser-profile-references", json={"profile_reference": "chrome-ready"}
    ).json()
    account = api.post(
        "/api/v1/ad-accounts",
        json={
            "display_name": "Ready account",
            "external_account_id": "act_ready",
            "account_type": account_type,
            "business_manager_id": bm["id"] if account_type == "business_manager" else None,
            "status": status,
        },
    ).json()
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links",
        json={"asset_type": "browser_profile", "asset_id": browser["id"]},
    )
    for item_key, summary in (
        ("ownership_confirmed", "Ownership verified in the BM member list."),
        ("payment_method_reviewed", "Payment reference verified with finance."),
    ):
        response = api.post(
            f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/{item_key}/evidence",
            json={"evidence_type": "operator_note", "summary": summary, "status": "verified"},
        )
        assert response.status_code == 201, response.text
        api.patch(
            f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/{item_key}",
            json={"review_status": "completed"},
        )
    for item_key in ("admin_access_reviewed", "two_factor_reviewed", "billing_issue_checked"):
        api.patch(
            f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/{item_key}",
            json={"review_status": "completed"},
        )
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/readiness/manual-review",
        json={"note": "Initial operator review."},
    )
    return account


def test_full_evidence_lifecycle_reaches_operationally_ready(api):
    account = make_ready_account(api)
    readiness = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness").json()
    assert readiness["readiness_status"] == "operationally_ready"
    assert readiness["completed_item_count"] == readiness["required_item_count"]
    assert "not a platform approval" in readiness["disclaimer"]

    listed = api.get("/api/v1/ad-accounts").json()["items"][0]
    assert listed["readiness_status"] == "operationally_ready"
    assert listed["has_browser_reference"] is True


def test_readiness_downgrades_when_a_critical_event_is_recorded_and_recovers_on_resolve(api):
    account = make_ready_account(api)

    created = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={
            "event_type": "policy_notice",
            "severity": "critical",
            "summary": "Operator observed a policy notice.",
        },
    ).json()
    assert created["readiness_status"] == "not_ready"

    resolved = api.post(
        f"/api/v1/account-events/{created['event']['id']}/resolve",
        json={"resolution_note": "Notice cleared after review."},
    ).json()
    assert resolved["readiness_status"] == "operationally_ready"


def test_warning_event_produces_ready_with_warnings(api):
    account = make_ready_account(api)
    result = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "spend_anomaly", "severity": "warning", "summary": "Spend spike."},
    ).json()
    assert result["readiness_status"] == "ready_with_warnings"


def test_resolving_an_event_requires_a_note(api):
    account = make_ready_account(api)
    event = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "note", "severity": "info", "summary": "Something"},
    ).json()["event"]
    response = api.post(
        f"/api/v1/account-events/{event['id']}/resolve", json={"resolution_note": "   "}
    )
    assert response.status_code == 422


def test_restricted_status_blocks_readiness_even_with_a_complete_checklist(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    readiness = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness").json()
    assert readiness["readiness_status"] == "not_ready"
    assert any(r["code"] == "account_status_restricted" for r in readiness["reasons"])


def test_rejected_evidence_blocks_readiness(api):
    account = make_ready_account(api)
    checklist = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    entry = next(e for e in checklist if e["item"]["item_key"] == "payment_method_reviewed")
    evidence_id = entry["evidence"][0]["id"]

    result = api.patch(f"/api/v1/readiness-evidence/{evidence_id}", json={"status": "rejected"}).json()
    assert result["readiness"]["readiness_status"] == "not_ready"


def test_archiving_evidence_returns_the_item_to_incomplete(api):
    account = make_ready_account(api)
    checklist = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    entry = next(e for e in checklist if e["item"]["item_key"] == "ownership_confirmed")
    evidence_id = entry["evidence"][0]["id"]

    result = api.post(f"/api/v1/readiness-evidence/{evidence_id}/archive").json()
    assert result["readiness"]["readiness_status"] == "unknown"

    after = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    item = next(e["item"] for e in after if e["item"]["item_key"] == "ownership_confirmed")
    assert item["evidence_status"] == "missing"


def test_expired_evidence_is_derived_not_asserted(api):
    account = make_ready_account(api)
    checklist = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    entry = next(e for e in checklist if e["item"]["item_key"] == "ownership_confirmed")
    evidence_id = entry["evidence"][0]["id"]

    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    result = api.patch(f"/api/v1/readiness-evidence/{evidence_id}", json={"expires_at": past}).json()
    assert result["readiness"]["readiness_status"] == "not_ready"
    assert any("expired" in reason["message"].lower() for reason in result["readiness"]["reasons"])


def test_evidence_cannot_be_created_directly_as_expired(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "A"}).json()
    response = api.post(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/ownership_confirmed/evidence",
        json={"evidence_type": "note", "summary": "x", "status": "expired"},
    )
    assert response.status_code == 422


def test_derived_items_cannot_be_hand_marked(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "A"}).json()
    response = api.patch(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/browser_reference_assigned",
        json={"review_status": "completed"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["details"]["derived_from"] == "active_browser_profile_link"


def test_waiver_requires_a_reason_and_still_does_not_satisfy_the_item(api):
    account = make_ready_account(api)
    without_reason = api.patch(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/billing_issue_checked",
        json={"review_status": "waived"},
    )
    assert without_reason.status_code == 422

    with_reason = api.patch(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/billing_issue_checked",
        json={"review_status": "waived", "waiver_reason": "Handled by finance out of band."},
    ).json()
    assert with_reason["readiness"]["readiness_status"] == "not_ready"


def test_manual_review_expiry_blocks_readiness(api, db_session):
    from app.models.entities import AdAccount

    account = make_ready_account(api)
    row = db_session.get(AdAccount, account["id"])
    row.last_manual_review_at = datetime.now(UTC) - timedelta(days=400)
    db_session.commit()

    readiness = api.post(f"/api/v1/ad-accounts/{account['id']}/readiness/recalculate").json()
    assert readiness["readiness_status"] == "not_ready"
    assert any(r["code"] == "last_manual_review_completed_blocked" for r in readiness["reasons"])


def test_unlinking_the_browser_reference_downgrades_readiness(api):
    account = make_ready_account(api)
    links = api.get(f"/api/v1/ad-accounts/{account['id']}/asset-links").json()
    link = next(entry for entry in links if entry["asset_type"] == "browser_profile")

    api.post(f"/api/v1/ad-accounts/{account['id']}/asset-links/{link['id']}/unlink")
    readiness = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness").json()
    assert readiness["readiness_status"] == "unknown"


def test_readiness_summary_counts_every_state(api):
    make_ready_account(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete", "external_account_id": "act_x"})
    summary = api.get("/api/v1/ad-accounts/readiness/summary").json()
    assert summary["total_active"] == 2
    assert summary["operationally_ready"] == 1
    assert summary["unknown"] == 1
    assert summary["archived"] == 0


def test_readiness_board_groups_accounts_by_blocking_reason(api):
    api.post("/api/v1/ad-accounts", json={"display_name": "One", "external_account_id": "a1"})
    api.post("/api/v1/ad-accounts", json={"display_name": "Two", "external_account_id": "a2"})
    board = api.get("/api/v1/ad-accounts/readiness/board").json()
    assert len(board["rows"]) == 2
    codes = {group["code"] for group in board["groups"]}
    assert "ownership_confirmed_incomplete" in codes
    assert all(len(group["accounts"]) <= 2 for group in board["groups"])


def test_readiness_endpoint_is_read_only(api, db_session):
    from app.models.entities import AdAccount

    account = api.post("/api/v1/ad-accounts", json={"display_name": "A"}).json()
    row = db_session.get(AdAccount, account["id"])
    stamp = row.readiness_evaluated_at

    api.get(f"/api/v1/ad-accounts/{account['id']}/readiness")
    db_session.refresh(row)
    assert row.readiness_evaluated_at == stamp


def test_conditional_landing_page_items_appear_when_a_landing_page_is_set(api):
    account = make_ready_account(api)
    api.patch(
        f"/api/v1/ad-accounts/{account['id']}",
        json={"landing_page_url": "https://example.com/offer"},
    )
    readiness = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness").json()
    by_key = {item["item_key"]: item for item in readiness["items"]}
    assert by_key["landing_page_verified"]["required"] is True
    assert "landing page" in by_key["landing_page_verified"]["requirement_reason"].lower()
    assert readiness["readiness_status"] == "unknown"


def test_landing_page_url_must_be_http(api):
    response = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "A", "landing_page_url": "javascript:alert(1)"},
    )
    assert response.status_code == 422
