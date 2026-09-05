# TEST_LOG

## Session 2026-09-04 — MINI-SPEC A1

**Environment**

| | |
|---|---|
| Host | Mắt Bão Cloud IDE workspace (12 vCPU / 62 GB) — *not* the 4 vCPU / 8 GB target VPS |
| Python | 3.12.3, venv at `backend/.venv` |
| Node | 22.22.3, npm 10.9.8 |
| Database | PostgreSQL 16-alpine in Docker, `localhost:5434` (`adsops`, `adsops_test`) |
| API under test | `uvicorn app.main:app` on `127.0.0.1:8009`, `ENVIRONMENT=local-pilot` |
| Migration revision | `0001_a1_registry` |

### 1. Backend automated tests — PASS

```
$ .venv/bin/python -m pytest
111 passed in 83.84s
```

| File | Tests | Covers |
|---|---|---|
| `tests/test_readiness_engine.py` | 25 | Every rollup rule as a pure-function unit test |
| `tests/test_redaction.py` | 28 | Sensitive-name detection, recursive redaction, credential-shaped values |
| `tests/test_registry_api.py` | 19 | CRUD, uniqueness, archive/restore, links, filters, pagination, cross-workspace denial |
| `tests/test_readiness_api.py` | 18 | Checklist → evidence → events lifecycle end-to-end |
| `tests/test_security_api.py` | 13 | Secret rejection, audit redaction, system-status leakage, headers |
| `tests/test_audit_api.py` | 8 | Audit completeness, changed-field diffs, scoping, no write endpoint |

Readiness rules verified as units: archived → `unknown`; `restricted`/`disabled` → `not_ready`
even with a complete checklist; missing mandatory evidence → `unknown` with an item reason;
expired and rejected evidence → `not_ready`; expired review date → `not_ready`; waiver never
satisfies a required item; unresolved warning → `ready_with_warnings`; unresolved critical →
`not_ready`; resolved and `info` events do not block; conditional BM/personal items apply only
to their account type; manual review past the interval → `not_ready`; never reviewed →
`unknown`; a browser + proxy reference alone can never reach `operationally_ready`; no reason
message makes a safety or approval claim.

### 2. Migration verification on a clean database — PASS

The pytest session drops and recreates `public`, then runs `alembic upgrade head`, so every run
is a clean-database migration check. Verified separately against a freshly created `adsops`
database: 17 tables created from a single revision, no manual step.

### 3. Backend lint — PASS

```
$ .venv/bin/ruff check .
All checks passed!
```

### 4. Frontend — PASS

```
$ npx vitest run          16 passed | 7 skipped (live suite, opt-in)
$ npm run build           tsc -b && vite build → dist 292.34 kB (86.40 kB gzip)
$ npx eslint .            clean
```

Hermetic tests cover the readiness colour map (`unknown` and `not_ready` can never be styled as
success; only `operationally_ready` may be green), all four badges rendering, the error state
showing a correlation ID, the loading skeleton being `aria-busy`, the audit diff rendering
`[REDACTED]` as a visible marker rather than hiding it, and the account form offering no
password/cookie/token/credential input.

### 5. Live pilot — PASS (28/28)

Executed 2026-09-04 21:09 against the running API on a **freshly created database**, driving the
same endpoints the dashboard calls.

| # | Check | Result |
|---|---|---|
| 1 | Sign in as the bootstrapped owner | PASS (`workspace=Matbao AdsOps`) |
| 2 | Registry empty before the pilot | PASS |
| 3 | Create BM, personal reference, page, pixel, payment, 3 browser profiles, proxy | PASS |
| 4 | Proxy connection string refused | PASS (`forbidden_field`) |
| 5–7 | `password` / `cookie` / `access_token` fields refused | PASS |
| 8 | Account A created, checklist initialised, readiness `unknown` | PASS |
| 9 | Account A partially complete is still not ready | PASS |
| 10 | **Account A → `operationally_ready`** (10/10 required items) | PASS |
| 11 | **Account B → `unknown`** with explicit payment reason | PASS |
| 12 | Proxy reference is advisory (`info`) only | PASS |
| 13 | **Account C → `not_ready`** with restriction + critical-event reasons | PASS |
| 14 | Reference mapping alone never makes an account ready | PASS |
| 15 | Resolving the event and status recomputes readiness | PASS |
| 16 | Registry filters, search by BM name, pagination | PASS (all=3, ready=1, browser=3, bm search=2) |
| 17 | Readiness summary and board | PASS |
| 18 | Unlink keeps the historical row | PASS |
| 19 | Removing a required Page downgrades A to `unknown` | PASS |
| 20 | Re-linking restores A to `operationally_ready` | PASS |
| 21 | Archived account keeps checklist (14) + audit (3) and refuses edits (409) | PASS |
| 22 | Archived account reports `unknown` readiness | PASS |
| 23 | No hard-delete endpoint (`DELETE` → 405) | PASS |
| 24 | Audit covers every mutation type (49 entries, 19 distinct actions) | PASS |
| 25 | No credential-like key persisted in any audit row | PASS |
| 26 | The pilot password never appears in audit output | PASS |
| 27 | System status hides infrastructure detail | PASS (`revision=0001_a1_registry`) |
| 28 | No readiness message claims safety or approval | PASS |

**Pilot scenarios versus A1 §Live verification:**

| Scenario | Expected | Actual |
|---|---|---|
| A — complete BM mapping, all mandatory evidence verified, current review, no events | `operationally_ready` | `operationally_ready` ✔ |
| B — payment review missing | `unknown` or `not_ready` with an explicit payment reason | `unknown`, reason `payment_method_reviewed_incomplete` ✔ |
| C — restricted status and an unresolved critical event | `not_ready` with restriction/event reasons | `not_ready`, reasons `account_status_restricted` + `unresolved_critical_event` ✔ |

### 6. Live UI verification — PASS (7/7)

`frontend/src/test/live.app.test.tsx` renders the real pages (jsdom) against the running API and
its live pilot data — not fixtures or mocks:

- Overview renders live readiness counts and the "internal operational state" framing.
- The registry table lists all three pilot accounts with their readiness badges.
- Opening Pilot B shows the payment-review reason behind its `unknown` state.
- The Readiness tab shows per-item "Why required?" text and marks derived items as **Derived**.
- The Audit History tab renders `ad_account.created` and states the log is append-only.
- The Readiness board renders grouped reasons and states there is no bulk action.
- System Status renders revision `0001_a1_registry` and leaks no `postgresql`, credential or
  `JWT_SECRET` string into the DOM.

### 7. Development fixtures — PASS

