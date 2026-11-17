# MINI-SPEC A3 Report — Alert Center & Telegram Notification Delivery

Date: 2026-09-05 · Status: **Complete** · Baseline audited: `a4b7881` (A2) on `1692462` (A1)

## 1. Summary

A3 adds a centralised Alert Center and a durable, one-way Telegram notification pipeline on top of
A2 health. Alerts are derived deterministically from A2 health signals and failed evaluation runs,
deduplicated by a persisted key, and carried through a full workflow — acknowledge, suppress with
a bounded expiry, resolve, reopen — none of which touches the A2 signal or the A1 record behind
it. Eligible alerts write a delivery row into a database-backed transactional outbox in the same
transaction; a bounded dispatcher claims due rows with `FOR UPDATE SKIP LOCKED`, renders a
server-side message from a fixed allowlist, sends it through an isolated transport adapter, and
appends an append-only attempt record.

A3 deliberately did **not** add: any Telegram command or two-way control path; auto-remediation;
a second health engine or any score; another delivery channel; Celery, Redis or a scheduler; any
storage or exposure of the bot token; or a "send now" control. **No real Telegram message has been
sent by this codebase**: the default transport is `disabled`, no bot token exists in the
repository or its environment, and every test and pilot used `FakeNotificationTransport`.

## 2. Audit Before Build

**Verified A1/A2 baseline** (measured): 91 routes, 20 ORM tables, methods limited to
`GET`/`PATCH`/`POST`, two migrations at head `0002_a2_account_health`, and **no Celery, Redis,
APScheduler, FastAPI background tasks or any queue anywhere**. Compose validates but is not
deployed. Every figure the A3 brief quotes is accurate.

