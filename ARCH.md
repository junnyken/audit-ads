# ARCH

Architecture of the AdsOps Control Center as of MINI-SPEC A5.

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
  │           · account-health · alerts · notification policy · notifications
  ├─ services: registry · references · links · checklist · evidence · rollup · events
  │            · audit · workspace access · redaction
  │            · health rules · health engine · health signals · snapshots · runs · backfill
  │            · alert derivation · alert lifecycle · notification planner · outbox dispatcher
  │            · quiet hours · message template · transport adapter (Telegram / fake)
  └─ SQLAlchemy 2.0 (sync) → PostgreSQL 16
```

A4 adds one long-running process — the dispatcher — and still no broker: the notification outbox is database-backed and
its dispatcher is a bounded, short-lived batch invoked by a command or an owner-only endpoint.
There is still no Redis and no worker after A2. Health evaluation is the second background-shaped
job, and it is handled the same way readiness is — synchronously, inside the transaction of the
mutation that caused it, wrapped in a SAVEPOINT. A1's only background-shaped work is readiness
recalculation,
which is a handful of indexed reads; running it inside the mutation's transaction is both
cheaper and more honest than a queue, because a stored readiness state can never be newer than
the data it was computed from. The target VPS (4 vCPU / 8 GB, already loaded) has no budget for
a broker that buys nothing.

## 2. Request lifecycle

0. `RateLimitMiddleware` consumes a token from the caller's bucket and short-circuits with
   429 before any routing, session or database work. It is registered first and therefore runs
   innermost, so its refusal still passes back out through the CORS, security-header and
   request-context layers — a 429 that lost its CORS headers would reach a browser as an
   opaque failure instead of a stated reason.
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

## 4c. Alert Center and notification outbox (A3)

A third concept, kept as separate from health as health is from readiness:

| Concept | Owner | Question it answers |
|---|---|---|
| Readiness | A1 | Are the required operational records complete and current? |
| Health | A2 | What needs attention on this account, and why? |
| **Alert** | **A3** | **What is waiting for the operator, in what workflow state?** |
| **Notification** | **A3** | **What was actually sent, when, and what happened to it?** |

```
A2 evaluation (inside its own SAVEPOINT)
  └─ signals reconciled, snapshot written, run finished
       └─ A3 derivation (nested SAVEPOINT of its own)
            ├─ alerts reconciled against current A2 facts
            └─ NotificationDelivery rows written in the same transaction   ← the outbox
                                    │
Dispatcher (command, or owner-only endpoint)
  └─ claim due rows: SELECT … FOR UPDATE SKIP LOCKED, batch 10, concurrency 1
       └─ render server-side from an allowlist
            └─ TelegramTransport | FakeNotificationTransport
                 └─ append NotificationDeliveryAttempt, update delivery status
