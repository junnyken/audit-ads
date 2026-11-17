"""S2 — what Meta's `account_status` / `disable_reason` codes mean here. Pure: no database, no clock.

Spend reads (S1) already ask the ad account node for both fields and store them raw on every
observation, failed ones included (`ad_account_spend_observations.observed_account_status` /
`observed_disable_reason`). This module is the one place that turns those raw strings into a
vocabulary — through an **allowlist** copied from Meta's Marketing API reference
(`/docs/marketing-api/reference/ad-account/`, read 2026-10-27).

Three degradations are deliberate and pinned by tests (rule 4):

* a missing code (`None`) is `None` — "not observed", which is not the same as `unknown`;
* a code that is present but not on the allowlist — `201`/`202` (filter values, not node states),
  any other number, anything that is not digits, anything absurdly long — is `unknown`;
* nothing but the code `"1"` (surrounding whitespace stripped) ever becomes `active`.

`disable_reason` is explanatory only. Its names are Meta's; their meaning is not documented by
Meta and is not verified here, so it never changes a severity.

These enums are not database columns. They are derived when read.
"""
from __future__ import annotations

from enum import StrEnum


class PlatformAccountStatus(StrEnum):
    """Meta's `account_status`, as this product names it. Platform-neutral on purpose."""

    ACTIVE = "active"
    DISABLED = "disabled"
    UNSETTLED = "unsettled"
    PENDING_RISK_REVIEW = "pending_risk_review"
    PENDING_SETTLEMENT = "pending_settlement"
    IN_GRACE_PERIOD = "in_grace_period"
    PENDING_CLOSURE = "pending_closure"
    CLOSED = "closed"
    #: A code was returned, but it is not one this product recognises. Never a good state.
    UNKNOWN = "unknown"


class PlatformDisableReason(StrEnum):
    NONE = "none"
    ADS_INTEGRITY_POLICY = "ads_integrity_policy"
    ADS_IP_REVIEW = "ads_ip_review"
    RISK_PAYMENT = "risk_payment"
    GRAY_ACCOUNT_SHUT_DOWN = "gray_account_shut_down"
    ADS_AFC_REVIEW = "ads_afc_review"
    BUSINESS_INTEGRITY_RAR = "business_integrity_rar"
    PERMANENT_CLOSE = "permanent_close"
    UNUSED_RESELLER_ACCOUNT = "unused_reseller_account"
    UNUSED_ACCOUNT = "unused_account"
    UMBRELLA_AD_ACCOUNT = "umbrella_ad_account"
    BUSINESS_MANAGER_INTEGRITY_POLICY = "business_manager_integrity_policy"
    MISREPRESENTED_AD_ACCOUNT = "misrepresented_ad_account"
    AOAB_DESHARE_LEGAL_ENTITY = "aoab_deshare_legal_entity"
    CTX_THREAD_REVIEW = "ctx_thread_review"
    COMPROMISED_AD_ACCOUNT = "compromised_ad_account"
    UNKNOWN = "unknown"


#: The allowlist. `201 ANY_ACTIVE` / `202 ANY_CLOSED` are deliberately absent: they read as filter
#: values for listing, not as the state of one node, so they fall through to `unknown`.
ACCOUNT_STATUS_CODES: dict[int, PlatformAccountStatus] = {
    1: PlatformAccountStatus.ACTIVE,
    2: PlatformAccountStatus.DISABLED,
    3: PlatformAccountStatus.UNSETTLED,
    7: PlatformAccountStatus.PENDING_RISK_REVIEW,
    8: PlatformAccountStatus.PENDING_SETTLEMENT,
    9: PlatformAccountStatus.IN_GRACE_PERIOD,
    100: PlatformAccountStatus.PENDING_CLOSURE,
    101: PlatformAccountStatus.CLOSED,
}

DISABLE_REASON_CODES: dict[int, PlatformDisableReason] = {
    0: PlatformDisableReason.NONE,
    1: PlatformDisableReason.ADS_INTEGRITY_POLICY,
    2: PlatformDisableReason.ADS_IP_REVIEW,
    3: PlatformDisableReason.RISK_PAYMENT,
    4: PlatformDisableReason.GRAY_ACCOUNT_SHUT_DOWN,
    5: PlatformDisableReason.ADS_AFC_REVIEW,
    6: PlatformDisableReason.BUSINESS_INTEGRITY_RAR,
    7: PlatformDisableReason.PERMANENT_CLOSE,
    8: PlatformDisableReason.UNUSED_RESELLER_ACCOUNT,
    9: PlatformDisableReason.UNUSED_ACCOUNT,
    10: PlatformDisableReason.UMBRELLA_AD_ACCOUNT,
    11: PlatformDisableReason.BUSINESS_MANAGER_INTEGRITY_POLICY,
    12: PlatformDisableReason.MISREPRESENTED_AD_ACCOUNT,
    13: PlatformDisableReason.AOAB_DESHARE_LEGAL_ENTITY,
    14: PlatformDisableReason.CTX_THREAD_REVIEW,
    15: PlatformDisableReason.COMPROMISED_AD_ACCOUNT,
}