```
$ .venv/bin/python -m app.seeds.fixtures
account_a: Pilot A - complete record -> operationally_ready
account_b: Pilot B - payment review missing -> unknown
account_c: Pilot C - restricted with critical event -> not_ready
```

Re-running reports `already_seeded` and creates nothing (idempotent).

### 8. Deployment configuration — PARTIALLY VERIFIED

`docker compose config` validates and resolves. Memory limits and health checks are declared on
all three services.

**Not verified in this session:** the images were not built, and the compose stack was not
started. The API and the SPA were exercised directly (uvicorn + vitest/jsdom + `npm run build`),
not through the nginx container. Deploying to the target VPS is a separate, unperformed step.

## Issues found and fixed during this session

| Issue | Fix |
|---|---|
| The generated reference routers used PEP 563 string annotations, so FastAPI could not resolve the closure-provided body schema and silently treated request bodies as query parameters (every reference `POST` returned 422) | Removed `from __future__ import annotations` from that module, with a comment stating why it must stay absent |
| `pydantic-settings` JSON-decodes list-typed env values before validators run, so `CORS_ORIGINS=a,b` crashed the app at startup | Read the raw string and expose `cors_origins` as a computed property |
| The `operationally_ready` message read "not a platform approval **or** a guarantee", which a strict reading parses as an affirmative guarantee clause | Reworded to "it is not a platform approval, **and it is not** a guarantee against restriction"; the test now requires any use of "guarantee" to be explicitly negated |
| Vitest 2 bundles its own Vite copy; merging test config into `vite.config.ts` made `tsc` compare two Vite type trees and fail the build | Split `vitest.config.ts` from `vite.config.ts` |
| Test emails used the reserved `.test` TLD, which `email-validator` rejects | Switched fixtures to `example.com` |

## Explicitly not tested

- No advertising platform was contacted. A1 has no integration and no credential to use one.
- No browser automation, antidetect or proxy tooling exists to test — building it is prohibited.
- No load or performance testing on the target VPS.
- No manual click-through in a real browser. UI verification was done by rendering the real
  components against the live API in jsdom, plus a production build; that is not the same as a
  human driving Chrome, and the difference is recorded here deliberately.

---

## Session 2026-09-04 (later) — MINI-SPEC A2

**Environment** — unchanged from the A1 session (Python 3.12.3, Node 22.22.3, PostgreSQL 16 in
Docker on `localhost:5434`, API on `127.0.0.1:8009`). Migration head is now
`0002_a2_account_health`.

### 1. A1 baseline re-verified before any A2 code — PASS

Run first, per A2 §7:

```
$ .venv/bin/python -m pytest tests/       111 passed in 79.68s
$ .venv/bin/ruff check .                  All checks passed
$ npx vitest run src/test/readiness.test.ts   6 passed
```

The seven A1 invariants named in A2 §7.2 were each re-run individually and all pass:
missing mandatory evidence cannot yield `operationally_ready`; manual completion of a derived
checklist item is rejected (409); a waiver does not satisfy a mandatory item; sensitive fields are
rejected (422 `forbidden_field`); cross-workspace access returns 404 rather than 403; archive
preserves audit and evidence history; `unknown`/`not_ready` are never styled green.

Measured facts versus the A2 brief: **16** ORM tables (17 including `alembic_version`), **77**
routes, methods present are only `GET`/`PATCH`/`POST`, single revision `0001_a1_registry`, and no
Celery/Redis anywhere. **No A1 regression was found, so A2 proceeded on an intact baseline.**

### 2. A1 regression after A2 was wired in — PASS

```
$ .venv/bin/python -m pytest tests/test_readiness_engine.py tests/test_readiness_api.py \
    tests/test_registry_api.py tests/test_security_api.py tests/test_audit_api.py tests/test_redaction.py
111 passed
```

The A1 suite runtime rose from ~80s to ~120s because health now evaluates on every A1 mutation in
tests. That is the real cost of synchronous evaluation and it is recorded rather than hidden.

### 3. Full backend suite — PASS (192)

```
$ .venv/bin/python -m pytest tests/       192 passed
$ .venv/bin/ruff check .                  All checks passed
```

| File | Tests | Covers |
|---|---|---|
| `test_readiness_engine.py` | 25 | A1 rollup rules (unchanged) |
| `test_redaction.py` | 28 | A1 redaction (unchanged) |
| `test_registry_api.py` | 19 | A1 registry (unchanged) |
| `test_readiness_api.py` | 18 | A1 readiness lifecycle (unchanged) |
| `test_security_api.py` | 13 | A1 secret rejection (unchanged) |
| `test_audit_api.py` | 8 | A1 audit (unchanged) |
| **`test_health_engine.py`** | **37** | Rule evaluation, rollup precedence, freshness, determinism, vocabulary |
| **`test_health_api.py`** | **25** | Evaluation, lifecycle, dedup, actions, archive, runs, backfill, filters, failure, staleness |
| **`test_health_security.py`** | **18** | Secret rejection, cross-workspace non-disclosure, role checks, A2 regressions |
| **`test_health_performance.py`** | **1** | 30-account bounded resource check |

Notable A2 assertions: acknowledging keeps health at `warning`; resolving a signal leaves the
source `AccountEvent` at `open`; re-evaluating unchanged facts creates no duplicate active signal;
a materially changed event supersedes its signal and links to the successor; a signal resolved
while its condition still holds is legitimately raised again on the next evaluation; a disabled
rule stops generating but keeps history; archiving expires active signals and reports
`unknown`/`not_applicable`; the backend contains no import of `requests`, `httpx`, `selenium`,
`playwright` or any browser driver.

### 4. Migration verification — PASS

- Clean database: both revisions applied in order, 21 tables (17 + 4 new). Every pytest session
  repeats this.
- Upgrade path: `0001_a1_registry → 0002_a2_account_health` applied to the existing A1 database
  with data in place; no A1 table altered, no A1 column changed.
- Rollback: `alembic downgrade 0001_a1_registry` drops only the four new tables.

### 5. Frontend — PASS

```
$ npx vitest run     35 passed | 12 skipped (live suite, opt-in)
$ npm run build      dist 316.78 kB (91.61 kB gzip)
$ npx eslint .       clean
```

Bundle impact versus the A1 baseline (292.34 kB / 86.40 kB gzip): **+24.4 kB raw, +5.2 kB gzip**
for the health list page, Health tab, signal drawer and Overview section.

New hermetic tests (19): the health colour map (only `clear_signals` may be green; `unknown` never
is; freshness is never green or red); `clear_signals` copy always carries the configured-check
caveat; no safety or approval language in any health string; acknowledge requires a note and
resolve requires a reason before their buttons enable; an engine-closed signal is labelled
automatic; no credential input and no score wording in the drawer; health and readiness
vocabularies stay separate.

