# A3 — Audit Before Build Report

- MINI-SPEC: A3 — Alert Center & Telegram Notification Delivery
- Date: 2026-09-04
- Baseline audited: `a4b7881` (A2), on `1692462` (A1)
- Status: **Accepted — A1/A2 baseline verified, all named invariants hold, A3 may proceed**

## 1. Verified A1/A2 baseline (measured, not quoted)

| Claim in the A3 brief | Verification | Actual |
|---|---|---|
| FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 | `requirements.txt`, compose | ✔ |
| React + TypeScript + Tailwind | `package.json` | ✔ React 18.3 / TS 5.7 / Tailwind 3.4 / Vite 6 |
| A1: 16 ORM tables, 77 routes | measured at `1692462` | ✔ (recorded in the A2 audit) |
| A2 added 4 tables and 14 routes → 91 routes, no `DELETE` | enumerated from `app.routes`, `Base.metadata` | ✔ **91** routes, **20** ORM tables, methods are only `GET`/`PATCH`/`POST` |
| Two migrations, head `0002_a2_account_health` | `alembic/versions/` | ✔ |
| No Celery / Redis / APScheduler / BackgroundTasks /any queue | grep across `requirements.txt` and `app/` | ✔ **none**. The only reference is the docstring in `app/commands/evaluate_health.py` explaining why |
| A2 evaluates health in a SAVEPOINT; failure does not roll back the source mutation | `health_service.py::evaluate_account_safe`, `test_a_failed_evaluation_leaves_health_unknown_and_still_commits_the_a1_change` | ✔ |
| Readiness evaluated with `persist=False` from the health path | `health_service.py::_facts` | ✔ |
| Freshness derived at read time; stale degrades to unknown | `health_presenter.py`, `health_engine.py::derive_freshness` | ✔ |
| Docker Compose exists, not deployed | `docker compose config` validates; no image built, no stack started | ✔ |
| CI, rate limiting, evidence upload, role UI, browser click-through incomplete | inspected | ✔ still incomplete |

**Deviations from the A2 report: none.** Every figure the brief quotes is accurate.

## 2. Regression baseline (run before any A3 code)

```
$ .venv/bin/python -m pytest tests/     192 passed in 207.93s
$ .venv/bin/ruff check .                All checks passed
$ npx vitest run                        35 passed | 12 skipped (live suite, opt-in)
$ npx eslint .                          clean
$ npm run build                         dist 316.78 kB (91.61 kB gzip)
$ [A2 resource check]                   30 accounts | 1.19s | avg 40ms | 31 queries/account
```

**Harness note, not a product defect:** an earlier run failed one health test because two pytest
processes were running concurrently against the same `adsops_test` database and truncating each
other's fixtures. Re-run alone, the suite is green. The test harness assumes a single runner;
recorded as a follow-up rather than papered over.

### Invariants required by A3 §7.2 — all confirmed

| Invariant | Evidence |
|---|---|
| A1 readiness cannot be overwritten by A2 health evaluation | `test_health_evaluation_never_changes_readiness` |
| A1 missing mandatory evidence cannot yield `operationally_ready` | `test_missing_mandatory_evidence_is_unknown_with_item_reason` |
| A1 sensitive fields are rejected/redacted | `test_payload_with_a_password_field_is_refused`, redaction suite (28) |
| A1 cross-workspace access is non-disclosing | `test_cross_workspace_access_is_denied` (404, not 403) |
| A1 archives preserve history | `test_archive_is_reversible_and_keeps_children` |
| A2 health is separate from readiness | `test_health_and_readiness_are_reported_separately` |
| A2 stale snapshot degrades to unknown/stale | `test_a_stale_evaluation_is_reported_as_unknown_not_clear` |
| A2 evaluation failure does not roll back source mutation | `test_a_failed_evaluation_leaves_health_unknown_and_still_commits_the_a1_change` |
| A2 rule evaluation deterministic and idempotent | `test_evaluation_is_idempotent_for_the_snapshot`, `test_candidate_order_is_deterministic_and_worst_first` |
| A2 health actions do not silently mutate A1 source data | `test_health_signal_actions_do_not_mutate_a1_checklist_data` |

**No blocking invariant failed. A3 proceeds on an intact baseline; no repair was required.**

## 3. Confirmed A3 gaps

