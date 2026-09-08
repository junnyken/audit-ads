"""A5 unit tests: id canonicalisation, URL sanitisation and context resolution.

The rule under test throughout: exact match or admit you do not know. There is no similarity
path in the code, and these tests exist to keep it that way.
"""
from __future__ import annotations

import uuid

from app.core.enums import ExtensionContextStatus, ExtensionPageType
from app.services.extension_context import (
    ExtensionContextResolver,
    canonical_external_id,
    sanitise_path,
)
from app.services.extension_events import CONTEXT_ALLOWLIST, build_source_context

# ---- canonicalisation --------------------------------------------------------------------


def test_the_same_account_written_three_ways_canonicalises_to_one_value():
    assert canonical_external_id("act_123456789") == "123456789"
    assert canonical_external_id("ACT-123456789") == "123456789"
    assert canonical_external_id("  123456789  ") == "123456789"


def test_canonicalisation_never_makes_two_different_accounts_equal():
    assert canonical_external_id("act_123") != canonical_external_id("act_1234")
    assert canonical_external_id("act_000123") != canonical_external_id("act_123")


def test_unusable_values_canonicalise_to_nothing_rather_than_a_guess():
    for value in (None, "", "   ", "act_", "!!!", "a b c", "x" * 200):
        assert canonical_external_id(value) is None, value


# ---- path sanitisation --------------------------------------------------------------------


def test_a_query_string_never_survives_sanitisation():
    path, page_type = sanitise_path(
        "https://adsmanager.facebook.com/adsmanager/manage/campaigns"
        "?act=123&access_token=SECRET&session_id=abc#fragment"
    )
    assert path == "/adsmanager/manage/campaigns"
    assert page_type is ExtensionPageType.CAMPAIGN
    for leak in ("SECRET", "access_token", "session_id", "?", "#"):
        assert leak not in path


def test_each_allowlisted_route_maps_to_its_page_type():
    assert sanitise_path("/adsmanager/manage/campaigns")[1] is ExtensionPageType.CAMPAIGN
    assert sanitise_path("/adsmanager/manage/adsets")[1] is ExtensionPageType.ADSET
    assert sanitise_path("/adsmanager/manage/ads")[1] is ExtensionPageType.AD
    assert sanitise_path("/billing_hub/accounts")[1] is ExtensionPageType.BILLING
    assert sanitise_path("/settings")[1] is ExtensionPageType.SETTINGS


def test_billing_hub_under_adsmanager_prefix_is_recognised():
    """Real UAT (2026-09-08): Meta serves this at /adsmanager/billing_hub/..., not the bare
    /billing_hub/... path the original allowlist assumed, and adds a /details segment on the
    per-account view."""
    assert sanitise_path("/adsmanager/billing_hub/accounts")[1] is ExtensionPageType.BILLING
    assert (
        sanitise_path("/adsmanager/billing_hub/accounts/details")[1]
        is ExtensionPageType.BILLING
    )
    assert (
        sanitise_path("/adsmanager/billing_hub/payment_activity")[1]
        is ExtensionPageType.BILLING
    )


def test_an_unrecognised_route_is_discarded_not_stored():
    for raw in (
        "/messages/t/123",
        "/profile.php",
        "https://www.facebook.com/",
        "/adsmanager/manage/campaigns/../../etc/passwd",
        "/" + "x" * 300,
        "not a path",
        None,
    ):
        path, page_type = sanitise_path(raw)
        assert path is None, raw
        assert page_type is ExtensionPageType.UNKNOWN


# ---- resolution ----------------------------------------------------------------------------


def _resolver(db_session, workspace) -> ExtensionContextResolver:
    return ExtensionContextResolver(db_session, workspace.id)


def _account(db_session, workspace, external_id: str | None, **kwargs):
    from app.core.enums import AccountStatus
    from app.models.entities import AdAccount

    account = AdAccount(
        workspace_id=workspace.id,
        display_name=kwargs.pop("display_name", "Account"),
        external_account_id=external_id,
        status=AccountStatus.ACTIVE,
        **kwargs,
    )
    db_session.add(account)
    db_session.flush()
    return account