### 6. Live pilot — PASS

Both pilots were run against the running API on a **freshly created database**, A1 first so its
scenarios are re-proved with A2 in place.

**A1 pilot re-run: 28/28** — including `system status` now reporting revision
`0002_a2_account_health`, and the three A1 scenarios landing on `operationally_ready`, `unknown`
and `not_ready` exactly as in the A1 session. A2 changed nothing about them.

**A2 pilot: 37/37.**

| Scenario | Expected | Actual |
|---|---|---|
| A — complete evidence, no events, active status | A1 `operationally_ready` · A2 `clear_signals` · "no current issues found by configured checks" | exactly that, 0 open signals, freshness `current` |
| B — missing required evidence, stale review | A1 `unknown`/`not_ready`/`ready_with_warnings` · A2 `warning`/`attention_needed` with reason, source, timestamp and next step | A1 `unknown` · A2 `warning`, reasons `mandatory_readiness_evidence_missing`, `manual_review_due_or_stale`, `readiness_unknown`, each with a recommended manual step |
| C — restricted status + unresolved critical event | A1 `not_ready` · A2 `critical` with source facts, timestamps, rule version, no remediation | exactly that; both `account_restricted_status` and `critical_account_event_open` raised, `readiness_not_ready` correctly suppressed, account status untouched |
| D — staleness | A2 `unknown`/stale; UI keeps no misleading clear result; run records context | snapshot aged 5 days → `unknown` + `stale` + `health_evaluation_stale`, filterable, and recalculation restored `clear_signals` |

Also verified live: acknowledging a critical signal kept health `critical`; resolving the source
event and clearing the status closed both signals while keeping them as history; ten versioned
rules registered; evaluation runs recorded for all five trigger types exercised; bounded backfill
evaluated a batch of 4 with 0 failures and refused without `confirm`; secret fields and
credential-shaped evidence references refused; no secret-like or score-like key in any health
payload; archived account reported `unknown`/`not_applicable` with no active signals;
`DELETE` on a signal returns 405.

**Live UI verification: 12/12** (7 A1 + 5 A2) — real React pages rendered against the live API in
jsdom: the Overview Account Health section with all six cards and no safety wording; the Account
Health list with Readiness, Health, Data freshness and Top reason as separate columns; the Health
tab showing signals with rule versions and the readiness state beside it; the signal drawer with
evidence, guidance and both actions disabled until their required text is entered.

### 7. Performance and resource check — PASS

```
[A2 resource check] 30 accounts | total 1.33s | avg 44ms | 930 queries (31.0/account) | peak RSS 141 MB (+0 MB)
```

Bounded loop, no browser process started, no external call, no worker. The check runs as part of
the suite so the cost is measured on every run rather than once on the day it shipped.

## Issues found and fixed during the A2 session

| Issue | Fix |
|---|---|
| Index names generated from the project naming convention exceeded PostgreSQL's 63-character identifier limit, so `alembic revision --autogenerate` crashed | Explicit short names for the six composite health indexes and for the `rule_definition_id` foreign key |
| Health filters returned zero rows. SQLAlchemy's `Enum(native_enum=False)` persists the enum **name** (`CLEAR_SIGNALS`), so the hand-written lowercase string literals in the CASE expression matched nothing | Every branch is now bound with the column's own Enum type. Recorded in `ARCH.md` §6b so the next person filtering these columns does not repeat it |
| `GROUP BY status` in the summary query resolved to `ad_accounts.status` instead of the output alias, so PostgreSQL rejected the query | Group by the expressions themselves, with a comment explaining the ambiguity |
| Health rules crashed on an ORM object whose `updated_at` was not yet flushed | Rules format timestamps defensively; a missing timestamp falls back to the evaluation time |
| **A1 defect found by an A2 test:** `Field` rendered a `<label>` with no `for` attribute unless a caller passed `htmlFor`, so most form controls had no accessible name | `Field` now wraps the control in the label when no explicit id is given, giving implicit association. Verified by `getByLabelText` in the A2 drawer tests |

## Explicitly not tested in the A2 session

- Docker Compose was still not built or started (A2 §7.1 forbids deploying unless asked).
- No scheduler was configured, so scheduled evaluation is exercised only through the command
  (`python -m app.commands.evaluate_health`) and through synchronous triggers.
- Still no manual click-through in a real browser; UI verification remains jsdom rendering against
  the live API plus a production build.
- No advertising platform was contacted, and no browser process was started, by design.

---

## Session 2026-09-04/05 — MINI-SPEC A3

**Environment** — unchanged (Python 3.12.3, Node 22.22.3, PostgreSQL 16 in Docker on
`localhost:5434`, API on `127.0.0.1:8009`). Migration head is now `0003_a3_alerts`.
`NOTIFICATION_TRANSPORT=fake`, `TELEGRAM_BOT_TOKEN` empty, `PUBLIC_APP_URL=https://adsops.example.com`.

**No real Telegram message was sent at any point.** No bot token exists in this repository or its
environment, the default transport is `disabled`, and every test and pilot used
`FakeNotificationTransport`.

### 1. A1/A2 baseline re-verified before any A3 code — PASS

```
$ .venv/bin/python -m pytest tests/     192 passed in 207.93s
$ .venv/bin/ruff check .                All checks passed
$ npx vitest run                        35 passed | 12 skipped
$ npx eslint .                          clean
$ npm run build                         dist 316.78 kB (91.61 kB gzip)
```

Measured: **91** routes, **20** ORM tables, methods only `GET`/`PATCH`/`POST`, two migrations,
**no Celery, Redis, APScheduler, BackgroundTasks or any queue**. Every figure the A3 brief quotes
is accurate; **no deviation from the A2 report was found**. All ten invariants named in A3 §7.2
were confirmed by their existing tests.

**Harness limitation found (not a product defect):** running two pytest processes at once against
the same `adsops_test` database makes them truncate each other's fixtures, which failed one health
test spuriously. Re-run alone the suite is green. The harness assumes a single runner; recorded as
a follow-up.

### 2. Full backend suite — PASS (283)

```
$ .venv/bin/python -m pytest tests/     283 passed in 433.62s
$ .venv/bin/ruff check .                All checks passed
```

