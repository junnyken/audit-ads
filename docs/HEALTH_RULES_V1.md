# Health rules — version 1 (`a2-v1`)

Ten typed rules, evaluated in this order. Each is a Python function in a fixed registry
(`backend/app/services/health_rules.py`); there is no user-authored rule code, no expression
parser and nothing evaluated from a string.

Every rule reads only A1 facts already stored in this product. No rule contacts an advertising
platform, and no rule predicts platform enforcement.

| # | `rule_key` | Category | Severity | Fires when | Closes when |
|---|---|---|---|---|---|
| 1 | `account_restricted_status` | account_status | critical | The recorded account status is `restricted` | The status is no longer `restricted` |
| 2 | `account_disabled_status` | account_status | critical | The recorded account status is `disabled` | The status is no longer `disabled` |
| 3 | `critical_account_event_open` | operations | critical | An A1 account event with severity `critical` is unresolved (one signal per event) | The source event is resolved or archived |
| 4 | `warning_account_event_open` | operations | warning | An A1 account event with severity `warning` is unresolved (one signal per event) | The source event is resolved or archived |
| 5 | `mandatory_readiness_evidence_missing` | readiness | attention | One or more required checklist items have no completed review or verified evidence | Every listed item is satisfied |
| 6 | `mandatory_readiness_evidence_expired` | readiness | warning | One or more required checklist items have expired, rejected or flagged evidence (excluding the manual-review item, which rule 9 owns) | Those items carry current, verified evidence |
| 7 | `readiness_not_ready` | readiness | warning | A1 readiness is `not_ready` **and** no critical source fact already explains it | Readiness is no longer `not_ready` |
| 8 | `readiness_unknown` | data_quality | attention | A1 readiness is `unknown` | Readiness resolves to any other state |
| 9 | `manual_review_due_or_stale` | operations | warning | The last manual review is missing, or older than the configured interval | A manual review is recorded within the interval |
| 10 | `account_data_stale_or_unknown` | data_quality | **unknown** if the account has no checklist at all, otherwise attention | Required health inputs are missing (no checklist items, or readiness never evaluated) | The inputs exist |

## Interactions

**Rule 7 is suppressed behind critical facts.** A2 §B requires choosing one approach and
documenting it. When an account is restricted or has an open critical event, `readiness_not_ready`
is not emitted: reporting the same fact twice under two names makes the account look worse than
the evidence supports and buries the actual cause. The critical signal is the one that carries the
detail.

**Rule 10 is the only rule that may raise `unknown` severity.** It fires when the engine has
nothing to assess. That severity blocks `clear_signals` in the rollup, because "we could not look"
must never be reported as "we looked and found nothing".

**One fact, one signal.** `signal_key` is `rule_key` plus a source scope (`account`, `readiness`,
`checklist`, `manual_review`, `inputs`, or `event:<id>`). A unique index on
`(ad_account_id, active_key)` makes duplicate active signals impossible at the database level.

## Policy values

| Setting | Default | Source |
|---|---|---|
| `manual_review_due_after_days` | 30 | Reuses the A1 setting `READINESS_MANUAL_REVIEW_INTERVAL_DAYS` rather than introducing a second, divergable value |
| `health_evaluation_stale_after_hours` | 24 | `HEALTH_EVALUATION_STALE_AFTER_HOURS` |
| `signal_default_expiry_days` | none | Status- and event-derived signals close when their source fact ends, not on a timer |

## Limitations

- Every rule reads operator-entered records. Nothing here observes an advertising platform, so a
  signal describes what *you recorded*, not what the platform currently thinks.
- Data freshness for platform sync is permanently `unknown`/`not_applicable` in this release,
  because there is no integration to be fresh against.
- Rules are read-only through the API. Enabling, disabling and re-versioning are supported by the
  schema and the engine, but there is no admin UI in A2 — A1 shipped no settings architecture to
  extend, and inventing one was out of scope.
- Severity is fixed per rule in version 1. Per-workspace thresholds are deferred.
