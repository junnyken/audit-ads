# MINI-SPEC A2 Report — Evidence-Based Account Health & Alert Foundation

Date: 2026-09-04 · Status: **Complete** · Baseline audited: `0b5a67b` (A1)

## 1. Summary

A2 adds a separate, evidence-based account-health capability on top of A1. Ten typed, versioned
rules turn recorded account status, readiness output, checklist/evidence state and account events
into explainable health signals; a deterministic rollup reduces those to one of five states —
`unknown`, `attention_needed`, `warning`, `critical`, `clear_signals` — always with the reasons,
sources and timestamps behind it. Signals have a full lifecycle (open → acknowledged → resolved,
plus expired and superseded) and are never deleted or overwritten in place. Health is separate
from readiness in the database, the API and the UI, and both are displayed side by side.

A2 deliberately did **not** add: any numeric ban-risk, safety or trust score; any prediction of
platform enforcement; any mutation of an advertising account, campaign, browser profile or proxy;
any notification transport (that is A3); suppression/snooze; a rule-configuration UI; Celery,
Redis or a scheduler; and any credential, cookie, session or token handling. No health state is
ever worded as safe, protected, approved or immune.

## 2. Audit Before Build

**A1 baseline verified** (measured, not quoted): 16 ORM tables, 77 routes, methods limited to
`GET`/`PATCH`/`POST`, single revision `0001_a1_registry`, no Celery/Redis anywhere, compose valid
with memory limits and health checks but not deployed. The A2 brief's "16 database tables" is
accurate; the A1 report's phrasing ("16 domain entities plus `users`") was loose and is corrected
in `docs/AUDIT_BEFORE_BUILD_A2.md`.