| File | Tests | Covers |
|---|---|---|
| A1 files (`readiness_engine`, `redaction`, `registry_api`, `readiness_api`, `security_api`, `audit_api`) | 111 | unchanged |
| A2 files (`health_engine`, `health_api`, `health_security`, `health_performance`) | 81 | unchanged apart from the declared structural-test change below |
| **`test_alert_engine.py`** | **30** | Quiet hours (incl. cross-midnight and timezone), severity mapping, idempotency keys, message rendering, injection, truncation, unsafe URLs |
| **`test_alert_api.py`** | **39** | Derivation, dedupe, escalation, lifecycle, actions, policy, quiet-hours planning, dispatch, retry, final failure, cancellation, recovery, concurrency, filters, history |
| **`test_alert_security.py`** | **21** | Token handling, cross-workspace non-disclosure, owner-only gates, structural network limits, A1/A2 regressions |
| **`test_alert_performance.py`** | **1** | 30-account derivation, planning and bounded dispatch |

Notable A3 assertions: a claimed delivery cannot be claimed twice by a second dispatcher
(`FOR UPDATE SKIP LOCKED`, verified with two live sessions); a transient failure retries with the
expected backoff and then succeeds, appending attempts rather than deliveries; a final failure is
never retried; an alert resolved before send cancels its delivery; a stranded `sending` row is
reclaimed and processed exactly once; acknowledging an alert leaves the A2 signal `open`;
resolving an alert leaves the A2 signal `open`; and an exception inside alert derivation leaves
the A1 mutation committed, health unchanged and `alert_derivation_error` recorded on the run.

### 3. Declared test change

`test_backend_contains_no_outbound_http_or_browser_dependency` (written in A2) forbade importing
any HTTP client anywhere in the backend. A3 needs exactly one outbound call, to Telegram. The rule
was **narrowed, not dropped**, and split in two:

- `test_health_security.py::test_backend_starts_no_browser_and_contacts_no_advertising_platform`
  keeps the browser ban.
- `test_alert_security.py::test_only_the_telegram_transport_module_may_make_an_outbound_request`
  bans every browser driver and every general HTTP client, and permits exactly one named module.
- `test_alert_security.py::test_the_telegram_transport_only_ever_targets_the_configured_api_base`
  additionally asserts the URL is built from configuration, never from caller input.

This was declared in `docs/AUDIT_BEFORE_BUILD_A3.md` §10 before any code was written.

### 4. Migration verification — PASS

- Clean database: three revisions applied in order, **25 tables** (21 + 4 new).
- Upgrade path: `0002_a2_account_health → 0003_a3_alerts` applied to a database with A1/A2 data
  in place. No A1 or A2 table was altered.
- Rollback: `alembic downgrade 0002_a2_account_health` returned the schema to 21 tables, dropping
  only the four new ones.

### 5. Frontend — PASS

```
$ npx vitest run     52 passed | 16 skipped (live suite, opt-in)
$ npm run build      dist 347.82 kB (97.84 kB gzip)
$ npx eslint .       clean
```

Bundle impact versus the A2 baseline (316.78 kB / 91.61 kB gzip): **+31.0 kB raw, +6.2 kB gzip**
for the Alert Center page, alert drawer, Overview section and notification settings.

New hermetic tests (17): alert severity/status/delivery colour maps (nothing critical or open is
green); no safety, approval or score wording in any alert string; the approved wording for a
failed delivery and an unconfigured transport; acknowledgement is described as not-resolution;
suppression is described as time-bounded and non-hiding; every skip reason has a plain-language
label; the drawer requires a note before acknowledging, a reason before resolving, and a reason
plus a future expiry before suppressing; it warns explicitly when suppressing a critical alert;
it shows a failed delivery's safe summary and no raw provider response; and it offers **no**
send-now control, no recipient field and no token field.

### 6. Live pilots — PASS

All three pilots were run in sequence against the running API on **one freshly created database**,
with the fake transport.

| Pilot | Result |
|---|---|
| **A1 re-run** | **28/28** — the three A1 scenarios still land on `operationally_ready`, `unknown`, `not_ready` |
| **A2 re-run** | **37/37** — health states, staleness and failure behaviour unchanged |
| **A3** | **37/37** |
| **A3 Pilot E** (in-process, same live database) | **16/16** |

**A3 scenario outcomes:**

| Scenario | Expected | Actual |
|---|---|---|
| Precondition — no recipient | Alert exists, delivery skipped with a reason | `open` alert, delivery `skipped` / `no_recipient_configured` |
| A — critical immediate | One open critical alert, one immediate delivery, one safe fake message, `sent` with a message id, no source change | exactly that; message id `fake-1`, one attempt, health and readiness unchanged |
| B — warning in quiet hours | Deferred to the window end, no immediate send, policy decision visible | deferred to `2026-09-04T23:59:00Z` with timezone and decision recorded; dispatch sent 0 |
| B2 — critical in quiet hours | Bypasses by policy | `critical_bypass: true`, `deferred: false`, delivered immediately |
| C — attention | Alert Center item, no Telegram by default | 2 info alerts, both deliveries `skipped` / `severity_delivery_disabled` |
| D — dedupe and escalation | No duplicate; escalation creates exactly one new candidate | 3 recalculations changed nothing; raising an event's severity resolved the warning alert and opened one critical alert with exactly one new pending delivery |
| F — acknowledge / suppress / resolve | All audited; acknowledgement does not resolve the signal; suppression timed and visible; resolution does not mutate source | signal stayed `OPEN` throughout; indefinite suppression refused (422); `alert.created`, `alert.acknowledged`, `alert.suppressed`, `alert.resolved` all audited |

**Pilot E (retry and failure safety), run in-process** because staging a transport failure needs a
handle on the fake transport: a transient failure scheduled a retry ~1.00 min out with no message
leaving the process, the retry then succeeded, both attempts were recorded append-only and **no
second delivery row** was created; a configuration failure became `failed_final` with a safe
summary and was never retried, while its alert stayed visible; a delivery stranded in `sending`
was reclaimed by the recovery sweep and then processed **exactly once**, and a later sweep sent
nothing again.

**Safety sweeps in the pilot:** zero audit rows containing `bot_token`; zero delivery attempts
containing a URL; no secret-like or score-like key in any alert payload; no safety or approval
wording in any output; `DELETE` on an alert returns 405; the notification status endpoint exposed
no raw chat id.

**Live UI verification: 16/16** (7 A1 + 5 A2 + 4 A3) — real React pages rendered against the live
API in jsdom: the Overview Alert Center section with all six cards and no safety wording; the
Alert Center table with Severity, Alert, Account, Health, Readiness, Source, Status and Delivery
as separate columns; the alert drawer with its policy decision, notification history, disabled
actions until their required text is entered, and no send-now control; and the notification
settings showing a masked recipient (`…7890`) with no token value anywhere in the DOM.

