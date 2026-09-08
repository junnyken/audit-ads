# FEATURES

Current release: **MINI-SPEC A5 — Chrome Context Extension & Account Workspace Guard**
(2026-09-05), built on **A4 Stage A — Deployment Readiness**, **A3 — Alert Center & Telegram
Notification Delivery**, **A2 — Evidence-Based Account Health** and **A1 — Account Registry &
Stability Readiness**.

**Nothing has been deployed, no real Telegram message has ever been sent, and the extension has
never been published.** A4 Stage B and a Chrome Web Store listing each need their own explicit
approval.

## Shipped in A5 — Chrome context extension

### What it is
A Manifest V3 extension that tells you **which account you are looking at** while you work in
Meta Ads Manager, and shows the readiness, health and open alerts this product already holds for
it. It reads the page and writes events through the API. It changes nothing on any advertising
platform, and it has no capability to.

### Context detection
- The account is identified by **exact account id only**. `act_123456789`, `ACT-123456789` and
  `123456789` are canonicalised to the same value — a format equivalence, stated in the code —
  and then compared for equality.
- **Names are never matched.** They are display-only, and there is no similarity code path for a
  later change to reach.
- Four honest outcomes: `confirmed`, `ambiguous`, `unknown`, `unsupported_page`. Two registry
  rows carrying the same id is `ambiguous`, not a coin flip. An archived account says archived,
  not "not registered".
- The account id is read from the query string; **the query string never leaves the browser**.
  Routes are reduced to an allowlist in the extension and again on the server.

### Popup and side panel
- Popup: account identity, readiness, health, alerts and deep links, or a plain statement that
  the context is not confirmed with a link to pick the account by hand.
- Side panel: the same context plus the **Account Workspace Guard** — a four-item checklist and a
  required reason before a change intent is recorded. It says explicitly that it *records* and
  does not block, because the extension cannot block anything in Ads Manager.
- Quick actions record manual review start/complete, change completed, notes, and policy or
  payment issues. Every one becomes an ordinary A1 account event with an audit row.
- No action anywhere in the extension can pause, publish, duplicate or alter anything on Meta.

### Scope-limited extension session
- The extension exchanges a dashboard login for a **separate, shorter-lived token** and forgets
  the password immediately. The dashboard token is used for one call and never stored.
- That token is **refused by every dashboard route**: it cannot create accounts, change
  readiness, resolve alerts, edit notification policy, trigger a test send, or mint another
  extension session. A token stolen from browser storage is a much smaller problem than a
  dashboard token would be.
- Revocation is a stored fact, not a token expiry: revoking a browser from Settings or from the
  extension stops it on its next request.
- The session lives in `chrome.storage.session`, which is in-memory and cleared when the browser
  closes.

### Event ingestion
- Event types are an **allowlist**, not a free string, so a compromised extension cannot write
  something that reads like a system event.
- The **server** decides severity. A client that could mark its own note "critical" would make
  the timeline worthless.
- Events that record an operator decision require a reason; automatic breadcrumbs do not.
- An event cannot be dated into the future or backdated more than a day.
- Stored context passes an allowlist: page type, context status, sanitised path, client version
  and account id. A raw URL, a query string or a credential cannot land there even if sent.

### Permissions, deliberately narrow
- `storage`, `sidePanel`, `activeTab` — and nothing else. No `cookies`, `webRequest`, `tabs`,
  `scripting`, `debugger`, `proxy` or `<all_urls>`.
- Three host patterns, with `www.facebook.com` scoped to `/adsmanager/*` so the content script
  never loads on the feed, Messenger or a profile.
- The dashboard API is **not** a host permission: requests follow ordinary CORS and the API's
  exact-origin allowlist decides. `extension/PERMISSIONS.md` explains every entry.

### Dashboard side
Settings lists connected browsers with their version and last-seen time, and can revoke any of
them — so a lost laptop can be cut off from another machine.

## Shipped in A4 Stage A — deployment readiness and observability

### Production packaging
- A versioned production Compose overlay supporting two topologies: a managed platform
  (Coolify / Vibe Host) terminating TLS, or a self-managed VPS with an optional `edge` nginx
  profile. The audit could not confirm which target will be used, so neither is assumed.
- Explicit immutable image tags. Compose refuses to start without `IMAGE_TAG`, and `latest` is
  refused by the rollback script.
- **The API image no longer migrates on start.** A schema change is a release step with a
  backup in front of it, not something a crash-looping container replays unattended.
- CPU and memory limits, log rotation, read-only root filesystems, dropped capabilities and
  `no-new-privileges` on every service.
- Database, API and dispatcher have no host port at all; `web` binds to loopback by default.
- Images build with a non-root user and carry no secret in any layer or environment variable.

