# ARCH

Architecture of the AdsOps Control Center as of MINI-SPEC A2.

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
  │           · account-health
  ├─ services: registry · references · links · checklist · evidence · rollup · events
  │            · audit · workspace access · redaction
  │            · health rules · health engine · health signals · snapshots · runs · backfill
  └─ SQLAlchemy 2.0 (sync) → PostgreSQL 16
```

There is still no Redis and no worker after A2. Health evaluation is the second background-shaped
job, and it is handled the same way readiness is — synchronously, inside the transaction of the
mutation that caused it, wrapped in a SAVEPOINT. A1's only background-shaped work is readiness
recalculation,
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

## 4b. Health engine (A2)

Health answers a different question from readiness and therefore has its own engine, its own
vocabulary and its own tables. Readiness asks *are the operational prerequisites documented and
current?*; health asks *what needs attention now, and why?* Neither implies the other, and both
are displayed side by side.

```
A1 facts ──► HealthFacts ──► typed rule registry ──► SignalCandidate[]
(account status,               (10 rules, versioned,      (deterministic signal_key
 readiness result,              pure functions)            + allowlisted evidence)
 checklist + evidence,                                             │
 unresolved events)                                                ▼
                                                    AccountHealthSignal reconcile
                                                    (open / acknowledge / resolve /
                                                     expire / supersede — never delete)
                                                                   │
                                                                   ▼
                                                     roll_up() ──► AccountHealthSnapshot
                                                                   + HealthEvaluationRun
```

### Rules

`app/services/health_rules.py` holds a fixed registry of typed rules. A rule is a Python function
with metadata, not a stored expression: A2 forbids user-authored rule code, and a registry keeps
evaluation deterministic, reviewable and cheap. `health_rule_definitions` rows mirror the registry
so rules can be enabled, disabled and versioned; they are seeded lazily and idempotently on first
use, so one definition of the rule set cannot drift from a second copy written in SQL.

A disabled rule stops producing candidates. It never erases what it produced before: existing
active signals from that rule are marked `expired`, and the history stays.

### Signal lifecycle and deduplication

`signal_key` is `rule_key` plus a source scope (`account`, `readiness`, `checklist`,
`manual_review`, `inputs`, `event:<uuid>`). On each evaluation:

| Situation | Outcome |
|---|---|
| Candidate with no active signal | New signal, `open` |
| Candidate matching an active signal, same evidence hash | Only `last_evaluated_at` is touched — which is what preserves an `acknowledged` status instead of resetting it |
| Candidate matching an active signal, different evidence hash | Successor signal created; the previous one becomes `superseded` and points at its replacement |
| Active signal with no matching candidate | `resolved` by the engine (`resolved_by` is NULL), or `expired` if its rule was disabled |

Uniqueness is enforced by the database, not by hope: `active_key` mirrors `signal_key` while a
signal is open or acknowledged and is NULL otherwise, with `unique(ad_account_id, active_key)`.
A PostgreSQL partial index would also work but would break A1's property that one migration runs
on any backend; NULLs never collide in a unique index on either.

The evidence hash excludes volatile keys (`recorded_at`), so editing an unrelated field on an
account does not supersede a signal that still says the same thing.

### Rollup, algorithm version 1

1. Archived account → `unknown`, freshness `not_applicable`, active signals expired.
2. Failed evaluation → `unknown` with `health_evaluation_failed`.
3. Any active `critical` → `critical`.
4. Else any active `warning` → `warning`.
5. Else any active `attention` → `attention_needed`.
6. Else any active `unknown`-severity signal → `unknown` (the engine could not assess).
7. Else, if the evaluation is current → `clear_signals`.
8. Else → `unknown` with `health_evaluation_stale`.

Acknowledged signals count in steps 3-6. Acknowledging records that you saw something; it is not
a claim that it is fixed.

### Freshness is derived at read time

A snapshot records what was true when it was written, and without a scheduler nothing rewrites it
as it ages. `present_snapshot()` therefore recomputes freshness on every read and downgrades a
stale `clear_signals` to `unknown`. The list endpoint expresses the same rule in SQL so filters
and counts agree with the rows behind them. This is the difference between "we checked and found
nothing" and "we have not checked lately", and the second must stay visible.

### Failure isolation

`evaluate_account_safe()` runs the evaluation inside `SAVEPOINT`. If a rule raises, only the
health work rolls back: the A1 mutation still commits, a `failed` HealthEvaluationRun is written
with the exception type, and the account's snapshot is set to `unknown`. This is what makes
synchronous evaluation safe to hang off every mutation.

### Evaluation triggers

Account create/update/archive/restore, asset link/unlink, checklist review, evidence
add/update/archive, manual review, account event create/update/resolve, manual recalculation and
backfill. Each records its `trigger_type` on the run.

### Cost

Measured on 30 accounts (see `TEST_LOG.md`): ~44 ms and 31 queries per account, no measurable RSS
growth. No browser, no external call, no new runtime dependency.

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
| Health evidence | Built from allowlisted fields per rule and passed through the same recursive redactor before persistence; signal action payloads go through `StrictPayload`, and `evidence_reference` refuses credential-shaped values |
| Health authorization | Every health route resolves the workspace from the membership; a foreign signal or account is reported as `404`. Backfill is owner-only and requires explicit confirmation |

The backend is the final enforcement point. Client-side omission is never trusted: the tests
prove the API refuses a secret field even when the UI has no input for it.

## 6. Deployment

`docker-compose.yml` runs three services — `db`, `api`, `web` — each with a memory limit and a
health check. The API container runs `alembic upgrade head` before `uvicorn` with a single
worker. nginx serves the built SPA and proxies `/api` and `/health` to the API, so the bundle
carries no cross-origin base URL.

Backup/restore is a standard `pg_dump` of the `db_data` volume; migrations are forward-only and
verified on a clean database by the test session itself.

## 6b. A1 storage detail confirmed during the A2 audit

SQLAlchemy's `Enum(native_enum=False)` persists the enum **name**, so the database holds
`OPERATIONALLY_READY` while the API always serialises `.value` (`operationally_ready`). The
external contract is lowercase and covered by tests. Any hand-written SQL that filters on these
columns must bind the enum member, not a lowercase string — A2's health filters do exactly that.

## 7. Deliberately rejected designs

- **Numeric risk score** — a single number hides uncertainty and implies a safety claim the
  product must never make.
- **Browser-first platform** — the VPS cannot host browser workloads, and the registry problem
  does not need them.
- **Proxy-as-security** — a proxy reference proves nothing about account stability; it is
  optional metadata that can never make an account ready.
- **Direct bulk-operation engine** — mutation capability without a confirmation and audit
  foundation is exactly the thing A1 exists to prevent.

Rejected again in A2:

- **One health score replacing readiness** — readiness and open issues are different questions,
  and a number hides cause, uncertainty and the A1 guarantees.
- **ML restriction prediction** — there is no authorised basis for it; it would produce confident
  claims with nothing behind them.
- **Auto-remediation from a signal** — A2 mutates no platform asset. Every action is manual and
  recorded.
- **Browser/proxy telemetry as a health input** — environment metadata is not evidence about an
  account, and collecting it would cross the product's boundary.
- **User-authored dynamic rule code** — a security, correctness and auditability risk; the typed
  registry gives the same expressiveness with none of it.