### 7. Performance and resource check — PASS

```
[A3 resource check] 30 accounts | derive+plan 1.75s (avg 58ms) | 1263 queries (42.1/account)
                    | alerts 90 | deliveries 90 | due 36
                    | dispatch batch 10 in 0.10s -> sent 10 | peak RSS 152 MB (+0 MB)
[A2 resource check] 30 accounts | total 1.70s | avg 57ms | 1200 queries (40.0/account)
```

The A2 check now measures A2 **plus** A3 derivation, which is why its per-account query count rose
from 31 to 40. Dispatcher concurrency is 1 and the batch is bounded at 10. No browser process is
started, and RSS did not grow.

## Issues found and fixed during the A3 session

| Issue | Fix |
|---|---|
| **A failure alert could never appear.** Derivation ran only inside the A2 savepoint that a failed evaluation rolls back, and the next successful evaluation made the failure no longer "latest" — so `health_evaluation_run` alerts were unreachable | Derive again in the failure branch, *after* the run is marked failed |
| **A recovered account never cleared its failure alert.** Derivation ran while the current run was still `running`, so a previous failure still looked like the latest word | Finish the evaluation run *before* deriving, then merge the alert counters into the run summary |
| An archived account kept a failure-derived alert alive | The failure candidate is skipped for archived accounts, which leave active assessment entirely |
| `time` values in an audit snapshot were not JSON-serialisable, so the first policy write 500'd | `to_jsonable` now handles `time` (an A1 helper gap the first `Time` column exposed) |
| Test assumption: severity escalation on one alert key does not occur with A2 v1 rules, because warning and critical events are separate rules | Test rewritten to assert the real behaviour (warning alert resolves, one critical alert opens, exactly one new delivery), plus a direct test of the escalation path for the day a rule changes |
| Pilot assumptions, not product defects: a dispatch call works the whole workspace backlog; the dispatcher claims the oldest scheduled row first; reminder keys collide across pilot re-runs; and an enum's `.value` is lowercase while the column stores the name | Pilot assertions scoped to the alert under test, backlog drained first, run-scoped sequence numbers, correct casing |

## Explicitly not tested in the A3 session

- **No real Telegram message was sent**, and no real transport call was made. The `TelegramTransport`
  HTTP path is exercised only by unit-level reasoning and structural tests; its first real send
  needs a bot token and the user's explicit approval of a target chat.
- Docker Compose was still not built or started.
- No scheduler was configured; dispatch ran through the owner-only endpoint and the CLI path.
- Still no manual click-through in a real browser.

---

## Session 2026-09-05 — MINI-SPEC A4 Stage A

**Environment** — Python 3.12.3, Node 22.22.3, PostgreSQL 16 in Docker, Docker Engine 29.1.3,
Compose v2.40.3. Migration head is now `0004_a4_operational_runs`.

**Nothing was deployed to any target, and no real Telegram message was sent.** No bot token
exists in this repository or its environment; every notification path used
`FakeNotificationTransport` or the `disabled` transport.

### 1. Baseline re-verified before any A4 code — PASS

```
$ .venv/bin/python -m pytest tests/     283 passed
$ .venv/bin/ruff check .                All checks passed
$ npx vitest run                        52 passed | 16 skipped
$ npx eslint . && npx tsc --noEmit      clean
$ npm run build                         dist 347.82 kB (97.84 kB gzip)
$ live-API frontend suite               16 passed
```

Measured: **111 routes**, methods `{GET, PATCH, POST}`, **zero DELETE**, **24 ORM tables**,
three migrations, and no Celery/Redis/scheduler/bot-command/browser dependency anywhere.

Every figure the A4 brief quotes is accurate. **No deviation from the A3 report was found.** The
brief's "24 tables" and the A3 report's "25 tables" describe the same schema — 24 ORM tables plus
`alembic_version`.

Required scans all clean: no DELETE route, no secret field in a schema beyond the login
password, no Telegram command endpoint, no browser automation dependency, no pilot password in
shipped code, and the Telegram template rejects localhost, private ranges and bare hostnames.
The outbound-HTTP scan matched two files; one (`api/middleware.py`) is a false positive on
`starlette.requests`.

### 2. Target environment audit — INCOMPLETE, and reported as such

Inspected read-only. This workspace is **not** the VPS described in the brief: it has 12 vCPU /
62 GB RAM (the brief describes 4 vCPU / 8 GB), its filesystem is **89% full**, `systemd` is not
running, there is **no crontab**, nothing listens on 80/443, and `audit-ads` has **no git
remote**. Domain, TLS method, database location, backup destination and firewall state are
unresolved. `docs/AUDIT_BEFORE_BUILD_A4.md` §5–6 lists exactly what an operator must supply.

**Workspace limitation, not a product defect:** this Docker-in-Docker cgroup is in `domain
threaded` mode and **cannot apply any resource limit** — plain `docker run --memory=256m` fails
here too. The CPU and memory limits in the production overlay are therefore validated by
`compose config` but were **not exercised at runtime**. Runtime verification below ran with a
scratch override that clears them; that override is never used in a deployment.

### 3. Full backend suite — PASS (344)

```
$ .venv/bin/python -m pytest tests/     344 passed
$ .venv/bin/ruff check .                All checks passed
```

| File | Tests | Covers |
|---|---|---|
| A1/A2/A3 files | 283 | unchanged, all still passing |
| **`test_a4_configuration.py`** | **21** | Production validation, secret handling, `.env.example` hygiene, Dockerfile/compose/nginx assertions |
| **`test_a4_operations.py`** | **22** | Run recording, summary allowlist, staleness, thresholds, host metrics, test-send preview and execution |
| **`test_a4_api.py`** | **18** | Authorization, public-surface safety, dispatcher state, test-send gates, no-DELETE |

Notable assertions: a production process **refuses to start** with a placeholder secret and the
refusal never echoes the value; the pilot credential is refused in *every* environment; a summary
containing `chat_id`, `bot_token` or a backup path is stripped to its allowlisted counters; a
failed run records an exception *type* and never its message; `never` is distinct from `stale`;
an unreadable metric reports `unknown` rather than `ok`; the test send creates no Alert, writes
no `NotificationDelivery`, sends exactly once and refuses a second attempt; and `execute` rejects
any request carrying a recipient or a message body.

### 4. Container and Compose tests — PASS

```
$ docker compose -f docker-compose.yml -f docker-compose.production.yml config   valid
$ docker build ./backend  → adsops/api:a4-stage-a   325 MB
$ docker build ./frontend → adsops/web:a4-stage-a    74 MB
```

