# A1 — Audit Before Build Report

- Project: AdsOps Control Center (`audit-ads`)
- MINI-SPEC: A1 — Account Registry & Stability Readiness
- Date: 2026-09-04
- Auditor: AI Implementation Partner
- Status: **Accepted → bootstrap required**

## 1. Repository and documentation audit

| Item | Finding |
|---|---|
| Repository root | `/home/coder/workspace/projects/audit-ads` — **completely empty**, no `.git` before this audit |
| Backend location | none |
| Frontend location | none |
| Package managers / lockfiles | none |
| Python environment / tooling | system Python 3.12.3, `pip` 24.0, `venv` available. No project venv |
| Test configuration / coverage | none |
| Docs (`README.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `MINI_SPEC_PLAYBOOK.md`) | **all absent** — created as minimal structure per A1 §Required documents |
| Lint / typecheck / build scripts | none |

**Consequence:** every "reuse existing convention" clause in A1 degrades to "establish the convention".
There is no existing framework, ORM, auth, API, frontend or deployment pattern to preserve, so
A1 Step 1 (Bootstrap) is confirmed **required**, and the additive-first rule applies from this
commit forward.

## 2. Architecture audit

Nothing existed. All rows below are decisions, not discoveries:

| Concern | Decision | Rationale |
|---|---|---|
| FastAPI conventions | app factory `create_app()`, one `APIRouter` per resource under `/api/v1` | A1 §F default |
| ORM / migrations | SQLAlchemy 2.0 (sync) + Alembic | Sync sessions make "one transaction per mutation + audit row" trivially auditable |
| Portable column types | `sa.Uuid`, `sa.JSON`, timezone-aware `DateTime` | Same migration runs on PostgreSQL and SQLite, so migration correctness is testable in CI without a server |
| Auth identity | `User` + `Workspace` + `WorkspaceMember(role)` + JWT bearer | A1 §3.2 forbids hard-coding a single user; RBAC roles exist in data from day one |
| Error schema | `{"error": {"code","message","details","request_id"}}` | Needed by A1 §G.7 (error state must show correlation ID) |
| Pagination | `page` / `page_size` / `sort` / `sort_direction` → `{items,page,page_size,total,total_pages}` | A1 §F list filters |
| Audit | single `audit_logs` table, append-only, written inside the mutation transaction | A1 Guardrail 8/9 |
| Redis / Celery | **not introduced in A1** | A1 §J: readiness recalculation is cheap and runs in-transaction. Adding a broker would be a speculative module (Step 1 forbids) |
| Deployment | Docker Compose, `mem_limit` + healthchecks on every service | A1 §4.3 VPS is 4 vCPU / 8 GB and already saturated |

## 3. Security audit

| Concern | Finding / decision |
|---|---|
| `.env` handling | No `.env` existed. `.env.example` created with placeholders only; `.env` is git-ignored |
| Secret leakage risk | Backend rejects secret-named fields at the schema layer **and** redacts recursively before any log/audit write (`SensitiveFieldRedactionService`) |
| AuthN / AuthZ gaps | Every `/api/v1` route depends on `get_current_membership` — workspace scope is resolved server-side, never taken from the client body |
| CORS | Explicit allowlist from `CORS_ORIGINS` env; no `*` |
| Log redaction | Structured JSON logs pass through the same redactor |
| Frontend env exposure | Only `VITE_API_BASE_URL` is exposed; no secret is referenced in the bundle |
| DB backup / migration safety | Documented in `ARCH.md`; Alembic verified on a clean database |

## 4. UX audit

No design tokens, component library, table, drawer, badge, tab or timeline component existed.
Established minimally: Tailwind tokens + `Badge`, `DataTable`, `Drawer`, `Tabs`, `EmptyState`,
`Skeleton`, `ErrorState`. Readiness colour mapping is centralised in one module so A1
Guardrail 10 (no green for `unknown` / `not_ready`) cannot be violated per-page.

## 5. Confirmed gaps

| # | Gap | Class | Addressed by |
|---|---|---|---|
| G1 | No repository, no backend/frontend skeleton, no Compose, no env template | deployment | Step 1 bootstrap |
| G2 | No domain entities for workspace / BM / ad account / assets / references | data_model | Step 2 |
| G3 | No controlled vocabulary for account type/status, readiness, evidence, review, severity | vocabulary | `app/core/enums.py` |
| G4 | No readiness state machine | state_machine | `ReadinessRollupService` (algorithm v1) |
| G5 | No API surface, no pagination/filter/sort, no error schema | API | Step 3 |
| G6 | No auth, no workspace authorization, no redaction, no secret-field rejection | security | Step 1 + Step 3 |
| G7 | No audit log | data_model + security | `audit_logs` + `AuditLogService` |
| G8 | No dashboard, table, detail tabs, readiness surfaces, empty/loading/error states | frontend_UX | Step 4 |
| G9 | No structured logs, request-ID middleware, health or status endpoints | observability | `core/logging.py`, `middleware`, `/health/*` |
| G10 | No test tooling, no fixtures | testing | pytest + seeded pilot fixtures |

## 6. Out-of-scope findings (documented, not built)

- **F1** No CI runner is configured for this repo. Test/lint/build were run locally; wiring CI is a follow-up.
- **F2** Redis + Celery are part of the Master Plan (Phase 2 alerts) but not needed by A1; Compose ships an optional, profile-gated Redis so A3 can enable it without re-architecture.
- **F3** Rate limiting: no middleware existed to extend, so A1 documents it as a follow-up per A1 §H.
- **F4** The observed workspace host (12 vCPU / 62 GB) is **not** the target VPS (4 vCPU / 8 GB). Compose limits are sized for the target, not the dev host.

## 7. Design choice selected

**Evidence-first registry + deterministic readiness rollup** (A1 §Design Choice, chosen design).
Rejected alternatives (numerical risk score, browser-first platform, proxy-as-security,
direct bulk-operation engine) are rejected here for the same reasons stated in A1 and no code
path implements them.

## 8. Files to be changed

Everything is new. See `docs/MINI_SPEC_A1_REPORT.md` §4 for the actual file list produced.
