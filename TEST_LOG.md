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