| Check | Result |
|---|---|
| Explicit image tags, no `latest` | `IMAGE_TAG` is required by compose; `postgres:16.4-alpine`, `nginx:1.27.2-alpine` pinned |
| Non-root user | `appuser` |
| No secret baked into an image | 0 secret-like environment variables, 0 layers carrying a secret value |
| Release stamped into the image | `RELEASE_VERSION=a4-stage-a` |
| Image `CMD` does not migrate | `["uvicorn", …]` — no alembic |
| Health checks | present on `api` and `web` |
| Dispatcher runs from the same image | `python -m app.commands.run_dispatcher --help` works |
| nginx syntax (app and edge) | both `nginx -t` successful |

### 5. Staging-equivalent runtime verification — PASS

The full production stack was started locally under a separate project name, on a fresh volume,
with `ENVIRONMENT=staging` and strict validation on.

| Check | Result |
|---|---|
| Services | `db`, `api`, `dispatcher`, `web` all started; `db` and `api` reported `healthy` |
| Production config validation | **0 errors, 0 warnings** — the process started, and logged no finding |
| Migration as an explicit step | The API started **before** any migration ran, proving the image no longer migrates; `alembic upgrade head` then applied 4 revisions and `alembic current` reported `0004_a4_operational_runs` |
| Public exposure | Only `adsops-staging-web-1` bound a host port, and only on `127.0.0.1:8099`. Database, API and dispatcher bound nothing |
| Routing | `GET /` → 200 `text/html`; `GET /health/live` → `{"status":"ok"}`; `GET /api/v1/system/status` without a token → **401** |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Robots-Tag`, `Cross-Origin-Opener-Policy` and a full `Content-Security-Policy` with `frame-ancestors 'none'`; nginx version suppressed |
| API docs off in production | The API itself returns **404** for `/docs`, `/redoc` and `/openapi.json`. Through nginx those paths return the SPA's HTML page (the frontend fallback), not the schema |
| Restart policy | `unless-stopped` on all four services; a controlled `restart` of `api` and `dispatcher` came back healthy |
| Read-only root filesystem | `true` on `api` and `dispatcher` |
| Production owner login | **200** |
| **Pilot credential** | **401** |
| A1–A4 smoke | accounts, health summary, alert summary, audit logs, system status, operations overview and configuration all 200 |
| Dispatcher | bounded loop running at a 15-second interval, each pass logged and recorded |

Torn down afterwards with `down -v`; no container or volume remains.

### 6. Migration, backup and restore — PASS

| Check | Result |
|---|---|
| Clean-database migration | 4 revisions, 26 tables |
| Upgrade path from a live A3 database **with data** | `0003_a3_alerts → 0004_a4_operational_runs` applied to the local pilot database; 14 accounts and 54 alerts intact afterwards |
| Downgrade | `downgrade 0003_a3_alerts` returned the schema to 25 tables, dropping only `operational_runs` |
| Backup script | Ran against the live staging stack: 9,373 bytes, **26 tables**, SHA-256 recorded, `.json` metadata written, run recorded |
| Restore drill | Checksum verified, restored into `adsops_restore_drill_<ts>`, 26 tables and revision `0004_a4_operational_runs` confirmed, drill database dropped, **production database untouched** |
| Earlier drill on the pilot database | 26 tables, 14 accounts, 54 alerts restored; pilot database still showed 14 accounts afterwards |
| Failed migration aborts the release | `alembic upgrade head` against an unreachable database exits **1**; `release_migrate.sh` exits before the version switch |

### 7. Live verification of A4 behaviour — PASS (32/32)

Against the running API with the fake transport: release and revision reported; dispatcher
state derived from real runs and moving `stale → current` after a pass; backup and restore-drill
ages read from real recorded runs; host CPU/memory/disk banded (`ok` / `warning` / `critical` —
the disk band correctly reported **critical** at 88.7% on this genuinely full workspace);
configuration findings flagging the pilot credential by code with no value; every operations
endpoint refusing anonymous access; run history covering four kinds with no path or connection
string; the test-send preview rendering the required template, reporting **not ready**, and
returning no token-shaped value or raw chat id; `execute` refusing the disabled switch, a
caller-supplied body and a caller-supplied recipient; A1 rows intact (14 stored, 12 active — the
archived two still excluded); and `DELETE` returning 405.

### 8. Frontend — PASS

```
$ npx vitest run     60 hermetic passed | 19 skipped (live suite, opt-in)
$ live-API suite     19 passed  (7 A1 + 5 A2 + 4 A3 + 3 A4)
$ npx eslint .       clean
$ npx tsc --noEmit   clean
$ npm run build      dist 359.85 kB (100.88 kB gzip)
```

Bundle impact versus A3 (347.82 kB / 97.84 kB gzip): **+12.0 kB raw, +3.0 kB gzip**.

New tests assert that a stale or never-run process is never styled as healthy, that "never run"
and "stale" differ in wording as well as colour, that an unknown metric is never reported as OK,
that operational copy never claims safety or approval, and — rendered against the live API — that
System Status shows the release, revision, dispatcher, backup and host bands; that configuration
findings appear **without** the pilot password, a token-shaped value or a connection string; and
that the delivery verification renders a preview, reports itself blocked, and offers **no send
control at all** while blocked.

### 9. Defects found and fixed during A4

| Issue | Fix |
|---|---|
| **The API image migrated on every container start.** A crash-looping container would replay migrations unattended, with no backup in front of them | Migration moved to an explicit release step; a test asserts no `CMD`/`ENTRYPOINT` mentions alembic |
| **`/docs`, `/redoc` and `/openapi.json` were public and unauthenticated**, publishing the whole API surface | Gated behind `ENABLE_API_DOCS`, off in production; verified 404 on the staging stack |
| **The `edge` service's variables were interpolated even with its profile off**, so `TLS_CERT_DIR` was required for every deployment that does not use it. Found only by actually running compose | Changed to a default instead of a hard requirement |
| **The backup script rejected a valid backup of a small database** — a fresh deployment's first backup always "failed" the 10 KB floor | Verify the dump's **content** (≥20 `CREATE TABLE` and an `alembic_version` marker) with a much lower byte floor |
| **`grep -q` under `set -o pipefail` made a good backup look corrupt** — it exits early, SIGPIPEs `gunzip`, and the pipeline reports failure | Count matches instead of short-circuiting |
| **`source`-ing the env file broke on a realistic value** (`BOOTSTRAP_WORKSPACE_NAME=AdsOps Staging` was executed as a command) | A shared reader that parses `KEY=VALUE` without executing the file — safer for a file holding secrets anyway |
| **Backup and restore-drill runs were recorded in the wrong database**, via whatever the host virtualenv pointed at rather than the database just backed up | Recorded through the API container (`exec`, falling back to `run --rm`) |
| **`worker_status` returned a constant `not_configured`**, which A4's dispatcher would have made a lie | Derived from recorded runs: `running` / `stale` / `not_configured` |
| **A1's credential guard rejected my own request field.** `preview_token` contains "token", so the test-send endpoint could never have been called | Renamed to `approval_code` — the guard was right; the field name was wrong |
| Test assumptions, not product defects: a `TestSendService` class collected as a pytest class; a memory threshold assertion off by one band; `TestClient.get()` given a `json=` argument; `WorkspaceRole.MEMBER` does not exist; an assertion counting active accounts as stored rows | Fixed in the tests |

### 10. Explicitly NOT done

- **No deployment.** No command was run against any target: no `docker compose up` on a VPS, no
  Coolify or Vibe Host action, no DNS, firewall or proxy change.
- **No real Telegram message.** The transport stayed `disabled` or `fake`; `ALLOW_TEST_SEND`
  stayed `false`; no bot token exists.
- **No real-browser UAT.** Verification is jsdom rendering of the real components against the
  live API, plus a production build. A person has still never clicked through the app; the
  checklist for that is in `docs/RUNBOOK_DEPLOY.md` §9 and A4 §10.8.
- **Resource limits unproven at runtime** — see §2.
- **No CI**, and still no rate limiting.

---

## Session 2026-09-05 — MINI-SPEC A5

**Environment** — unchanged, plus Node 22 for a second npm package (`extension/`, 153 MB,
293 packages). Migration head is now `0005_a5_extension`.

**Nothing was deployed, no real Telegram message was sent, and the extension was never loaded
in a browser or published anywhere.**

### 1. Baseline re-verified before any A5 code — PASS

```
$ .venv/bin/python -m pytest tests/     344 passed in 460.23s
$ .venv/bin/ruff check .                All checks passed
$ npx vitest run                        60 passed | 19 skipped
$ live-API frontend suite               19 passed
$ npx eslint . && npx tsc --noEmit      clean
$ npm run build                         dist 359.85 kB (100.88 kB gzip)
```

Measured: **117 routes**, methods `{GET, PATCH, POST}`, **zero DELETE**, **25 ORM tables**, head
`0004_a4_operational_runs`. Required scans clean: no browser-automation dependency in either
manifest, one outbound HTTP module, and no `<all_urls>` anywhere (no extension existed yet).
**No deviation from the A4 report was found.**

### 2. Full backend suite — PASS (388)

```
$ .venv/bin/python -m pytest tests/     388 passed
$ .venv/bin/ruff check .                All checks passed
```

| File | Tests | Covers |
|---|---|---|
| A1–A4 files | 344 | unchanged, all still passing |
| **`test_a5_extension_context.py`** | **19** | Canonicalisation, URL sanitisation, the four context states, cross-workspace isolation, the stored-context allowlist |
| **`test_a5_extension_api.py`** | **25** | Session exchange, token scoping, revocation, context resolution, event ingestion, payload refusals, surface shape |

Notable assertions: an extension token is refused by **every** dashboard route and cannot mint
another session; a pre-A5 token with no `token_use` claim still works, so adding the claim signs
nobody out; an account with an **identical name but a different id is not matched**; two registry
rows carrying the same id resolve to `ambiguous`, never a coin flip; resolving a context does not
persist readiness; an event type outside the allowlist, a decision without a reason, a
self-chosen severity, a workspace id and every credential-like field are all rejected; and a
stored event context contains no URL, query string or secret.

### 3. Extension suite — PASS (50)

```
$ npx vitest run     50 passed (5 files)
$ npx eslint .       clean
$ npx tsc --noEmit   clean
$ npm run build      dist built, content script 3.76 kB
```

| File | Tests | Covers |
|---|---|---|
| `validation.test.ts` | 15 | Canonicalisation, `act` extraction, path allowlisting, dashboard-URL rules |
| `detector.test.ts` | 6 | What the content script reads, what it refuses, and the URL watcher |
| `storage.test.ts` | 7 | Session in `storage.session` not `local`, expiry, per-tab cache isolation, no password anywhere |
| `manifest.test.ts` | 11 | MV3, permission set, path-scoped hosts, CSP, and a bundle audit |
| `ui.test.tsx` | 11 | Popup, side panel guard, options page |

The bundle audit is the one worth naming: it asserts the shipped files contain no token-shaped
value, no `document.cookie`, no `localStorage`, no `indexedDB`, no `graph.facebook.com`, and no
`chrome.cookies` / `chrome.webRequest` / `chrome.debugger` / `chrome.proxy` reference — and that
the content script contains **no `import`**, because an isolated-world script has no module
loader and a split bundle would fail silently on the page.

### 4. Migration verification — PASS

- Clean database: five revisions, **27 tables**.
- Upgrade path applied to the live pilot database holding A1–A4 data: 14 accounts and 4 account
  events intact afterwards.
- Downgrade to `0004_a4_operational_runs` returned the schema to 26 tables, dropping only
  `extension_installations` and the new nullable column.

### 5. Frontend — PASS

```
$ npx vitest run     60 hermetic passed | 20 skipped (live suite, opt-in)
$ live-API suite     20 passed  (7 A1 + 5 A2 + 4 A3 + 3 A4 + 1 A5)
$ npx eslint .       clean
$ npm run build      dist 362.04 kB (101.29 kB gzip)
```

Bundle impact versus A4 (359.85 kB / 100.88 kB gzip): **+2.2 kB raw, +0.4 kB gzip** for the
connected-browsers section in Settings.

### 6. Live verification — PASS (30/30)

Against the running API, sending exactly what the content script would produce from a real Ads
Manager URL (`…/adsmanager/manage/campaigns?act=123456789&business_id=999&access_token=…`).

| Area | Result |
|---|---|
| Session | Connect issued a separate `token_use: extension` token, distinct from the dashboard token |
| Scope | That token was refused **401** by `/ad-accounts`, `/alerts`, `/operations/overview` and `/audit-logs`; it could not create an account and could not mint another session; the dashboard token was refused on extension-only routes |
| Confirmed context | `act_123456789` resolved to the right account, returning readiness, health and alerts as three separate values, with no numeric score and the honest disclaimer |
| Unknown | An unregistered id returned `unknown` with `account: null` and no readiness block |
| Ambiguous | A page with no visible id returned `no_account_id_on_page` |
| Unsupported | `/messages/t/1` returned `unsupported_page` and resolved nothing |
| URL safety | A full URL sent by mistake came back as `/adsmanager/manage/campaigns` — no `access_token`, no `business_id`, no query |
| **Name never matches** | A second account with an *identical display name* and a different id was **not** matched |
| Events | A change intent landed as an ordinary account event (`source: chrome_extension`, severity decided server-side), appeared in the A1 timeline and wrote an audit row |
| Refusals | Event type outside the allowlist **422**; decision without a reason **422**; `workspace_id`, `cookie`, `access_token`, `password` and a self-chosen `severity` all **422** |
| Stored context | Contained no URL, query string or secret |
| Revocation | Worked before; after revoking from the dashboard the session returned **401 immediately** and could not write events; the installation list showed it revoked with no token in the payload |
| Regression | A1–A4 endpoints unchanged; `DELETE` on the extension surface returns 405 |

### 7. Defects found and fixed during A5

| Issue | Fix |
|---|---|
| **The content script was built as an ES module importing a shared chunk.** An isolated-world script has no module loader, so it would have failed silently on every Ads Manager page — the worst way for the detector to break | A second Vite config builds it alone as a single IIFE, and a bundle test asserts it contains no `import` |
| **Extension pages referenced `/popup.js` absolutely**, which depends on the extension root resolving the way a web server would | `base: './'`, so the HTML references `../popup.js` |
| **`optional_host_permissions: ["https://*/*"]`** would have let the extension request any origin at runtime | Removed entirely. The API is reached through ordinary CORS and the server's exact-origin allowlist instead |
| The brief proposed `https://www.facebook.com/*`, which would run the content script on the feed, Messenger and profiles | Narrowed to `https://www.facebook.com/adsmanager/*`, asserted by a manifest test |
| `_exact_matches` loaded every account in the workspace and filtered in Python — fine at 30 accounts, wasteful on every page navigation | Exact set membership resolved in SQL against a closed candidate list |
| Two live UI tests pinned the literal migration revision and release identifier, so they would fail on every release rather than when something broke | Rewritten to assert the shape, scoped to the tile under test |
| Test assumptions, not product defects: the account timeline returns a list rather than a page envelope; an unused import | Fixed in the tests |