```

### Why an outbox rather than a queue

A2 deliberately shipped no broker. Adding Redis and Celery for notification delivery would add a
container, a process and a failure mode to a VPS that has room for none of them. A database
outbox gives the same guarantees that matter here — durability, idempotency, retry history and
restart recovery — using tables that are already backed up with everything else. A later infra
phase can move the dispatcher behind Celery without changing a single alert or delivery contract.

### Why derivation is nested inside the health savepoint

A2 wraps evaluation in a SAVEPOINT so a health failure cannot roll back the operator's mutation.
A3 opens a **second, nested** savepoint around alert derivation, so an alerting bug degrades
alerting and nothing else: the A1 change commits, the health snapshot stands, and the evaluation
run records `alert_derivation_error`. A test proves exactly that.

The evaluation run is also marked finished *before* derivation runs. Derivation asks "what is the
latest word on this account?", and a run still marked `running` would leave a previous failure
looking current — a recovered account would then never clear its failure alert.

### Deduplication and uniqueness

Two keys, both persisted, neither in memory:

- `alerts.alert_key` identifies a source condition; `active_key` mirrors it while the alert is
  open, acknowledged or suppressed, with `unique(workspace_id, active_key)`.
- `notification_deliveries.idempotency_key` is `alert + reason + severity + recipient`, unique per
  workspace. Planning upserts against it, so re-evaluation cannot produce a second message.

Retries never create a delivery row — they append an attempt.

### Quiet hours

Evaluated with `zoneinfo` in the policy's timezone, never the server's, with cross-midnight
windows handled directly. A warning raised inside the window is **scheduled** for the end of it,
not dropped. Critical bypasses when the policy says so. An unresolvable timezone produces a
`skipped` delivery with `timezone_not_configured` — A3 never guesses an hour to message someone.

### The transport boundary

One interface, two implementations, and a structural test that keeps it that way:
`services/telegram_transport.py` is the only backend module permitted to import an HTTP client,
and browser drivers stay banned everywhere. The token is read from server configuration, is
interpolated into the request URL (which is therefore never logged), and appears in no database
column, no API response, no audit row and no attempt record. `FakeNotificationTransport` records
what would have been sent, which is what every test and the live pilot use.

### What A3 cannot do

There is no path from an alert to an advertising platform. Telegram is one-way: no bot commands,
no callbacks that change state, no recipient chosen per alert, no message body accepted from a
caller. The dispatch endpoint takes a batch size and nothing else.

## 4d. Deployment topology and operational observability (A4)

```
Internet ──HTTPS 443──► platform proxy (Coolify / Vibe Host)   ── or ──►  edge  (nginx, TLS)
                                        │                                   │  [profile: edge]
                                        └───────────────┬───────────────────┘
                                                        ▼
                                            web   (nginx, static React build)
                                                        │ /api, /health
                                                        ▼
                                            api   (FastAPI, uvicorn, 1 worker)
                                                        │
                              dispatcher ───────────────┼──────────────►  db  (PostgreSQL 16)
                              (bounded loop)            │                  private network only
                                                        ▼
                                                persistent volume
```

Two supported shapes, chosen at deploy time rather than assumed: a managed platform terminates
TLS, or the optional `edge` profile does it for a self-managed VPS. The audit could not confirm
which target will be used, and artifacts that only work on one would have been guesswork.

### Why the API image stopped migrating on start

A1–A3 ran `alembic upgrade head` in the container command. That is convenient and wrong: a
crash-looping container replays migrations with nobody watching, and there is no backup in
front of it. A4 makes the migration an explicit release step
(`scripts/release_migrate.sh`) that backs up first, records the revision, and **aborts the
release before the version switch** if anything fails.

### Why the dispatcher is a container, not a timer

A3 left the outbox durable but undrained. A4 §E offers a systemd timer, a cron entry or a
dedicated process. The audit found systemd not running in this workspace and no crontab, and
neither Coolify nor Vibe Host gives host-unit access — so a container is the only mechanism
that works on every target this project can actually deploy to. It is bounded by construction:
one pass at a time, batch 10, a sleep between passes, and a stop signal honoured within a
second.

### Operational runs

One additive table, `operational_runs`, records dispatch passes, recovery sweeps, backups,
restore drills, migration releases and test sends. It is deliberately **not** workspace-scoped:
a dispatch pass covers every workspace and a backup covers the whole database, so pretending
either belongs to one tenant would make the "stale dispatcher" signal wrong the moment a second
workspace exists.

Its `summary_json` passes through an allowlist. A path, a connection string, a recipient or a
provider body is dropped rather than trusted, because this table is what the status page reads.

**"Never run" is a distinct state from "stale"** throughout: one has never started, the other
stopped. Collapsing them into a healthy/unhealthy flag is precisely how an outbox stops
delivering without anyone noticing.

### Host metrics without the Docker socket

CPU, memory and disk come from `/proc` and `shutil.disk_usage` inside the API container.
Mounting the Docker socket would give whoever compromises the API full control of the host — a
far larger risk than the container restart counts it would buy. Container-level detail therefore
comes from the host or the platform, not from the application.

### The controlled test send

A delivery verification, not a product notification. It creates no Alert and writes no
`NotificationDelivery`: it sends through the transport directly and records an
`OperationalRun`. That keeps its dedupe key entirely outside the alert outbox, so a test message
can never collide with, suppress or duplicate a real one.

Four independent gates: workspace owner, a server-side switch that is off by default, an
explicit confirmation, and an approval code proving the exact destination and message were
previewed. The request schema carries **no recipient and no message body** — a structural
guarantee rather than a check that could be skipped.

## 4e. Chrome context extension (A5)

```
 Meta Ads Manager tab
   │  content script  (isolated world, read-only)
   │    reads: the `act` id in the URL, the route path, the tab title
   │    writes: nothing to the page, ever
   ▼
 service worker  ── the only holder of the session, the only network caller
   │                POST /api/v1/extension/context/resolve
   │                POST /api/v1/extension/events
   ▼
 AdsOps API
   ├─ ExtensionContextResolver  → exact id match, or an honest "I don't know"
   ├─ ExtensionSummaryService   → composes A1 readiness + A2 health + A3 alerts
   └─ ExtensionEventIngestService → A1 AccountEventService (audit row, readiness recalc)

 popup / side panel / options  — extension pages, no network access of their own
