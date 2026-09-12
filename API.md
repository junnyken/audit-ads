# API

Base URL prefix: `/api/v1`. All responses are JSON. Interactive docs at `/docs`.

## Conventions

**Authentication** — every endpoint except `POST /auth/login` and the health checks requires
`Authorization: Bearer <token>`. The workspace is resolved from the token's membership; it is
never read from a request body or query string.

**Errors** — one shape everywhere:

```json
{"error": {"code": "conflict", "message": "…", "details": {}, "request_id": "8f2c…"}}
```

| Code | HTTP | Meaning |
|---|---|---|
| `not_authenticated` | 401 | Missing, invalid or expired token |
| `not_authorized` | 403 | Role may not perform this action |
| `not_found` | 404 | No such record **in this workspace** |
| `conflict` | 409 | Uniqueness violation, already archived, duplicate link |
| `entity_archived` | 409 | The target is archived; restore it first |
| `validation_error` | 422 | Payload failed validation |
| `forbidden_field` | 422 | Payload carried a secret-bearing field or a credential-shaped value |
| `rate_limited` | 429 | Too many requests. `details.retry_after_seconds` and the `Retry-After` header say how long to wait |

**Rate limiting** — two budgets. `POST /auth/login` and `POST /extension/connect` share a
strict per-address budget (default 10 per 5 minutes); everything else under `/api/v1` gets a
general budget per authenticated subject, falling back to the address when anonymous (default
300 per minute). Health checks are never limited. Every response carries `X-RateLimit-Limit`
and `X-RateLimit-Remaining`; a refusal adds `Retry-After` in seconds. Budgets are **per API
process** — see ARCH §5b.

**Correlation** — send `X-Request-ID` to set it, or read it from the response. It appears in the
error body, in structured logs and on the audit row.

**Pagination** — list endpoints accept `page`, `page_size`, `sort`, `sort_direction`
(`asc`/`desc`) and return:

```json
{"items": [], "page": 1, "page_size": 25, "total": 0, "total_pages": 0}
```

**No DELETE** — A1 defines no hard-delete endpoint. Use `POST …/archive` and `POST …/restore`.

**Secret fields** — a body containing a key whose name contains `password`, `passwd`, `cookie`,
`session`, `token`, `secret`, `credential`, `authorization`, `proxy_url`, `proxy_username`,
`proxy_password`, `api_key`, `private_key` (at any nesting depth) is refused with
`forbidden_field`. `proxy_reference`, `profile_reference` and evidence text additionally refuse
values shaped like connection strings.

## Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | `{email, password}` → `{access_token, token_type, expires_at}`. One message for unknown user and wrong password, so the endpoint cannot enumerate accounts |
| `GET` | `/auth/me` | Current user, role and workspace |

## Ad account registry

| Method | Path |
|---|---|
| `GET` | `/ad-accounts` |
| `POST` | `/ad-accounts` |
| `GET` | `/ad-accounts/{ad_account_id}` |
| `PATCH` | `/ad-accounts/{ad_account_id}` |
| `POST` | `/ad-accounts/{ad_account_id}/archive` |
| `POST` | `/ad-accounts/{ad_account_id}/restore` |

List filters: `search` (name, external ID, owner label, tags, BM name, personal-reference
label), `status`, `readiness_status`, `account_type`, `business_manager_id`,
`personal_account_reference_id`, `country`, `currency`, `has_browser_reference`,
`has_proxy_reference`, `archived`, `page`, `page_size`, `sort`, `sort_direction`.
Sortable: `updated_at`, `created_at`, `display_name`, `readiness_status`,
`last_manual_review_at`.

List rows also carry `required_item_count`, `completed_item_count`, `has_browser_reference` and
`has_proxy_reference`, computed with three bulk queries for the whole page.

Create/update accept: `display_name` (required), `external_account_id`, `account_type`,
`business_manager_id`, `personal_account_reference_id`, `owner_label`, `country`, `currency`,
`timezone`, `status`, `requires_page`, `requires_pixel`, `landing_page_url` (http/https only),
`tags`, `notes`.

`external_account_id` is unique per workspace when non-empty; a blank value is stored as `null`.
Mutating an archived account returns `entity_archived`.

## References

The same six operations exist for each of the seven reference resources:

```
GET    /{resource}                 POST   /{resource}
GET    /{resource}/{id}            PATCH  /{resource}/{id}
POST   /{resource}/{id}/archive    POST   /{resource}/{id}/restore
```

| Resource | Required field | Unique per workspace |
|---|---|---|
| `/business-managers` | `name` | `external_id` |
| `/personal-account-references` | `label` | `external_reference_id` |
| `/pages` | `name` | `external_page_id` |
| `/pixels` | `name` | `external_pixel_id` |
| `/payment-profile-references` | `reference_code` | `reference_code` |
| `/browser-profile-references` | `profile_reference` | `provider` + `profile_reference` |
| `/proxy-references` | `proxy_reference` | `provider` + `proxy_reference` |

List filters: `search`, `status`, `archived`, `page`, `page_size`, `sort`, `sort_direction`.

## Asset links

| Method | Path | Notes |
|---|---|---|
| `GET` | `/ad-accounts/{id}/asset-links` | `?include_inactive=false` for active only |
| `POST` | `/ad-accounts/{id}/asset-links` | `{asset_type, asset_id, note}` |
| `PATCH` | `/ad-accounts/{id}/asset-links/{link_id}` | `{note}` |
| `POST` | `/ad-accounts/{id}/asset-links/{link_id}/unlink` | Closes the link; the row survives |