### Production configuration validation
- Startup validation that **refuses to boot a production process** configured unsafely, and
  warns everywhere else: missing database or auth settings, placeholder or short secrets, a
  wildcard CORS origin, `telegram` transport with no token, a non-HTTPS public URL, published
  API docs, an unstamped release.
- The documented local pilot password is refused in **every** environment.
- Findings name a code and a sentence. They never contain the offending value, and neither does
  any log line or API response.
- Interactive API docs are off in production: the schema is a map of the whole API.

### Backup, restore and rollback
- A backup script that refuses to run below 512 MB free, verifies gzip integrity, and checks
  the dump's **content** — at least 20 `CREATE TABLE` statements and an `alembic_version`
  marker — rather than guessing from its size. It writes a SHA-256 and a JSON metadata file,
  records the run, and renames a failed dump `.suspect` instead of accepting it.
- A restore drill that verifies the checksum, restores into an **isolated** throwaway database,
  checks table count and migration revision, records the result and drops the database again.
  It refuses any name matching the production database.
- An explicit migration release step: back up, record the revision, migrate, verify, and abort
  the release before the version switch if anything fails.
- Application-only rollback to a previous immutable tag. **No automatic schema downgrade and no
  scripted production restore** — both are incident decisions a person makes deliberately.

### Dispatcher scheduling
- A dedicated bounded dispatcher container finally drains the A3 outbox on a schedule: one pass
  at a time, batch 10, a sleep between passes, a stop signal honoured within a second, and
  periodic recovery sweeps.
- Chosen over a systemd timer or cron because neither is available in this workspace or on the
  managed platforms this project deploys to.
- Every pass is recorded, so "the dispatcher stopped" is a visible state rather than silence.
- It runs, records and delivers nothing when the transport is disabled.

### Observability
- A System Status page showing release, database and migration revision, dispatcher state,
  backup age, due and failed deliveries, oldest pending delivery, host CPU/memory/disk with
  warning and critical bands, configuration findings and operational run history.
- **"Never run" stays distinct from "stale"** everywhere: one has never started, the other
  stopped, and collapsing them into a green tick is how an outbox quietly stops delivering.
- Host metrics come from `/proc` and `shutil`, never the Docker socket.
- `worker_status` stopped reporting a constant `not_configured` and is now derived from
  recorded runs.

### Controlled Telegram test send
- A preview endpoint that renders the exact fixed message, the masked recipient and eight
  pre-send checks — and sends nothing.
- Execution behind four independent gates: workspace owner, a server-side switch that is off by
  default, an explicit confirmation, and an approval code proving the preview was seen.
- **The caller supplies no recipient and no message body.** The request schema has no field for
  either, so it is a structural guarantee rather than a check that could be skipped.
- The message carries only an environment label, a timestamp and an optional public link.
- Keyed separately from the alert outbox: a test send creates no alert, writes no delivery row,
  and cannot collide with, suppress or duplicate a real notification.
- Exactly one message per approved preview; a second attempt is refused.

### Runbooks
`docs/RUNBOOK_DEPLOY.md`, `RUNBOOK_ROLLBACK.md`, `RUNBOOK_BACKUP_RESTORE.md`,
`RUNBOOK_TELEGRAM_TEST_SEND.md`, `RUNBOOK_INCIDENT_RESPONSE.md` and
`docs/PRODUCTION_ENVIRONMENT.md` — each with prerequisites, redacted commands, expected output,
verification checkpoints, failure handling and escalation conditions. No real secret appears in
any of them.

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

## Deliberately excluded from A5

| Excluded | Why |
|---|---|
| Any action that changes something in Ads Manager | The extension has no such capability, and adding one would make it a remote control for advertising assets |
| Reading cookies, `localStorage`, `sessionStorage`, IndexedDB or network traffic | Session material is exactly what this product refuses to touch. A lint rule and a bundle test enforce it |
| Fingerprint collection or spoofing, antidetect behaviour, proxy configuration | Platform-enforcement evasion, forbidden since A1 |
| Auto-login, auto-appeal, checkpoint bypass | Same |
| Fuzzy or name-based account matching | A wrong match on a 30-account workflow is worse than no match. Exact id or nothing |
| A second health, readiness or alert engine | A5 is a viewport onto existing state; a second engine could disagree with the dashboard |
| Writing anything into the Ads Manager page | A detector failure must leave the page exactly as it was |
| `<all_urls>` or a bare `facebook.com` host permission | The content script has no business on the feed |
| Chrome Web Store publishing, or any deployment | Out of scope, and each needs its own approval |

## Deliberately excluded from A4