```

### Two tokens, not one

The extension exchanges a dashboard login for a **separate** token carrying `token_use:
"extension"` and an `installation_id`. Three dependencies keep them apart:

| Dependency | Accepts | Used by |
|---|---|---|
| `Ctx` | dashboard only | every existing route |
| `ExtCtx` | extension only, and only while the installation is live | the extension routes |
| `AnyCtx` | either | the one read-only account summary |

A token lives in browser storage, which is a weaker place than a dashboard tab. So the one that
lives there cannot create an account, change readiness, resolve an alert, edit notification
policy, trigger a test send, or mint another session. That is the whole point of issuing a
second token instead of reusing the first.

Revocation is a **row**, re-checked on every request, so cutting off a browser takes effect
immediately rather than whenever its token would have expired.

Tokens minted before A5 carry no `token_use` claim and are treated as dashboard sessions, so
adding the claim signed nobody out.

### Exact matching, and why canonicalisation is not fuzzy matching

Ads Manager writes the account as `act=123456789` in a query string; the registry may hold
`act_123456789`. A5 canonicalises both — trim, lowercase, drop an `act_` prefix — and then
requires **equality** against a small closed candidate set resolved in SQL. It is a *format*
equivalence, and it never makes two different ids equal.

Names are display-only. There is no similarity function anywhere in A5, so a future change
cannot accidentally reach one, and a test asserts that an account with an identical name but a
different id is not matched.

### Nothing leaves the browser that we would not want stored

The account id is extracted from the query string; the query string itself is discarded before
the request is built. Routes are reduced to an allowlist in the extension **and again on the
server** — the browser side is a convenience, the server side is the guarantee. What is stored
on an event passes a third allowlist: page type, context status, sanitised path, client version,
account id.

### Why the extension is its own package

MV3 needs three HTML entry points, an ES-module service worker and an IIFE content script — an
isolated-world script has no module loader, so a split bundle would fail silently on the page.
The extension therefore has its own build, and a test asserts the shipped content script
contains no `import`.

### What the extension cannot do

There is no code path from the extension to any advertising platform, and none to the operator's
session material: no `cookies`, `webRequest`, `tabs`, `scripting`, `debugger` or `proxy`
permission, no `<all_urls>`, and lint rules that make `document.cookie`, `localStorage`,
`sessionStorage` and `indexedDB` errors rather than choices. The Account Workspace Guard records
that a person checked; it does not block, and the UI says so — claiming otherwise would be a
safety promise the product cannot keep.

## 4f. Meta provider and read-only discovery (A7 / A10 / A10.1)

```
route ──> _provider_for(connection) ──> FakeMetaBusinessProvider      (default)
                                   └──> RealMetaBusinessProvider      (production + token)
                                              │
                                              └──> MetaGraphTransport  (GET-only)
