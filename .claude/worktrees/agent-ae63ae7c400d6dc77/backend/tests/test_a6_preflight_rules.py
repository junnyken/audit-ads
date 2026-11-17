"""Unit tests for the A6 rule-producing modules — Section 10.1/10.2 of the mini-spec.

Copy/field rules and SSRF protection are pure-function tests (no database). The account-context
adapter needs real A1/A2 rows, so those use `db_session`/`workspace` like the A5 context tests.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.core.enums import (
    AccountStatus,
    DraftStatus,
    FindingSeverity,
    HealthStatus,
)
from app.models.entities import AdAccount
from app.models.health import AccountHealthSnapshot
from app.models.preflight import CampaignDraft
from app.services.audit import AuditLogService
from app.services.preflight_account_context import AccountContextRuleAdapter
from app.services.preflight_copy_rules import CopyRuleEngine
from app.services.preflight_landing_page import LandingPageCheckService
from app.services.preflight_safe_http import (
    FetchOutcome,
    SafeFetchResult,
    _assert_safe_url,
    _UnsafeTarget,
)

# ---- CopyRuleEngine -------------------------------------------------------------------------


def _draft(**overrides) -> CampaignDraft:
    defaults = {
        "id": uuid.uuid4(),
        "workspace_id": uuid.uuid4(),
        "ad_account_id": uuid.uuid4(),
        "title": "Test draft",
        "objective": "conversion",
        "primary_copy": "Ưu đãi mùa hè, mua ngay hôm nay.",
        "headline": None,
        "description": None,
        "call_to_action": None,
        "landing_page_url": "https://shop.example.com/sale",
        "creative_reference": None,
        "budget_amount": None,
        "budget_currency": None,
        "budget_change_percent": None,
        "targeting_summary": "Nữ 25-45, TP.HCM",
        "draft_status": DraftStatus.DRAFT,
        "created_by": uuid.uuid4(),
    }
    defaults.update(overrides)
    return CampaignDraft(**defaults)


def test_absolute_claim_is_detected_and_unrelated_copy_is_not():
    hit = CopyRuleEngine().evaluate(_draft(primary_copy="Đảm bảo hiệu quả 100%, không lo thất bại."))
    assert any(f.rule_key == "copy_absolute_claim_detected" for f in hit)

    clean = CopyRuleEngine().evaluate(_draft(primary_copy="Ưu đãi mùa hè, số lượng có hạn."))
    assert not any(f.rule_key == "copy_absolute_claim_detected" for f in clean)


def test_empty_primary_copy_is_blocking():
    findings = CopyRuleEngine().evaluate(_draft(primary_copy=""))
    empty_field = [f for f in findings if f.rule_key == "copy_empty_required_field"]
    assert len(empty_field) == 1
    assert empty_field[0].severity is FindingSeverity.BLOCKING


def test_empty_headline_alone_is_not_blocking():
    """Deviation from the mini-spec's literal wording, documented in preflight_copy_rules.py:
    headline is nullable by schema design, so an absent headline is not itself a defect."""
    findings = CopyRuleEngine().evaluate(_draft(primary_copy="Nội dung hợp lệ.", headline=None))
    assert not any(f.rule_key == "copy_empty_required_field" for f in findings)


def test_landing_page_missing_when_objective_present_is_blocking():
    findings = CopyRuleEngine().evaluate(_draft(landing_page_url=None, objective="conversion"))
    assert any(f.rule_key == "landing_page_missing" and f.severity is FindingSeverity.BLOCKING for f in findings)


def test_landing_page_missing_is_not_raised_without_an_objective():
    findings = CopyRuleEngine().evaluate(_draft(landing_page_url=None, objective=None))
    assert not any(f.rule_key == "landing_page_missing" for f in findings)


def test_excessive_caps_and_symbols_is_a_warning():
    findings = CopyRuleEngine().evaluate(_draft(primary_copy="CHỈ HÔM NAY!!! Mua ngay."))
    hit = [f for f in findings if f.rule_key == "copy_excessive_caps_or_symbols"]
    assert len(hit) == 1
    assert hit[0].severity is FindingSeverity.WARNING


def test_sensitive_category_without_disclaimer_is_flagged():
    findings = CopyRuleEngine().evaluate(
        _draft(primary_copy="Giảm cân nhanh chóng.", description=None)
    )
    assert any(f.rule_key == "copy_missing_disclaimer_for_flagged_category" for f in findings)


def test_sensitive_category_with_disclaimer_is_not_flagged():
    findings = CopyRuleEngine().evaluate(
        _draft(
            primary_copy="Giảm cân nhanh chóng.",
            description="Kết quả có thể khác nhau tùy cơ địa từng người.",
        )
    )
    assert not any(f.rule_key == "copy_missing_disclaimer_for_flagged_category" for f in findings)


def test_budget_change_over_threshold_is_a_warning():
    findings = CopyRuleEngine().evaluate(_draft(budget_change_percent=75))
    assert any(f.rule_key == "budget_change_exceeds_threshold" for f in findings)
    under = CopyRuleEngine().evaluate(_draft(budget_change_percent=20))
    assert not any(f.rule_key == "budget_change_exceeds_threshold" for f in under)


def test_targeting_summary_missing_is_a_warning():
    findings = CopyRuleEngine().evaluate(_draft(targeting_summary=""))
    assert any(f.rule_key == "targeting_summary_missing" for f in findings)


def test_draft_missing_account_link_is_blocking():
    findings = CopyRuleEngine().evaluate(_draft(ad_account_id=None))
    hit = [f for f in findings if f.rule_key == "draft_missing_account_link"]
    assert len(hit) == 1
    assert hit[0].severity is FindingSeverity.BLOCKING


# ---- SSRF protection (preflight_safe_http) -----------------------------------------------


@pytest.mark.parametrize("scheme", ["file", "ftp", "javascript", "data"])
def test_non_http_schemes_are_refused(scheme):
    with pytest.raises(_UnsafeTarget):
        _assert_safe_url(f"{scheme}://example.com/x")


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.1", "169.254.1.1", "::1", "224.0.0.1"],
)
def test_loopback_private_link_local_and_multicast_targets_are_refused(monkeypatch, ip):
    def fake_getaddrinfo(host, port):
        return [(None, None, None, None, (ip, 0))]

    monkeypatch.setattr("app.services.preflight_safe_http.socket.getaddrinfo", fake_getaddrinfo)
    with pytest.raises(_UnsafeTarget):
        _assert_safe_url("https://internal.example.com/")


def test_a_genuinely_public_address_is_accepted(monkeypatch):
    def fake_getaddrinfo(host, port):
        return [(None, None, None, None, ("93.184.216.34", 0))]

    monkeypatch.setattr("app.services.preflight_safe_http.socket.getaddrinfo", fake_getaddrinfo)
    _assert_safe_url("https://example.com/")  # must not raise


def test_dns_resolution_failure_is_refused_not_ignored(monkeypatch):
    def fake_getaddrinfo(host, port):
        raise OSError("no such host")

    monkeypatch.setattr("app.services.preflight_safe_http.socket.getaddrinfo", fake_getaddrinfo)
    with pytest.raises(_UnsafeTarget):
        _assert_safe_url("https://nowhere.invalid/")


# ---- LandingPageCheckService ---------------------------------------------------------------


def _fake_result(**overrides) -> SafeFetchResult:
    defaults = {
        "outcome": FetchOutcome.OK,
        "url": "https://shop.example.com/",
        "final_url": "https://shop.example.com/",
        "http_status": 200,
        "is_https": True,
        "redirect_count": 0,
        "response_time_ms": 200,
        "mobile_viewport_meta_present": True,
        "contact_or_policy_link_detected": True,
        "fetch_error": None,
    }
    defaults.update(overrides)
    return SafeFetchResult(**defaults)


def test_transient_error_produces_no_findings_and_is_flagged_transient(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(outcome=FetchOutcome.TRANSIENT_ERROR, http_status=None, fetch_error="timeout"),
    )
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    assert outcome.is_transient is True
    assert outcome.findings == []


def test_unreachable_is_a_blocking_finding_not_transient(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(outcome=FetchOutcome.UNREACHABLE, http_status=404, fetch_error="http_status_404"),
    )
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    assert outcome.is_transient is False
    assert any(f.rule_key == "landing_page_unreachable" and f.severity is FindingSeverity.BLOCKING for f in outcome.findings)


def test_blocked_unsafe_is_a_blocking_finding(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(
            outcome=FetchOutcome.BLOCKED_UNSAFE, http_status=None, fetch_error="unsafe_address:127.0.0.1"
        ),
    )
    outcome = LandingPageCheckService().check("https://internal.example.com/")
    assert any(f.rule_key == "landing_page_private_target_blocked" for f in outcome.findings)


def test_redirects_over_threshold_is_a_warning_when_the_final_fetch_still_succeeds(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(redirect_count=5),
    )
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    assert any(f.rule_key == "landing_page_excessive_redirects" and f.severity is FindingSeverity.WARNING for f in outcome.findings)


def test_slow_response_over_threshold_is_a_warning(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(response_time_ms=5000),
    )
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    assert any(f.rule_key == "landing_page_slow_response" for f in outcome.findings)


def test_missing_viewport_and_contact_link_each_produce_their_own_warning(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(mobile_viewport_meta_present=False, contact_or_policy_link_detected=False),
    )
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    keys = {f.rule_key for f in outcome.findings}
    assert "landing_page_missing_mobile_viewport" in keys
    assert "landing_page_missing_contact_or_policy_link" in keys


def test_not_https_is_a_warning(monkeypatch):
    monkeypatch.setattr(
        "app.services.preflight_landing_page.safe_fetch",
        lambda url: _fake_result(is_https=False, final_url="http://shop.example.com/"),
    )
    outcome = LandingPageCheckService().check("http://shop.example.com/")
    assert any(f.rule_key == "landing_page_not_https" for f in outcome.findings)


def test_clean_result_produces_no_findings(monkeypatch):
    monkeypatch.setattr("app.services.preflight_landing_page.safe_fetch", lambda url: _fake_result())
    outcome = LandingPageCheckService().check("https://shop.example.com/")
    assert outcome.findings == []
    assert outcome.evidence_fields["http_status"] == 200


# ---- AccountContextRuleAdapter (real A1/A2 rows) -------------------------------------------


def _account(db_session, workspace, **kwargs):
    account = AdAccount(
        workspace_id=workspace.id,
        display_name=kwargs.pop("display_name", "Account"),
        external_account_id=kwargs.pop("external_account_id", "act_1"),
        status=kwargs.pop("status", AccountStatus.ACTIVE),
        **kwargs,
    )
    db_session.add(account)
    db_session.flush()
    return account


def _adapter(db_session, workspace) -> AccountContextRuleAdapter:
    audit = AuditLogService(db_session, workspace.id, None)
    return AccountContextRuleAdapter(db_session, workspace.id, audit)


def test_none_account_produces_no_findings(db_session, workspace):
    assert _adapter(db_session, workspace).evaluate(None) == []


def test_restricted_account_status_is_blocking(db_session, workspace):
    account = _account(db_session, workspace, status=AccountStatus.RESTRICTED)
    findings = _adapter(db_session, workspace).evaluate(account)
    hit = [f for f in findings if f.rule_key == "account_status_restricted_or_disabled"]
    assert len(hit) == 1
    assert hit[0].severity is FindingSeverity.BLOCKING


def test_disabled_account_status_is_blocking(db_session, workspace):
    account = _account(db_session, workspace, status=AccountStatus.DISABLED)
    findings = _adapter(db_session, workspace).evaluate(account)
    assert any(f.rule_key == "account_status_restricted_or_disabled" for f in findings)


def test_fresh_account_with_no_checklist_evidence_is_readiness_unknown(db_session, workspace):
    account = _account(db_session, workspace)
    findings = _adapter(db_session, workspace).evaluate(account)
    assert any(f.rule_key == "account_readiness_unknown" for f in findings)


def test_health_critical_snapshot_is_blocking(db_session, workspace):
    account = _account(db_session, workspace)
    db_session.add(
        AccountHealthSnapshot(
            workspace_id=workspace.id,
            ad_account_id=account.id,
            health_status=HealthStatus.CRITICAL,
            engine_version="test",
            last_evaluated_at=datetime.now(UTC),
        )
    )
    db_session.flush()
    findings = _adapter(db_session, workspace).evaluate(account)
    hit = [f for f in findings if f.rule_key == "account_health_critical"]
    assert len(hit) == 1
    assert hit[0].severity is FindingSeverity.BLOCKING


def test_health_warning_snapshot_is_a_warning_not_blocking(db_session, workspace):
    account = _account(db_session, workspace)
    db_session.add(
        AccountHealthSnapshot(
            workspace_id=workspace.id,
            ad_account_id=account.id,
            health_status=HealthStatus.WARNING,
            engine_version="test",
            last_evaluated_at=datetime.now(UTC),
        )
    )
    db_session.flush()
    findings = _adapter(db_session, workspace).evaluate(account)
    hit = [f for f in findings if f.rule_key == "account_health_warning"]
    assert len(hit) == 1
    assert hit[0].severity is FindingSeverity.WARNING
