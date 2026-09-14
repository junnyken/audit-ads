"""The live-verification scripts must not carry a credential, and must not run without one.

Written after measuring, on 2026-09-14, that `a6`, `a7_a8` and `a9_live_verify.py` each hard-coded
an email and password for an account that no longer existed in the development database. Those
scripts had been unrunnable for an unknown length of time and nobody knew, because nobody had run
them. A committed credential is two defects at once: a secret in the wrong place, and a fact that
stops being true without telling anyone.

These tests are the thing that keeps the second one from coming back.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
LIB = SCRIPTS_DIR / "lib"

sys.path.insert(0, str(SCRIPTS_DIR))

from lib.live_auth import (  # noqa: E402
    EMAIL_VAR,
    EXIT_NOT_CONFIGURED,
    MISSING_MESSAGE,
    PASSWORD_VAR,
    LiveCredentials,
    read_credentials,
    require_credentials,
)

#: Every script that signs in to the dashboard. `a10_live_probe.py` is deliberately absent: it
#: makes one read-only Meta call and has no dashboard login at all — it asks for the Meta token at
#: a hidden prompt. Migrating it to a dashboard credential would be attaching the wrong model to
#: it, not fixing anything.
#: The credential these scripts used to carry, named by prefix only. Asserting against the whole
#: value would mean committing it here — which is the very thing this file exists to forbid.
STALE_EMAIL_PREFIX = "trieunt"
STALE_PASSWORD_PREFIX = "dev-password"

BROWSER_SCRIPTS = (
    "a6_live_verify.py",
    "a7_a8_live_verify.py",
    "a9_live_verify.py",
    "o2_1_live_verify.py",
)


# ------------------------------------------------------------------ the helper's own behaviour


def test_a_fully_configured_environment_yields_the_credential():
    creds = read_credentials({EMAIL_VAR: "someone@example.com", PASSWORD_VAR: "a-real-password"})

    assert creds is not None
    assert creds.email == "someone@example.com"
    assert creds.password == "a-real-password"


@pytest.mark.parametrize(
    "env",
    [
        pytest.param({PASSWORD_VAR: "a-real-password"}, id="email missing"),
        pytest.param({EMAIL_VAR: "someone@example.com"}, id="password missing"),
        pytest.param({}, id="both missing"),
        pytest.param({EMAIL_VAR: "  ", PASSWORD_VAR: "  "}, id="both blank"),
    ],
)
def test_an_incomplete_environment_is_not_configured(env):
    """Half-configured counts as not configured: an email with no password would otherwise reach
    the login form as an empty string and fail as "wrong password", sending whoever ran it after
    the wrong problem."""
    assert read_credentials(env) is None


@pytest.mark.parametrize(
    "env",
    [
        {PASSWORD_VAR: "a-real-password"},
        {EMAIL_VAR: "someone@example.com"},
        {},
    ],
)
def test_missing_configuration_exits_two(env):
    """2, not 1: a caller that cannot tell "you have not configured this" from "a check failed"
    will eventually report a missing variable as a product defect."""
    with pytest.raises(SystemExit) as exit_info:
        require_credentials(env)

    assert exit_info.value.code == EXIT_NOT_CONFIGURED


def test_the_message_names_the_variables_and_no_values():
    assert EMAIL_VAR in MISSING_MESSAGE
    assert PASSWORD_VAR in MISSING_MESSAGE
    # It must teach the reader to export, not hand them anything to copy.
    assert "you@example.com" in MISSING_MESSAGE
    assert STALE_EMAIL_PREFIX not in MISSING_MESSAGE
    assert STALE_PASSWORD_PREFIX not in MISSING_MESSAGE


def test_the_message_says_a_documented_credential_proves_nothing():
    """The exact failure this whole slice exists for."""
    assert "still exists" in MISSING_MESSAGE


def test_a_credential_object_never_prints_its_password():
    """A dataclass would print it the first time anyone logs the object, drops it in an f-string,
    or lets an exception carry it."""
    creds = LiveCredentials(email="someone@example.com", password="s3cr3t-value", frontend="http://x")

    for rendered in (repr(creds), str(creds), f"{creds}"):
        assert "s3cr3t-value" not in rendered
        assert "not shown" in rendered


def test_the_helper_has_no_default_and_no_fallback_password():
    source = (LIB / "live_auth.py").read_text()

    assert STALE_EMAIL_PREFIX not in source
    assert STALE_PASSWORD_PREFIX not in source
    # A default would be a credential by another name.
    assert 'PASSWORD_VAR, "' not in source
    assert "password=\"" not in source


# ------------------------------------------------------------------ the scripts, as source text


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_no_browser_script_carries_a_credential(script):
    source = (SCRIPTS_DIR / script).read_text()

    assert STALE_EMAIL_PREFIX not in source
    assert STALE_PASSWORD_PREFIX not in source
    # No assignment of a literal to anything password-shaped, however it is spelled.
    assert not re.search(r'(?i)^\s*\w*password\w*\s*=\s*["\'][^"\']+["\']', source, re.MULTILINE)


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_every_browser_script_uses_the_shared_helper(script):
    source = (SCRIPTS_DIR / script).read_text()

    assert "from lib.live_auth import" in source
    assert "require_credentials()" in source


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_no_browser_script_mints_a_session_or_injects_one(script):
    """Every one of these signs in through the real form, which creates a real, revocable
    DeviceSession. A check that skipped the login would not be checking the product."""
    source = (SCRIPTS_DIR / script).read_text()

    for forbidden in ("create_access_token", "localStorage", "add_cookies", "set_cookie"):
        assert forbidden not in source, forbidden


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_credentials_are_resolved_before_a_browser_is_launched(script):
    """Order matters: a missing variable must stop the run before Chromium starts, not surface
    later as a failed login that reads like a product defect."""
    source = (SCRIPTS_DIR / script).read_text()

    assert source.index("require_credentials()") < source.index("sync_playwright()")


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_no_browser_script_prints_a_credential(script):
    source = (SCRIPTS_DIR / script).read_text()

    assert not re.search(r"print\([^)]*(password|PASSWORD)", source)
    # Nor smuggled into a URL or a query string.
    assert not re.search(r"(?i)(https?://[^\"']*\{[^}]*password)", source)


@pytest.mark.parametrize("script", BROWSER_SCRIPTS)
def test_running_without_credentials_exits_two_and_says_nothing_secret(script):
    """The whole contract, end to end, as a person would hit it."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / script)],
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home())},
    )

    assert result.returncode == EXIT_NOT_CONFIGURED
    combined = result.stdout + result.stderr
    assert EMAIL_VAR in combined
    assert STALE_EMAIL_PREFIX not in combined
    assert STALE_PASSWORD_PREFIX not in combined


def test_the_meta_probe_is_deliberately_not_migrated():
    """`a10_live_probe.py` has no dashboard login: it makes one read-only Meta call and asks for
    the *Meta token* at a hidden prompt. Giving it a dashboard credential would attach the wrong
    model to it. This test states that decision so a later reader does not "fix" it."""
    source = (SCRIPTS_DIR / "a10_live_probe.py").read_text()

    assert "sync_playwright" not in source
    assert "input[type=password]" not in source
    assert EMAIL_VAR not in source