### 8. Explicitly NOT done

- **The extension has never run in a real browser.** No unpacked load, no real Ads Manager page,
  no Chrome Web Store listing, no signing. Verification is unit tests, a manifest and bundle
  audit, and live API calls sending exactly what the content script produces.
- **Meta's URL shapes are an assumption** taken from the current Ads Manager routes. The
  extension degrades to `unsupported_page` when they change rather than guessing, but the
  allowlist will need maintenance.
- **No deployment, and no real Telegram message** — unchanged from A4.
- **Still no rate limiting**, and no CI.

---

## Rate limiting (follow-up, 2026-09-05)

Not a MINI-SPEC: this closes the follow-up that A4 and A5 both recorded and neither did —
"still no rate limiting". Nothing in the API was bounded, including `POST /auth/login`.

### 1. What was measured before the change

| Check | Result |
|---|---|
| Backend suite on a clean tree | **387 passed, 1 failed** |
| The failure | `test_a4_configuration.py::test_wildcard_cors_is_rejected_in_production` |

The A5 report states "344 passed, unchanged" and a backend total of 388. That is not what the
tree does today: one A4 configuration test is red, and was red **before** this change — verified
by stashing the change and re-running.

**Why it was red, and why it matters more than the count.** `Settings` binds
`cors_origins_raw` by its alias `CORS_ORIGINS` only; pydantic-settings ignores the field name
even with `populate_by_name=True`, and `extra="ignore"` drops it in silence. The test passed
`cors_origins_raw="*"`, so the wildcard never reached the settings object and the assertion ran
against the default. **The production CORS-wildcard check therefore had no working test.** The
check itself was always correct — proven by re-running it through the alias — so the fix is in
the test, plus a note on the field so the trap is visible next time.