| # | Gap | Class |
|---|---|---|
| N1 | No alert vocabulary: alert status, alert severity, delivery status, source type, skip/failure codes, dispatcher run states | vocabulary |
| N2 | No alert, policy, delivery or delivery-attempt tables | data_model |
| N3 | No alert lifecycle (open → acknowledged → suppressed → resolved / expired / archived), no deterministic alert key | state_machine |
| N4 | No notification policy: timezone, quiet hours, per-severity enablement, recipient state, reminders | data_model + state_machine |
| N5 | No outbound transport of any kind, no transport abstraction, no fake transport | architecture |
| N6 | No outbox, no dispatcher, no claim/lease, no bounded retry, no idempotency key | architecture |
| N7 | No alert/notification endpoints or filters | API |
| N8 | No Alert Center surfaces: nav entry, overview cards, list, detail, settings, delivery history, account-detail linkage | frontend_UX |
| N9 | No secret handling for a bot token, no chat-reference masking, no owner-only policy gate | security |
| N10 | No alert/notification observability events, no delivery counters in system status | observability |
| N11 | No alert/notification tests, no fake-transport harness | testing |
| N12 | Still no worker/scheduler — the dispatcher must not assume one | deployment |

## 4. Reuse map

**Backend** — `ApiContext`/`Ctx`/`WriteCtx`/`AuditCtx`; `get_or_404` (404 for foreign rows);
`paginate`/`apply_sort`/`page_response`; the `{"error": {...}}` envelope and request-id
middleware; `AuditLogService.record`; `redact()` + `StrictPayload` + `reject_credential_like`;
`Archivable`/`archived_at`; the portable `sa.Uuid`/`sa.JSON`/`sa.Enum(native_enum=False)`
conventions **and the A2 lesson that those enums persist names, not values**; the A2
`active_key` nullable-unique trick for "at most one active row per key"; the A2 SAVEPOINT
isolation pattern; `HealthEvaluationRun` as the observability precedent for dispatcher runs;
the pytest harness (Alembic-rebuilt schema, `db_session`, `api`, `other_auth`).

**Frontend** — app shell and nav; `Badge`/`Card`/`StatTile`/`Drawer`/`Tabs`/`EmptyState`/
`ErrorState`/`Skeleton`/`Field`/`InlineNote`/`Progress`; the `Tone` vocabulary and the
`HEALTH_META`/`READINESS_META` colour-map discipline; `AuditDiff`; the API client with
`ApiError.requestId`; `useSearchParams` URL filters; the A2 signal drawer as the model for an
alert drawer.

**Not present, so A3 must not assume it:** no generic table component, no query-hook module,
**no queue, no scheduler, no HTTP client of any kind** (the backend currently imports none).

## 5. Notification architecture decision

**Chosen: a database-backed transactional outbox plus a bounded, single-process dispatcher.**

| Question A3 §7.3 requires answering | Answer |
|---|---|
| Why it fits the repository | A2 already proved this shape: durable rows + a synchronous, savepoint-isolated writer + a CLI seam. The outbox reuses `AuditLogService`, the archive convention and the `active_key` uniqueness trick verbatim |
| Why it fits a 4 vCPU / 8 GB VPS | No broker, no extra container, no extra process at rest. The dispatcher is a short-lived bounded batch (default 10, concurrency 1) invoked by a command or an owner-only endpoint |
| How idempotency is guaranteed | `notification_deliveries.idempotency_key` is unique per workspace and derived from `alert_id + delivery_reason + severity + recipient`. Planning is an upsert against that key, so re-evaluation cannot create a second delivery |
| How deliveries are claimed safely | `SELECT … FOR UPDATE SKIP LOCKED` on due rows, then a status transition to `sending` inside the claim transaction. Two dispatchers cannot claim the same row |
| How retries work | Transient failures increment `attempt_count`, append an attempt row, and set `next_retry_at` with backoff 1 min → 5 min → 15 min. At `max_attempts` (3) the delivery becomes `failed_final`. Final errors (invalid chat, auth, transport not configured) never retry |
| How recovery works after restart | Nothing lives in memory. A row left in `sending` past its lease is reclaimed by the recovery sweep; `pending` and retry-due rows are picked up on the next dispatch |
| How no real Telegram message is sent in tests | `NOTIFICATION_TRANSPORT` defaults to `disabled`; the test harness sets `fake`. `TelegramTransport` is the only module in the backend permitted to perform an outbound request, and a structural test enforces that. Sending requires `NOTIFICATION_TRANSPORT=telegram` **and** a bot token, neither of which is set anywhere in this repository or its tests |

