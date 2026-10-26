"""S2 — the account_status / disable_reason allowlist. Pure: no database, no clock, no provider.

Pins the three degradations of `platform_status.py`: missing is `None`, present-but-unlisted is
`unknown`, and nothing but `"1"` ever becomes `active` (rule 4).
"""
from __future__ import annotations

import ast
import inspect

import pytest

from app.services import platform_status as ps
from app.services.platform_status import (
    BLOCKING,
    PENDING,
    PlatformAccountStatus,
    PlatformDisableReason,
    interpret_account_status,
    interpret_disable_reason,
    status_class,
)

OFFICIAL = {
    "1": PlatformAccountStatus.ACTIVE,
    "2": PlatformAccountStatus.DISABLED,
    "3": PlatformAccountStatus.UNSETTLED,
    "7": PlatformAccountStatus.PENDING_RISK_REVIEW,
    "8": PlatformAccountStatus.PENDING_SETTLEMENT,
    "9": PlatformAccountStatus.IN_GRACE_PERIOD,
    "100": PlatformAccountStatus.PENDING_CLOSURE,
    "101": PlatformAccountStatus.CLOSED,
}


@pytest.mark.parametrize("raw, expected", sorted(OFFICIAL.items()))
def test_every_documented_code_maps_to_its_own_state(raw, expected):
    assert interpret_account_status(raw) is expected


@pytest.mark.parametrize(
    "raw",
    ["201", "202", "0", "4", "5", "6", "10", "42", "99", "102", "999999", "abc", "", "   ", "-1",
     "+1", "1.0", "01", "001", "1e0", "١", "1 1", "9" * 7, "x" * 32, "ACTIVE", "true"],
)
def test_any_other_present_value_is_unknown(raw):
    assert interpret_account_status(raw) is PlatformAccountStatus.UNKNOWN


def test_missing_is_none_not_unknown():
    assert interpret_account_status(None) is None
    assert interpret_disable_reason(None) is None


def test_surrounding_whitespace_is_stripped():
    assert interpret_account_status(" 2 ") is PlatformAccountStatus.DISABLED


def test_nothing_but_one_becomes_active():
    candidates = [str(n) for n in range(0, 1000)] + ["", "201", "202", "abc", "01", "+1", "1.0"]
    active = [raw for raw in candidates if interpret_account_status(raw) is PlatformAccountStatus.ACTIVE]
    assert active == ["1"]


def test_201_and_202_are_filter_values_not_states():
    assert 201 not in ps.ACCOUNT_STATUS_CODES and 202 not in ps.ACCOUNT_STATUS_CODES


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("0", PlatformDisableReason.NONE),
        ("1", PlatformDisableReason.ADS_INTEGRITY_POLICY),
        ("2", PlatformDisableReason.ADS_IP_REVIEW),
        ("3", PlatformDisableReason.RISK_PAYMENT),
        ("4", PlatformDisableReason.GRAY_ACCOUNT_SHUT_DOWN),
        ("5", PlatformDisableReason.ADS_AFC_REVIEW),
        ("6", PlatformDisableReason.BUSINESS_INTEGRITY_RAR),
        ("7", PlatformDisableReason.PERMANENT_CLOSE),
        ("8", PlatformDisableReason.UNUSED_RESELLER_ACCOUNT),
        ("9", PlatformDisableReason.UNUSED_ACCOUNT),
        ("10", PlatformDisableReason.UMBRELLA_AD_ACCOUNT),
        ("11", PlatformDisableReason.BUSINESS_MANAGER_INTEGRITY_POLICY),
        ("12", PlatformDisableReason.MISREPRESENTED_AD_ACCOUNT),
        ("13", PlatformDisableReason.AOAB_DESHARE_LEGAL_ENTITY),
        ("14", PlatformDisableReason.CTX_THREAD_REVIEW),
        ("15", PlatformDisableReason.COMPROMISED_AD_ACCOUNT),
    ],
)
def test_all_sixteen_disable_reasons(raw, expected):
    assert interpret_disable_reason(raw) is expected


@pytest.mark.parametrize("raw", ["16", "99", "abc", "", "-3", "03"])
def test_unlisted_disable_reason_is_unknown(raw):
    assert interpret_disable_reason(raw) is PlatformDisableReason.UNKNOWN


def test_blocking_and_pending_partition_the_non_active_states():
    assert {
        PlatformAccountStatus.DISABLED,
        PlatformAccountStatus.CLOSED,
        PlatformAccountStatus.PENDING_CLOSURE,  # §7: critical, decided 2026-10-27
    } == BLOCKING
    assert {
        PlatformAccountStatus.UNSETTLED,
        PlatformAccountStatus.PENDING_SETTLEMENT,
        PlatformAccountStatus.IN_GRACE_PERIOD,
        PlatformAccountStatus.PENDING_RISK_REVIEW,
    } == PENDING
    assert not (BLOCKING & PENDING)
    assert PlatformAccountStatus.ACTIVE not in BLOCKING | PENDING
    assert PlatformAccountStatus.UNKNOWN not in BLOCKING | PENDING


def test_status_class_is_categorical():
    assert status_class(None) == "none"
    assert status_class(PlatformAccountStatus.UNKNOWN) == "unknown"
    assert status_class(PlatformAccountStatus.ACTIVE) == "active"
    assert status_class(PlatformAccountStatus.CLOSED) == "blocking"
    assert status_class(PlatformAccountStatus.IN_GRACE_PERIOD) == "pending"


def test_the_module_reads_no_clock_and_no_database():
    tree = ast.parse(inspect.getsource(ps))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
    assert imported <= {"__future__", "enum"}, imported
    source = inspect.getsource(ps)
    assert "datetime" not in source and "now(" not in source


def test_no_label_or_disclaimer_claims_safety():
    texts = list(ps.ACCOUNT_STATUS_LABEL.values()) + [ps.PLATFORM_STATUS_DISCLAIMER]
    for text in texts:
        lowered = text.lower()
        for banned in ("safe", "normal", "an toàn", "bình thường", "cannot be restricted", "sẽ được mở"):
            assert banned not in lowered, text
