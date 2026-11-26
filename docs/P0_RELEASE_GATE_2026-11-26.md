# P0 release gate — 2026-11-26

This checklist separates source verification from production operational acceptance. Approval to fix P0 does not manufacture missing evidence or waive backup requirements.

| Gate | Evidence/status |
|---|---|
| P0 source defects addressed | Legacy Meta token capture retired, inventory fails closed, Telegram server-only, T1/T2/alert surfaces restored, precision/coverage/axe/token palette fixes, test-reset guard, backup/restore strict handling |
| Frontend full suite | Main final full suite: 641 passed / 0 failed / 20 skipped (45 passed / 1 skipped files) |
| Backend regression | Main combined selected SQLite/API suite: 91 passed in 53.24s; additional pure A4 34 passed, inventory 7 passed and fake-Docker restore 5 passed (separate checks, not full PostgreSQL suite) |
| Lint/build | Main final frontend typecheck/build pass, eslint 0 errors/10 warnings; backend ruff passed |
| Production identity/revision | Unknown; local baseline 3f886e69e5401f4edc846d9ee2c397a5c26e6a4b not proven production |
| Production schema / DB / volume / owner | Not independently verified |
| Shared staging isolation | No verified existing staging configuration available; no second stack created |
| Real login / RBAC / existing data workflow | Not run; no ADSOPS_LIVE_EMAIL/PASSWORD configured |
| Verified backup and isolated restore | Not run; 5 fake-Docker script control tests are not a restore drill |
| Real migration/rollback rehearsal | Not run; Alembic offline SQL generation only |
| Production release/smoke of changed artifact | Not run; public health probes describe existing release only |

## Access needed to unblock operational gates

Connect the existing Vibe Host management integration for the confirmed AdsOps frontend/backend resources (or provide an approved management route/host without exposing secrets in chat). Configure live-test credentials securely in workspace environment. Identify existing shared staging with actual DB/schema/volume isolation. Provide the current production backup method/location and revision visibility. Do not provision a new beta to avoid missing access.

## Known adjacent security drift not silently accepted

The Telegram helper has existing HTTP placement outside the project's original transport allowlist and a legacy test-send approval-flow discrepancy. Server-only credential changes do not certify those broader flows. Legacy encrypted credentials in immutable historical audit are ignored, not deleted; operational rotation/remediation needs explicit execution on the confirmed target. No real send is authorized by this checklist.

## Decision

**Production release: NO-GO** until operational evidence exists and the remaining security/acceptance gaps are dispositioned. Do not mark the entire P0 done based only on source tests. No production write/deploy/migration has been performed in this session.
