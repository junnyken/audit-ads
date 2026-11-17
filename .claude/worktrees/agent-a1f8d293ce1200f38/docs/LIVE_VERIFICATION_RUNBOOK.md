# Live Verification Runbook

How to run a real-browser check against the local stack, and the rule the scripts enforce.

## Why this document exists

On 2026-09-14 three live-verification scripts were found signing in as an account that **no longer
existed** in the development database. Each carried a literal email and password. They had been
unrunnable for an unknown length of time and nobody knew — because nobody had run them, and a
committed credential gives no signal when it stops working.

That is two failures in one. A secret in the wrong place, and a *fact* that quietly stopped being
true. The second is the one that cost time, and it is the reason for rule 41.

## Live Verification Credential Policy

- **Never commit a username or a password.** Not in a script, not in a test, not in a document.
  Where a test must detect an old credential, it matches a prefix so the value itself is never
  stored.
- **Every live-verification script reads `ADSOPS_LIVE_EMAIL` and `ADSOPS_LIVE_PASSWORD`** from the
  environment, through `backend/scripts/lib/live_auth.py`. No default, no fallback, no `.env`.
- **A missing variable exits 2** — distinct from 1, which means a check failed. A caller that
  cannot tell those apart will eventually report a missing variable as a product defect.
- **A documented credential is not evidence that the account exists.** Verify the intended user is
  in the database you are about to verify against, before the run.
- **Use the real login flow.** Sign in through the form; the server creates a real, revocable
  `DeviceSession`. Never mint a token, inject `localStorage`, or set a cookie to skip the login — a
  check that bypasses authentication is not checking the product.
- **Never print, log, screenshot or persist a credential.** `LiveCredentials.__repr__` hides the
  password so it cannot leak through an f-string, a log line or a traceback.
- **Do not use production credentials** for local browser verification.
- **Report whether a run actually happened.** "Blocked because credentials were not configured" is
  a complete and acceptable answer. Claiming a browser run from memory is not.

## Before you run

```bash
cd ~/workspace/projects/audit-ads
scripts/dev.sh status          # backend and frontend must both answer
```

Confirm the account you are about to use exists **right now**:

```bash
cd backend
.venv/bin/python - <<'PY'
from app.db.session import SessionLocal
from sqlalchemy import text
with SessionLocal() as s:
    for row in s.execute(text("select email, is_active from users order by created_at")):
        print(row[0], "| active:", row[1])
PY
```

## Running a check

```bash
cd ~/workspace/projects/audit-ads/backend

export ADSOPS_LIVE_EMAIL='the-account-you-just-confirmed@example.com'
read -rs ADSOPS_LIVE_PASSWORD && export ADSOPS_LIVE_PASSWORD   # hidden, and not in shell history
export ADSOPS_LIVE_PASSWORD

# Playwright is deliberately not in this project's venv: it is a verification tool, not a runtime
# dependency, and requirements.txt is what ships in the production image.
/home/coder/workspace/projects/Translation/.venv/bin/python scripts/o2_1_live_verify.py
```

| Script | Checks | Screenshots |
|---|---|---|
| `o2_1_live_verify.py` | O2.1 B1–B6: registry badge, matched rows, edge filter, coverage, history, Pixels | `docs/evidence/O2-2-LIVE/` |
| `a9_live_verify.py` | A9 team seats, invitations, device sessions | `docs/evidence/A9-LIVE/` |
| `a7_a8_live_verify.py` | A7/A8 wizards, all five steps | `docs/evidence/A7-A8-LIVE/` |
| `a6_live_verify.py` | A6 Preflight pages | `docs/evidence/A6-LIVE/` |

`ADSOPS_LIVE_FRONTEND` overrides the dashboard URL; it defaults to `http://localhost:5173`, which
must match `CORS_ORIGINS` exactly — `127.0.0.1` is a different origin to a browser.

**Two different failures, in the right order.** Playwright is imported *inside* `main()`, after the
credential check, so running with this project's own venv — which deliberately does not have
Playwright, because `requirements.txt` is what ships in the production image — tells you the
credentials are unset rather than raising `ModuleNotFoundError` first:

```
$ .venv/bin/python scripts/o2_1_live_verify.py
Live verification credentials are not configured.        # exit 2
```

With the credentials exported, the same command then reports the missing interpreter dependency
instead, which is the point at which you switch to the Playwright-capable interpreter above. The
common mistake is reported first; found by a test that ran each script with the project venv and
got exit 1 instead of 2.

## Not in this model, on purpose

`scripts/a10_live_probe.py` has **no dashboard login**. It makes one read-only Meta call and asks
for the *Meta token* at a hidden prompt, or reads `META_ACCESS_TOKEN`. Giving it
`ADSOPS_LIVE_EMAIL` would attach the wrong model to it. A test states this so a later reader does
not "fix" it.

`scripts/create_dev_owner.py` provisions the first owner on an empty database through the product's
own `bootstrap_owner()`, asking for the password at a hidden prompt. It is **idempotent and does
nothing once a workspace exists** — so it cannot be used to obtain a credential for a database that
is already set up.

## What the tests hold to

`backend/tests/test_live_verification_credentials.py` fails if any browser script regains a
credential literal, loses the shared helper, mints or injects a session, prints a password, or
launches Chromium before the environment has been checked. It also runs each script with no
environment and asserts exit 2.