### 2. Rate limit tests

| Layer | Count | What it establishes |
|---|---|---|
| Bucket arithmetic (injected clock) | 8 | Limit, continuous refill, capacity ceiling, per-identity and per-policy isolation, honest `Retry-After`, per-process scaling, bounded memory, refusal of a meaningless policy |
| Client address | 4 | `X-Forwarded-For` ignored with no configured proxy, counted from the right when there is one, a short chain does not index past the start, a missing peer is not a crash |
| Identity from a token | 4 | A forged token is anonymous; a valid one yields its subject; an extension installation gets its own bucket; malformed headers are anonymous |
| Middleware in an app | 8 | Login limited with the project error envelope; `extension/connect` shares the strict budget; the general budget is separate; two subjects do not share a bucket; health probes never limited; a refusal keeps its CORS headers; the switch works; disabling it in production is a configuration error |
| **Total new** | **32** | |
| **Backend suite after** | **420 passed** | 388 as A5 claimed, plus 32, with the pre-existing failure fixed |

`ruff check .` clean.

### 3. Live verification against the running API

Server started with `RATE_LIMIT_AUTH_ATTEMPTS=3`, `RATE_LIMIT_AUTH_WINDOW_SECONDS=300`, then
five login attempts from one address:

| Attempt | Status | Body code | `X-RateLimit-Remaining` | `Retry-After` |
|---|---|---|---|---|
| 1 | 422 | `validation_error` | 2 | — |
| 2 | 422 | `validation_error` | 1 | — |
| 3 | 422 | `validation_error` | 0 | — |
| 4 | **429** | `rate_limited` | 0 | **100** |
| 5 | **429** | `rate_limited` | 0 | **100** |

`Retry-After: 100` is arithmetically right: three tokens per 300 seconds is one per 100.
`/health/ready` still returned 200 while the address was blocked. The 429 body carried the
standard envelope and a request id, and **no value** — not the address, the limit window, the
email or the identity.

The 422s are the schema refusing an 8-character minimum password, not a bug — and they still
cost a token, which is the intended behaviour: an attacker must not get free probes by sending
payloads that fail validation before reaching the password check.

### 4. Known limits

- **Per process, not distributed.** No Redis, by choice. `RATE_LIMIT_PROCESS_COUNT` divides the
  configured allowance so the documented number is what an operator actually gets, and a
  production configuration with it above one raises a warning to confirm it matches the
  deployed worker count.
- **`RATE_LIMIT_TRUSTED_PROXY_HOPS` defaults to 0.** Behind a proxy that means every caller
  shares one bucket; a production deployment that leaves it at zero gets a warning. It is not
  defaulted to 1 because guessing the hop count wrong in the other direction lets a client
  forge its own address and bypass the limit entirely.
- **Not yet exercised under real concurrency** on a deployed host.
