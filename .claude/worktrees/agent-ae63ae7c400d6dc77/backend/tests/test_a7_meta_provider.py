"""Unit tests for `FakeMetaBusinessProvider` — the required pilot scenarios from mini-spec A7
§"Meta API chưa sẵn sàng vẫn build được", at the provider level."""
from __future__ import annotations

from app.services.meta_provider import (
    CapabilityCheck,
    CreateAccountRequest,
    CreateAccountResult,
    FakeMetaBusinessProvider,
    MetaFailureCode,
    ShareAccessRequest,
    ShareAccessResult,
)


def _create_request(key: str = "key-1") -> CreateAccountRequest:
    return CreateAccountRequest(
        business_manager_external_id="bm_1",
        name="New account",
        currency="VND",
        country="VN",
        timezone="Asia/Ho_Chi_Minh",
        idempotency_key=key,
    )


def _share_request(key: str = "key-1") -> ShareAccessRequest:
    return ShareAccessRequest(
        source_external_account_id="act_1",
        recipient_reference="system_user:123",
        role="advertiser",
        idempotency_key=key,
    )


def test_capability_defaults_to_fully_available():
    provider = FakeMetaBusinessProvider()
    check = provider.check_capability()
    assert check.list_business_managers is True
    assert check.create_ad_account is True
    assert check.share_ad_account_access is True


def test_capability_can_be_staged_unavailable():
    provider = FakeMetaBusinessProvider(
        capability=CapabilityCheck(
            list_business_managers=True,
            create_ad_account=False,
            share_ad_account_access=False,
            reason=MetaFailureCode.PERMISSION_MISSING,
        )
    )
    check = provider.check_capability()
    assert check.create_ad_account is False
    assert check.reason == MetaFailureCode.PERMISSION_MISSING


def test_create_succeeds_by_default_and_returns_an_account_id():
    provider = FakeMetaBusinessProvider()
    result = provider.create_ad_account(_create_request())
    assert result.status == "succeeded"
    assert result.external_account_id is not None
    assert provider.created == [_create_request()]


def test_create_permission_missing_is_not_retryable():
    provider = FakeMetaBusinessProvider()
    provider.queue_create_result(
        CreateAccountResult(status="failed", failure_code=MetaFailureCode.PERMISSION_MISSING)
    )
    result = provider.create_ad_account(_create_request())
    assert result.status == "failed"
    assert result.retryable is False


def test_create_billing_required_is_not_retryable():
    provider = FakeMetaBusinessProvider()
    provider.queue_create_result(
        CreateAccountResult(status="failed", failure_code=MetaFailureCode.BILLING_REQUIRED)
    )
    result = provider.create_ad_account(_create_request())
    assert result.retryable is False


def test_create_rate_limited_is_retryable_and_a_second_attempt_can_succeed():
    provider = FakeMetaBusinessProvider()
    provider.queue_create_result(
        CreateAccountResult(status="failed", failure_code=MetaFailureCode.RATE_LIMITED)
    )
    first = provider.create_ad_account(_create_request("attempt-1"))
    assert first.retryable is True
    second = provider.create_ad_account(_create_request("attempt-2"))
    assert second.status == "succeeded"


def test_create_timeout_is_unknown_status_and_not_retryable():
    """A timeout during create is ambiguous — Meta may have created the account server-side.
    Mini-spec A7: status becomes `unknown`, never auto-retried, reconciliation handles it."""
    provider = FakeMetaBusinessProvider()
    provider.queue_create_result(
        CreateAccountResult(status="unknown", failure_code=MetaFailureCode.TIMEOUT)
    )
    result = provider.create_ad_account(_create_request())
    assert result.status == "unknown"
    assert result.retryable is False


def test_create_idempotency_key_replay_returns_the_same_result_not_a_new_account():
    provider = FakeMetaBusinessProvider()
    first = provider.create_ad_account(_create_request("same-key"))
    second = provider.create_ad_account(_create_request("same-key"))
    assert first == second
    assert len(provider.created) == 1  # not called twice against the "real" provider


def test_share_succeeds_by_default_and_returns_a_grant_reference():
    provider = FakeMetaBusinessProvider()
    result = provider.share_ad_account_access(_share_request())
    assert result.status == "succeeded"
    assert result.access_grant_reference is not None


def test_share_unsupported_role_is_not_retryable():
    provider = FakeMetaBusinessProvider()
    provider.queue_share_result(
        ShareAccessResult(status="failed", failure_code=MetaFailureCode.UNSUPPORTED_ROLE)
    )
    result = provider.share_ad_account_access(_share_request())
    assert result.status == "failed"
    assert result.retryable is False


def test_share_idempotency_key_replay_returns_the_same_result():
    provider = FakeMetaBusinessProvider()
    first = provider.share_ad_account_access(_share_request("same-key"))
    second = provider.share_ad_account_access(_share_request("same-key"))
    assert first == second
    assert len(provider.shared) == 1