def test_an_exact_id_confirms_the_account(db_session, workspace):
    account = _account(db_session, workspace, "act_123456789", display_name="BM USA - 03")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456789", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.CONFIRMED
    assert result.account.id == account.id
    assert result.page_type is ExtensionPageType.CAMPAIGN


def test_the_registry_prefix_and_the_page_form_match_each_other(db_session, workspace):
    _account(db_session, workspace, "123456789")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="act_123456789", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.CONFIRMED


def test_an_unregistered_id_is_unknown_not_a_near_match(db_session, workspace):
    _account(db_session, workspace, "act_123456789", display_name="BM USA - 03")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456780", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.UNKNOWN
    assert result.reason_code == "account_not_registered"
    assert result.account is None


def test_a_matching_name_never_resolves_an_account(db_session, workspace):
    """The killer case: same name, different id. It must not confirm."""
    _account(db_session, workspace, "act_111111111", display_name="BM USA - Account 03")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="999999999", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.UNKNOWN
    assert result.account is None


def test_a_page_without_an_account_id_is_ambiguous(db_session, workspace):
    _account(db_session, workspace, "act_123456789")
    result = _resolver(db_session, workspace).resolve(
        external_account_id=None, raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.AMBIGUOUS
    assert result.reason_code == "no_account_id_on_page"


def test_two_registry_rows_with_the_same_id_are_ambiguous_not_a_coin_flip(db_session, workspace):
    _account(db_session, workspace, "act_123456789", display_name="First")
    _account(db_session, workspace, "123456789", display_name="Second")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456789", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.AMBIGUOUS
    assert result.reason_code == "multiple_registered_matches"
    assert result.candidate_count == 2
    assert result.account is None


def test_an_archived_account_is_reported_as_archived_not_as_unregistered(db_session, workspace):
    from datetime import UTC, datetime

    account = _account(db_session, workspace, "act_123456789")
    account.archived_at = datetime.now(UTC)
    db_session.flush()
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456789", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.AMBIGUOUS
    assert result.reason_code == "account_archived"


def test_an_unsupported_page_is_reported_before_any_account_lookup(db_session, workspace):
    _account(db_session, workspace, "act_123456789")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456789", raw_path="/messages/t/1"
    )
    assert result.status is ExtensionContextStatus.UNSUPPORTED_PAGE
    assert result.account is None


def test_an_account_in_another_workspace_is_never_matched(db_session, workspace, other_owner):
    _account(db_session, other_owner["workspace"], "act_123456789")
    result = _resolver(db_session, workspace).resolve(
        external_account_id="123456789", raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.UNKNOWN


# ---- source context allowlist -----------------------------------------------------------


def test_source_context_keeps_only_the_allowlisted_keys():
    context = build_source_context(
        page_type=ExtensionPageType.CAMPAIGN,
        context_status=ExtensionContextStatus.CONFIRMED,
        raw_path="/adsmanager/manage/campaigns?act=1&access_token=SECRET",
        extension_version="0.1.0",
        external_account_id="act_123456789",
    )
    assert set(context) <= CONTEXT_ALLOWLIST
    assert context["safe_path"] == "/adsmanager/manage/campaigns"
    assert "SECRET" not in str(context)
    assert "access_token" not in str(context)


def test_source_context_discards_an_unrecognised_path_entirely():
    context = build_source_context(
        page_type=None,
        context_status=ExtensionContextStatus.UNKNOWN,
        raw_path="https://www.facebook.com/messages/t/1?x=y",
        extension_version="0.1.0",
        external_account_id=None,
    )
    assert context["safe_path"] is None
    assert context["page_type"] == "unknown"


def test_source_context_truncates_a_long_version_rather_than_storing_it():
    context = build_source_context(
        page_type=ExtensionPageType.AD,
        context_status=ExtensionContextStatus.CONFIRMED,
        raw_path="/adsmanager/manage/ads",
        extension_version="9" * 200,
        external_account_id="1",
    )
    assert len(context["extension_version"]) <= 32


def test_a_resolution_never_carries_a_uuid_it_was_not_asked_for(db_session, workspace):
    result = _resolver(db_session, workspace).resolve(
        external_account_id=str(uuid.uuid4()), raw_path="/adsmanager/manage/campaigns"
    )
    assert result.status is ExtensionContextStatus.UNKNOWN
