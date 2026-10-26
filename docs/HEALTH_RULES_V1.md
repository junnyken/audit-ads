# Health rules — version 1 (`a2-v1`)

Ten typed rules from A2, plus four spend rules added by S1 (2026-10-26) and four Meta account-status
rules added by S2 (2026-10-27), evaluated in this order. Each is a Python function in a fixed registry
(`backend/app/services/health_rules.py`); there is no user-authored rule code, no expression
parser and nothing evaluated from a string.

Every rule reads only facts already stored in this product — A1 records, and since S1 spend
observations (which also carry Meta's `account_status` / `disable_reason` codes, interpreted by S2)
that were read from Meta and stored *before* evaluation. No rule contacts an
advertising platform, and no rule predicts platform enforcement.

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
| 11 | `spend_observation_missing_or_stale` | spend | attention | The account can be read (production connection + reader) and spend was never read successfully, the latest success is older than `SPEND_OBSERVATION_STALE_AFTER_HOURS` (26), or the last 3 reads failed | A successful read lands inside the window |
| 12 | `spend_change_vs_baseline` | spend | warning | Current read, known timezone, a row for the latest complete local day, ≥5 earlier complete days with rows; \|Δ\| vs their median ≥ 50% **and** ≥ the currency minimum (VND 500 000, USD 20; no minimum ⇒ never). One signal per day | The latest complete day is back in range, or there is no longer enough data |
| 13 | `spend_cap_approaching` | spend | warning | `amount_spent / spend_cap` (raw Meta values, cap > 0) ≥ 0.9 on a current read. **Seeded disabled** until the first live read confirms the units | Ratio below 0.9 or cap removed |
| 14 | `spend_currency_mismatch` | spend | attention | Meta's currency ≠ the registry currency, or insights rows disagree with the account node | The currencies agree |
| 15 | `platform_account_status_blocking` | account_status | critical | The latest stored observation **carrying an `account_status` code** (a failed spend read counts: the node answered) says `2` disabled, `100` pending closure or `101` closed — **whatever its age** (old is not recovered; the evidence carries the freshness) | The latest code is no longer one of those, or no code is stored |
| 16 | `platform_account_status_pending` | account_status | warning | That code is `3` unsettled, `7` pending risk review, `8` pending settlement or `9` in grace period | As above |
| 17 | `platform_account_status_unrecognised` | data_quality | attention | That code is present but not on the allowlist (`201`/`202`, any other number, anything non-numeric, `01`, too long) — `unknown`, never `active` | The code is back on the allowlist, or no code is stored |
| 18 | `platform_vs_recorded_status_mismatch` | account_status | attention | The observation is **current** and Meta `active` while the record says `restricted`/`disabled`, or Meta not-operable/pending while the record says `active`. Records `unknown`/`warning`/`archived` and Meta `unknown` are never compared | The two agree, or the observation is no longer current |

Spend signals carry `source_type = provider_observation`. Missing data never fires a spend rule
(no row ≠ 0; no timezone ⇒ no "yesterday"; no baseline ⇒ no comparison), and no spend rule raises
`unknown` — rule 10 remains the only one that may. Details: `ARCH.md` §4j.

Account-status signals (15–18, S2) also carry `source_type = provider_observation` and evidence
naming "Meta read-only observation (ad account node)". All four are **enabled by default**
(decided 2026-10-27). The code → state allowlist lives in `services/platform_status.py`; a missing
code is "not observed" (no rule fires), and `disable_reason` explains but never changes a severity.
Which observation said it and when (`observation_id`, `observed_at`, `observation_status`,
`observation_failure_code`) and the sliding context (`previous_*`, `since_observed_at`) are
volatile evidence keys, so an unchanged code does not supersede the signal on every read;
`spend_freshness` is material, so `current → stale` supersedes once (no new delivery, severity
unchanged). Returning to `1` closes the signal through the engine's usual wording ("The source
condition is no longer true.") — there is no "recovered" message (A3 v1). Health never writes
`AdAccount.status`: the dashboard's "Record Meta status in the registry" opens the ordinary edit
form, and a person saves it. Details: `ARCH.md` §4k.

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

- Rules 1–10 read operator-entered records only, so their signals describe what *you recorded*.
  Rules 11–18 read stored Meta observations — what Meta returned to the named reader when it was
  read, not what Meta thinks now. No rule contacts Meta during evaluation. (The sentence that used
  to stand here, "nothing here observes an advertising platform", stopped being true with S1.)
- A1's "platform sync" freshness (`last_synced_at`) is still never written by a Meta read; spend and
  status reads carry their own freshness (`current` / `stale` / `never_observed` / `not_observable`).
- Rules are versioned in code. Since the rule-toggle follow-up, the owner can enable or disable a
  rule per workspace (`PATCH /account-health/rules/{key}`, "Configured checks" on Account Health).
- Severity is fixed per rule in version 1. Per-workspace thresholds are deferred.
