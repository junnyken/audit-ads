# FEATURES

Current release: **MINI-SPEC A3 — Alert Center & Telegram Notification Delivery** (2026-09-04),
built on **A2 — Evidence-Based Account Health** and **A1 — Account Registry & Stability
Readiness**.

## Shipped in A3 — Alert Center and notification delivery

### Alert Center
- Alerts derived deterministically from A2 health signals and failed evaluation runs. A3 reads
  A2; it never recomputes health and never changes a health severity.
- Deterministic `alert_key` per source condition, with at most one active alert per key enforced
  by the database. Re-evaluating an unchanged condition creates nothing.
- Six states: `open`, `acknowledged`, `suppressed`, `resolved`, `expired`, `archived`. Nothing is
  ever deleted; a resolved alert keeps its full history and its delivery record.
- Acknowledge (note required), resolve (reason required), suppress (reason **and** a future
  expiry — indefinite suppression is refused), unsuppress, reopen. None of them touch the A2
  signal, the A1 event, the checklist item or the evidence behind the alert.
- Suppression mutes delivery only: the alert stays visible, and suppressing a critical alert
  warns explicitly and is audited.
- Alerts close automatically when their source condition ends, recorded as closed by the engine
  rather than by a person.

### Notification policy
- One workspace policy: timezone (IANA, validated), quiet hours with cross-midnight support,
  critical bypass, per-severity enablement, reminders, and a chat reference.
- Seeded with safe defaults and **no recipient**, so a new workspace messages nobody.
- Owner-only to change. The Telegram bot token is server-side environment configuration: it is
  not in the database, not in any API response, not in an audit row, and not in a log line.
- The chat reference is masked everywhere it is displayed.

### Delivery (transactional outbox)
- A delivery row is written in the same transaction as the alert that caused it, so the decision
  to notify is as durable as the fact behind it.
- Idempotency key per alert + reason + severity + recipient. Retries append an *attempt*, never a
  second delivery.
- Quiet hours defer a warning to the end of the window in the policy's timezone; they never
  discard it. Critical bypasses by default.
- Every non-send is recorded as a `skipped` delivery with a plain-language reason.
- Bounded dispatcher: `FOR UPDATE SKIP LOCKED` claim, concurrency 1, batch 10, 3 attempts with
  1/5/15-minute backoff, lease-based recovery after a crash.
- Append-only delivery attempts with an allowlisted response code, a safe message id and a
  summarised error — never a raw provider body.
- `python -m app.commands.dispatch_notifications` is the scheduler seam; owner-only
  dispatch and recovery endpoints exist for operators.

### Telegram transport
- Isolated behind one adapter; a structural test asserts it is the only backend module that may
  make an outbound request, and that browser drivers remain banned everywhere.
- Messages are rendered server-side from a fixed allowlist, with control characters stripped,
  newlines collapsed so an operator note cannot forge a field, and safe truncation.
- The dashboard deep link appears only when a public HTTPS URL is configured; a `127.0.0.1` or
  private-range link is omitted rather than sent.
- `FakeNotificationTransport` records what would have been sent. **No real Telegram message has
  ever been sent by this codebase**: the default transport is `disabled` and no bot token exists.

### Surfaces
- Alerts navigation entry and an Alert Center page with URL-synchronised filters, all required
  columns, and severity/status/source/health/readiness/delivery shown as separate values.
- Alert drawer with source rule and version, timeline, notification history with attempts,
  current policy decision, and the four workflow actions. There is deliberately **no "send now"**.
- Overview Alert Center section with the six required cards, each linking to a filtered view.
- Owner-only notification policy in Settings, with capability booleans and a masked recipient.
- Related-alert counts on the account Health tab, linking into the filtered Alert Center.
- A clear banner when Telegram is not configured, which never hides the in-app alerts.

## Shipped in A2 — Account health

### Health signals
- Ten typed, versioned rules in a fixed registry (`a2-v1`). No user-authored rule code, no
  expression parser, nothing evaluated from a string. See [`docs/HEALTH_RULES_V1.md`](docs/HEALTH_RULES_V1.md).
- Every signal carries rule key and version, severity, status, source type and source entity,
  an allowlisted evidence payload, observed and last-evaluated timestamps, and the operator
  guidance for what it means and what to do next.
- Deterministic `signal_key` per rule and source fact; a unique index on `(ad_account_id,
  active_key)` makes a duplicate active signal impossible at the database level.
- Lifecycle: `open` → `acknowledged` → `resolved`, plus `expired` (rule disabled, or account
  archived) and `superseded` (evidence materially changed, so a successor signal was created and
  the previous one kept). Nothing is ever deleted or overwritten in place.
