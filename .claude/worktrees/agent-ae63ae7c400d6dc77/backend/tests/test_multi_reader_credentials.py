"""One reader credential per Business Manager.

A system-user token is scoped to the business that owns it. Reading a second Business Manager
needs that business's own credential — measured 2026-09-11, and partner sharing does not change
it, because discovery reads the Business Manager node itself.

Nothing here may weaken rule 1: the value lives in server configuration and reaches nothing else.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings, get_settings
from app.core.production_checks import check_settings
from app.services.meta_real_provider import (
    READER_BUSINESS_SPECIFIC,
    READER_NONE,
    READER_SERVER_DEFAULT,
    build_real_provider,
    resolve_reader,
)

BM_ONE = "1993884657458857"
BM_TWO = "109796697343603"


def settings_with(**overrides) -> Settings:
    base = {
        "database_url": "postgresql+psycopg://u:p@db/x",
        "jwt_secret": "x" * 40,
        "meta_access_token": "default-token",
        "meta_business_id": BM_ONE,
    }
    base.update(overrides)
    return Settings(**base)


# ------------------------------------------------------------------------- resolution


def test_a_business_with_its_own_credential_uses_it():
    settings = settings_with(meta_access_tokens_by_business={BM_TWO: "second-business-token"})

    token, source = resolve_reader(settings, BM_TWO)

    assert token == "second-business-token"
    assert source == READER_BUSINESS_SPECIFIC


def test_a_business_without_one_falls_back_to_the_server_token():
    """Deliberate, and the reason is written down: a system user can legitimately hold assets
    across businesses, so refusing to try would remove access that works today."""
    settings = settings_with(meta_access_tokens_by_business={BM_TWO: "second-business-token"})

    token, source = resolve_reader(settings, BM_ONE)

    assert token == "default-token"
    assert source == READER_SERVER_DEFAULT


def test_its_own_credential_is_never_passed_over_for_the_default():
    settings = settings_with(
        meta_access_token="default-token",
        meta_access_tokens_by_business={BM_ONE: "first-business-token"},
    )

    token, source = resolve_reader(settings, BM_ONE)

    assert token == "first-business-token"
    assert source == READER_BUSINESS_SPECIFIC


def test_an_empty_mapped_value_does_not_count_as_configured():
    """An empty string would otherwise read as "configured" and quietly authenticate as nobody."""
    settings = settings_with(meta_access_tokens_by_business={BM_TWO: "   "})

    _, source = resolve_reader(settings, BM_TWO)

    assert source == READER_SERVER_DEFAULT


def test_no_credential_anywhere_is_none_not_an_empty_token():
    settings = settings_with(meta_access_token="", meta_access_tokens_by_business={})

    token, source = resolve_reader(settings, BM_TWO)

    assert token == ""
    assert source == READER_NONE


def test_the_provider_is_built_with_the_business_s_own_credential():
    settings = settings_with(meta_access_tokens_by_business={BM_TWO: "second-business-token"})

    provider = build_real_provider(settings, business_id=BM_TWO)

    assert provider.transport.access_token == "second-business-token"
    assert provider.business_id == BM_TWO


def test_configuring_nothing_leaves_every_existing_caller_unchanged():
    """The whole design is additive: with no mapping configured, behaviour is what it was."""
    settings = settings_with()

    provider = build_real_provider(settings)

    assert provider.transport.access_token == "default-token"
    assert provider.business_id == BM_ONE


# ----------------------------------------------------------------- configuration checks


def test_an_empty_mapped_credential_is_a_configuration_error():
    findings = check_settings(settings_with(meta_access_tokens_by_business={BM_TWO: ""}))

    codes = {f.code for f in findings}
    assert "meta_reader_token_empty" in codes


def test_a_placeholder_credential_is_refused_like_every_other_placeholder():
    findings = check_settings(
        settings_with(meta_access_tokens_by_business={BM_TWO: "pilot-local-password"})
    )

    assert "meta_reader_token_placeholder" in {f.code for f in findings}


def test_an_entry_with_no_business_id_is_a_configuration_error():
    findings = check_settings(settings_with(meta_access_tokens_by_business={"": "a-token"}))

    assert "meta_reader_business_id_empty" in {f.code for f in findings}


def test_a_finding_names_the_business_but_never_the_credential():
    """Rule 26. The Business Manager id is public; the value beside it is not."""
    findings = check_settings(
        settings_with(meta_access_tokens_by_business={BM_TWO: "pilot-local-password"})
    )

    for finding in findings:
        assert "pilot-local-password" not in finding.message
    reader = next(f for f in findings if f.code == "meta_reader_token_placeholder")
    assert BM_TWO in reader.message


# --------------------------------------------------------------------------- the API


@pytest.fixture()
def configured_readers():
    settings = get_settings()
    previous_map = settings.meta_access_tokens_by_business
    previous_bm = settings.meta_business_id
    previous_token = settings.meta_access_token
    settings.meta_access_tokens_by_business = {BM_TWO: "second-business-token"}
    settings.meta_business_id = BM_ONE
    settings.meta_access_token = "default-token"
    yield settings
    settings.meta_access_tokens_by_business = previous_map
    settings.meta_business_id = previous_bm
    settings.meta_access_token = previous_token


def test_a_connection_says_which_reader_answers_for_it(api, configured_readers):
    own = api.post(
        "/api/v1/meta-connections",
        json={"label": "Second business", "environment": "production", "business_manager_reference": BM_TWO},
    ).json()
    inherited = api.post(
        "/api/v1/meta-connections",
        json={"label": "First business", "environment": "production"},
    ).json()

    assert own["reader_source"] == "business_specific"
    assert inherited["reader_source"] == "server_default"
    assert own["token_configured"] is True


def test_a_business_manager_with_no_reader_at_all_reports_it(api, configured_readers):
    configured_readers.meta_access_token = ""

    connection = api.post(
        "/api/v1/meta-connections",
        json={"label": "Unreachable", "environment": "production", "business_manager_reference": "999999999"},
    ).json()

    assert connection["reader_source"] == "none"
    # Evidence-first: no credential is not "configured but failing", and never a silent success.
    assert connection["token_configured"] is False


def test_a_fake_connection_is_never_described_as_using_a_real_reader(api, configured_readers):
    connection = api.post(
        "/api/v1/meta-connections", json={"label": "Local", "environment": "fake"}
    ).json()

    assert connection["reader_source"] == "fake"


def test_no_response_ever_carries_a_reader_credential(api, configured_readers):
    api.post(
        "/api/v1/meta-connections",
        json={"label": "Second business", "environment": "production", "business_manager_reference": BM_TWO},
    )

    raw = api.get("/api/v1/meta-connections").text

    assert "second-business-token" not in raw
    assert "default-token" not in raw
    assert "meta_access_tokens_by_business" not in raw


def test_a_reader_credential_cannot_be_sent_in_a_request_body(api):
    """StrictPayload refuses a field by *name*. This is the guard that makes rule 1 structural."""
    response = api.post(
        "/api/v1/meta-connections",
        json={"label": "Sneaky", "environment": "production", "access_token": "EAAG-whatever"},
    )

    assert response.status_code == 422