| Excluded | Why |
|---|---|
| Deploying anything | Stage B. It needs a resolved target and the owner's explicit approval |
| Sending a real Telegram message | Stage B, and a *separate* approval from the deployment one |
| Enabling real dispatch automatically after a deployment | The default outcome of A4 is deployment-ready with delivery opt-in |
| A scripted production restore | A one-command overwrite of a production database is a foot-gun that eventually gets run by accident |
| Automatic schema downgrade on incident | The release being rolled back has already written rows; a downgrade drops the columns holding them |
| Mounting the Docker socket into the API container | It would hand whoever compromises the API full control of the host, for a container restart count |
| A monitoring stack (Prometheus, Grafana, agents) | The target host has no headroom. Lightweight status signals first |
| CI/CD | Out of scope by A4 §3; still a documented follow-up |
| Infrastructure alerts over Telegram | Operational signals are not account health. They stay on the status page unless a MINI-SPEC extends the alert model deliberately |
| Broad auth/RBAC redesign or role UI | Unrelated to deployment |

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

- **Real-browser UAT (2026-09-08):** loaded unpacked in real Chrome, connected to a live backend,
  and run against real Meta Ads Manager accounts — see `TEST_LOG.md`. Confirmed: exact-match
  resolution against a registered account, correct non-guessing on an unregistered one, and
  clean context switching between the two. Found and fixed one real allowlist gap (the billing
  hub route). Not exercised live: the side panel's note-recording UI, and revocation's effect on
  an already-open tab within its 30-second context cache (server-side revocation itself was
  confirmed instant via the API).
- **Meta's URL shapes are an assumption.** The route allowlist matches today's Ads Manager; when
  it changes, the extension degrades to `unsupported_page` rather than guessing, but the
  allowlist will need updating.
- **A deployment must add `chrome-extension://<id>` to `CORS_ORIGINS`**, and the id is only known
  once the extension is packed.
- **Still no rate limiting.** The extension caches per tab for 30 seconds and only re-resolves
  when the account or route actually changes, but a compromised client could still poll.
- **No Chrome Web Store listing**, no signing, no update channel.
- **Deployed for the first time (2026-09-08), on Vibe Host, not the compose stack in this repo.**
  `audit-ads-backend.cmc-1.vibenode.matbao.ai` is live, migrated, and health-checked
  (`database: reachable`). The paired frontend project's container runs and serves `200`
  internally but the public domain still 404s — a platform-side Traefik/routing issue, not a
  code defect, unresolved as of this note. A second, separate Vibe Host project named
  `audit-ads` was accidentally created from `extension/` instead of `frontend/` and is broken;
  it has been left alone rather than deleted. None of this used the `docker-compose.yml` /
  `RUNBOOK_DEPLOY.md` path in this repo, which remains unexercised against a real target.
- **No real Telegram message has ever been sent.** The transport code path is covered by
  structural and unit-level tests through a fake; a first real send needs a bot token and the
  owner's approval of a named chat.
- **The deployment target is unresolved**: no git remote, no domain, no confirmed host, no
  backup destination. `docs/AUDIT_BEFORE_BUILD_A4.md` §6 lists exactly what is missing.
- **Resource limits are unproven at runtime.** This workspace's Docker-in-Docker cgroup is
  `domain threaded` and cannot apply any limit; they are validated by `compose config` only.
- **Off-host backup transfer is manual.** Nothing ships credentials to an object store.
- **No real-browser UAT.** Verification is jsdom rendering against the live API plus a
  production build. A person has still never clicked through the app.
- **Still no CI, and no rate limiting.**
- **Scheduled dispatch is now solved** by the A4 dispatcher container, but it has only ever run
  locally. On a real deployment it is unproven until Stage B.
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

---

## Rate limiting

Every request under `/api/v1` is bounded. Two budgets, because two things are being protected:

| Budget | Applies to | Keyed by | Default |
|---|---|---|---|
| Credential exchange | `POST /auth/login`, `POST /extension/connect` | client address | 10 per 5 minutes |
| General API | everything else under `/api/v1` | authenticated subject, else address | 300 per minute |

Health checks are never limited. A refusal is HTTP 429 with the standard error envelope, the
code `rate_limited`, and `Retry-After` in seconds; every response carries `X-RateLimit-Limit`
and `X-RateLimit-Remaining`.

Two honest limits: the buckets live **in the API process**, so running more than one worker
divides the allowance (`RATE_LIMIT_PROCESS_COUNT` states how many, and production warns if it
is above one); and `X-Forwarded-For` is ignored until `RATE_LIMIT_TRUSTED_PROXY_HOPS` says a
proxy is in front, because a client can set that header itself. Both are reported as
configuration findings rather than left for someone to discover.