`asset_type` ∈ `page` · `pixel` · `payment_profile` · `browser_profile` · `proxy`.
`browser_profile` and `proxy` allow one active link at a time; assigning a new one closes the
previous link and audits both. Linking an already-linked asset returns `conflict`.

## Readiness and evidence

| Method | Path | Notes |
|---|---|---|
| `GET` | `/ad-accounts/readiness/summary` | Counts per state plus `total_active` and `archived` |
| `GET` | `/ad-accounts/readiness/board` | Cross-account rows plus reason groups. Read-only |
| `GET` | `/ad-accounts/{id}/readiness` | Evaluates without persisting |
| `POST` | `/ad-accounts/{id}/readiness/recalculate` | Re-initialises missing items and persists |
| `POST` | `/ad-accounts/{id}/readiness/manual-review` | `{note}` — stamps `last_manual_review_at` |
| `GET` | `/ad-accounts/{id}/readiness/checklist` | Items with their evidence and evaluation |
| `PATCH` | `/ad-accounts/{id}/readiness/checklist/{item_key}` | `{review_status, notes, expires_at, waiver_reason}` |
| `POST` | `/ad-accounts/{id}/readiness/checklist/{item_key}/evidence` | Attach evidence |
| `PATCH` | `/readiness-evidence/{evidence_id}` | `{status, summary, expires_at}` |
| `POST` | `/readiness-evidence/{evidence_id}/archive` | Soft-archive |

A `PATCH` on a derived item returns `409 conflict` with `details.derived_from`.
`review_status: "waived"` requires `waiver_reason`. Evidence cannot be created as `expired` —
expiry is derived from `expires_at`.

Readiness response:

```json
{
  "ad_account_id": "uuid",
  "readiness_status": "not_ready",
  "evaluated_at": "2026-09-04T21:09:20+00:00",
  "required_item_count": 10,
  "completed_item_count": 7,
  "reasons": [
    {"code": "payment_method_reviewed_incomplete", "severity": "warning",
     "source_type": "checklist_item", "source_id": "uuid",
     "message": "Payment method reviewed: This item has not been reviewed."}
  ],
  "items": [
    {"item_key": "browser_reference_assigned", "state": "satisfied", "required": true,
     "is_mandatory": true, "derived_from": "active_browser_profile_link",
     "requirement_reason": "Always required: …", "message": "An active browser-profile reference is assigned.", "…": "…"}
  ],
  "data_freshness": {"status": "unknown", "last_synced_at": null},
  "disclaimer": "Readiness is an internal operational state derived from recorded evidence. It is not a platform approval, and it does not guarantee that an account cannot be restricted."
}
```

## Events

| Method | Path | Notes |
|---|---|---|
| `GET` | `/ad-accounts/{id}/events` | `?include_archived=true` optional |
| `POST` | `/ad-accounts/{id}/events` | `{event_type, severity, source, occurred_at, summary, evidence_reference}` |
| `PATCH` | `/account-events/{event_id}` | Cannot set `resolved` — use the resolve action |
| `POST` | `/account-events/{event_id}/resolve` | `{resolution_note}` (required, non-blank) |

Create, update and resolve all return the recomputed `readiness_status`.

## Audit

| Method | Path | Filters |
|---|---|---|
| `GET` | `/audit-logs` | `entity_type`, `entity_id`, `action` (contains), `actor_id`, `page`, `page_size` |
| `GET` | `/ad-accounts/{id}/audit-logs` | Includes the account's checklist items, evidence, events and links |

There is no write endpoint for audit logs.

## Account health (A2)

All health endpoints follow the A1 conventions above: bearer auth, workspace scope from the
membership, the same error envelope, the same pagination shape, `404` for anything outside the
workspace.

Every health payload carries a `disclaimer`, and `clear_signals` is described only as
"No current issues found by configured checks". Health never claims platform approval or safety.

### Summary and list

| Method | Path | Notes |
|---|---|---|
| `GET` | `/account-health/summary` | Counts per health state plus `stale_data`, `never_evaluated`, `last_evaluation_at`, `failed_runs_recent` |
| `GET` | `/account-health` | Paginated account rows with health, readiness and freshness as separate values |

`GET /account-health` filters: `search`, `health_status`, `freshness_status`, `severity`,
`signal_status`, `rule_key`, `business_manager_id`, `account_type`, `readiness_status`,
`archived`, `page`, `page_size`, `sort`, `sort_direction`.
Sortable: `health_severity` (default, worst first), `last_evaluated_at`, `freshness`,
`display_name`, `updated_at`.

Filtering on `health_status` and `freshness_status` applies the same read-time staleness rule the
UI shows, so a stale `clear_signals` account is matched by `health_status=unknown` — the filter
and the badge can never disagree.

### Per account

| Method | Path | Notes |
|---|---|---|
| `GET` | `/ad-accounts/{id}/health` | Rollup, counts, ordered reasons, freshness, engine version, and the A1 readiness state alongside |
| `GET` | `/ad-accounts/{id}/health/signals` | All signals; `status=` or `include_historical=false` to narrow |
| `POST` | `/ad-accounts/{id}/health/recalculate` | Re-reads stored records. Contacts no platform |

