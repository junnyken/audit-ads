# A2 — Audit Before Build Report

- MINI-SPEC: A2 — Evidence-Based Account Health & Alert Foundation
- Date: 2026-09-04
- Baseline commit audited: `0b5a67b` (A1 delivered in `1692462`)
- Status: **Accepted — A1 baseline verified, all named invariants hold, A2 may proceed**

## 1. Verified A1 baseline (measured, not quoted)

| Claim in the A2 brief | Verification command | Actual |
|---|---|---|
| FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 | `requirements.txt`, `docker compose config` | ✔ fastapi 0.115.6, SQLAlchemy 2.0.36, postgres:16-alpine |
| React + TypeScript + Tailwind frontend | `frontend/package.json` | ✔ React 18.3, TS 5.7, Tailwind 3.4, Vite 6, TanStack Query 5 |
| 16 database tables | `len(Base.metadata.tables)` | ✔ **16** ORM tables (17 in the database including `alembic_version`) |
| 77 routes | enumerated from `app.routes` | ✔ **77** unique method+path pairs |
| Four readiness states, reason-level output | `app/services/readiness.py` | ✔ pure function → `ReadinessResult` with `reasons[]` and `items[]` |
| No hard delete | route method set | ✔ methods present are only `GET`, `PATCH`, `POST` |
| Migration revision | `SELECT version_num FROM alembic_version` | ✔ `0001_a1_registry`, single revision |
| Celery / Redis present | grep across backend + compose | ✘ **absent** — no broker, no worker, no scheduler |
| Docker Compose valid, limits declared | `docker compose config` | ✔ services `db`/`api`/`web`, `mem_limit` 1g/512m/128m, healthchecks present. **Not deployed** (A2 §7.1 forbids deploying unless asked) |

**Deviation from the prior A1 report:** none material. The A1 report said "16 domain entities plus
`users`"; the accurate count is 16 ORM tables in total (15 domain tables + `users`), 17 including
`alembic_version`. The A2 brief's "16 database tables" is the correct figure. Recorded here so the
number stops drifting.

## 2. A1 invariants — re-run, all hold

```
$ .venv/bin/python -m pytest tests/                     111 passed
$ .venv/bin/ruff check .                                All checks passed
$ npx vitest run src/test/readiness.test.ts             6 passed
```

| Invariant (A2 §7.2) | Test | Result |
|---|---|---|
| Missing mandatory evidence cannot yield `operationally_ready` | `test_missing_mandatory_evidence_is_unknown_with_item_reason` | PASS |
| Manual completion of derived checklist items is rejected | `test_derived_items_cannot_be_hand_marked` (409 + `derived_from`) | PASS |
| Waiver does not satisfy a mandatory item | `test_waiver_never_satisfies_a_required_item` | PASS |
| Sensitive fields rejected/redacted | `test_payload_with_a_password_field_is_refused` (422 `forbidden_field`) | PASS |
| Cross-workspace access does not reveal existence | `test_cross_workspace_access_is_denied` (404, not 403) | PASS |
| Archive preserves audit/evidence history | `test_archive_is_reversible_and_keeps_children`, `test_archiving_an_account_keeps_its_audit_history_visible` | PASS |
| `unknown` / `not_ready` visual state is not green | `readiness.test.ts` colour-map tests | PASS |

**No A1 regression found. No repair needed. A2 proceeds on an intact baseline.**

## 3. Reusable components found (the reuse map)

**Backend**

| Concern | Reused from A1 |
|---|---|
| Workspace authorization | `app/api/deps.py` — `Ctx` / `WriteCtx` / `AuditCtx`, `ApiContext(session, user, membership, workspace, audit)` |
| Scoped fetch, non-disclosure | `services/base.py::get_or_404` (foreign row → 404), `require_active` |
| Pagination / sort | `services/base.py::paginate`, `apply_sort`; `schemas/common.py::page_response` |
| Error envelope + correlation id | `core/errors.py`, `core/context.py`, `api/middleware.py` |
| Audit | `services/audit.py::AuditLogService.record(...)` writing in the mutation's transaction |
| Redaction / secret rejection | `core/redaction.py`, `schemas/common.py::StrictPayload`, `reject_credential_like` |
| Soft archive | `db/base.py::Archivable`, `archived_at` everywhere |
| Portable schema conventions | `sa.Uuid`, `sa.JSON`, `sa.Enum(native_enum=False)` |
| Test harness | `tests/conftest.py` — Alembic-rebuilt schema, `db_session`, `api`, `other_auth` fixtures |

**Frontend**

