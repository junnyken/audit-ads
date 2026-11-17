# MINI-SPEC A1 Report — Account Registry & Stability Readiness

Date: 2026-09-04 · Status: **Complete** · Repository: `projects/audit-ads`

## 1. Summary

A1 delivers the central, auditable registry the operator was missing: ad accounts mapped to
Business Managers or personal-account references, linked to Pages, Pixels, payment profiles and
non-secret browser/proxy references, each with a 14-item evidence-first readiness checklist.
A deterministic rollup turns those records into one of four explainable states — `unknown`,
`not_ready`, `ready_with_warnings`, `operationally_ready` — always with item-level reasons and
never with a numeric score or a safety claim. Every mutation writes a redacted, immutable audit
row in the same transaction. The stack is a FastAPI + PostgreSQL backend and a React/TypeScript
dashboard, deployable with Docker Compose on the existing VPS without any browser workload.

## 2. Audit Before Build

- **Files/docs inspected:** the entire project directory — it was empty. No `.git`, no backend,
  no frontend, no lockfile, no `README.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md` or
  `MINI_SPEC_PLAYBOOK.md`. Environment inspected instead: Python 3.12.3, Node 22.22.3, Docker
  with a `postgres:16-alpine` image available, sibling projects confirming the one-git-repo-per-
  project convention.
- **Existing views/API/state inspected:** none existed. Every "reuse the existing convention"
  clause in A1 degraded to "establish the convention", which is recorded as such in
  `docs/AUDIT_BEFORE_BUILD.md` rather than presented as reuse.
- **Confirmed gaps:** G1 bootstrap (deployment), G2 domain model, G3 vocabulary, G4 readiness
  state machine, G5 API surface, G6 auth/authorization/redaction (security), G7 audit log,
  G8 dashboard surfaces (frontend_UX), G9 observability, G10 test tooling.
- **Out-of-scope findings (documented, not built):** no CI runner for this repository; Redis and
  Celery are not needed by A1 and were not introduced; no rate-limiting middleware existed to
  extend; the workspace host (12 vCPU / 62 GB) is not the 4 vCPU / 8 GB target VPS, so compose
  limits are sized for the target rather than for the machine the build ran on.

## 3. Design Choice

- **Chosen design:** evidence-first registry plus a deterministic readiness rollup.
- **Why:** it fixes the actual problem (account knowledge scattered across Chrome environments)
  while making "green dashboard theatre" structurally impossible — incomplete data resolves to
  `unknown`, never to a pass. It separates account facts from browser/proxy operational labels,
  produces a historical evidence trail usable in a legitimate manual review, and runs on the
  current VPS with no browser processes. A later authorised integration can populate signals
  without rewriting the core model.
- **Rejected, per A1:** numeric risk score (hides uncertainty, implies a safety claim);
  browser-first platform (VPS cannot host it, and the registry problem does not need it);
  proxy-as-security (a proxy reference proves nothing — it is optional metadata that can never
  make an account ready); direct bulk-operation engine (mutation before audit foundations).
- **Patterns established (nothing pre-existed to reuse):** app factory + one router per
  resource; sync SQLAlchemy sessions so a mutation and its audit row share one transaction;
  `{"error": {code, message, details, request_id}}`; `{items, page, page_size, total,
  total_pages}`; `archived_at` soft-delete everywhere; one redactor guarding both logs and audit
  payloads; one readiness colour map in the frontend.

## 4. Changed Files

Everything is new (initial commit).

**Backend** — `app/core/{config,enums,errors,context,redaction,security,logging}.py`;
`app/db/{base,session}.py`; `app/models/{__init__,entities}.py`;
`app/schemas/{common,auth,registry,readiness,events,audit}.py`;
`app/services/{base,audit,workspace,checklist_config,readiness,rollup,checklist,links,registry,references,events}.py`;
`app/api/{deps,middleware}.py`; `app/api/v1/__init__.py`;
`app/api/v1/routers/{auth,ad_accounts,references,readiness,events,audit,system}.py`;
`app/{main,bootstrap}.py`; `app/seeds/fixtures.py`; `pyproject.toml`, `requirements.txt`,
`requirements-dev.txt`, `pytest.ini`, `Dockerfile`.

**Frontend** — `src/{main,App}.tsx`; `src/index.css`; `src/lib/{api,types,readiness,format,resources}.ts`;
`src/hooks/useAuth.tsx`; `src/components/{AppShell,ui,AccountFormDrawer,ReferenceManager,AuditDiff}.tsx`;
`src/pages/{Login,Overview,Accounts,AccountDetail,BusinessManagers,Assets,Readiness,AuditLog,SystemStatus,Settings}.tsx`;
`src/pages/account/{OverviewTab,AssetsTab,ReadinessTab,EventsTab,AuditTab}.tsx`;
`package.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.js`, `eslint.config.js`,
`tsconfig*.json`, `Dockerfile`, `nginx.conf`.

**Migrations** — `backend/alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`,
`alembic/versions/0001_a1_account_registry_and_readiness.py`.

**Infrastructure** — `docker-compose.yml`, `.env.example`, `.gitignore`.

**Tests** — `backend/tests/{conftest,test_readiness_engine,test_redaction,test_registry_api,test_readiness_api,test_security_api,test_audit_api}.py`;
`frontend/src/test/{setup.ts,readiness.test.ts,components.test.tsx,live.app.test.tsx}`.