```

`_provider_for` returns the real provider only when a connection is marked `production` **and**
`META_ACCESS_TOKEN` is configured — two deliberate acts by different people, one recorded in the
database and one in the deployment. Either alone stays fake, so a misconfigured environment
degrades to "no real call" rather than to a surprise one.

**The no-write boundary is structural, not a setting.** The real provider's `create_ad_account`,
`share_ad_account_access` and `share_pixel_access` raise `MetaWriteNotEnabled`, and
`MetaGraphTransport` exposes no method that can issue anything but a GET. Two independent
reasons, neither of which can be flipped by configuration.

### One reader, so answers cannot disagree

Every Business Manager read goes through `RealMetaBusinessProvider._read_business_managers()`.
This was learned the hard way: after the first fix there were still **three** readers, and the
one left outside the helper was `probe()` — the operator's own live verification tool. With
`META_BUSINESS_ID` configured it reported zero Business Managers while the capability check
could see one. A verification tool that contradicts the product is worse than either answer
alone, so a test now exercises each public reader in isolation and fails if any of them reaches
for `me/businesses` while an id is configured.

`META_BUSINESS_ID` exists because Meta will not name the business behind a system user token —
established live by asking three ways, not assumed. It is configuration, never a request field;
it is not a secret, so unlike the token it may appear in logs and responses.

### Discovery and reconciliation (A10.1)

```
validate configured BM ──> read assets per edge ──> persist observations
                                                         │
                          registry ────────────────> reconcile at read time
