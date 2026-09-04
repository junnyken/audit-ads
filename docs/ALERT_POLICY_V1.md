# Alert and notification policy — version 1 (`a3-v1`)

How an A2 health fact becomes an Alert Center item, and when that item becomes a Telegram
message. Everything here is deterministic and lives in code; there is no user-authored rule
expression anywhere in A3.

## 1. Source → alert

| A2 source | Alert severity | Telegram behaviour |
|---|---|---|
| Health signal, severity `critical`, status open/acknowledged | `critical` | Immediate candidate. Bypasses quiet hours when the policy says so (default: yes) |
| Health signal, severity `warning`, status open/acknowledged | `warning` | Candidate, deferred to the end of the quiet window if raised inside it |
| Health signal, severity `attention` or `unknown` | `info` | Alert Center item only. Telegram **off by default** |
| Health signal resolved / superseded / expired | — | The linked alert resolves. **No "resolved" Telegram message in v1** |
| Health evaluation run failed, and it is the latest word on the account | `warning` | Candidate, quiet-hours aware. Carries only the allowlisted error *code* — never the exception text |
| Health evaluation succeeded after a failure | — | The failure-derived alert resolves automatically |

The original A2 severity is kept in `source_snapshot_json.health_severity`, so mapping an
`attention` signal to an `info` alert stays explainable rather than looking like a downgrade
someone invented.

**Alert key** — `health_signal:{ad_account_id}:{signal_key}` or
`health_evaluation_run:{ad_account_id}:{error_code}`. At most one *active* alert per key is
enforced by the database through a nullable `active_key` with `unique(workspace_id, active_key)`.

## 2. Alert lifecycle

```
            ┌───────────────┐  acknowledge (note)   ┌────────────────┐
            │     open      │──────────────────────►│  acknowledged  │
            └───────┬───────┘                       └────────┬───────┘
   suppress (reason │ + future expiry)                       │ suppress
                    ▼                                        ▼
            ┌───────────────┐   expiry passes / unsuppress   ┌────────────┐
            │  suppressed   │───────────────────────────────►│ open / ack │
            └───────┬───────┘                                └────────────┘
                    │ source condition ends, or operator resolves (reason)
                    ▼
            ┌───────────────┐        reopen (reason, if no active alert holds the key)
            │   resolved    │◄──────────────────────────────────────────────────────
            └───────────────┘
```

- **Acknowledge is not resolve.** An acknowledged alert keeps its `active_key`, keeps counting,
  and leaves the A2 signal exactly as it was.
- **Suppression mutes delivery only.** The alert stays in the Alert Center with its full history.
  It requires a reason and a future expiry; indefinite suppression is refused. Suppressing a
  critical alert shows an explicit warning in the UI and is audited.
- **Nothing is deleted.** Resolved, expired and superseded alerts stay queryable forever.

## 3. Delivery policy defaults

| Setting | Default | Note |
|---|---|---|
| `enabled` | `true` | |
| `timezone` | `Asia/Ho_Chi_Minh` | IANA identifier, validated server-side |
| `quiet_hours_enabled` | `true` | |
| `quiet_hours_start` / `quiet_hours_end` | `23:00` / `07:00` | Cross-midnight windows supported |
| `critical_bypasses_quiet_hours` | `true` | |
| `warning_telegram_enabled` | `true` | |
| `attention_telegram_enabled` | `false` | Info alerts stay in-app |
| `reminder_enabled` | `false` | |
| `telegram_chat_id` | `null` | Seeded with **no recipient**, so a new workspace messages nobody |

The bot token is **not** in this table. It is server-side environment configuration
(`TELEGRAM_BOT_TOKEN`), and the API exposes only a boolean capability.

## 4. Deduplication

`idempotency_key` = `alert_id : reason : severity : recipient` (plus a sequence number for
reminders), unique per workspace. Planning is an upsert against it, so:

1. One initial delivery per alert, source state and recipient.
2. Re-evaluating an unchanged condition creates nothing new.
3. A severity escalation creates exactly one additional delivery (`reason = escalation`).
4. A resolved alert sends nothing in v1.
5. A retry appends an **attempt**, never a second delivery row.
6. Acknowledgement creates no delivery.
7. Suppression deletes no delivery history.
8. Reminders are disabled by default; when enabled, each one gets its own sequence.

## 5. Quiet hours

Evaluated in the policy's timezone with `zoneinfo`, not the server's. A window that crosses
midnight is handled directly (`23:00 → 07:00` means "at or after 23:00, or before 07:00").

- Critical + `critical_bypasses_quiet_hours` → scheduled immediately.
- Otherwise, inside the window → `scheduled_for` is set to the **next end of the window in that
  timezone**. The delivery is deferred, never discarded.
- If the timezone cannot be resolved, the delivery is **skipped** with
  `timezone_not_configured`. A3 never guesses an hour.

The decision — timezone, whether it was inside the window, whether critical bypassed it, and the
computed end — is stored on the delivery so the UI can explain itself.

## 6. Every reason a message is not sent

| `skip_reason` | Meaning |
|---|---|
| `no_recipient_configured` | No chat is configured. The alert is fully usable in-app |
| `policy_disabled` | Notifications are switched off |
| `severity_delivery_disabled` | This severity is not sent under the current policy |
| `alert_suppressed` | The alert was suppressed when the delivery was planned |
| `alert_not_active` | The alert was already closed |
| `timezone_not_configured` | The policy timezone could not be resolved |
| `reminders_disabled` | A reminder was requested while reminders are off |

Every one is written down as a `skipped` delivery row. "No message arrived" always has a record.

## 7. Dispatch and retry

- **Claim**: `SELECT … FOR UPDATE SKIP LOCKED`, batch of 10 by default, concurrency 1.
- **Retry**: transient failures only (`network_error`, `rate_limited`, `provider_server_error`),
  backoff 1 min → 5 min → 15 min, maximum 3 attempts, then `failed_final`.
- **Never retried**: `invalid_recipient`, `unauthorized`, `message_rejected`,
  `transport_not_configured`. These need a person, not another attempt.
- **Cancelled**: if the alert closed before the message went out, the delivery is cancelled
  rather than sent — an alert about something that is over is noise.
- **Recovery**: a delivery left in `sending` past its lease is reclaimed by the recovery sweep.
  Nothing lives in memory, so a restart loses nothing.

## 8. Message template `a3-v1`

```
[AdsOps] {SEVERITY} — {ALERT_TITLE}

Account: {ACCOUNT_DISPLAY_NAME} ({ACCOUNT_REFERENCE})
Health: {HEALTH_STATUS}
Readiness: {READINESS_STATUS}
Observed: {OBSERVED_AT_IN_POLICY_TIMEZONE}

Reason: {SAFE_SUMMARY}
Next step: {RECOMMENDED_MANUAL_ACTION}

{OPTIONAL_DASHBOARD_LINK}
```

Rendered server-side from that allowlist and nothing else. Control characters are stripped,
newlines collapsed (so an operator note cannot forge a field), fields truncated, and the whole
message capped well below Telegram's limit. The dashboard link appears only when
`ADSOPS_PUBLIC_APP_URL` is set to a public HTTPS URL — a link to `127.0.0.1` or a private range is
omitted, because it is useless to whoever receives it.

## 9. Limitations

- **No scheduler.** Dispatch runs when `python -m app.commands.dispatch_notifications` is invoked
  or when the owner triggers it. A deferred warning waits for the next dispatch after its
  scheduled time.
- **Telegram only**, one-way. There are no bot commands, and no other channel.
- **No reminder UI beyond the toggle**; the mechanism exists and is off by default.
- **No real message has ever been sent** by this codebase. The default transport is `disabled`,
  tests use the fake, and no bot token exists in the repository.