**Documentation** — `README.md`, `MINI_SPEC_PLAYBOOK.md`, `FEATURES.md`, `ARCH.md`, `API.md`,
`TEST_LOG.md`, `CLAUDE.md`, `docs/AUDIT_BEFORE_BUILD.md`, `docs/MINI_SPEC_A1_REPORT.md`.

## 5. New API/DB/State

**Tables (17):** `users`, `workspaces`, `workspace_members`, `business_managers`,
`personal_account_references`, `ad_accounts`, `pages`, `pixels`, `payment_profile_references`,
`browser_profile_references`, `proxy_references`, `account_asset_links`,
`readiness_checklist_items`, `readiness_evidence`, `account_events`, `audit_logs`,
`alembic_version`.

**Enums (as `VARCHAR + CHECK`):** workspace role, account type, account status, readiness
status, evidence status, checklist review status, event severity, event status, checklist
category, asset type, reference status.

**Endpoints:** 77 routes. Auth (2), ad-account registry (6), asset links (4), seven reference
resources (6 operations each = 42), readiness and evidence (10), events (4), audit (2), system
and health (3), plus OpenAPI docs. **No `DELETE` route exists.**

**State/rollup behaviour:** readiness recomputes synchronously inside the transaction of any
account, checklist, evidence, asset-link or event mutation, and the account's stored
`readiness_status` plus `readiness_evaluated_at` are updated only when that transaction commits.
A readiness *read* never persists. Checklist initialisation is idempotent in code and enforced
by a `unique(ad_account_id, item_key)` constraint.

## 6. Tests

| Layer | Result |
|---|---|
| Unit (readiness engine, redaction) | 53 passed |
| Integration (registry, readiness lifecycle, security, audit) | 58 passed against real PostgreSQL |
| **Backend total** | **111 passed** |
| Frontend hermetic | 16 passed |
| Frontend live-API rendering | 7 passed |
| Backend lint (`ruff`) | clean |
| Frontend lint (`eslint`) | clean |
| Typecheck + production build (`tsc -b && vite build`) | passed, 292 kB / 86 kB gzip |
| Migration on a clean database | passed (run by every pytest session) |

Full detail, including the five defects found and fixed during the session, is in `TEST_LOG.md`.

## 7. Live Verification

Three pilot records were created end-to-end through the API on a freshly created database, plus
one throwaway account for the archive check. 28/28 checks passed.

| Scenario | Expected | Actual |
|---|---|---|
| A — complete BM mapping, all mandatory evidence verified, current manual review, no events | `operationally_ready` | `operationally_ready` (10/10 items) |
| B — payment review missing | `unknown`/`not_ready` with an explicit payment reason | `unknown`, `payment_method_reviewed_incomplete` |
| C — restricted status with an unresolved critical event | `not_ready` with restriction/event reasons | `not_ready`, `account_status_restricted` + `unresolved_critical_event` |

Also verified live: registry filters and search by BM name; pagination; unlinking a Page
downgraded A to `unknown` and re-linking restored it (proving readiness follows real links, not
a cached flag); archiving retained the checklist, the audit trail and refused edits; `DELETE`
returned 405; 49 audit rows across 19 distinct action types with no credential-like key
persisted; the system-status payload exposed no infrastructure value.

**Issues found and fixed during live verification:** the reference routers' body schemas were
being treated as query parameters (PEP 563 annotations inside a router factory), and
`CORS_ORIGINS=a,b` crashed startup because pydantic-settings JSON-decodes list env values before
validators run. Both are fixed with a comment explaining the constraint, and both are covered by
tests.

## 8. Remaining Limits / Follow-ups

**Intentionally excluded (A1 non-goals):** platform connection or mutation; campaign
publish/pause/edit/duplicate/delete; bulk operations; Telegram or any notification delivery;
browser automation, antidetect, fingerprinting, cookie handling, proxy rotation; credential or
session storage; payment changes; numeric risk score or restriction prediction; team-assignment
UX beyond the authorization foundation.

**Technical debt / deferred:**

1. **Compose stack not built or started.** Images were not built and the nginx path was not
   exercised; the app was verified via uvicorn and a production frontend build. Deploying to the
   target VPS is the next operational step.
2. **No CI.** Test, lint and build commands are documented but not wired to a runner.
3. **No rate limiting.** A1 had no middleware to extend; documented as a follow-up per A1 §H.
4. **No evidence file storage.** Evidence is metadata plus an optional external link.
5. **Roles are not assignable through the UI.** The data model and permission checks already
   support them.
6. **No manual browser click-through.** UI verification rendered the real components against the
   live API in jsdom; that is strong evidence, but it is not a human driving Chrome.
7. **`last_synced_at` is always empty**, so data freshness reports `unknown`. This is correct for
   A1 — nothing syncs — and becomes meaningful when an authorised integration lands.

**Recommended next MINI-SPEC:** `A2 — Evidence-Based Account Health`. It should add time-bound
signals, data-freshness rules, health-signal reasons and alert priorities, reusing A1's account
events, readiness evidence, audit log and registry. It must not introduce a parallel health
engine, and must not add risk prediction. `A3 — Alert Center and Telegram Notification Delivery`
follows it.

**A2 is proposed, not started.**