Rollup response:

```json
{
  "ad_account_id": "uuid",
  "health_status": "warning",
  "status_description": "At least one unresolved warning signal is open, and no critical signal is open.",
  "freshness_status": "current",
  "evaluated_at": "2026-09-04T22:14:35+00:00",
  "engine_version": "a2-v1",
  "counts": {"critical": 0, "warning": 2, "attention": 1, "unknown": 0},
  "summary_reasons": [
    {
      "code": "manual_review_due_or_stale",
      "severity": "warning",
      "signal_id": "uuid",
      "message": "The last manual review is older than the configured 30-day interval.",
      "observed_at": "2026-09-04T22:14:35+00:00",
      "rule_key": "manual_review_due_or_stale",
      "rule_version": 1,
      "status": "open"
    }
  ],
  "readiness": {"status": "ready_with_warnings", "evaluated_at": "2026-09-04T22:14:35+00:00"},
  "disclaimer": "Account health is an internal operational state ..."
}
```

### Signal detail and actions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/account-health/signals/{signal_id}` | Signal, rule guidance, account context |
| `POST` | `/account-health/signals/{signal_id}/acknowledge` | `{note}` required. Does **not** resolve; the signal keeps counting towards health |
| `POST` | `/account-health/signals/{signal_id}/resolve` | `{reason}` required, `evidence_reference` optional and validated |
| `POST` | `/account-health/signals/{signal_id}/reopen` | `{reason}` required. `409` if an active signal already holds the same `signal_key`, or if the signal was superseded |
| `GET` | `/account-health/signals/{signal_id}/audit-logs` | Append-only trail for that signal |

Signal actions never touch the underlying A1 event, checklist item or evidence record. To change
those, use their own A1 endpoints. Actions on an archived account are refused.

Signal statuses: `open`, `acknowledged`, `resolved`, `expired`, `superseded`.
Severities: `critical`, `warning`, `attention`, `unknown`.
Health states: `critical`, `warning`, `attention_needed`, `unknown`, `clear_signals`.
Freshness: `current`, `stale`, `unknown`, `not_applicable`.

### Rules, runs and backfill

| Method | Path | Notes |
|---|---|---|
| `GET` | `/account-health/rules` | The versioned typed registry. Read-only in A2 |
| `GET` | `/account-health/evaluation-runs` | Filters: `ad_account_id`, `status`, `page`, `page_size` |
| `GET` | `/account-health/evaluation-runs/{run_id}` | One run, including `error_code` and `error_summary` |
| `POST` | `/account-health/backfill` | Owner-only. `{confirm: true, batch_size?}`. Bounded (max 50) and synchronous — this release has no worker |

Run triggers: `account_mutation`, `checklist_mutation`, `evidence_mutation`,
`account_event_mutation`, `manual_recalculate`, `scheduled_recalculate`, `rule_change`,
`backfill`. Run statuses: `queued`, `running`, `succeeded`, `failed`, `skipped`.

A failed evaluation never blocks the A1 mutation that triggered it; it is recorded as a failed run
and the account's health is reported as `unknown`.

## Alert Center (A3)

Same conventions as A1/A2: bearer auth, workspace scope from the membership, the shared error
envelope, the shared pagination shape, `404` for anything outside the workspace.

Alert payloads carry a `disclaimer`. No alert state is ever worded as safe, protected, approved
or immune, and no numeric score exists anywhere in A3.

### Summary and list

| Method | Path | Notes |
|---|---|---|
| `GET` | `/alerts/summary` | Counts per card, plus `telegram_transport_configured` and `recipient_configured` as booleans |
| `GET` | `/alerts` | Paginated rows with severity, status, source, health, readiness and delivery state as separate values |

`GET /alerts` filters: `search`, `status`, `severity`, `source_type`, `health_status`,
`readiness_status`, `business_manager_id`, `ad_account_id`, `delivery_status`,
`has_pending_delivery`, `suppressed`, `archived`, `page`, `page_size`, `sort`, `sort_direction`.
Sortable: `severity` (default, worst first), `last_observed_at`, `first_observed_at`, `status`,
`title`. With no `status` filter the list shows active alerts (open, acknowledged, suppressed).

### Detail and actions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/alerts/{alert_id}` | Alert, account context, notification history, current policy decision |
| `POST` | `/alerts/{alert_id}/acknowledge` | `{note}` required. Does **not** resolve; the A2 signal is untouched |
| `POST` | `/alerts/{alert_id}/resolve` | `{reason}` required. Changes no source record |
| `POST` | `/alerts/{alert_id}/reopen` | `{reason}` required. `409` if an active alert already holds the key |
| `POST` | `/alerts/{alert_id}/suppress` | `{reason, expires_at}`, both required. A past or missing expiry is refused |
| `POST` | `/alerts/{alert_id}/unsuppress` | `{note}` optional. Restores the previous status |
| `GET` | `/alerts/{alert_id}/audit-logs` | The alert's trail, including its deliveries |
| `GET` | `/alerts/{alert_id}/notifications` | Every delivery planned for this alert |

Alert statuses: `open`, `acknowledged`, `suppressed`, `resolved`, `expired`, `archived`.
Severities: `info`, `warning`, `critical`.

### Notification policy