**Telegram chat configuration: Option B** — an owner-managed `telegram_chat_id` on the workspace
policy row. Option A (a server env var) would force a redeploy to change the destination and
would not be per-workspace, and A3 is already creating the policy table. The bot token stays
env-only in both options; the policy row never holds it, and the API never returns it.

## 6. Dedupe, quiet hours, suppression and retry decisions

- **Alert key**: `health_signal:{ad_account_id}:{signal_key}` and
  `health_evaluation_run:{ad_account_id}:{error_code}`. Uniqueness of the *active* alert is
  enforced by the database with a nullable `active_key` mirroring `alert_key`, exactly as A2 does
  for signals.
- **Quiet hours**: evaluated in the policy's IANA timezone via `zoneinfo`, supporting
  cross-midnight windows. A deferred warning is **scheduled**, never discarded:
  `scheduled_for` is set to the next quiet-hours end in that timezone and the decision is
  recorded on the delivery. If no timezone can be resolved, the delivery is skipped with
  `timezone_not_configured` rather than guessing.
- **Suppression**: requires a reason and a future expiry; indefinite suppression is refused.
  A suppressed alert stays visible in the Alert Center and keeps its history; only delivery is
  muted. When suppression expires and the source condition is still active, the alert returns to
  `open` and becomes eligible again under the normal dedupe rules.
- **Retry**: bounded to 3 attempts with 1/5/15-minute backoff; transient versus final failure is
  decided from an allowlisted error code, never from a raw provider body.

## 7. Expected changed files

New backend: `models/alerts.py`; `services/alert_rules.py`, `alert_derivation.py`,
`alert_service.py`, `notification_policy.py`, `notification_planner.py`, `quiet_hours.py`,
`notification_templates.py`, `notification_transport.py`, `telegram_transport.py`,
`notification_dispatcher.py`; `schemas/alerts.py`; `api/v1/routers/alerts.py`;
`commands/dispatch_notifications.py`; migration `0003_a3_alerts_and_notifications.py`.
Extended: `core/enums.py`, `core/config.py`, `models/__init__.py`, `api/v1/__init__.py`,
`services/health_service.py` (one guarded derivation hook), `api/v1/routers/system.py`.

New frontend: `lib/alerts.ts`; `components/AlertDrawer.tsx`; `pages/Alerts.tsx`;
`pages/settings/NotificationPolicy` section. Extended: `lib/types.ts`, `AppShell.tsx`, `App.tsx`,
`Overview.tsx`, `Settings.tsx`, `pages/account/HealthTab.tsx`.

Docs: `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `docs/ALERT_POLICY_V1.md`,
`docs/MINI_SPEC_A3_REPORT.md`.

## 8. Migration and resource risks

| Risk | Mitigation |
|---|---|
| Migration compatibility | One additive revision `0003`, `down_revision = 0002_a2_account_health`. No A1/A2 table is altered. `alembic downgrade 0002_a2_account_health` drops only the four new tables |
| Alert derivation slowing health evaluation | Derivation runs inside its **own** nested savepoint within the A2 evaluation, so a derivation bug degrades alerts only — never health, never the source mutation. Cost is measured on 30 accounts and recorded |
| Dispatcher load | Single process, bounded batch, no polling loop, no scheduler enabled. It runs only when invoked |
| A new outbound dependency | The transport uses the Python standard library (`urllib.request`) with a timeout, so no new package is installed and the container image does not grow |
| Enum-name storage trap | The A2 lesson applies: every SQL comparison on a status column binds the enum member, not a lowercase string |

## 9. Explicit confirmation (A3 §7.4 item 11)

A3 as designed **performs no deployment**: no image is built, `docker compose up` is not run, no
Coolify/Vibe Host configuration is touched. A3 **sends no real Telegram message**: automated tests
and the live pilot use `FakeNotificationTransport`, the real transport is disabled by default,
no bot token exists in this repository or its environment, and a real send would require the user
to configure a token and name an approved chat. A3 changes no A1 readiness semantics and no A2
health semantics, adds no score, and creates no path by which an alert can act on an advertising
platform.

## 10. One deliberate test change to declare up front

`test_backend_contains_no_outbound_http_or_browser_dependency` (written in A2) forbids importing
`urllib.request` anywhere in the backend. A3 legitimately needs exactly one outbound call, to
Telegram. The test is therefore **narrowed, not deleted**: it still forbids every browser driver
and every general HTTP client, and it now additionally asserts that the single permitted
outbound module is `services/telegram_transport.py`. Weakening an invariant silently would be the
worst possible way to add a network call, so it is declared here and recorded in `TEST_LOG.md`.
