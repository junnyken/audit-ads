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

## Health and system

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health/live` | No auth. `{"status": "ok"}` |
| `GET` | `/health/ready` | No auth. 503 when the database is unreachable |
| `GET` | `/api/v1/system/status` | Auth required. Never exposes hostnames, connection strings, environment values or credentials |