| Method | Path | Notes |
|---|---|---|
| `GET` | `/notification-policies/current` | Seeds a safe default on first access |
| `POST` | `/notification-policies/current` | Owner-only. Idempotent create |
| `PATCH` | `/notification-policies/current` | Owner-only |
| `GET` | `/notification-policies/current/audit-logs` | Policy change history |

The response carries `telegram_transport_configured` and `recipient_configured` as booleans and
`telegram_chat_id_masked` as a suffix. **The bot token has no representation in this API at all**;
a payload containing a token-like field is refused with `forbidden_field`, and a token-shaped
value in `telegram_chat_id` is refused by validation.

Accepted fields: `name`, `enabled`, `timezone` (IANA), `quiet_hours_enabled`,
`quiet_hours_start`, `quiet_hours_end`, `critical_bypasses_quiet_hours`,
`warning_telegram_enabled`, `attention_telegram_enabled`, `reminder_enabled`,
`reminder_interval_hours`, `max_reminders_per_alert`, `telegram_chat_id`.

### Notification history

| Method | Path | Notes |
|---|---|---|
| `GET` | `/notifications` | Filters: `alert_id`, `status`, `channel`, `scheduled_after`, `scheduled_before`, `failed_only`, `page`, `page_size`, `sort`, `sort_direction` |
| `GET` | `/notifications/status/summary` | Safe counters: transport mode, recipient configured, due, failed final, oldest pending age, last success, last attempt |
| `GET` | `/notifications/{notification_id}` | One delivery, with a masked recipient |
| `GET` | `/notifications/{notification_id}/attempts` | Append-only attempt history |

Delivery statuses: `pending`, `queued`, `sending`, `sent`, `failed_transient`, `failed_final`,
`skipped`, `cancelled`. Skip reasons: `no_recipient_configured`, `policy_disabled`,
`severity_delivery_disabled`, `alert_suppressed`, `alert_not_active`, `timezone_not_configured`,
`reminders_disabled`.

### Operational

| Method | Path | Notes |
|---|---|---|
| `POST` | `/notifications/dispatch-due` | Owner-only. `{confirm: true, batch_size?}`. Works the outbox under the recorded policy; takes **no recipient and no message body** |
| `POST` | `/notifications/recovery-sweep` | Owner-only. Reclaims deliveries stranded by a dispatcher that died mid-send. Sends nothing |

Both exist because A3 ships no scheduler. Neither can force a message out: policy, dedupe and
quiet-hours decisions are already recorded on the delivery rows.

## Chrome extension (A5)

Authenticated like everything else, and split by token type: **`Ctx`** routes need a dashboard
session, **`ExtCtx`** routes need an extension session, and the two are mutually exclusive.
No route here accepts a workspace id, a credential-like field or a raw URL.

### Session

| Method | Path | Token | Notes |
|---|---|---|---|
| `POST` | `/extension/connect` | dashboard | Exchanges a dashboard session for a scope-limited extension session. Body: `extension_instance_id`, `extension_version`, `label` |
| `GET` | `/extension/session/current` | extension | Cheap liveness check; writes no audit row |
| `GET` | `/extension/installations` | dashboard | Connected browsers for the signed-in operator. Never returns a token |
| `POST` | `/extension/installations/revoke` | dashboard | `{installation_id?, reason}`. Takes effect on the browser's next request |

The response's `token_use` is `extension`. That token is **refused with 401 by every dashboard
route**, cannot create an account, and cannot mint another extension session.

### Context

| Method | Path | Token | Notes |
|---|---|---|---|
| `POST` | `/extension/context/resolve` | extension | `{external_account_id?, page_type?, safe_path?, extension_version}` |
| `GET` | `/extension/accounts/{id}/summary` | extension | The same summary for an account picked by hand |
| `GET` | `/ad-accounts/{id}/extension-summary` | either | What the extension sees, readable from the dashboard |

`context_status` is `confirmed`, `ambiguous`, `unknown` or `unsupported_page`. Only `confirmed`
carries `account`, `readiness`, `health`, `alerts` and `dashboard_paths`; the others carry a
`reason_code` (`account_not_registered`, `multiple_registered_matches`, `no_account_id_on_page`,
`account_archived`, `unsupported_page`) and nothing else.

Readiness, health and alerts are three separate values, as everywhere else. Resolving is
read-only: it evaluates readiness with `persist=False` and cannot rewrite stored state.

`safe_path` is sanitised server-side regardless of what was sent — a full URL is reduced to its
allowlisted route or discarded, and never echoed back.

### Events

| Method | Path | Token | Notes |
|---|---|---|---|
| `POST` | `/extension/events` | extension | `{ad_account_id, event_type, note, occurred_at?, page_type?, context_status?, safe_path?, extension_version}` → `201` |

`event_type` is an allowlist: `extension_context_confirmed`, `extension_context_ambiguous`,
`extension_context_unknown`, `manual_review_started`, `manual_review_completed`,
`campaign_change_intent`, `campaign_change_completed`, `account_note_added`,
`policy_issue_reported`, `payment_issue_reported`.

There is **no `severity` field**: the server decides it from the event type. Events that record
an operator decision require a non-empty `note`. An `occurred_at` in the future, or more than a
day old, is replaced with now.

The event is created through the A1 `AccountEventService`, so it lands in the account timeline,
writes an audit row and recalculates readiness exactly like a dashboard-entered event.

### Changed in A5

Route count rose from 117 to **125**, still with **no `DELETE` anywhere**, and the extension
surface uses only `GET` and `POST`. `account_events` gained a nullable `source_context_json`.