- Signals close automatically when their source fact ends, recorded as resolved by the engine
  rather than by a person. Resolving a signal whose condition still holds legitimately reopens it
  on the next evaluation.

### Health rollup
- Five states: `unknown`, `attention_needed`, `warning`, `critical`, `clear_signals`. No numeric
  score of any kind.
- Acknowledgement is not resolution: an acknowledged signal still counts towards the rollup.
- Freshness is derived on every read, so a `clear_signals` snapshot that has aged past the
  configured interval is presented as `unknown` instead of quietly staying green.
- A failed evaluation records the failure and reports `unknown`; it never leaves a previous clear
  result standing.
- Readiness and health are separate everywhere — database, API and UI. `operationally_ready` does
  not imply `clear_signals`, and `clear_signals` does not imply `operationally_ready`.

### Evaluation
- Triggered synchronously after every relevant A1 mutation (account, checklist, evidence, event,
  manual review, asset link), inside a SAVEPOINT so a health failure can never roll back the
  operator's actual change.
- `HealthEvaluationRun` records every evaluation — trigger, status, engine version, duration,
  result summary, error code and request id.
- Manual per-account recalculation, and an owner-only bounded backfill that requires explicit
  confirmation.
- `python -m app.commands.evaluate_health --batch N` is the scheduler seam for A3.

### Surfaces
- Account Health section on the Overview with the six required cards, each linking to a filtered
  list, plus last-evaluation and freshness caveats.
- Account Health page: URL-synchronised filters, sorting by severity/last evaluated/name, and the
  required columns including readiness, health, freshness and top reason as separate values.
- Health tab on account detail with open, acknowledged and historical signals, the readiness state
  beside it, recent evaluation runs, and manual recalculation.
- Signal drawer with evidence, rule metadata and version, timeline, and the acknowledge/resolve
  flows — each stating plainly that it records an internal outcome, not a platform decision.

## Shipped in A1

### Registry
- Central ad-account registry with workspace scoping, search, filter, sort and server-side
  pagination.
- Ownership mapping to a Business Manager **or** a personal-account reference, or an explicit
  `unknown`.
- Reference records: Business Managers, personal-account references, Pages, Pixels,
  payment-profile references, browser-profile references, proxy references.
- Time-bounded account↔asset links (`linked_at` / `unlinked_at` / `linked_by`). Unlinking closes
  a link and keeps the row, so historical mappings stay answerable.
- At most one active browser-profile reference and one active proxy reference per account;
  re-assigning closes the previous mapping and audits both halves.
- Soft archive and restore for every entity. No hard delete exists anywhere in the API.
- Tags, notes, owner label, country, currency, timezone.

### Readiness
- 14-item default checklist, initialised idempotently when an account is created.
- Deterministic, explainable rollup with four states: `unknown`, `not_ready`,
  `ready_with_warnings`, `operationally_ready`. No numeric score.
- Every result carries item-level reasons, required/completed counts and a data-freshness block.
- Conditional items state *why* they are required (account type, workflow needs a Page/Pixel,
  a landing page is assigned).
- Derived items (`business_manager_confirmed`, `page_linked`, `pixel_linked`,
  `browser_reference_assigned`, `last_manual_review_completed`, …) are computed from recorded
  facts and cannot be hand-marked.
- Evidence records with `provided` / `verified` / `expired` / `rejected` states and expiry;
  item evidence status is derived worst-first from live evidence rows.
- Waivers require a written reason and never satisfy a required item.
- Manual review recording, with an expiry interval (default 30 days).
- Cross-account readiness board grouped by blocking reason. Read-only: no bulk "mark complete".

### Events
- Operator-recorded account events with `info` / `warning` / `critical` severity.
- Unresolved warnings downgrade to `ready_with_warnings`; unresolved critical events force
  `not_ready`.
- Resolution requires a written note.

### Audit and observability
- Append-only audit log for every mutation: actor, action, entity type/id, before/after diff of
  only the changed fields, metadata, request id, timestamp.
- Per-account audit timeline that also covers its checklist items, evidence, events and links.
- Structured JSON logs with recursive redaction and a request/correlation id on every response.
- `GET /health/live`, `GET /health/ready`, `GET /api/v1/system/status`.

### Security
- JWT authentication; workspace scope resolved from the membership, never from the request body.
- Roles (`owner`/`admin`/`buyer`/`viewer`/`auditor`) exist in the data model; only `owner` is
  provisioned in A1, and permission checks are already role-based.
- Requests carrying secret-named fields are **refused** (`forbidden_field`), not silently dropped.
- Values shaped like connection strings or credentials are refused for reference fields.
- Recursive redaction before anything reaches a log line or an audit row.
- CORS allowlist, security headers, no secret in the browser bundle.