```

Validation is a gate: assets are read only after the configured BM was actually read back,
because an inventory from a BM nobody could confirm cannot be attributed to anything.

Three tables — `business_manager_discovery_runs`,
`discovered_ad_account_observations`, `discovered_pixel_observations`. Reconciliation has **no**
table: the spec calls it rebuildable from observations plus registry state, and something
rebuildable is one less copy that can drift against the two sources it summarises.

Every run records the identity it read as (`provider_actor_*`, surfaced as `read_as`). Measured
2026-09-11: the same Business Manager returned 4 ad accounts to an *Employee* system user and 8
to an *Admin* one. An inventory is a fact about the reader as much as about the BM, and a run by
a narrower token would otherwise report `complete` truthfully while licensing
`missing_from_latest_discovery` for records a broader token had just confirmed. Identity is
established *before* the inventory it qualifies; a test pins that ordering rather than merely
asserting both calls happened.

Coverage is the load-bearing concept. `complete` is derived from whether every `required_edge`
answered — never from the absence of errors, because an edge nobody asked for raises no error,
and that is the case that produces a confidently wrong "missing". The per-edge record includes
edges that were never attempted, and `required_edges` is stored per run so adding an edge later
invalidates old coverage instead of silently reinterpreting it.

Coverage alone still had a hole, found on 2026-09-11 and closed by A10.3. A token with **no role**
in a Business Manager reads that BM's node normally and gets `200` with an empty list and no error
from every asset edge, while `{bm}/system_users` refuses outright. Every required edge answers, so
coverage says `complete` — on an inventory of a Business Manager nobody could read. Each run now
carries a `BusinessAuthority`, asked only when the inventory came back empty: a non-empty result
proves its own authority, an empty one must establish it or its coverage degrades to `unknown`.
The gate is authority, not emptiness — a readable BM that genuinely holds nothing still reports
`complete`, because gating on emptiness would suppress every legitimate absence conclusion for a
BM that was emptied deliberately.

`missing_from_latest_discovery` sits last in the decision tree, behind `unknown`, `matched` and
two `out_of_scope` branches. Pixels can never reach it: `Pixel` has no Business Manager
relationship in the A1 schema, so a registry Pixel cannot be shown to belong to the configured
BM. That asymmetry is reported in the payload rather than hidden.

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
| Bot token | `TELEGRAM_BOT_TOKEN` is server-side only. It is never persisted, never returned, and the redactor masks any key containing "token" before a log or audit row is written. The API exposes a boolean capability instead |
| Recipient | An owner-managed chat reference on the policy row, validated to be a chat id or `@name`; a token-shaped value is refused. It is masked in every response |
| Outbound surface | Exactly one module may make a request, to the configured Telegram API base only. No per-alert recipient, no caller-supplied message body, no arbitrary URL |
| Deep links | Only a configured public HTTPS URL is emitted; localhost, private ranges and bare hostnames are dropped |
| Production configuration | Validated at startup. A production process **refuses to boot** with a missing or placeholder secret, a wildcard CORS origin, `telegram` transport without a token, a non-HTTPS public URL, or the documented pilot credential. Findings carry a code and a sentence, never the value (A4) |
| API surface | `/docs`, `/redoc` and `/openapi.json` are off in production: the schema is a map of the whole API (A4) |
| Network exposure | Database, API and dispatcher have no host port; `web` binds to loopback by default; TLS lives at the edge (A4) |
| Container hardening | Non-root user, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, explicit immutable image tags, no secret in any image layer (A4) |
| Docker socket | Never mounted into an application container (A4) |
| Extension session | A separate `token_use: "extension"` token, shorter-lived, refused by every dashboard route, and revocable by row rather than by expiry (A5) |
| Extension payloads | No workspace id, no credential-like field, no raw URL. The event type is an allowlist and the severity is decided server-side (A5) |
| Extension permissions | `storage`, `sidePanel`, `activeTab` and three path-scoped hosts. No cookies, request interception, tab enumeration, scripting or `<all_urls>` (A5) |

The backend is the final enforcement point. Client-side omission is never trusted: the tests
prove the API refuses a secret field even when the UI has no input for it.

## 5b. Rate limiting

A token bucket per (policy, identity), held in process memory.

**Two policies.** Credential exchange (`/auth/login`, `/extension/connect`) is keyed by client
address, because there is no trustworthy subject yet and keying on the submitted email would
let anyone lock out a named operator. Everything else is keyed by the subject of a
signature-**verified** token, falling back to the address. An extension installation is part of
the key, so two browsers signed in as one operator do not starve each other.

**Why a bucket, not a fixed window.** A fixed window permits the full allowance in the last
second of one window and again in the first second of the next — double the intended burst,
exactly when an attacker is trying. A bucket refills continuously and yields an honest
`Retry-After`.

**Why in-process.** The deployment has no Redis and adding one would be a new service, a new
failure mode and a new backup, for a limiter whose job is to blunt brute-force and runaway
clients. The cost is stated rather than hidden: the limit is per process, so
`RATE_LIMIT_PROCESS_COUNT` divides the configured allowance to make the documented number the
one an operator gets, and a production configuration above one raises a warning. It is not a
distributed limiter and nothing claims it is.

**`X-Forwarded-For` is opt-in.** With `RATE_LIMIT_TRUSTED_PROXY_HOPS` at 0 the header is
ignored entirely, because a client sets it itself and would otherwise mint a fresh bucket per
request. Above 0, the address is counted from the right — the rightmost entry is the one the
nearest proxy observed; everything further left is client-supplied. Leaving it at 0 behind a
real proxy makes every caller share one bucket, so production warns about that too.

**The image must not pre-empt this.** `uvicorn --proxy-headers --forwarded-allow-ips "*"` sets
`always_trust`, and uvicorn then takes the **first** `X-Forwarded-For` entry — the one the client
wrote — and overwrites `request.client.host` with it. The limiter would key the login bucket on a
value the attacker chooses, and a fresh bucket per request makes the bound decorative. The API
image therefore runs uvicorn **without** proxy headers; nothing here reads the request scheme or
builds an absolute URL, so they buy nothing to offset it. A test asserts the flags stay out of the
Dockerfile. The edge nginx sets `X-Forwarded-For $proxy_add_x_forwarded_for`, which appends the
peer it saw, so the rightmost entry is the trustworthy one — which is what counting from the right
by `RATE_LIMIT_TRUSTED_PROXY_HOPS` reads.

**Bounded memory.** Buckets are capped and evicted, idle-first then least-recently-used, so the
limiter cannot become the exhaustion it prevents. Eviction is always generous — an evicted
caller gets a fresh, full bucket — so it can never lock anyone out.

**Never limited:** `/health/live` and `/health/ready`. A limited probe converts a busy minute
into a restart loop.

## 5c. How the frontend finds the API

The bundle reads its API base at **runtime**, from `/config.js`, which nginx writes from
`API_ORIGIN` when the container starts (`frontend/default.conf.template`, rendered by the
official image's envsubst step). It is not a build argument: on a platform that assigns a
subdomain, the API's address does not exist when the image is built, and a baked-in origin can
only be changed by rebuilding. `window.__ADSOPS_API_BASE__` wins; the old
`VITE_API_BASE_URL` remains as a fallback so a locally built bundle still works.

An empty `API_ORIGIN` means **same origin** — correct when something in front proxies `/api` to
the API, as the production compose's edge nginx does. A non-empty one means the browser calls
the API directly, which is what a platform deploying each part as its own site needs.

**Why the browser calls the API directly rather than through this server.** Proxying `/api`
onward would put three proxies' worth of `X-Forwarded-For` in front of the API — but the API is
also reachable directly, so a caller could send it a *shorter*, self-authored chain and the
API's configured hop count would land on a value the caller chose. The rate limiter keys the
login bucket on that address (§5b), so the brute-force bound would evaporate for anyone who
skipped the frontend. One proxy on every path is what keeps
`RATE_LIMIT_TRUSTED_PROXY_HOPS=1` true regardless of how the API is reached. The cost is that
`CORS_ORIGINS` must name the frontend origin, and CSP `connect-src` must name the API origin —
both are configuration, and both fail loudly rather than silently.

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

Rejected in A5:

- **Reusing the dashboard token in the extension** — it would put a token that can change
  readiness into browser storage.
- **Name or fuzzy account matching** — on a 30-account workflow a wrong match is worse than no
  match, and the whole point of the extension is to stop acting on the wrong account.
- **Sending the full page URL** — the account id is worth having; the query string it arrives in
  is not, and it can carry session parameters.
- **Any control that acts on Ads Manager** — that would make this a remote control for
  advertising assets rather than a context viewer.
- **A bare `https://www.facebook.com/*` host permission** — it would put the content script on
  the operator's feed and Messenger for no benefit.