## Operations (A4)

Authenticated like everything else. The routes that reveal deployment detail or can cause an
external side effect are **owner-only**. Nothing here returns a secret, a hostname, a connection
string, a filesystem path or a raw chat id.

### Status and history

| Method | Path | Notes |
|---|---|---|
| `GET` | `/operations/overview` | Release, database and migration revision, dispatcher state, backup age, delivery counters, host CPU/memory/disk with bands and thresholds |
| `GET` | `/operations/runs` | Owner-only. Recorded runs, newest first. Filters: `kind`, `limit` |
| `GET` | `/operations/configuration` | Owner-only. Configuration **findings** and capability booleans |

`dispatcher_state` and `backup_state` are `current`, `stale` or `never` — "never run" is not
folded into "stale", because one has never started and the other stopped.

Host bands are `ok`, `warning`, `critical` or `unknown`. A metric that cannot be read reports
`unknown`; it never defaults to healthy.

`configuration` returns `{code, severity, message}` per finding and nothing else. It reports
that a secret is missing, a placeholder or too short — never its value.

### Controlled Telegram test send

| Method | Path | Notes |
|---|---|---|
| `POST` | `/operations/test-send/preview` | Owner-only. Renders the message, the masked recipient and eight pre-send checks. **Sends nothing** |
| `POST` | `/operations/test-send/execute` | Owner-only. `{approval_code, confirm}`. Sends exactly one message when all four gates are open |
| `POST` | `/operations/test-send/reset` | Owner-only. Records that the verification is closed. It cannot delete the send history |

`execute` accepts **only** `approval_code` and `confirm`. There is no recipient field and no
message body field: both come from server-side configuration and a fixed template, and any extra
field is rejected as a strict-payload violation. The field is named `approval_code` rather than
`preview_token` because A1's credential guard refuses any request field named like a secret —
correctly, and this value is an approval reference, not a credential.

Refusals are explicit and safe: `preview_token_mismatch`, `already_sent_for_this_preview`,
`pre_send_checks_failed:<codes>`, `transport_failed`. HTTP 422 covers a missing confirmation and
a disabled server switch.

The test send writes an `OperationalRun`, never a `NotificationDelivery`, so it is keyed
entirely outside the alert outbox and can neither collide with nor duplicate a real alert.

### Changed in A4

`GET /system/status` gains `release_version`, and `worker_status` is now derived from recorded
dispatcher runs (`running` / `stale` / `not_configured`) instead of the constant
`not_configured` it returned in A1–A3.

Route count rose from 111 to **117**, still with **no `DELETE` anywhere**, and the operations
surface uses only `GET` and `POST`.

## Preflight Compliance Gate (A6)

Draft-first, rule-based review of a campaign draft before the operator publishes it manually.
No route in this section ever creates, edits, publishes, pauses or duplicates anything on an
advertising platform — findings are advisory only, and `draft_status` never claims platform
approval.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/campaign-drafts` | Filters: `search`, `draft_status`, `ad_account_id`, `has_blocking_findings`, `archived`, pagination/sort |
| `POST` | `/campaign-drafts` | Creates in `draft` status |
| `GET` | `/campaign-drafts/{id}` | |
| `PATCH` | `/campaign-drafts/{id}` | Any edit resets `draft_status` back to `draft` |
| `POST` | `/campaign-drafts/{id}/archive` / `/restore` | Soft-archive only |
| `POST` | `/campaign-drafts/{id}/evaluate` | Runs `CopyRuleEngine` + `LandingPageCheckService` + `AccountContextRuleAdapter`, applies the §6.C verdict rollup. Idempotent-safe: an in-flight or just-completed run (5s cooldown) is returned unchanged rather than duplicated |
| `GET` | `/campaign-drafts/{id}/evaluation-runs` | History, newest first |
| `GET` | `/campaign-drafts/{id}/findings` | `include_superseded=false` by default |
| `GET` | `/campaign-drafts/{id}/landing-page-evidence` | Metadata only — never the fetched HTML |
| `POST` | `/preflight-findings/{id}/acknowledge` / `/resolve` | Both require a `reason`; neither changes `draft_status` — only a fresh `evaluate` does |

Landing-page fetches go through `services/preflight_safe_http.py`: SSRF-guarded (DNS/IP
validated before connecting and on every redirect hop), timeout, redirect cap, response-size
cap, `html.parser`-only signal extraction. `draft_status` values:
`draft`/`submitted_for_review`/`needs_changes`/`ready_for_manual_review`/
`blocked_by_internal_policy`/`unknown_missing_evidence`/`archived`.

## BM + ad account creation & sharing (A7)

Two operations against the official Meta API, both gated behind an explicit capability check
and an explicit operator confirmation. No route here calls a real Meta API yet —
`FakeMetaBusinessProvider` is the only provider wired anywhere, and no token is ever a column in
any table (mirrors the Telegram bot token's server-config-only boundary).

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/meta-connections` | `token_configured` is a computed boolean — never the credential |
| `GET` | `/meta-connections/{id}` | |
| `POST` | `/meta-connections/{id}/check-capability` | Refreshes `capabilities`/`business_managers` from the provider; nothing else may call the provider without this having run first |
| `POST` | `/account-creation-batches` | Draft. 409 if the connection's last capability check says `create_ad_account` is not allowed |
| `GET` | `/account-creation-batches/{id}` | Returns `current_preview_hash` alongside the batch's stored `preview_hash` — compare before confirming |
| `POST` | `/account-creation-batches/{id}/confirm` | Body: `{"preview_hash": ...}`. 409 (`preview_mismatch`) if the batch changed since preview, or if already confirmed |
| `POST` | `/account-creation-batches/{id}/run` | 409 if not yet confirmed. Sequential; a retryable failure requeues (bounded); a timeout becomes `unknown`, never auto-retried; a success syncs into `/ad-accounts` through the ordinary registry path (`readiness`/`health` both start `unknown`) |
| `POST` | `/account-creation-batches/items/{item_id}/reconcile` | Only valid on an `unknown`-status item |
| `GET`/`POST` | `/access-share-batches` | Same draft/preview/confirm/run shape, gated on `share_ad_account_access` |
| `POST` | `/access-share-batches/{id}/confirm` / `/run` | Same guarantees as account creation |