| Concern | Reused from A1 |
|---|---|
| Shell + nav | `components/AppShell.tsx` |
| Badge / Card / StatTile / EmptyState / ErrorState / Skeleton / Field / Drawer / Tabs / Progress / InlineNote | `components/ui.tsx` |
| Status colour discipline | `lib/readiness.ts` — one `Tone` vocabulary and `TONE_CLASS` map |
| Audit diff rendering | `components/AuditDiff.tsx` |
| API client, `ApiError.requestId`, `query()` | `lib/api.ts` |
| URL-synchronised filters | `pages/Accounts.tsx` via `useSearchParams` |
| Account detail tabs | `pages/AccountDetail.tsx` + `pages/account/*Tab.tsx` |

**Not found (so A2 must not assume it):** no generic `DataTable` component (tables are composed
from `.th`/`.td`/`.table-scroll` utility classes), no custom query-hook module (TanStack Query is
used directly), **no background task framework of any kind**.

## 4. Confirmed A2 gaps

| # | Gap | Class |
|---|---|---|
| H1 | No health vocabulary: health status, signal status, signal severity, freshness status, rule category, source type, run trigger/status | vocabulary |
| H2 | No health tables: rule definitions, signals, snapshots, evaluation runs | data_model |
| H3 | No signal lifecycle (open → acknowledged → resolved / expired / superseded), no deduplication key, no active-signal uniqueness | state_machine |
| H4 | No health engine; the readiness engine answers a different question and must not be overloaded | architecture |
| H5 | No health endpoints, filters, or signal actions | API |
| H6 | No health surfaces: overview cards, health list page, Health tab, signal drawer, recalculate UX | frontend_UX |
| H7 | No evaluation-run observability, no health log events, no failed-run counter in system status | observability |
| H8 | No evaluation trigger points wired to A1 mutations | architecture |
| H9 | No health tests | testing |
| H10 | No worker/scheduler; A2 must not add one merely to satisfy the spec | deployment |

## 5. Decisions taken before writing code

**Worker/scheduler (A2 §G).** A1 has no Celery, no Redis, no scheduler, and the target VPS is
already loaded. Per A2 §G ("if worker infrastructure is absent or untested: do not add a
production scheduler merely to meet A2"), A2 implements **synchronous, savepoint-isolated
evaluation** plus a **command abstraction** (`python -m app.commands.evaluate_health`) that A3 can
wire to a scheduler. No Redis, no Celery, no periodic job is introduced. Documented as a limit.

**A1 mutations must not fail because health evaluation failed.** Synchronous evaluation inside
the mutation's transaction would couple them. A2 therefore runs each evaluation inside a
`SAVEPOINT`: a failure rolls back only the health work, records a `failed` HealthEvaluationRun,
and marks the account's snapshot `unknown`/`stale`. The A1 mutation still commits.

**Deduplication and active-signal uniqueness.** `signal_key` is deterministic
(`rule_key` + source scope). Rather than a PostgreSQL-only partial unique index — which would
break A1's "one migration runs anywhere" property — A2 adds a nullable `active_key` column that
mirrors `signal_key` while a signal is open/acknowledged and is `NULL` otherwise, with
`unique(ad_account_id, active_key)`. NULLs do not collide on either backend, so the database
enforces "at most one active signal per account per signal key" portably.

**`readiness_not_ready` interaction (A2 §B requires choosing one approach).** It is **suppressed**
when the not-ready state is already fully explained by a critical source fact (restricted/disabled
status, or an open critical event) that A2 has already raised as its own signal. Otherwise it is
emitted. Rationale: the operator should see the cause, not the same fact twice under two names.

**`HealthSignalResolutionHistory` is not created.** A1's `AuditLog` already records actor, action,
before/after and request id for every mutation, and the signal row carries the current
acknowledgement/resolution fields. A2 §A.5 says to prefer that; a second history table would
duplicate audit data without need.

**Backfill.** Owner-only, **bounded and synchronous** (default 5 accounts, hard maximum 50) rather
than asynchronous, because there is no worker. This is a deliberate deviation from A2 §E's
"asynchronous"; a bounded synchronous batch is safer than adding a broker A2 was told not to add.
Recorded as a follow-up for A3.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Evaluation cost on every A1 mutation | Engine reads only indexed rows for one account; measured on 30 accounts and recorded in `TEST_LOG.md` |
| VPS load | No worker, no browser, no external call. Memory profile unchanged; compose limits untouched |
| Migration compatibility | Single additive revision `0002_a2_account_health`, `down_revision = 0001_a1_registry`; no A1 table is altered, no A1 column is changed |
| Rollback | `alembic downgrade 0001_a1_registry` drops only the four new tables; A1 data is untouched |
| Health being mistaken for a safety verdict | `clear_signals` is worded "No current issues found by configured checks" everywhere, enforced by a test |

## 7. Explicit confirmation (A2 §7.5 item 9)

A2 as designed **does not** change any A1 readiness enum value, meaning or decision rule; **does
not** introduce a numeric score; **does not** mutate any advertising platform, account, campaign,
browser profile or proxy; **does not** add browser automation or any new runtime dependency; and
**does not** accept or store any credential, cookie, session, token or proxy secret. Health is
additive and read-only with respect to A1 source records.
