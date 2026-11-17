# MINI-SPEC O2.2 Report — Live Verification Credential Decoupling & Browser UAT Closure

Date: 2026-09-14 · Baseline `1b73b32` · Audit: this document's §2 (written before any code changed)

## 1. Summary

Four browser-verification scripts now take their dashboard credential from the environment through
one shared helper, and refuse to start without it. No email or password remains anywhere in the
repository — including the one **this agent had quoted into a document the day before**.

**Browser UAT did not run.** No credentials were exported, so no browser was opened and no O2.1
scenario was executed on screen. That is the honest state; it was not worked around.

Deliberately unchanged: `a10_live_probe.py` (no dashboard login to decouple), and every product
surface — no migration, no endpoint, no UI, no behaviour change to A1–A10.

## 2. Audit Before Build

Three of the task's assumptions were wrong when measured.

- **`a10_live_probe.py` is not a login script.** 0 credential literals, 0 `sync_playwright`, no
  login form. It asks for the *Meta token* at a hidden prompt. Migrating it would attach the wrong
  model. Confirmed as scope by the operator.
- **The stale password was in a document, not only in scripts.** `dev-password-6779` appeared in
  `docs/AUDIT_BEFORE_BUILD_O2_1.md`, quoted verbatim by this agent on 2026-09-13 to prove the
  scripts carried a credential. Quoting it was the same mistake in a different file.
- **No supported route existed for the agent to obtain a credential.** `create_dev_owner.py` calls
  `bootstrap_owner()`, which returns the existing workspace and creates nothing once one exists.
  Checked rather than assumed.

**Dev users, measured:** exactly one — `uxui.matbao@gmail.com`, active, created 2026-09-10.
`trieunt@matbao.com`: **0 rows**. `device_sessions`: 11, all live.

**Auth flow:** `POST /api/v1/auth/login` creates a server-side, revocable `DeviceSession` and puts
`session_id` in the token claim. Scripts fill the real form, so each run creates an ordinary
session. Nothing is minted or injected.

**Regression baseline:** backend **exit 0**; frontend **145 passed / 20 skipped**, `tsc -b` 0,
eslint 0, build 0.

## 3. Credential Decoupling Design

`backend/scripts/lib/live_auth.py` — in `scripts/`, not `app/`, because `app/` is what ships in the
production image and a verification tool does not belong there.

| | |
|---|---|
| Variables | `ADSOPS_LIVE_EMAIL`, `ADSOPS_LIVE_PASSWORD`, optional `ADSOPS_LIVE_FRONTEND` |
| Missing / blank / half-configured | prints the message, **exit 2** |
| Why 2 | distinct from 1 ("a check failed"); a caller that cannot tell them apart eventually reports a missing variable as a product defect |
| Leak prevention | no literal in source; `LiveCredentials.__repr__` renders `password=<not shown>`; no printing, no file, no URL, no query string; the value reaches exactly one call — typing it into the form |
| Session | real login only. No `create_access_token`, no `localStorage`, no cookie injection — asserted by test |

**Migrated:** `a6_live_verify.py`, `a7_a8_live_verify.py`, `a9_live_verify.py`,
`o2_1_live_verify.py`. **Deferred, with a test recording why:** `a10_live_probe.py`.

## 4. Changed Files

Backend: `scripts/lib/__init__.py`, `scripts/lib/live_auth.py` (new); the four scripts above.
Tests: `tests/test_live_verification_credentials.py` (new).
Docs: `docs/LIVE_VERIFICATION_RUNBOOK.md` (new), this report (new), `CLAUDE.md` (rule 42),
`README.md`, `FEATURES.md`, `TEST_LOG.md`, `docs/SESSION_SECURITY.md`,
`docs/AUDIT_BEFORE_BUILD_O2_1.md` (password removed).

**No migration. No schema change. No config change. No frontend file touched.**

## 5. Tests

| | Result |
|---|---|
| Backend before | **exit 0** |
| Backend after | **exit 0, 864 collected** (827 before, +37) |
| `ruff check .` | clean |
| Frontend | **145 passed / 20 skipped** — unchanged, no frontend file touched |
| `tsc -b` / eslint / build | 0 / 0 / 0 |

The 37 new tests cover: a complete environment resolves; each incomplete one does not; exit 2 for
every missing combination; the message names the variables and no value; the message says a
documented credential proves nothing; `repr`/`str`/f-string never show the password; the helper has
no default or fallback; and per script — no credential literal, uses the shared helper, no session
minting or injection, credentials resolved **before** `sync_playwright()`, no password printed or
smuggled into a URL, and running with no environment exits 2 while leaking neither old value.

## 6. O2.1 Browser UAT Results

- **Credentials supplied: no.** (No value was ever printed, requested through chat, or stored.)
- **Real auth flow used:** n/a — no run occurred.
- **Token minting / bypass used: no.**

| Scenario | Result |
|---|---|
| B1 registry badge, matched rows, import buttons | **blocked** — no credentials |
| B2 owned/client filter and edge display | **blocked** |
| B3 coverage states | **blocked** on screen; all six asserted in component tests (O2.1) |
| B4 authority | **blocked** on screen; asserted in component tests (O2.1) |
| B5 discovery history | **blocked** on screen; asserted in component tests (O2.1) |
| B6 Pixels | **blocked** on screen; asserted in component tests (O2.1) |
| B7 non-owner refusal | **pass** — backend tests, no browser needed (O2.1) |
| B8 registry re-measured | **pass** — see below |

**Screenshot index: empty.** `docs/evidence/O2-2-LIVE/` will be populated by the first real run.

**Registry, re-measured at the end of this session:** `business_managers` **1**, `ad_accounts`
**2**, `audit_logs` **56**. Unchanged — nothing was imported. `users` **1** — no account was
created.

**Provider writes: zero.** No Meta call of any kind was made by this slice.

**Production frontend was not tested** and remains unreachable at the platform edge.

## 7. Defects Found and Fixed

**One, in the tooling the tests were written for.**

- **Defect:** `playwright` was imported at module level, before the credential gate. Running a
  script with this project's own venv — the interpreter `CLAUDE.md` prescribes for `backend/` —
  raised `ModuleNotFoundError` and exited **1**, pointing the reader at a missing library when the
  real problem was an unset variable.
- **Fix:** import Playwright inside `main()`, after `require_credentials()`; `Page` kept for
  annotations under `TYPE_CHECKING`. Re-measured: all four scripts exit **2** with the credential
  message under `.venv/bin/python`.
- **Test:** `test_running_without_credentials_exits_two_and_says_nothing_secret`, which found it,
  plus `test_credentials_are_resolved_before_a_browser_is_launched`.

## 8. Remaining Limits / Follow-ups

- **Every browser scenario remains unverified on screen.** One command closes B1–B6; see
  `docs/LIVE_VERIFICATION_RUNBOOK.md`.
- **Production frontend routing:** still broken at the platform edge, still a platform-side ticket
  (`docs/VIBEHOST_SUPPORT_REQUEST.md`). Not touched.
- **Second-BM credential:** not started. `adsops-admin` has no role in `109796697343603`; the code
  side shipped in `3e3485f`, the Business Settings side has not been done.
- **O3.1 prerequisites, none met:** billing not confirmed; remaining ad-account slot count unknown;
  target BM would be `1993884657458857`; **no explicit approval for a single-create preview has
  been given or requested.**
- **Recommended next:** run the live verification, then decide between the second-BM credential and
  O3.1's prerequisites. Not started here.