Batch item status: `queued`/`running`/`succeeded`/`failed`/`unknown`. A `queued` item stuck
`running` past a 2-minute lease is reclaimed and requeued (bounded retry) rather than stuck
forever.

## Bulk Pixel share (A8)

A third operation on the exact same engine as A7 — no new mechanism, one new capability
(`share_pixel_access`) and one new batch type.

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/pixel-share-batches` | Draft. Body: `{"meta_connection_id", "items": [{"source_external_pixel_id", "target_ad_account_external_id"}]}`. 409 if the connection's last capability check says `share_pixel_access` is not allowed |
| `GET` | `/pixel-share-batches/{id}` | Same `current_preview_hash` vs. stored `preview_hash` shape as A7's batches |
| `POST` | `/pixel-share-batches/{id}/confirm` | Body: `{"preview_hash": ...}`. Same `preview_mismatch` 409 guarantees as A7 |
| `POST` | `/pixel-share-batches/{id}/run` | Same sequential run, bounded retry, `unknown`-on-timeout, lease-recovery guarantees as A7's batches |

`check-capability`'s response now also includes `share_pixel_access` alongside A7's three
capability fields.

## Health and system

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health/live` | No auth. `{"status": "ok"}` |
| `GET` | `/health/ready` | No auth. 503 when the database is unreachable |
| `GET` | `/api/v1/system/status` | Auth required. Never exposes hostnames, connection strings, environment values or credentials |

## Dashboard device sessions (A9 Step 2)

Every dashboard login now creates a server-side `DeviceSession` row and embeds its id in the
JWT as a `session_id` claim, checked on every request — a token whose session is revoked,
expired, or simply missing the claim is refused, the same way an expired signature would be.
This is separate from A5's own `ExtensionInstallation` registry, which is untouched.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/security/sessions/me` | The caller's own sessions, `is_current` marks the one used for this request |
| `POST` | `/api/v1/security/sessions/{id}/revoke` | Own session: revoking your *current* one is refused (`409`) — sign out instead. Another member's session: owner-only (`403` otherwise) and a `reason` is required (`422` without one) |
| `POST` | `/api/v1/security/sessions/logout-other-devices` | Revokes every other active session for the caller; the current one is untouched |

## Meta connections and the real provider (A10)

`POST /meta-connections/{id}/check-capability` was the only endpoint in this product that could
reach Meta until A10.1 added `POST /meta-connections/{id}/discoveries`; those two remain the
whole list. Either reaches Meta only when **both** conditions hold: the connection's
`environment` is
`production` **and** `META_ACCESS_TOKEN` is set on the server. Anything else — `fake`,
`sandbox`, or `production` with no token — uses `FakeMetaBusinessProvider`, so a misconfigured
environment degrades to "no real call" rather than a surprise one.

The real provider is **read-only by construction**: `create_ad_account`,
`share_ad_account_access` and `share_pixel_access` raise, and the transport beneath it has no
method that can POST. A capability check against a real connection therefore reports
`list_business_managers: true` and the three write capabilities `false` with reason
`not_supported` — that is accurate, not a misconfiguration.

Graph errors map onto the existing `MetaFailureCode` vocabulary: `token_expired`,
`rate_limited`, `permission_missing`, `provider_server_error`, `invalid_request`, `timeout`.
Meta's own error text is never echoed back — it repeats request parameters, which can name a
Business Manager. See `docs/RUNBOOK_META_CONNECTION.md`.

## Configured BM validation & read-only asset discovery (A10.1)

Two owner-only endpoints, both on an existing connection:

| Method | Path | What it does |
|---|---|---|
| `POST` | `/meta-connections/{id}/discoveries` | Validates the configured BM, then reads its ad accounts and Pixels. Returns the run plus reconciliation |
| `GET` | `/meta-connections/{id}/discoveries/latest` | The most recent run, reconciliation recomputed. **Makes no provider call** |

`META_BUSINESS_ID` is server configuration and is never accepted from a request body, a query
parameter or the extension. It is not a secret — a BM id is public in Business Settings — so
unlike the token it may appear in responses and logs.

### Coverage, and why a count alone is not an answer

Discovery reads **two** edges for ad accounts, `owned_ad_accounts` and `client_ad_accounts`,
and one for Pixels, `adspixels`. Each response carries `required_edges`, a per-edge `coverage`
object and a `coverage_status` of `complete`, `partial`, `incomplete`, `unknown`, `stale` or
`not_attempted`.