### Frontend
- Overview with the six required summary cards, accounts needing review, recently changed
  accounts, checklist-completion distribution, latest audit activity, data-freshness notice.
- Registry table with the required columns, URL-encoded filters, and display-only bulk selection.
- Create/edit drawer grouped into Identity / Ownership / Operational metadata / Assets /
  Browser and proxy references / Notes.
- Account detail with Overview, Assets & References, Readiness, Events and Audit History tabs.
- Ownership references, Assets, Readiness, Audit Log, System Status and Settings pages.
- Empty, loading (skeleton), and error states; errors surface the correlation id.
- `unknown` and `not_ready` are never rendered with success styling — enforced by a single
  colour map and covered by a test.

## Deliberately excluded from A3

| Excluded | Why |
|---|---|
| Telegram bot commands, or any two-way control | A3 is one-way delivery. A command that could pause a campaign would be a remote-control path into advertising assets |
| Auto-remediation from an alert | Every action stays manual and recorded |
| Email, Slack, SMS, webhooks | One channel, done properly, before adding more |
| A "send now" button | It would bypass dedupe and quiet hours, which is how alert fatigue starts |
| A second health engine, or any alert-derived health inference | A2 remains the only source of health computation |
| Celery, Redis, a scheduler, a production cron | Same reason as A2: A1 has none and the VPS has no headroom. A database outbox is smaller and durable |
| Storing a bot token anywhere but server configuration | It is a credential; the database, the API and the logs never see it |
| Real Telegram sends in tests or pilots | Fake transport only; a real send needs a token and the user's explicit approval |
| Deployment, DNS, reverse proxy, Compose runtime | Belongs to a deployment MINI-SPEC |

## Deliberately excluded from A2

| Excluded | Why |
|---|---|
| Numeric ban-risk, safety or trust score | Rejected design: a number hides cause and implies a claim the product must never make |
| ML restriction prediction | No authorised basis for it; it would be a misleading claim |
| Auto-remediation from a signal | A2 mutates no platform asset; every action stays manual and recorded |
| Telegram or any delivery transport | Belongs to MINI-SPEC A3, which reuses these signals |
| Suppression / snooze | A2 §24 allows deferring it; deferred to A3 rather than half-built |
| Rule configuration UI | A1 shipped no settings architecture to extend; rules are read-only and versioned |
| Celery, Redis, periodic scheduler | A1 has none and the target VPS has no headroom; A2 ships a command seam instead |
| Browser/proxy telemetry as a health input | Rejected: environment metadata is not evidence about an account |

## Deliberately excluded from A1

| Excluded | Why |
|---|---|
| Platform API integration / sync | A1 is a registry; an authorised integration belongs to a later phase |
| Campaign publish, pause, edit, duplicate, delete | Out of scope; A1 has no mutation path to any platform |
| Bulk operations | A1 §Non-goals — data and audit foundations first |
| Telegram or any notification delivery | Belongs to MINI-SPEC A3 |
| Browser automation, antidetect, proxy rotation, cookie handling, fingerprinting | Prohibited by the product charter |
| Credential/session storage, payment changes | Prohibited; the API refuses such fields |
| Numeric risk score, restriction prediction | Rejected design — hides uncertainty and implies safety claims |
| Team assignment UX, full RBAC | Data model supports it; UX belongs to MINI-SPEC F1 |

## Known limits (follow-ups)

- **No scheduled dispatch.** Deliveries wait until the dispatch command or the owner-only
  endpoint runs. A deferred warning is scheduled correctly but only leaves when something works
  the outbox. Wiring `app.commands.dispatch_notifications` to a scheduler is the next infra step.
- **Reminders are implemented but off**, and have no dedicated UI beyond the toggle.
- **No real Telegram delivery has been exercised.** The transport code path is tested through a
  fake; a first real send needs a bot token and the user's explicit approval of a target chat.
- **No scheduled evaluation.** Health is recalculated on mutation and on request. Without a worker
  nothing sweeps idle accounts, so an untouched account's evaluation ages and is then reported as
  `unknown`/stale — correct, but it means staleness is surfaced rather than prevented. Wiring
  `app.commands.evaluate_health` to a scheduler belongs to A3.
- **Backfill is synchronous and bounded** (default 5, maximum 50 accounts) rather than
  asynchronous, for the same reason.
- Rule enable/disable is supported by the schema and engine but has no UI.
- No rate-limiting middleware yet (no existing middleware to extend in A1).
- No CI pipeline configured for this repository.
- Evidence is metadata plus an optional external link; there is no file upload/storage layer.
- Roles cannot be assigned through the UI yet.
- `last_synced_at` is always empty because nothing syncs; readiness reports data freshness as
  `unknown` rather than pretending otherwise.