- **A host permission for the API origin** — it would let the extension bypass CORS. Ordinary
  CORS plus the API's exact-origin allowlist is the smaller privilege.
- **Blocking the operator** — the guard records a decision; a checklist that claimed to prevent a
  mistake it cannot see would be a false promise.

Rejected in A4:

- **Migrating on container start** — convenient, but it replays schema changes unattended
  during a crash loop, with no backup in front of them.
- **A systemd timer or cron for the dispatcher** — unavailable on the targets this project can
  actually deploy to.
- **Mounting the Docker socket for container metrics** — host compromise in exchange for a
  restart count.
- **A monitoring stack by default** — the target host has no headroom.
- **A scripted production restore** — a one-command database overwrite is a foot-gun that
  eventually gets run by accident.
- **Automatic schema downgrade during an incident** — it deletes rows the running release
  already wrote.
- **Enabling real Telegram dispatch automatically after deployment** — the first real send
  requires a controlled test and separate explicit approval.

Rejected again in A3:

- **Sending Telegram inside the health-evaluation transaction** — a network call would slow or
  fail the source transaction and make duplicate sends possible when its outcome is uncertain.
- **Celery/Redis solely for notifications** — a broker for a handful of messages a day, on a VPS
  with no headroom.
- **Client-side Telegram calls** — would expose the bot token and let a browser choose the
  recipient and the message.
- **Telegram bot commands for operations** — a remote-control path into advertising assets, which
  is the opposite of what this product is for.
- **A message per evaluation** — alert fatigue, and operationally harmful. A3 sends only new or
  escalated conditions, plus bounded retries.