This exists because of a measurement, not a theory: on a real Business Manager the four ad
accounts split two and two across the edges. A run reading only the documented
`owned_ad_accounts` succeeds at everything it attempts, so an error-based notion of
completeness calls it complete — while half the inventory is invisible. Coverage is therefore
derived from **whether every required edge answered**, not from the absence of errors, and an
edge that was never attempted is recorded explicitly rather than omitted.

### `read_as` — who produced the result

Every discovery response carries `read_as: {external_id, name}`: the Meta identity the provider
was acting as. Recorded because the inventory depends on it — measured 2026-09-11, the same
Business Manager returned 4 ad accounts to an *Employee* system user and 8 to an *Admin* one,
minutes apart.

A result is therefore evidence about what **that identity** could read. A later run by a narrower
token reports `coverage: complete` truthfully and would otherwise license
`missing_from_latest_discovery` for records a broader token had just confirmed. Any view that
compares two runs, or two Business Managers, must carry the reader with the count.

### Ad account creation against a real Business Manager (A10.2)

The existing A7 batch endpoints are unchanged. What changed is what a `production` connection's
provider does when a confirmed batch runs: it now really creates the account.

Item outcomes carry the same vocabulary as before, with two that matter more than the rest:

| Outcome | Meaning |
|---|---|
| `failed` + `billing_required` | The Business Manager needs billing configured before it can hold a new ad account. Mapped separately so a fixable condition is named rather than reported as a generic rejection |
| `unknown` + `timeout` | The request may have succeeded on Meta's side. **Never retried automatically**, and `reconcile_create` cannot resolve it — Meta has no idempotency key for creation, and matching by name is forbidden. It waits for a person to open Business Settings |

A live batch is capped at `META_WRITE_PILOT_MAX_ITEMS` (default 1) whenever the provider's writes
are real. Sharing ad-account access and sharing a Pixel are still refused outright.

### A Business Manager per connection

`POST /meta-connections` accepts `business_manager_reference` (optional, max 120 chars). Empty
inherits the server's `META_BUSINESS_ID`, which is what every connection created before A10.3 did.

Every connection response carries the id actually read plus where it came from:

```json
{"business_manager_reference": "1993884657458857", "business_manager_source": "server"}
```

`business_manager_source` is `connection` or `server`. It exists because inheriting is legitimate
but means the card is not about a business of its own — every inheriting connection reads the same
Business Manager, and two such connections produced two rows for one business.

**Set at creation and never updated.** There is no PATCH for it: changing which Business Manager a
connection reads would silently reinterpret every run it has already recorded, and those runs are
the evidence behind `missing_from_latest_discovery`. A different Business Manager is a new
connection.

Naming a Business Manager does not make it readable. A run whose provider does not return the
named BM fails with `not_configured` rather than attributing whatever came back to the id asked
for. With the authority gate, a BM this token has no role in reports `coverage: unknown` and zero
assets — honestly, instead of `complete`.

### `business_authority` — whether an empty result may be trusted

Every discovery response carries `business_authority`: `established`, `not_established` or
`not_checked`.

It is asked only of an **empty** inventory. Measured 2026-09-11: a system-user token with no role
in a Business Manager still reads that BM's node, and its asset edges answer `200` with an empty
list and **no error**, while `{business-id}/system_users` refuses with `permission_missing`. An
error-free empty result therefore cannot distinguish "this BM holds nothing" from "this token may
not see what it holds".

Without established authority an empty inventory reports `coverage_status: "unknown"`, never
`"complete"` — which withholds `missing_from_latest_discovery` for every record mapped to that
Business Manager. A non-empty inventory proves its own authority and spends no extra call;
`not_checked` means nobody asked, and never reads as access.

A refusal is recorded as `not_established`, not as proof of non-membership: reading that edge can
itself require an admin role. Both readings forbid the same conclusion, which is all the gate
decides.

### `POST /meta-connections/{connection_id}/discoveries/{run_id}/imports`

Registers one ad account the named run returned, in the A1 registry. Body:
`{"external_account_id": "..."}` — one account, not a list.

The run is named in the path rather than resolved as "the latest": the operator is acting on a
result they are looking at, and a run completing between render and click must not silently
become the evidence for a write.

Everything goes through A1's own registry service, so the record is indistinguishable from one
typed by hand — same uniqueness guard (a second import answers **409**), same audit row, same
checklist, same `unknown` readiness. Meta having returned an account is not evidence that this
workspace is ready to run ads on it. The Business Manager row is created if absent, from the
reference the run already recorded, and reused by external id afterwards.

Refusals: **404** for an account that run did not return, for a run belonging to another
connection, and for another workspace's run (never 403 — a 403 would confirm the id exists).

**Not gated on coverage or authority.** Those gate conclusions about *absence*, which are only
meaningful against a full inventory read by an identity allowed to see it. An account that was
returned was observed; requiring complete coverage would block the first import of a Business
Manager whose client edge happens to be refused, for no gain in truth.

A second audit row, `meta_discovery.ad_account_imported`, carries the provenance: the run id, the
Business Manager reference, the edge that produced the account, and the identity that read it.

### Reconciliation

Exact canonical external id only; display names are never matched. Ad account ids are
canonicalised with A5's `canonical_external_id`, because Meta writes an account as `act_123` on
one field and `123` on another while the registry stores whichever form an operator typed.

