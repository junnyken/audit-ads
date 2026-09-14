"""One place where a live-verification script gets its dashboard credential.

Written because the previous answer rotted. `a6`, `a7_a8` and `a9_live_verify.py` each carried a
literal email and password; measured 2026-09-14, that account no longer existed in the development
database, so every one of those scripts had been unrunnable for an unknown length of time and
nobody knew, because nobody had run them. A committed credential is not only a secret in the wrong
place — it is a fact that silently stops being true.

So: the credential comes from the environment, there is no default, and there is no fallback to
anything. A missing variable stops the script before a browser is opened.

What this module will not do, and the tests that hold it to that are in
`tests/test_live_verification_credentials.py`:

* it never contains a literal email or password;
* it never prints, logs, or raises one — the value appears in exactly one place, the call that
  types it into the login form;
* it never writes one to a file, a URL, a query string or a screenshot;
* it never mints a token, sets a cookie, or writes to `localStorage`. Every script that uses this
  signs in through the real form, which creates a real, revocable `DeviceSession` server-side.
  A verification that skipped the login would not be verifying the product.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

#: The two variables, named once. Scripts import these rather than spelling them out, so a rename
#: cannot leave one script reading a variable nobody sets any more.
EMAIL_VAR = "ADSOPS_LIVE_EMAIL"
PASSWORD_VAR = "ADSOPS_LIVE_PASSWORD"
FRONTEND_VAR = "ADSOPS_LIVE_FRONTEND"
DEFAULT_FRONTEND = "http://localhost:5173"

#: Exit code for "you have not configured this", distinct from 1 ("a check failed"). A caller that
#: cannot tell those apart will eventually report a missing variable as a product defect.
EXIT_NOT_CONFIGURED = 2

MISSING_MESSAGE = (
    "Live verification credentials are not configured.\n"
    f"Set {EMAIL_VAR} and {PASSWORD_VAR} in the shell and run again.\n"
    "No password is stored by this script.\n"
    "\n"
    f"    export {EMAIL_VAR}='you@example.com'\n"
    f"    read -rs {PASSWORD_VAR} && export {PASSWORD_VAR}\n"
    "\n"
    "A credential written in a document is not evidence that the account still exists: check the\n"
    "database you are about to verify against before you run."
)


@dataclass(frozen=True)
class LiveCredentials:
    """An email, a password, and where to point the browser.

    `__repr__` is overridden because a dataclass would otherwise print the password the first time
    anyone logs this object, drops it into an f-string, or lets an exception carry it.
    """

    email: str
    password: str
    frontend: str

    def __repr__(self) -> str:  # pragma: no cover - exercised through str() in the tests
        return f"LiveCredentials(email={self.email!r}, password=<not shown>, frontend={self.frontend!r})"

    __str__ = __repr__


def read_credentials(env: dict[str, str] | None = None) -> LiveCredentials | None:
    """The credential from the environment, or `None` when it is not fully configured.

    Half-configured counts as not configured: an email with no password would otherwise reach the
    login form as an empty string and fail as "wrong password", which sends whoever runs it looking
    for the wrong problem.
    """
    source = os.environ if env is None else env
    email = (source.get(EMAIL_VAR) or "").strip()
    password = source.get(PASSWORD_VAR) or ""
    if not email or not password.strip():
        return None
    return LiveCredentials(
        email=email,
        password=password,
        frontend=(source.get(FRONTEND_VAR) or DEFAULT_FRONTEND).strip(),
    )


def require_credentials(env: dict[str, str] | None = None) -> LiveCredentials:
    """Credentials, or exit 2 with an explanation that names no value.

    Deliberately exits rather than raising: a raised exception ends up in a traceback, and a
    traceback of a login failure is exactly where a password would leak if anyone ever put one in
    the message.
    """
    credentials = read_credentials(env)
    if credentials is None:
        print(MISSING_MESSAGE, file=sys.stderr)
        raise SystemExit(EXIT_NOT_CONFIGURED)
    return credentials


def sign_in(page, credentials: LiveCredentials, *, timeout_ms: int = 15000) -> None:
    """Sign in the way a person does: type into the real form and submit it.

    No token is minted, no cookie is written, nothing is injected into `localStorage`. The login
    creates a server-side `DeviceSession` exactly as it would for any operator, which is the point
    — a check that bypassed the auth flow would not be checking the product.
    """
    page.goto(credentials.frontend, wait_until="networkidle")
    page.fill("input[type=email]", credentials.email)
    page.fill("input[type=password]", credentials.password)
    page.click("button[type=submit]")
    page.wait_for_selector("nav", timeout=timeout_ms)
