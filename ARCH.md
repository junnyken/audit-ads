# ARCH

Architecture of the AdsOps Control Center as of MINI-SPEC A1.

## 1. Shape of the system

```
Browser (React 18 + TypeScript + Tailwind + TanStack Query)
  │  REST, bearer JWT, JSON
  ▼
nginx  ── serves the SPA, proxies /api and /health to the API container
  │
  ▼
FastAPI
  ├─ middleware: request/correlation id → structured JSON log → security headers → CORS
  ├─ deps: ApiContext (session, user, membership, workspace, audit writer)
  ├─ routers: auth · ad-accounts · references · readiness · events · audit · system
  ├─ services: registry · references · links · checklist · evidence · rollup · events
  │            · audit · workspace access · redaction
  └─ SQLAlchemy 2.0 (sync) → PostgreSQL 16
```

There is no Redis and no worker. A1's only background-shaped work is readiness recalculation,
which is a handful of indexed reads; running it inside the mutation's transaction is both
cheaper and more honest than a queue, because a stored readiness state can never be newer than
the data it was computed from. The target VPS (4 vCPU / 8 GB, already loaded) has no budget for
a broker that buys nothing.

## 2. Request lifecycle

1. `RequestContextMiddleware` assigns or accepts `X-Request-ID`, stores it in a `ContextVar`,
   echoes it on the response, and logs one structured line (method, path, status, duration —
   never query values or bodies).
2. `get_context` decodes the JWT, loads the user, the workspace and the membership. **The
   workspace id comes from the membership, never from the request.** That is what makes
   cross-workspace access structurally impossible rather than a rule each endpoint has to
   remember.
3. `get_write_context` additionally requires a mutating role.
4. The router calls services, which share one `Session`. The route commits once.
5. Every mutation writes its audit row in that same transaction, so a commit persists both the
   change and its record, or neither.
6. Errors become `{"error": {code, message, details, request_id}}`.

## 3. Data model

14 domain entities plus `users`:

```
Workspace 1─* WorkspaceMember *─1 User
Workspace 1─* BusinessManager · PersonalAccountReference · AdAccount · Page · Pixel
             · PaymentProfileReference · BrowserProfileReference · ProxyReference · AuditLog

BusinessManager           1─* AdAccount
PersonalAccountReference  1─* AdAccount
AdAccount *─* Page | Pixel | PaymentProfileReference | BrowserProfileReference | ProxyReference
          via AccountAssetLink (linked_at / unlinked_at / linked_by / unlinked_by)
AdAccount 1─* ReadinessChecklistItem 1─* ReadinessEvidence
AdAccount 1─* AccountEvent
```

Conventions:

- Every workspace-scoped table carries `workspace_id`, so authorization is a database predicate.
- Every domain table has `created_at`, `updated_at`, `archived_at`. Nothing is hard-deleted.
- `audit_logs` is the single exception: append-only, no `archived_at`, no update or delete path.
  An immutable record that can be archived is not immutable.
- Enums are `VARCHAR + CHECK` (`native_enum=False`), which is portable and lets a value be added
  with a constraint change instead of an `ALTER TYPE`.
- `sa.Uuid` and `sa.JSON` keep the schema portable, so the same migration is verifiable
  anywhere.

Constraints and indexes:

- `unique(workspace_id, external_account_id)` on `ad_accounts`; blank external ids normalise to
  `NULL` so several accounts may legitimately have none.
- `unique(ad_account_id, item_key)` on checklist items (this is what makes initialisation
  idempotent at the database level, not only in code).
- Uniqueness per workspace on every reference's external identifier.
- Composite indexes for the list filters (`workspace_id` with `archived_at`, `status`,
  `readiness_status`, `updated_at`, `last_manual_review_at`) and for audit retrieval
  (`workspace_id + created_at`, `entity_type + entity_id`).

## 4. Readiness engine

`app/services/readiness.py` is a pure function: account + checklist items + events + link facts
→ a result. It touches no database, which is why its 25 unit tests describe rules rather than
fixtures. `ReadinessRollupService` loads the facts, calls it, and persists the outcome.

### Item kinds

- **Operator items** need an explicit review, and where `requires_evidence` is set, verified
  evidence too.