#: Meta says the account cannot run. Critical (decided 2026-10-27, §7: `pending_closure` included).
BLOCKING: frozenset[PlatformAccountStatus] = frozenset(
    {
        PlatformAccountStatus.DISABLED,
        PlatformAccountStatus.CLOSED,
        PlatformAccountStatus.PENDING_CLOSURE,
    }
)
#: Meta says a payment or review is outstanding. Warning.
PENDING: frozenset[PlatformAccountStatus] = frozenset(
    {
        PlatformAccountStatus.UNSETTLED,
        PlatformAccountStatus.PENDING_SETTLEMENT,
        PlatformAccountStatus.IN_GRACE_PERIOD,
        PlatformAccountStatus.PENDING_RISK_REVIEW,
    }
)

#: Longer than any code Meta documents by a wide margin. The stored column is 16 characters.
_MAX_CODE_LENGTH = 6

#: Meta's own constant names, shown next to every label so an operator can look them up.
ACCOUNT_STATUS_META_NAME: dict[PlatformAccountStatus, str] = {
    PlatformAccountStatus.ACTIVE: "ACTIVE",
    PlatformAccountStatus.DISABLED: "DISABLED",
    PlatformAccountStatus.UNSETTLED: "UNSETTLED",
    PlatformAccountStatus.PENDING_RISK_REVIEW: "PENDING_RISK_REVIEW",
    PlatformAccountStatus.PENDING_SETTLEMENT: "PENDING_SETTLEMENT",
    PlatformAccountStatus.IN_GRACE_PERIOD: "IN_GRACE_PERIOD",
    PlatformAccountStatus.PENDING_CLOSURE: "PENDING_CLOSURE",
    PlatformAccountStatus.CLOSED: "CLOSED",
}

#: Short English labels for evidence messages and Telegram (proposed wording, BA review — S2 §4b).
ACCOUNT_STATUS_LABEL: dict[PlatformAccountStatus, str] = {
    PlatformAccountStatus.ACTIVE: "Active (Meta)",
    PlatformAccountStatus.DISABLED: "Disabled (Meta)",
    PlatformAccountStatus.UNSETTLED: "Unsettled balance (Meta)",
    PlatformAccountStatus.PENDING_RISK_REVIEW: "Pending risk review (Meta)",
    PlatformAccountStatus.PENDING_SETTLEMENT: "Pending settlement (Meta)",
    PlatformAccountStatus.IN_GRACE_PERIOD: "In grace period (Meta)",
    PlatformAccountStatus.PENDING_CLOSURE: "Pending closure (Meta)",
    PlatformAccountStatus.CLOSED: "Closed (Meta)",
    PlatformAccountStatus.UNKNOWN: "Unrecognised status code",
}

#: Fixed. Shown with every platform status this product displays (proposed wording, BA review).
PLATFORM_STATUS_DISCLAIMER = (
    "Trạng thái là mã Meta trả về cho reader đã nêu, tại thời điểm quan sát. Không phải quyết định "
    "của sản phẩm này, không bảo đảm tài khoản sẽ không bị hạn chế, và không thay cho việc kiểm tra "
    "trong Ads Manager."
)


def _code(raw: str | None) -> int | None | str:
    """`None` for missing, the integer for a well-formed code, `""` for anything malformed."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or len(text) > _MAX_CODE_LENGTH or not text.isascii() or not text.isdigit():
        return ""
    if len(text) > 1 and text.startswith("0"):
        # "01" is not a code Meta sends. Treating it as 1 would be a guess, and a guess must never
        # be the road to `active`.
        return ""
    return int(text)


def interpret_account_status(raw: str | None) -> PlatformAccountStatus | None:
    """Meta's raw `account_status` as this product's vocabulary.

    `None` in, `None` out ("not observed"). Anything present but off the allowlist is `unknown`.
    """
    code = _code(raw)
    if code is None:
        return None
    if code == "":
        return PlatformAccountStatus.UNKNOWN
    return ACCOUNT_STATUS_CODES.get(code, PlatformAccountStatus.UNKNOWN)  # type: ignore[arg-type]


def interpret_disable_reason(raw: str | None) -> PlatformDisableReason | None:
    code = _code(raw)
    if code is None:
        return None
    if code == "":
        return PlatformDisableReason.UNKNOWN
    return DISABLE_REASON_CODES.get(code, PlatformDisableReason.UNKNOWN)  # type: ignore[arg-type]


def status_class(status: PlatformAccountStatus | None) -> str:
    """The count bucket for a status: `active`, `blocking`, `pending`, `unknown` or `none`.

    Categorical, never a score (rule 9).
    """
    if status is None:
        return "none"
    if status in BLOCKING:
        return "blocking"
    if status in PENDING:
        return "pending"
    if status == PlatformAccountStatus.ACTIVE:
        return "active"
    return "unknown"


def status_label(status: PlatformAccountStatus | None) -> str:
    if status is None:
        return "Status not observed"
    return ACCOUNT_STATUS_LABEL[status]


def disable_reason_text(reason: PlatformDisableReason | None, raw: str | None) -> str:
    """Meta's constant name with the raw code, or a plain "not returned" / "unrecognised"."""
    if reason is None:
        return "not returned"
    if reason == PlatformDisableReason.UNKNOWN:
        return f"unrecognised code {str(raw or '').strip()[:16]}"
    return f"{reason.value.upper()} ({str(raw).strip()})"