`missing_from_latest_discovery` is the strongest statement available, so it is the last branch
and every earlier one withholds it: no usable external id → `unknown`; present in the union →
`matched`; no proven BM mapping → `out_of_scope`; mapped to a different BM → `out_of_scope`;
coverage not `complete` → `unknown`. It means only "not returned by the latest completed
discovery" — never that Meta deleted, disabled or restricted anything, and it never changes an
internal record on its own.

**Pixel reconciliation is asymmetric.** Meta → registry produces `matched` or
`missing_in_registry`; registry → Meta always produces `out_of_scope`, and the payload says so
in `pixels.registry_absence_evaluable: false`. `Pixel` has no Business Manager relationship in
the A1 schema, so a registry Pixel cannot be proven to belong to the configured BM and its
absence from that BM's discovery is not evidence about it. Lifting this needs a Pixel↔BM
ownership model, not a foreign key added in passing.

See `docs/META_READ_ONLY_DISCOVERY.md`.

## Team & Seats (A9 Step 5)

Every endpoint below is **owner-only** (`403` for any other role) except
`POST /team/invitations/accept`, which is for the invitee. Roles in this API use A9's own
vocabulary — `admin`/`operator`/`viewer` — mapped to the existing `WorkspaceRole` enum
(`operator`≈`buyer`) at the service boundary; `owner` can never be invited or assigned here.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/team/summary` | `seat_limit`/`available_seats` are `null` until a plan is configured — unknown capacity is never reported as a guessed number |
| `GET`/`PATCH` | `/api/v1/team/seat-plan` | `seat_limit` cannot be set below the current active-member count (`409`) |
| `GET` | `/api/v1/team/members` | Includes per-member assigned-BM/ad-account counts and live session count |
| `GET` | `/api/v1/team/members/{id}` | `404` (not `403`) across workspaces |
| `PATCH` | `/api/v1/team/members/{id}/role` | Body `{"role": "admin"\|"operator"\|"viewer"}`. `owner` is rejected by the schema itself (`422`); downgrading the last active owner is `409` |
| `POST` | `/api/v1/team/members/{id}/suspend` | Requires `reason`. Immediately revokes every live dashboard session of that member |
| `POST` | `/api/v1/team/members/{id}/unsuspend` | Only from `suspended` (`409` otherwise) |
| `POST` | `/api/v1/team/members/{id}/deactivate` | Requires `reason`. Revokes all sessions, releases the seat, keeps all history |
| `POST` | `/api/v1/team/members/{id}/reactivate` | `409` when no seat is available |
| `POST` | `/api/v1/team/members/{id}/archive` | Requires `reason`. Soft archive; the last active owner cannot be archived (`409`) |
| `GET` | `/api/v1/team/members/{id}/access-preview` | Owner-only, bounded: `is_owner` plus the concrete BM/ad-account id sets a non-owner can actually see |
| `GET`/`POST` | `/api/v1/team/invitations` | `POST` returns `invite_link_token` **once** — it is never stored raw and never returned by any later read |
| `GET` | `/api/v1/team/invitations/{id}` | Lazily marks a past-expiry invitation `expired` on read |
| `POST` | `/api/v1/team/invitations/{id}/revoke` | Requires `reason`. Only a `pending` invitation (`409` otherwise) |
| `POST` | `/api/v1/team/invitations/{id}/resend` | Supersedes the old token (it stops working immediately) and returns a brand-new one |
| `POST` | `/api/v1/team/invitations/accept` | Not owner-only. Body `{"token", "password"?, "full_name"?}`. Brand-new email: registers the account (password required, ≥8). Email that already has an account: must be called **with that account's bearer token** (`401` otherwise) — nobody claims an existing account by knowing its address. Signs the member in on success (returns `access_token`) |
| `GET` | `/api/v1/team/members/{id}/assignments` | Both BM and ad-account assignments, including revoked history |
| `POST` | `/api/v1/team/members/{id}/business-manager-assignments` | `409` on a duplicate *active* assignment; the owner needs no assignment (`422`) |
| `POST` | `/api/v1/team/members/{id}/ad-account-assignments` | Same rules |
| `POST` | `/api/v1/team/assignments/{id}/revoke` | Requires `reason`. Row is kept, status becomes `revoked` — no hard delete |
| `GET` | `/api/v1/team/members/{id}/sessions` | Owner-only view of another member's device sessions |
| `POST` | `/api/v1/team/members/{id}/sessions/revoke-all` | Requires `reason`. Returns `revoked_count` |

### Resource scope (A9 Step 7)

Since A9, a non-owner sees only the Business Managers and ad accounts assigned to them. This is
enforced in `AdAccountRegistryService.get()` — the single point every account-resolving route
uses — so `/ad-accounts`, readiness, health, events and per-account audit history all inherit
it. Alerts are filtered by their `ad_account_id`; an alert with no account link is not visible
to a non-owner. `/meta-connections` and the A7/A8 batch endpoints are owner-only.

Out-of-scope always answers `404`, never `403`, and the body never names the record — the same
answer another workspace's record gives. The owner is unaffected: no filter, no extra queries.

The UI for all of this lives at `/team` (owner-only) and `/security-devices` (any member),
both reached from Settings rather than the main nav. Verified in real Chromium —
`backend/scripts/a9_live_verify.py`, 20/20, screenshots in `docs/evidence/A9-LIVE/`.