**Files/docs inspected:** `MINI_SPEC_PLAYBOOK.md`, `docs/AUDIT_BEFORE_BUILD.md`,
`docs/MINI_SPEC_A1_REPORT.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `README.md`,
`CLAUDE.md`; the full backend tree (models, services, routers, deps, middleware, migrations,
tests, `conftest.py`); the full frontend tree (routes, `lib/api.ts`, `lib/readiness.ts`, `ui.tsx`,
account tabs, tests); `docker-compose.yml`, both `Dockerfile`s, `nginx.conf`, `.env.example`.

**A1 deviations/regressions found: none.** All seven invariants named in A2 §7.2 were re-run
individually and pass. One **A1 defect was discovered by an A2 test** and fixed: the shared `Field`
component rendered a `<label>` with no `for` attribute unless a caller passed `htmlFor`, leaving
most form controls without an accessible name. It now wraps the control so the association is
implicit.

**Confirmed A2 gaps:** H1 health vocabulary (`vocabulary`); H2 health tables (`data_model`);
H3 signal lifecycle and deduplication (`state_machine`); H4 health engine (`architecture`);
H5 health endpoints and filters (`API`); H6 health surfaces (`frontend_UX`); H7 evaluation-run
observability (`observability`); H8 trigger wiring (`architecture`); H9 health tests (`testing`);
H10 no worker/scheduler (`deployment`).

**Reused from A1:** `ApiContext` / `Ctx` / `WriteCtx` / `AuditCtx`; `get_or_404` (404 for foreign
rows); `paginate` / `apply_sort` / `page_response`; the error envelope and request-id middleware;
`AuditLogService`; `redact()` and `StrictPayload`; `Archivable` and `archived_at`; the portable
`sa.Uuid` / `sa.JSON` / `sa.Enum(native_enum=False)` conventions; the pytest harness; and on the
frontend the app shell, `Badge`/`Card`/`StatTile`/`Drawer`/`Tabs`/`EmptyState`/`ErrorState`/
`Skeleton`/`Field`/`InlineNote`, the `Tone` colour vocabulary, the API client, and the
`useSearchParams` filter convention.

**Out-of-scope findings:** no generic `DataTable` and no custom query-hook module exist (tables and
queries are composed directly); still no CI runner; still no rate limiting. All left as
follow-ups.

## 3. Design Choice

**Chosen:** a separate deterministic health-signal engine over A1 facts, with a materialised
snapshot used only as a query optimisation.

**Readiness/health separation:** separate tables, separate enums, separate endpoints, separate
badges. `ReadinessRollupService` is invoked with `persist=False` from the health path, so health
structurally cannot move a readiness state — proven by a test that asserts
`readiness_evaluated_at` is unchanged across repeated health recalculations.

**Signal lifecycle and deduplication:** `signal_key` = `rule_key` + source scope. Identical
evidence touches only `last_evaluated_at`, which is what preserves an `acknowledged` status
instead of resetting it. Materially changed evidence creates a successor and marks the previous
signal `superseded` with a link. A candidate that disappears closes its signal as `resolved` by
the engine (`resolved_by` NULL) — or `expired` if its rule was disabled. Uniqueness is enforced
by the database through a nullable `active_key` column with `unique(ad_account_id, active_key)`,
which is portable, unlike a PostgreSQL partial index.

**Evaluation trigger and background-job approach:** synchronous, inside a `SAVEPOINT`. A1 ships no
worker and A2 §G forbids adding a scheduler merely to satisfy this MINI-SPEC. The savepoint is
what makes this safe: a rule that raises rolls back only the health work, the A1 mutation still
commits, a `failed` run is recorded, and the account's health is reported `unknown`.
`python -m app.commands.evaluate_health` is the seam A3 can wire to a scheduler.

**Why:** it preserves A1's evidence-first stance; it keeps alert semantics out of the readiness
engine; it gives a drill-down path from dashboard count → account → signal → source evidence and
rule; it stays cheap enough for the target VPS (44 ms/account); and it produces the signal
substrate A3 needs without coupling evaluation to any delivery transport.

## 4. Changed Files

**Backend (new)** — `app/models/health.py`; `app/services/health_rules.py`,
`health_engine.py`, `health_service.py`, `health_presenter.py`, `health_triggers.py`;
`app/schemas/health.py`; `app/api/v1/routers/health.py`; `app/commands/__init__.py`,
`app/commands/evaluate_health.py`.

**Backend (extended)** — `app/core/enums.py` (additive health vocabulary); `app/core/config.py`
(three health settings); `app/models/__init__.py`; `app/api/v1/__init__.py`;
`app/api/v1/routers/ad_accounts.py`, `readiness.py`, `events.py` (trigger calls only — no A1
behaviour changed).

**Frontend (new)** — `src/lib/health.ts`; `src/components/HealthSignalDrawer.tsx`;
`src/pages/AccountHealth.tsx`; `src/pages/account/HealthTab.tsx`.

**Frontend (extended)** — `src/lib/types.ts`; `src/lib/readiness.ts` (added an `info` tone);
`src/components/ui.tsx` (`Field` label-association fix); `src/components/AppShell.tsx`;
`src/App.tsx`; `src/pages/Overview.tsx`; `src/pages/AccountDetail.tsx` (Health tab + deep-linkable
`?tab=`).

**Migrations** — `backend/alembic/versions/0002_a2_account_health.py`.

**Infrastructure** — none. No new service, dependency, image or resource limit.

**Tests** — `backend/tests/test_health_engine.py`, `test_health_api.py`, `test_health_security.py`,
`test_health_performance.py`; `frontend/src/test/health.test.ts`,
`health.components.test.tsx`, and five health scenarios appended to `live.app.test.tsx`.

**Documentation** — `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`,
`docs/AUDIT_BEFORE_BUILD_A2.md`, `docs/HEALTH_RULES_V1.md`, `docs/MINI_SPEC_A2_REPORT.md`.

## 5. New API/DB/State

**Tables (4):** `health_rule_definitions`, `account_health_signals`, `account_health_snapshots`,
`health_evaluation_runs`. `HealthSignalResolutionHistory` was deliberately **not** created: A1's
`AuditLog` plus the signal's own fields already record actor, action, before/after and request id,
and A2 §A.5 prefers reuse.

**Rules:** 10 typed rules at version 1, engine version `a2-v1`, materialised idempotently as
`workspace_id IS NULL` system defaults. See `docs/HEALTH_RULES_V1.md`.

**States:** health `unknown` / `attention_needed` / `warning` / `critical` / `clear_signals`;
signal status `open` / `acknowledged` / `resolved` / `expired` / `superseded`; severity `unknown` /
`attention` / `warning` / `critical`; freshness `current` / `stale` / `unknown` /
`not_applicable`; run trigger and status per A2 §A.4.

**Endpoints (14):** the routes listed in `API.md` §Account health. Total routes 77 → **91**, still
with **no `DELETE` anywhere**.

**Authorization:** every route resolves the workspace from the authenticated membership; foreign
signals and accounts return `404`, never `403`. Backfill is owner-only and requires
`confirm: true`. Signal actions are refused on archived accounts.

**Evaluation triggers:** account create/update/archive/restore, asset link and unlink, checklist
review, evidence add/update/archive, manual review, account event create/update/resolve, manual
recalculation, backfill, and the scheduled command.

## 6. Tests

| Layer | Result |
|---|---|
| A1 regression (unchanged files) | **111 passed** — identical to the A1 session |
| A2 unit (`test_health_engine.py`) | 37 passed |
| A2 integration (`test_health_api.py`) | 25 passed against real PostgreSQL |
| A2 security/regression (`test_health_security.py`) | 18 passed |
| A2 performance (`test_health_performance.py`) | 1 passed |
| **Backend total** | **192 passed** |
| Frontend hermetic | 35 passed (16 A1 + 19 A2) |
| Frontend live-API rendering | 12 passed (7 A1 + 5 A2) |
| Lint (`ruff`, `eslint`) | clean |
| Typecheck + build | passed, 316.78 kB / 91.61 kB gzip (+24.4 kB / +5.2 kB vs A1) |
| Migration verification | clean database and upgrade path both applied; downgrade drops only the new tables |
| Resource check | 30 accounts, 1.33 s total, 44 ms and 31 queries per account, no RSS growth |

**Defects found and fixed:** PostgreSQL's 63-character identifier limit broke autogeneration
(short explicit index names); health filters silently matched nothing because SQLAlchemy persists
enum *names* while the literals used values (all branches now bound with the column's Enum type);
`GROUP BY status` resolved to `ad_accounts.status` rather than the output alias (group by the
expressions); rules crashed on an unflushed `updated_at` (defensive formatting); and the A1 `Field`
label-association gap described in §2.

## 7. Live Verification

Both pilots were run against the live API on a freshly created database, A1 first.

**A1 pilot re-run: 28/28** — the three A1 scenarios still land on `operationally_ready`,
`unknown` and `not_ready`. A2 changed nothing about them.

**A2 pilot: 37/37.**

| Scenario | Expected | Actual |
|---|---|---|
| A — clear current signals | A1 `operationally_ready`, A2 `clear_signals`, configured-check wording | exactly that; 0 open signals; freshness `current` |
| B — warning from stale review / missing evidence | A1 `unknown`/`not_ready`/`ready_with_warnings`, A2 `warning`/`attention_needed` with reason, source, timestamp, next step | A1 `unknown`, A2 `warning` with `mandatory_readiness_evidence_missing`, `manual_review_due_or_stale`, `readiness_unknown` |
| C — critical status/event | A1 `not_ready`, A2 `critical` with source facts, rule version, no remediation | exactly that; both critical rules raised, `readiness_not_ready` suppressed, account status untouched |
| D — evaluation failure/staleness | A2 `unknown`/stale, no misleading clear result, run records context | snapshot aged 5 days → `unknown` + `stale` + `health_evaluation_stale`; recalculation restored `clear_signals` |

**Data freshness / failure verification:** the failure path is covered twice — live (staleness
downgrade and recovery) and in integration (`build_candidates` monkeypatched to raise: the A1
`PATCH` still returned 200 and persisted, a `failed` run was recorded with `error_code
RuntimeError`, and health reported `unknown` with `health_evaluation_failed`).

**Live UI: 12/12** — Overview health cards, Account Health list with separate readiness/health/
freshness columns, Health tab with rule versions beside the readiness state, and the signal drawer
with both actions gated on their required text.

**Deviation from expected behaviour:** none. One deliberate design deviation from the spec text is
recorded below.

## 8. Remaining Limits / Follow-ups

**Intentionally excluded:** numeric risk/safety/trust score; enforcement prediction; any campaign,
account, browser-profile or proxy mutation; browser automation, antidetect, fingerprinting, cookie
handling, proxy rotation; credential/session/token storage; Telegram or any delivery transport;
suppression/snooze (A2 §24 permits deferring it, and it is deferred to A3 rather than half-built);
rule-configuration UI; evidence file upload; team role-management UI.

**Worker/deployment limitations:**

1. **Backfill is bounded and synchronous, not asynchronous.** This is the one deliberate deviation
   from A2 §E. A1 ships no worker and A2 §G forbids adding a scheduler merely to satisfy A2, so a
   bounded synchronous batch (default 5, maximum 50, owner-only, explicitly confirmed) was chosen
   over introducing a broker. A3 should move it behind a queue.
2. **No scheduled sweep.** An untouched account's evaluation ages and is then reported
   `unknown`/stale — correct, but staleness is surfaced rather than prevented.
   `python -m app.commands.evaluate_health` is ready to be wired to a scheduler.
3. **Compose still not deployed.** Images were not built and the stack was not started, per
   A2 §7.1.
4. **No CI, no rate limiting** — unchanged from A1.
5. **No browser click-through.** UI verification is jsdom rendering against the live API plus a
   production build; that is strong evidence but not a human driving Chrome.
6. Rule enable/disable and versioning are supported by the schema and engine but have no UI.

**Recommended next MINI-SPEC:** `A3 — Alert Center & Telegram Notification Delivery`. It should
reuse these health signals and evaluation runs and add notification policy, deduplication, quiet
hours, delivery attempts, acknowledgement deep links and delivery-failure observability. It must
not create a second health engine and must not add auto-remediation. A3 is also the natural place
to introduce the worker that turns the evaluation command into a scheduled sweep and the backfill
into an asynchronous job.

**A3 is proposed, not started.**