- **Derived items** are computed from facts already recorded — an active link, an ownership
  mapping, a review timestamp. They cannot be hand-marked; the API refuses it with a 409. This
  is what stops "browser reference assigned" being ticked while none is assigned.

### Per-item outcome

| Condition | State |
|---|---|
| review `needs_update`, evidence `rejected`/`expired`, item past `expires_at`, or a waiver on a required item | `problem` |
| review `completed` and (no evidence required or evidence `verified`) | `satisfied` |
| review `completed` but evidence not verified, review `in_review`, or `not_reviewed` | `unknown` |
| condition not met for this account | `not_required` |

A waiver is recorded with its reason and still does not satisfy a required item (A1 §B).

### Rollup precedence (algorithm v1)

1. Archived account → `unknown`, reason `account_archived`.
2. Status `restricted` or `disabled` → contributes a critical reason.
3. Unresolved `critical` events → critical reasons.
4. Any required item in `problem` → warning reasons.
5. **If 2, 3 or 4 produced anything → `not_ready`.**
6. Any required item in `unknown` → `unknown`.
7. Account status still `unknown` → `unknown` (materially incomplete).
8. Unresolved `warning` events → `ready_with_warnings`.
9. Otherwise → `operationally_ready`.

Known-bad outranks unknown, and unknown outranks ready. `operationally_ready` therefore requires
every required item satisfied, a current manual review, no unresolved warning or critical event,
and a status that is not restricted or disabled.

### Conditional requirements

| Item | Required when |
|---|---|
| `business_manager_confirmed` | `account_type == business_manager` |
| `personal_account_reference_confirmed` | `account_type == personal_reference` |
| `page_linked` / `pixel_linked` | the operator marked the account as needing a Page / Pixel |
| `landing_page_verified`, `contact_policy_verified` | a landing page URL is assigned |
| `proxy_reference_reviewed` | never required — advisory only, surfaced as an `info` reason |

The condition is an explicit operator-set flag rather than an inference from unrelated metadata
(A1 Guardrail 6), and the engine returns the reason with every item.

### Data freshness

`last_synced_at` is `null` in A1 because nothing syncs, so freshness reports `unknown`. It is not
reported as `current`.

## 5. Security model

| Control | Implementation |
|---|---|
| Authentication | JWT (HS256), PBKDF2-HMAC-SHA256 password hashing (260k iterations, stdlib — no compiled dependency on the VPS) |
| Authorization | `WorkspaceAccessService`; every `/api/v1` route resolves the workspace from the membership |
| Cross-workspace probing | A foreign row is reported as `404`, never `403` |
| Secret rejection | `StrictPayload` scans request bodies recursively and refuses secret-named fields with `forbidden_field` |
| Credential-shaped values | Reference fields refuse connection strings, `user:pass@host` forms and bearer strings |
| Redaction | One recursive redactor guards logs **and** audit payloads; `password_hash` is dropped from snapshots |
| Audit integrity | Append-only table, no mutation endpoint, written in the mutation's transaction |
| Transport/headers | CORS allowlist (no wildcard), `nosniff`, `DENY` framing, `no-referrer`, `noindex` |
| Frontend | Only `VITE_API_BASE_URL` reaches the bundle; the compose build uses same-origin (`""`) |

The backend is the final enforcement point. Client-side omission is never trusted: the tests
prove the API refuses a secret field even when the UI has no input for it.

## 6. Deployment

`docker-compose.yml` runs three services — `db`, `api`, `web` — each with a memory limit and a
health check. The API container runs `alembic upgrade head` before `uvicorn` with a single
worker. nginx serves the built SPA and proxies `/api` and `/health` to the API, so the bundle
carries no cross-origin base URL.

Backup/restore is a standard `pg_dump` of the `db_data` volume; migrations are forward-only and
verified on a clean database by the test session itself.

## 7. Deliberately rejected designs

- **Numeric risk score** — a single number hides uncertainty and implies a safety claim the
  product must never make.
- **Browser-first platform** — the VPS cannot host browser workloads, and the registry problem
  does not need them.
- **Proxy-as-security** — a proxy reference proves nothing about account stability; it is
  optional metadata that can never make an account ready.
- **Direct bulk-operation engine** — mutation capability without a confirmation and audit
  foundation is exactly the thing A1 exists to prevent.