**Files/docs inspected:** `MINI_SPEC_PLAYBOOK.md`, `docs/AUDIT_BEFORE_BUILD.md`,
`docs/AUDIT_BEFORE_BUILD_A2.md`, `docs/MINI_SPEC_A1_REPORT.md`, `docs/MINI_SPEC_A2_REPORT.md`,
`docs/HEALTH_RULES_V1.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `README.md`,
`CLAUDE.md`; the whole backend tree (models, services, routers, deps, middleware, migrations,
`conftest.py`, all 192 tests); the whole frontend tree (routes, `lib/api.ts`, `lib/readiness.ts`,
`lib/health.ts`, `ui.tsx`, account tabs, tests); `docker-compose.yml`, both Dockerfiles,
`nginx.conf`, `.env.example`.

**Regression baseline:** 192 backend tests, 35 frontend hermetic tests, ruff and eslint clean, a
production build, and all ten A3 §7.2 invariants confirmed by their existing tests.

**Deviations/regressions found and repairs:** **none in the product.** One harness limitation was
found — two concurrent pytest runs share `adsops_test` and truncate each other's fixtures —
recorded as a follow-up rather than a defect. One A1 helper gap surfaced during A3
(`to_jsonable` did not handle `time`) and was fixed.

**Confirmed A3 gaps:** N1 alert vocabulary (`vocabulary`); N2 alert/policy/delivery/attempt tables
(`data_model`); N3 alert lifecycle and deterministic keys (`state_machine`); N4 notification
policy (`data_model` + `state_machine`); N5 transport abstraction (`architecture`); N6 outbox and
dispatcher (`architecture`); N7 endpoints and filters (`API`); N8 Alert Center surfaces
(`frontend_UX`); N9 token handling, chat masking, owner-only gates (`security`); N10 alert and
delivery observability (`observability`); N11 alert tests and a fake-transport harness
(`testing`); N12 still no worker or scheduler (`deployment`).

**Reused:** `ApiContext`/`Ctx`/`WriteCtx`/`AuditCtx`; `get_or_404` (404 for foreign rows);
`paginate`/`apply_sort`/`page_response`; the error envelope and request-id middleware;
`AuditLogService`; `redact()`, `StrictPayload`, `reject_credential_like`; `Archivable`; the
portable enum/UUID/JSON conventions **and the A2 lesson that those enums persist names**; the A2
`active_key` nullable-unique technique; the A2 SAVEPOINT isolation pattern; `HealthEvaluationRun`
as the observability precedent; the pytest harness; and on the frontend the shell, the whole
`ui.tsx` component set, the `Tone` colour discipline, the API client and the `useSearchParams`
filter convention.

**Notification architecture decision:** a database-backed transactional outbox plus a bounded
single-process dispatcher — details in §3.

**Out-of-scope findings:** no CI runner; no rate limiting; no generic table component; the pytest
harness assumes a single runner. All left as follow-ups.

## 3. Design Choice

**Alert derivation:** A3 reads A2 records and normalises them; it never re-evaluates a health
rule. `alert_key` is `health_signal:{account}:{signal_key}` or
`health_evaluation_run:{account}:{error_code}`, and at most one *active* alert per key is enforced
by the database through a nullable `active_key` with `unique(workspace_id, active_key)`.
Derivation is hooked into the A2 evaluation inside its **own nested SAVEPOINT**, so an alerting
bug degrades alerting and nothing else. The evaluation run is finished *before* derivation, so
"what is the latest word on this account?" has a truthful answer — without that ordering a
recovered account could never clear its failure alert.

**Outbox/dispatcher:** the delivery row is written in the same transaction as the alert. The
dispatcher claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, batch 10, concurrency 1, and
holds a lease so a process that dies mid-send does not strand the row. Retries are bounded (3
attempts, 1/5/15-minute backoff) and only for allowlisted transient codes; configuration and
recipient failures are final. Nothing lives in memory, so restart recovery is a query.

**Dedupe:** `idempotency_key` = `alert + reason + severity + recipient` (plus a sequence for
reminders), unique per workspace. Planning upserts against it, so re-evaluation cannot produce a
second message, and a retry appends an *attempt* rather than a delivery.

**Quiet hours and severity policy:** evaluated with `zoneinfo` in the policy timezone, never the
server's, with cross-midnight windows handled directly. Critical bypasses by default; a warning
inside the window is **scheduled for the end of it, not discarded**; info has no Telegram delivery
by default; an unresolvable timezone produces a `skipped` delivery with `timezone_not_configured`
rather than a guess. Every non-send is recorded with a reason.

**Telegram configuration and fake transport:** **Option B** — an owner-managed `telegram_chat_id`
on the workspace policy. Option A (a server env var) would need a redeploy to change the
destination and could not be per-workspace, and A3 was creating the policy table anyway. The bot
token stays server-side in both options. Transport selection is `NOTIFICATION_TRANSPORT`
(`disabled` by default), and `FakeNotificationTransport` is a shared instance so tests and pilots
can assert on the messages that *would* have been sent.

**Why:** it avoids adding a broker to a VPS with no headroom, keeps alert state and transport
state independently auditable, makes duplicate sends structurally impossible, and leaves a clean
seam for a later infra phase to move the dispatcher behind Celery without changing a single data
contract.

## 4. Changed Files

**Backend (new)** — `models/alerts.py`; `services/alert_rules.py`, `alert_service.py`,
`alert_triggers.py`, `notification_service.py`, `notification_templates.py`,
`notification_transport.py`, `telegram_transport.py`, `quiet_hours.py`; `schemas/alerts.py`;
`api/v1/routers/alerts.py`; `commands/dispatch_notifications.py`.

**Backend (extended)** — `core/enums.py` (additive alert vocabulary), `core/config.py` (transport,
token, public URL, dispatcher bounds), `services/base.py` (`time` serialisation),
`services/health_service.py` (the guarded derivation hook and run-ordering fix),
`api/v1/routers/system.py` + `schemas/audit.py` (safe delivery counters), `models/__init__.py`,
`api/v1/__init__.py`, `tests/conftest.py` (fake transport).

**Frontend (new)** — `lib/alerts.ts`; `components/AlertDrawer.tsx`; `pages/Alerts.tsx`.

**Frontend (extended)** — `lib/types.ts`, `AppShell.tsx`, `App.tsx`, `pages/Overview.tsx`,
`pages/Settings.tsx` (owner-only notification policy), `pages/account/HealthTab.tsx` (related
alert counts).

**Migrations** — `alembic/versions/0003_a3_alerts_and_notifications.py`.

**Infrastructure/config** — none. No new service, container, image or dependency: the transport
uses the standard library.

**Tests** — `tests/test_alert_engine.py`, `test_alert_api.py`, `test_alert_security.py`,
`test_alert_performance.py`; `frontend/src/test/alerts.test.ts`, `alerts.components.test.tsx`, and
four A3 scenarios appended to `live.app.test.tsx`; the declared narrowing of the A2 structural
test.

**Documentation** — `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`,
`docs/AUDIT_BEFORE_BUILD_A3.md`, `docs/ALERT_POLICY_V1.md`, `docs/MINI_SPEC_A3_REPORT.md`.

## 5. New API/DB/State

**Tables (4):** `alert_policies`, `alerts`, `notification_deliveries`,
`notification_delivery_attempts`. `AlertActionHistory` was deliberately **not** created: A1's
`AuditLog` plus the alert's own fields already record actor, action, before/after and request id,
and A3 §A.5 prefers reuse.

**Alert states:** `open`, `acknowledged`, `suppressed`, `resolved`, `expired`, `archived`.
Severities `info`/`warning`/`critical`. Source types `health_signal`, `health_evaluation_run`.

**Delivery states:** `pending`, `queued`, `sending`, `sent`, `failed_transient`, `failed_final`,
`skipped`, `cancelled`, with seven allowlisted skip reasons and eight allowlisted failure codes.

**Policy defaults:** enabled, `Asia/Ho_Chi_Minh`, quiet hours 23:00–07:00 enabled, critical
bypass on, warning delivery on, info delivery off, reminders off, **no recipient**.

**Endpoints (20):** routes rose from 91 to **111**, still with **no `DELETE` anywhere**. See
`API.md` §Alert Center.

**Authorization:** every route resolves the workspace from the membership; foreign alerts,
notifications and policies return `404`. Policy changes, dispatch and the recovery sweep are
owner-only; dispatch additionally requires explicit confirmation and accepts no recipient and no
message body.

**Dispatcher/retry:** batch 10 (max 50), concurrency 1, lease-based recovery, 3 attempts with
1/5/15-minute backoff, final failures never retried, and a delivery whose alert closed before
sending is cancelled rather than sent.

## 6. Tests

| Layer | Result |
|---|---|
| A1/A2 regression | **192 passed, unchanged** |
| A3 unit (`test_alert_engine.py`) | 30 passed |
| A3 integration (`test_alert_api.py`) | 39 passed against real PostgreSQL |
| Frontend | 52 hermetic + 16 live-API (7 A1 + 5 A2 + 4 A3) |
| Security/redaction (`test_alert_security.py`) | 21 passed |
| Dedupe / quiet hours / retry | covered across the unit and integration files, including a two-session concurrency test of the claim |
| Performance/resource | 30 accounts: 58 ms and 42 queries per account, 90 alerts, 90 deliveries, bounded dispatch of 10 in 0.10 s, no RSS growth |
| Lint/typecheck/build | ruff clean, eslint clean, build 347.82 kB (97.84 kB gzip), +31.0 kB over A2 |
| Migration verification | clean database (25 tables) and upgrade path both applied; downgrade drops only the four new tables |
| **Backend total** | **283 passed** |

**Defects found and fixed:** a failure-derived alert could never be created (derivation ran only
inside the savepoint the failure rolled back); a recovered account never cleared its failure alert
(derivation ran before the run was marked finished); an archived account kept a failure alert
alive; `time` values broke audit serialisation. Full detail, including the pilot-assumption fixes
that were *not* product defects, is in `TEST_LOG.md`.

## 7. Live Verification

**Fake vs real transport:** **fake only.** `NOTIFICATION_TRANSPORT=fake`, `TELEGRAM_BOT_TOKEN`
empty, and `telegram_transport_configured` reported `false` throughout. No network call to
Telegram was made at any point in this session.

**Pilot scenarios run**, all on one freshly created database:

| Pilot | Result |
|---|---|
| A1 re-run | **28/28** — A1 scenarios unchanged |
| A2 re-run | **37/37** — health behaviour unchanged |
| A3 (A, B, B2, C, D, F + safety sweeps) | **37/37** |
| A3 Pilot E (retry/failure, in-process on the same live database) | **16/16** |

**Actual outcomes:** a critical condition produced one alert, one immediate delivery and one safe
rendered message with a `sent` status and a message id; a warning inside quiet hours was deferred
to the window end with the policy decision recorded and nothing sent; a critical inside quiet
hours bypassed by policy; attention conditions produced Alert Center items with deliveries skipped
as `severity_delivery_disabled`; three recalculations of an unchanged condition produced no new
alert, no new delivery and no new message; raising an event's severity resolved the warning alert
and opened exactly one critical alert with exactly one new candidate; acknowledgement left the A2
signal `open` and health `critical`; indefinite suppression was refused; resolution changed no
source record; and every action was audited. Pilot E proved the retry, final-failure and
restart-recovery paths with staged transport failures, including "processed exactly once" after a
simulated dispatcher death.

**No-real-message verification:** the pilot asserted `transport_mode == "fake"` and
`telegram_transport_configured == false` before doing anything; the fake transport's recorded
messages were the only "sends"; a SQL sweep found zero audit rows containing `bot_token` and zero
delivery attempts containing a URL; and a structural test asserts only one module may make an
outbound request and that its URL comes from configuration.

**Resource observations:** 30 accounts derived and planned in 1.75 s (58 ms each, 42 queries
each), producing 90 alerts and 90 deliveries; a bounded batch of 10 dispatched in 0.10 s; peak RSS
unchanged. No browser process was started. The A2 resource check rose from 31 to 40 queries per
account because it now measures A2 plus A3 derivation.

**Deviation from expected behaviour:** none. One deliberate design deviation is recorded below.

## 8. Remaining Limits / Follow-ups

**Intentionally excluded:** Telegram bot commands or any two-way control; auto-remediation;
appeal or recovery automation; browser automation, antidetect, proxy work, cookie or credential
handling; email/Slack/SMS/webhook channels; user-authored alert expressions; a second health
engine or any score; a "send now" control; storing a bot token anywhere but server configuration;
deployment, DNS, reverse proxy or Compose runtime.

**Deployment/worker limitations:**

1. **No scheduler.** Deliveries wait for `python -m app.commands.dispatch_notifications` or the
   owner-only endpoint. A deferred warning is scheduled correctly but only leaves when something
   works the outbox. This is the same deliberate constraint as A2, and it is the first thing a
   deployment phase should resolve.
2. **Compose still not built or started**, per A3 §5.28.
3. **No CI and no rate limiting**, unchanged from A1/A2.
4. The pytest harness assumes a single runner; two concurrent runs corrupt each other's fixtures.

**Production-readiness gaps:**

1. **The real Telegram path has never executed.** Its failure mapping and request shape are
   covered by structure and unit-level reasoning, not by a real call. A first real send needs a
   bot token and the user naming an approved chat.
2. **Reminders are implemented but disabled**, with only a toggle in the UI.
3. **No manual browser click-through.** UI verification is jsdom rendering against the live API
   plus a production build.
4. `ADSOPS_PUBLIC_APP_URL` is unset in real deployments, so messages currently omit the deep link
   by design until a public URL exists.

**Recommended next MINI-SPEC:** `A4 — Deployment Readiness, Controlled Test Send & VPS
Observability` — an operations spec rather than a feature: build and run the Compose stack in a
safe environment, inject secrets, configure the public HTTPS URL and reverse proxy, schedule the
evaluation and dispatch commands, perform a **user-approved** controlled Telegram test send to a
named chat, and add health checks, backup, monitoring, basic rate limits and a rollback
procedure.

**A4 is proposed, not started.**
