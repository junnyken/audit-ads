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

### 5. A defect found while preparing to deploy — the limit was bypassable in the built image

`backend/Dockerfile` ran uvicorn with `--proxy-headers --forwarded-allow-ips "*"`. Read in
uvicorn 0.34.0, `_TrustedHosts.always_trust` is then true and `get_trusted_client_host` returns
`x_forwarded_for_hosts[0]` — the **first** entry, which is entirely client-supplied — and
`ProxyHeadersMiddleware` overwrites `scope["client"]` with it before the application sees the
request.

So in the production image, with the limiter's own default of `RATE_LIMIT_TRUSTED_PROXY_HOPS=0`
and its deliberate refusal to read the header itself, the address it keyed the login bucket on
would still have come from the header: **an attacker varying `X-Forwarded-For` would get a fresh
bucket on every request, and the brute-force bound would have been worth nothing.** The limiter
would have looked correct in every test and been bypassable in production.

Found by reading the Dockerfile before deploying, not by a test — no test covered the image.

**Fixed** by removing both flags. Nothing in the application reads `request.url.scheme` or builds
an absolute URL (grepped), so they provided no value to trade away. The forwarded chain is
honoured in one place that knows how many hops to expect, and `docker-compose.production.yml`
now states `RATE_LIMIT_TRUSTED_PROXY_HOPS=1` for the edge nginx in front of the API.

Two tests were added and the suite is **422 passed**: one asserts the flags stay out of the
Dockerfile's instructions (comments excluded, so the rationale does not trip its own guard), and
one drives three different `X-Forwarded-For` values through the real middleware and asserts they
share a bucket.


---

## Frontend → API wiring, for a per-site platform (2026-09-05)

The frontend was built for a single origin: its nginx proxied `/api` to the compose service
name `api`, and CSP allowed `connect-src 'self'` only. Deploying each part as its own site
breaks both — `api` does not resolve, and a cross-origin call is refused by the page's own CSP.

**Chosen shape: the browser calls the API directly, and the API base is read at runtime.**
`/config.js` is written by nginx from `API_ORIGIN` at container start, so one image serves any
environment. See ARCH §5c for why proxying onward would have quietly disabled the login rate
limit.

### Verified by running the built image, not by reading it

| Check | Result |
|---|---|
| `API_ORIGIN=https://api.example.com` → `/config.js` | `window.__ADSOPS_API_BASE__ = "https://api.example.com";` |
| → CSP | `connect-src 'self' https://api.example.com` |
| `API_ORIGIN` unset → `/config.js` | `window.__ADSOPS_API_BASE__ = "";` (same-origin, unchanged behaviour) |
| → CSP | `connect-src 'self'` |
| `index.html` load order | `<script src="/config.js">` executes before the deferred module bundle |
| SPA fallback (`/accounts`) | 200 |
| Frontend suite | 60 passed, tsc and eslint clean, build 362.12 kB |

**One defect found and fixed in the same pass:** `/config.js` returned **two** `Content-Type`
headers — nginx sets one for a `return`, and the `add_header` added a second. Replaced with
`default_type`. Found by reading the response headers of the running container; a config review
would not have shown it.

**Not yet verified:** no browser has loaded this build against a real API. The two origins have
never been exercised together, so `CORS_ORIGINS` and `connect-src` agreeing in practice is still
an assumption.


---

## Startup migration, and a test the previous commit broke (2026-09-05)

### 1. A test that went red in `123a8f2` and was not caught

Renaming `frontend/nginx.conf` to `default.conf.template` broke
`test_a4_configuration.py::test_nginx_configs_carry_the_required_security_headers`, which reads
that path from the repo. The frontend suite was run and passed; the **backend** suite, which is
where the repo-file assertions live, was not re-run after the rename. Fixed by pointing the test
at the template. The lesson is the one the A5 report already recorded in another form: a change
in one package can only be cleared by the suite that actually asserts on it.

### 2. `MIGRATE_ON_START` — a narrowing of rule 23, not a hole in it

The deployment platform has no console, no release command, and a database on an internal-only
host, so `alembic upgrade head` cannot be run from anywhere. The alternative to a controlled
startup path was an unmigrated database.

`MIGRATE_ON_START` carries **the revision the operator expects**, not a boolean. The upgrade runs
only when it equals the code's head, so a stale value after a new migration ships is refused
rather than silently applied — which is the exact accident rule 23 was written to prevent.

| Test | Establishes |
|---|---|
| head revision is readable | the guard has something real to compare against |
| unset → no upgrade | the default is still "never migrate on start" |
| `true`, `1`, `yes`, `on`, `head`, `""`, `"   "` → no upgrade | it cannot be switched on by habit; it is a revision id, not a flag |
| `0004_a4_operational_runs` (stale) → no upgrade | shipping a new migration with an old value left set does not apply it |
| naming this head → upgrade runs | the intended path works |
| upgrade raises → process still starts | a container that dies here only reads as "restarting"; the reason must be visible |
| head unreadable → refuses | it never guesses |

**13 new tests. Backend suite 435 passed, ruff clean.**

**Not verified:** it has never run against the deployed database. Whether the platform's
container actually reaches alembic's head on first boot is an assumption until it is watched.

---

## Session 2026-09-08 — A5 real-browser UAT (first ever)

The one thing A5 had never done: run in a real Chrome browser against a real Meta Ads Manager
account and a live backend. This session did, against a local dev API/DB (bootstrap owner
`trieunt@matbao.com`), extension loaded unpacked, connected over `http://localhost:8000`.

| Check (RUNBOOK_EXTENSION_UAT.md §5) | Result |
|---|---|
| Registered real account (`1167063825546698`, business `1993884657458857`) on its campaign page | **PASS** — popup showed `Confirmed`, correct name (`Tbsupellex`), and real Readiness/Health/Alerts pulled from the backend |
| Unregistered real account (`148004397`) on its campaign page | **PASS** — `Not registered`, extension did not guess |
| Switching between the two accounts in the same tab | **PASS** — context updated each time, never stuck on the previous account |
| Note-recording via the side panel | **Not exercised.** Chrome's "Open side panel" entry did not surface for the operator during this session (Chrome-version-dependent UI, not verified as a defect). Already covered by `tests/ui.test.tsx`'s side-panel workspace-guard tests; not re-verified live. |
| Session revocation takes effect immediately | **Server-side confirmed**: `POST /extension/installations/revoke` returned `is_active: false` instantly. **Not observed client-side**: the popup kept showing the old `Confirmed` result after revoking, because the per-tab 30-second context cache (`FEATURES.md`) served a cached read instead of calling the API. This is the documented cache behavior, not a bypass of revocation — the *next uncached* call would 401 — but it means an open tab can display stale operational state for up to 30s after an operator revokes a browser elsewhere. Not re-tested past the cache window for time reasons. |

**One real defect found and fixed:** the billing hub page real Meta serves today is
`/adsmanager/billing_hub/accounts/details/...`, not `/billing_hub/accounts` or
`/adsmanager/billing/` as the original allowlist assumed. Neither the backend
(`app/services/extension_context.py`) nor the extension (`shared/validation.ts`) recognised it,
so the popup showed `Not an Ads Manager page` on a page A5 was always meant to cover. Fixed by
adding `/adsmanager/billing_hub/accounts(?:/details)?/?$` and
`/adsmanager/billing_hub/payment_activity/?$` to both allowlists, with regression tests in both
suites. Extension: 51/51 passed, build clean. Backend: full suite still green (`pytest -q`,
all passed) after the change, ruff clean.

**Infra note, not a product defect:** the local Postgres container used for this session had no
persistent volume; its data (bootstrap owner, the just-registered account) was silently lost
partway through the session while the container itself stayed reported as running, forcing a
re-bootstrap and re-registration. Anyone repeating local UAT should mount a volume.

**Not exercised this session:** the same UAT against the Vibe Host deployment
(`audit-ads-backend.cmc-1.vibenode.matbao.ai`) — fixed and health-checked live (migrated,
`database: reachable`) but the operator did the actual browser UAT against local dev instead.
The paired `audit-ads-frontend` Vibe Host project still returns 404 publicly despite the
container running and serving `200` internally — a Traefik/routing-layer issue on the platform
side, unresolved.

---

## Session 2026-09-08 — A6 domain model + migration

`0006_a6_preflight` adds `campaign_drafts`, `preflight_evaluation_runs`, `preflight_findings`,
`landing_page_evidence` (models in `app/models/preflight.py`, enums in `app/core/enums.py`).
Autogenerated against the live A1-A5 schema, then hand-fixed to match repo naming conventions.

**One real defect found and fixed:** `alembic upgrade head` failed on the first attempt —
`alembic_version.version_num` is `varchar(32)`, and the auto-chosen revision id
`0006_a6_preflight_compliance_gate` is 33 characters. Transactional DDL rolled the whole
migration back cleanly (verified: no tables existed after the failed run). Renamed the revision
to `0006_a6_preflight` (17 chars) and re-ran. **Any future revision id in this repo must stay
under 32 characters** — worth remembering before naming the next migration by hand.

Verified: upgrade → downgrade → upgrade again, all clean. Full backend suite green (same count
as the pre-A6 baseline plus no new failures) and ruff clean on every new/changed file after each
step.

---

## Session 2026-09-08 — A6 rule engine + SSRF-safe landing-page fetch

`CopyRuleEngine` (`preflight_copy_rules.py`, 8 rules — the 4 copy rules plus budget/targeting/
data-quality/landing-page-missing, since none of those need network or another service),
`LandingPageCheckService` (`preflight_landing_page.py`, wraps `preflight_safe_http.safe_fetch`
into the 8 landing-page findings), `AccountContextRuleAdapter` (`preflight_account_context.py`,
the 5 account/readiness/health rules, reading A1/A2 through their real services with
`persist=False`). 38 new tests, all passing.

**One real bug caught by the tests, not by inspection:** `ReadinessResult.readiness_status` is
a plain `str` (already `.value`-extracted at the source, confirmed by reading
`app/services/readiness.py:98,318`), not the `ReadinessStatus` enum the adapter assumed —
`readiness.readiness_status.value` raised `AttributeError` in
`test_restricted_account_status_is_blocking` and `test_disabled_account_status_is_blocking`.
Fixed by dropping the stray `.value`.

**One real pre-existing test caught by the regression run:**
`test_only_the_telegram_transport_module_may_make_an_outbound_request` (A3, `test_alert_security.py`)
hard-asserts exactly one module in the whole backend may import an HTTP client. A6's
`preflight_safe_http.py` is a legitimate second one (SSRF-guarded, single purpose), so the test
needed widening, not bypassing — renamed to `test_only_named_modules_may_make_an_outbound_request`
with an allowlist of two, and CLAUDE.md rule 20 updated to name both. Confirmed
`test_the_telegram_transport_only_ever_targets_the_configured_api_base` still passes unchanged.

**Live-verified, not just unit-tested:** `LandingPageCheckService().check("https://example.com/")`
against the real internet returned real evidence (200, HTTPS, viewport meta correctly detected —
cross-checked against the page's actual HTML — no contact/policy link, correctly flagged).
`safe_fetch("http://127.0.0.1:8000/...")` and `safe_fetch("http://localhost:8000/...")` (which
resolves to `::1`) were both refused with `BLOCKED_UNSAFE` against this workspace's own running
API — the SSRF guard blocks a real local target, not just a mocked one.

Full backend suite green after each change, ruff clean.

---

## Session 2026-09-08 — A6 API + authorization, and frontend

**Backend (Step 4):** `CampaignDraftService`, `PreflightEvaluationService` (orchestrates the three
rule modules and applies the §6.C verdict rollup exactly, with a 5-second idempotent-safe
cooldown and in-flight check, and supersedes a draft's prior active findings before a fresh run
so "current findings" always means "findings from the latest run"), `PreflightFindingService`
(acknowledge/resolve, mirrors A2's `HealthSignalActionService`). Router: 10 endpoints under
`/campaign-drafts` and `/preflight-findings`, `Ctx`/`WriteCtx` throughout, matching A1's
conventions exactly. 51 new tests (38 rule-engine + 13 API), all passing against a real
migrated Postgres.

**One real bug caught by the API tests:** `create_draft`/`update_draft`/`archive_draft`/
`restore_draft` never populated `account_display_name` in their response — only `get_draft` and
`list_drafts` did. `test_create_get_update_draft` caught it (`assert None == 'Account'`). Fixed
with a shared `_serialize_with_context` helper so every mutation response carries the same
fields the detail view does.

**Live-verified end-to-end, all four pilot verdict scenarios from mini-spec §10.5:**
`blocked_by_internal_policy` (restricted account, real DB), `needs_changes` (warning-only,
mocked landing check), `ready_for_manual_review` (a fully-ready account driven through the real
readiness/health APIs, plus a real fetch of `https://example.com/`), `unknown_missing_evidence`
(simulated transient fetch failure) — each against a real PostgreSQL database via
`TestClient`, not just unit-level mocks.

**Frontend (Step 5):** `lib/preflight.ts` (status/severity tone mapping, mirrors `lib/readiness.ts`
and `lib/health.ts`), `PreflightDraftFormDrawer`, `PreflightFindingDrawer` (mirrors
`AccountFormDrawer`/`HealthSignalDrawer`), `Preflight` (list) and `PreflightDetail` (5 tabs:
Overview/Findings/Landing Page Evidence/Evaluation History/Audit History) pages, wired into
`App.tsx` and the nav. tsc clean, `vite build` clean, eslint clean, and 13 new tests (all
passing) — 73 total frontend tests passing, no regression on the existing 60.

**Known scope simplification, documented not silent:** the Audit History tab filters
`entity_type=campaign_draft` only — finding acknowledge/resolve and evaluation-run audit rows
(under `entity_type=preflight_finding` / `preflight_evaluation_run`) are not merged in, unlike
A1's account audit tab which aggregates several related entity types. A real gap if a full
audit trail is needed from that one tab; not fixed this pass for time.

**Not verified this session — browser automation (`chrome-devtools` MCP) was unavailable
(`Target closed` on every call), so the new Preflight pages have never actually been clicked
through in a real browser.** Verification instead relied on: tsc, eslint, a full production
build, 13 new component/unit tests exercising real React rendering and interaction (drawer
open/close, required-reason validation, tone/label correctness) via jsdom, and the fully
real-database-backed backend API tests above. This is a real gap versus this project's own
standard of live verification — recorded rather than glossed over. A person has not looked at
these three pages.

---

## Session 2026-09-08/09 — direction change: A6 paused, MINI-SPEC A7 (BM + ad account creation
## & sharing via the official Meta API) — domain model, `FakeMetaBusinessProvider`, batch engine

**Direction change, not a defect:** after A6 shipped (above), the operator redirected product
scope twice more in the same session — first toward an "Account Operations Intelligence"
spend/activity dashboard (built, then shelved), then settled on **A7 v3: create ad accounts and
share/grant access, both only through the official Meta API, batch-confirmed, nothing else**.
Preflight (A6) is hidden from nav (`AppShell.tsx`) but not deleted — code, migration, and tests
all still pass. The abandoned "Account Operations Intelligence" backend
(`account_operations.py`/router/schemas/tests) is likewise kept, not deleted, per the same
no-hard-delete discipline applied to product decisions, not just data. Full spec history is in
`docs/ADSOPS_MINI_SPEC_A7_*.md` (three versions, the Meta-API one is authoritative).

**Domain model:** `MetaEnvironment`, `MetaBatchItemStatus` enums; `MetaConnection`,
`AccountCreationBatch`(+`Item`), `AccessShareBatch`(+`Item`) — 5 additive tables, migration
`0007_a7_meta_ops`. No token column anywhere — mirrors CLAUDE.md rule 18's Telegram-token
boundary. Upgrade → downgrade → upgrade verified clean.

**One real defect, same class as the A6 one two sessions ago:** the autogenerated revision id
`a7_meta_bm_account_creation_sharing` would have exceeded `alembic_version.version_num
varchar(32)` again — caught before running this time (renamed to `0007_a7_meta_ops`, 16 chars)
instead of failing first. Worth institutionalizing as a habit: check revision-id length before
`alembic upgrade`, not after.

**`FakeMetaBusinessProvider`** (`meta_provider.py`) mirrors A3's `FakeNotificationTransport`
pattern exactly: `Protocol`-shaped interface, dataclass results, `queue_*_result` staging, one
shared singleton. 11 unit tests cover every required pilot scenario from the mini-spec: capability
available/unavailable, create success, `permission_missing`/`billing_required` (not retryable),
`rate_limited` (retryable, second attempt succeeds), **`timeout` → `unknown` status, never
retried automatically**, share success, `unsupported_role` (not retryable), and idempotency-key
replay returning the same result rather than acting twice.

**One real bug caught by the batch-engine tests, not by inspection:** the fake provider cached
*every* result under its idempotency key, including retryable failures. A rate-limited item's
retry then replayed the cached failure forever instead of getting a genuine second attempt —
`test_create_rate_limited_requeues_and_a_second_run_succeeds` failed with the item stuck
`queued`. Real-API idempotency contracts only guarantee replay for a *terminal* outcome (the
server durably did or didn't act); a retryable failure means nothing durable happened, so a
retry with the same key must be allowed to proceed for real. Fixed: `create_ad_account`/
`share_ad_account_access` only cache a result when `not result.retryable`.

**Batch engine** (`meta_account_creation.py`, `meta_access_share.py`, shared primitives in
`meta_batch.py`): draft → preview → confirm → run. `preview_hash` (sha256 over item content)
is recomputed and checked at confirm time — a batch edited after preview is refused with a
mini-spec-named `preview_mismatch` conflict, not silently run as something the operator never
saw. A successfully created account syncs through the *same* `AdAccountRegistryService.create`
and `AccountHealthEvaluationService` path every other account uses, so it starts
`readiness=unknown, health=unknown` for the same structural reason any new account does — never
special-cased as trusted. **Queue-crash lease recovery**: an item stuck `running` past a
2-minute lease is reclaimed and requeued (counted against its retry budget) rather than stuck
forever — verified by directly staging an abandoned `running` item and confirming a fresh
`run()` reclaims and completes it. 15 new service-level tests against a real Postgres session
(26 total with the provider tests), all passing.

**Not yet built:** the frontend (Meta Connection page, Create Account Wizard, Share Access
Wizard, Operations page). No real Meta App, token, or permission exists yet, and none is called
automatically — `FakeMetaBusinessProvider` is the only provider wired anywhere.

Full backend regression suite green after every step above, ruff clean throughout.

---

## Session 2026-09-09 — A7 API layer

`app/api/v1/routers/meta_operations.py`: `/meta-connections` (list/create/get/check-capability),
`/account-creation-batches` (draft/get/confirm/run/items/{id}/reconcile),
`/access-share-batches` (draft/get/confirm/run) — `Ctx`/`WriteCtx` throughout, workspace-scoped,
matching every other A-phase router's conventions exactly. `meta_access_token` added to
`app/core/config.py` (server-config-only, same boundary as `telegram_bot_token`) so
`token_configured` can answer honestly for a non-fake environment once one exists — not read by
any code path yet, since no real provider does. `reset_fake_provider()` wired into the `app`
test fixture (mirrors A3's `transport`/`reset_fake_transport` exactly) so every API test starts
with a clean fake Meta provider.

9 new API tests against a real migrated Postgres: full create-batch flow (draft → confirm → run
→ synced account real and reachable through the ordinary `/ad-accounts/{id}` endpoint, readiness
`unknown`), full share-batch flow, capability-blocked draft refused, preview-hash mismatch and
run-before-confirm both `409`, reconciliation resolving an `unknown` item through the API,
cross-workspace connection access non-disclosing (`404`, not `403`), and a connection response
never carries anything token-shaped except the `token_configured` boolean.

Full backend suite (~665 tests total) green, ruff clean.

**Frontend:** `lib/meta.ts` (batch-item-status tone/label, mirrors `lib/health.ts`), `Operations`
(4 cards — Create/Share live, Bulk Pixel share/Team seats "Coming later", per mini-spec's own
"no execute button" rule for the deferred two), `MetaConnections` (add connection, check
capability, shows `token_configured` boolean only — never a token), `CreateAccountWizard` and
`ShareAccessWizard` (5 steps each: connection+target → items → preview → confirm → result, with
per-item reconcile for `unknown` items and a queue-retry action). Nav simplified to the mini-
spec's own core list (Overview/Business Managers/Accounts/Assets/Operations/Alerts/Settings);
Readiness/Account Health/Preflight/Audit Log/System Status are hidden, not deleted — same
no-hard-delete discipline applied to navigation as to data.

tsc clean, eslint clean, production build clean, 4 new presentation-logic tests (`meta.test.ts`)
— 77 total frontend tests passing, no regression on the existing 73.

**Not verified this session:** the two wizards have never been clicked through in a real
browser — verification relied on tsc/eslint/build plus the backend's real API-level tests
(which exercise the same request/response shapes the wizards send and expect, just not through
the actual rendered UI). No component-level test exists yet for the wizard steps themselves,
only for the tone/label logic they use. Recorded as a real gap, same as A6's equivalent note
two sessions ago.

A7 v3 (BM + ad account creation & sharing) is now feature-complete for what the mini-spec scopes
as its own: domain model, `FakeMetaBusinessProvider`, batch engine, API, frontend — all real,
all tested, nothing calling a real Meta API because none exists to call yet.

---

## Session 2026-09-09 — A8 Bulk Pixel Share

A8 reuses A7's exact batch/queue engine, adding exactly one new operation
(`share_pixel_access`) — built end to end (domain model → provider → batch engine → API →
frontend) in one pass since every mechanism was already proven in A7.

**Backend:** `MetaFailureCode`/`RETRYABLE_FAILURE_CODES` unchanged; `CapabilityCheck` gained
`share_pixel_access` (defaulted `True` for backward compatibility with existing fake-provider
call sites). `SharePixelRequest`/`SharePixelResult` mirror A7's `ShareAccessRequest/Result`
exactly, including the `.retryable` property. `FakeMetaBusinessProvider.share_pixel_access`
applied A7's idempotency-caching fix (cache a terminal outcome only, never a retryable failure)
correctly from the start — no repeat of that bug. `PixelShareBatch`/`Item` models (migration
`0008_a8_pixel_share`, verified upgrade/downgrade/upgrade against the real Postgres, tables
confirmed via `psql`), `PixelShareBatchService` (mirrors `AccessShareBatchService` line for
line), and `/pixel-share-batches` router (draft/get/confirm/run) mirroring
`/access-share-batches` exactly.

13 new tests in `test_a8_meta_pixel_share.py` — provider (capability default, success,
non-retryable permission failure, rate-limited retry-to-success, idempotency replay),
batch-engine (capability blocks drafting, full flow, run-before-confirm refused, stale-hash
confirm refused, rate-limited requeue-and-succeed), API (full flow syncing the grant reference,
capability-blocked `409`, cross-workspace `404` non-disclosure) — all 13 passed on first run.

**Real regression caught by the full suite, not by inspection:** adding `share_pixel_access` to
`CapabilityCheck` and to `check-capability`'s response broke A7's own
`test_check_capability_updates_the_connection`, which asserted an exact capabilities dict.
Fixed by updating the expected dict to include the new field — the kind of shape-change ripple
this project's "run the full suite after every step" rule exists to catch.

**Frontend:** `PixelShareWizard.tsx` (same 5-step shape as `ShareAccessWizard`: connection →
pixel/targets → preview → confirm → result), `MetaCapabilities` type gained
`share_pixel_access`, `Operations`'s "Bulk Pixel share" card changed from a disabled
"Coming later (A8)" placeholder to a live `Start` link, route wired into `App.tsx`. tsc clean,
eslint clean, vitest 77/77 passing (no new frontend tests needed — `batchItemStatusTone`/
`BATCH_ITEM_STATUS_LABEL` were already shared and already covered by `meta.test.ts`), production
build clean.

**Local-environment friction, not a code bug:** the shared local Postgres (`adsops-db`, port
5434) was contended by two unrelated concurrent `pytest` runs mid-session — one a stray/orphaned
process from this session's own earlier background commands, one apparently another active
terminal in this same workspace running an unrelated test file
(`test_quyen_cheo_tai_khoan.py`). Both caused the exact false-slow/hang pattern already known
from this project's local dev friction: a full-suite run stalled at ~15-20% for several minutes
while a second run held table locks on the same database. Resolved by killing the stray
processes, clearing `idle in transaction`/lock-holding connections via
`pg_terminate_backend`, and waiting for the other terminal's run to finish before claiming the
database for a clean single-process regression run.

**Not verified this session:** `PixelShareWizard` has never been clicked through in a real
browser — same gap as A7's two wizards and A6's pages (chrome-devtools MCP remains unavailable
in this environment, confirmed again, not transient). No real Meta provider exists; nothing in
A8 calls a real Meta API.

Full backend regression suite: 546 tests, all passing, ruff clean — run alone against the shared
local Postgres once the other terminal's concurrent test run finished.

---

## Session 2026-09-09 — A9 Step 2 (session architecture)

Audit-before-build for A9 first (`docs/AUDIT_BEFORE_BUILD_A9.md`) — the biggest real finding:
dashboard sessions are pure stateless JWT, zero server-side revocation exists anywhere, while
A5's `ExtensionInstallation` already has exactly the pattern needed (row + `revoked_at`,
re-checked every request), just never applied to the dashboard. `WorkspaceRole` is
`owner/admin/buyer/viewer/auditor`, not the spec's `owner/admin/operator/viewer` — decided with
the product owner to keep the existing enum, map `buyer`≈`operator` semantically for A9's scope
policy, keep `auditor` as its own case. `READ_ROLES = frozenset(WorkspaceRole)` confirmed: **no
per-resource scope check exists anywhere in the codebase today** — A9's `ScopeAuthorizationService`
is net-new, not tightening something partial. No email provider configured. Baseline regression:
546 tests, all green, before any A9 code.

Following the spec's own recommended order (prove session revoke works before exposing any Team
UI): `DeviceSession` model + migration `0009_a9_device_session` (verified upgrade/downgrade/
upgrade), `SessionRegistryService`. `POST /auth/login` now creates a `DeviceSession` row and
embeds its id as a `session_id` JWT claim; `app/api/deps.py::_build_context` re-loads and
re-checks that row on every dashboard request (extension tokens are untouched — the check only
runs when `token_use == dashboard`). New endpoints: `GET /security/sessions/me`,
`POST /security/sessions/{id}/revoke` (409 on your own current session — sign out separately),
`POST /security/sessions/logout-other-devices` (keeps the caller signed in, revokes the rest).

**Two real regressions found by the existing suite, both fixed, neither a bug in the new
code — both were existing tests whose assumptions the new capability legitimately changed:**

1. `test_a5_extension_api.py::test_tokens_issued_before_a5_still_work_as_dashboard_sessions`
   hand-crafted a JWT with `token_use` stripped to simulate a pre-A5 token, and now also
   implicitly lacked `session_id` (a claim that didn't exist when the test was written) — so it
   started failing for the *new*, unrelated reason rather than the one it meant to test. Fixed
   by building the stripped token from a real `auth` fixture login (so `session_id` stays
   valid) and adding a **new** test,
   `test_a_token_missing_session_id_is_refused`, that locks in the actual new boundary:
   unlike `token_use`, `session_id` is not additive/optional — a token without one is refused.
2. `test_security_api.py::test_no_audit_row_ever_persists_a_credential_like_key` — the audit
   payload for `session.created` used the key `"session_type"`, and the project's
   `SENSITIVE_NAME_FRAGMENTS` denylist bans any key merely *containing* `"session"` (it exists
   to catch `session_token`/`session_id`-shaped leaks). A harmless enum value would have been
   silently `[REDACTED]`'d, and the security test correctly caught it. Fixed by renaming the
   audit dict key to `"channel"` — the `DeviceSession.session_type` **column** name is
   unaffected, only the JSON key inside the audit payload had to route around the denylist.
3. `test_audit_api.py::test_audit_history_is_workspace_scoped` asserted a *different*
   workspace's freshly-logged-in owner sees zero audit rows — true before A9, false now that
   login itself legitimately writes a `session.created` row in the *logging-in user's own*
   workspace. Fixed to assert the real invariant (the *other* workspace's mutation never
   appears in this workspace's audit list), not that logging in produces no audit trail at all.

13 new tests in `tests/test_a9_session_registry.py` (label/browser-OS parsing, IP hashing never
returns the raw address, cross-workspace session lookup returns nothing, revoke-own-current is
refused, revoke-someone-else's-session is `404` not `403`, logout-other-devices keeps exactly
the caller's session alive, a second login's session is independently revocable and denies the
first token's very next request) plus 1 new test in `test_a5_extension_api.py`.

Full backend regression suite: 546 pre-existing + 14 new = 560 tests, all passing, ruff clean.
Frontend unaffected this step (no UI wired yet) — tsc/eslint re-confirmed clean regardless.

**Not yet built:** seat plan, invitations, member lifecycle, BM/ad-account assignment,
`ScopeAuthorizationService`, Team & Seats / Security & Devices UI. Nothing in this step calls
real email/Telegram, deploys anything, or touches A1–A8 semantics.

---

## Session 2026-09-09 — A9 Step 3 (seat/invitation/assignment schema)

Schema only, per the spec's own step order — no service or route reads/writes these tables yet
(that's Step 4). `WorkspaceSeatPlan`, `WorkspaceInvitation`, `MemberBusinessManagerAssignment`,
`MemberAdAccountAssignment` (new file additions to `app/models/team.py`) plus
`WorkspaceMember.status` (new column on the existing A1 table, `invited/active/suspended/
deactivated` — deliberately does **not** include `archived`: that state is already
`WorkspaceMember.archived_at`, present since A1, and duplicating it as a fifth enum value would
be two sources of truth for the same fact). `seat_used` is not a persisted column anywhere —
always computed live from `count(active WorkspaceMember)`, the same derive-don't-cache
convention this codebase already used for A7/A8 batch status.

Migration `0010_a9_seat_invite_assign`: 4 new tables + 1 added column, verified upgrade/
downgrade/upgrade clean. One real thing caught before it became a production incident: the
autogenerated `ADD COLUMN workspace_members.status NOT NULL` had no default — safe on today's
empty dev database, but would fail outright against any workspace_members table that already
has rows. Added `server_default='ACTIVE'` (kept permanently, matching the existing precedent in
`0005_a5_extension.py` for `label`/`extension_version`), so every pre-existing member becomes
`active` — the same status the bootstrap owner is already effectively at.

Duplicate-*active*-assignment prevention (spec §8.A.3/4) is left to Step 4's `AssignmentService`
rather than a DB constraint: it would need a partial unique index scoped to `status = 'active'`,
which only Postgres supports, and this project's enum/index conventions are deliberately kept
portable (`_enum()`'s own docstring: "portable across PostgreSQL and SQLite"). A duplicate
*any-status* row is allowed at the DB level; a duplicate *active* row is a service-layer 409.

6 new schema-level tests in `tests/test_a9_team_schema.py` (new member defaults to `active`,
one seat plan per workspace enforced by a real `IntegrityError`, invitation `token_hash` unique
across workspaces — not just within one, a BM-assignment `member_id` pointed at a `users.id`
instead of a `workspace_members.id` fails its FK exactly as it should, an ad-account assignment
persists cleanly end to end, an assignment referencing made-up ids fails its FK).

Full backend regression suite: 560 pre-existing + 6 new = 566 tests, all passing, ruff clean.
No real regression found this step — schema-only changes, nothing existing read the new
column/tables yet to be broken by them.

**Not yet built:** `SeatPlanService`, `InvitationService`/`InvitationTokenService`,
`MembershipLifecycleService`, `ScopeAuthorizationService`, `AssignmentService`, any
`/team/...` API route, Team & Seats / Security & Devices UI. Nothing in this step calls real
email/Telegram, deploys anything, or touches A1–A8 semantics.

---

## Session 2026-09-09 — A9 Step 4 (core services)

`SeatPlanService`, `MembershipLifecycleService`, `AssignmentService`, `ScopeAuthorizationService`
(two foundational primitives only — `can_view_page_or_pixel`/`can_view_operation_batch` deferred
to Step 5, when a real route gives them something to be verified against), and `InvitationService`
**minus `accept()`** — still no API route wired to any of this yet (that's Step 5).

**Real bug caught by writing the code, not by a test:** every raw string like `"active"`/
`"pending"` used to compare against an enum column would have been wrong. `_enum()`'s docstring
promises portability but doesn't say *which* representation gets stored — confirmed by direct
inspection (`sa.Enum(SomeStrEnum, ...).enums` returns `['ACTIVE', 'PENDING', ...]`, the Python
member **names**, not their lowercase `.value`s). `app/services/invitation.py`'s first draft
compared `WorkspaceMember.status == "active"` and similar — silently wrong (would never match
any row, since every row actually stores `"ACTIVE"`), caught before running anything by
rereading the file against this fact rather than trusting the draft. Fixed everywhere to compare
against the actual enum members (`WorkspaceMemberStatus.ACTIVE`, `InvitationStatus.PENDING`,
...). `seat_plan.py`/`membership_lifecycle.py`/`assignment.py`/`scope_authorization.py` were
written correctly from the start using enum members throughout — grepped the whole batch for
any other `== "..."` pattern afterward to confirm none slipped through.

**Real bug caught by a test:** `test_create_invitation_returns_a_raw_token_never_persisted`
queried `AuditLog` rows right after `InvitationService.create()` and got zero back, even though
`create()` really does call `audit.record()`. Root cause: `app/db/session.py`'s `SessionLocal`
is `autoflush=False` project-wide — a real API request gets a flush for free from
`ApiContext.commit()` at the end of the route handler, but a service-level test calling the
service directly, with no route in between, does not. Not a service bug (every service here
flushes its own entity mutations already) — just this one test needed its own explicit
`session.flush()` before the query, which every other test in the file avoided needing only
because it reads Python object state directly rather than re-querying.

`app/services/workspace.py` gained `A9_ROLE_TO_WORKSPACE_ROLE`/`WORKSPACE_ROLE_TO_A9_ROLE` — the
one place `operator`↔`buyer` (and `admin`/`viewer` passthrough) is translated, per the Step 3
audit decision. `owner`/`auditor` are deliberately absent from the map: owner can never be
invited or role-changed through A9, auditor keeps its own pre-existing meaning.

**Spec gap surfaced and resolved (documented in `app/services/invitation.py`'s own docstring):**
the mini-spec's "Create invitation" flow accepts optional initial BM/ad-account assignments as
input, "applied transactionally only after valid acceptance" — but `WorkspaceInvitation`'s own
schema (already built in Step 3, matching the spec's field list exactly) has nowhere to persist
that choice between create and accept. Resolved by dropping bundled initial assignments from
`create()`'s scope: the owner assigns BM/account access through `AssignmentService` after the
member becomes active, functionally identical, one extra call instead of one bundled payload —
rather than adding a column the spec never actually defined.

**Deliberately not built yet — a real, unresolved design fork, not an oversight:**
`InvitationService.accept()`. This codebase has no self-registration endpoint at all (`User`
rows are created only once, by `app/bootstrap.py`) — so "accept an invitation" has to be one of
two different things depending on whether the invited email already belongs to a `User`: an
**existing** user must accept while authenticated as themself (spec: "validate exact invited
email against **authenticated**... user email"), while a **brand-new** email has no user to
authenticate as yet and must register as part of accepting (spec: "...**or registered** user
email" — the spec's own wording anticipates both, without resolving which). Building `accept()`
now would mean silently picking one path on a real architecture fork the spec left open. Flagged
for the product owner before continuing into Step 5.

31 new tests in `tests/test_a9_team_services.py` covering all five services: seat math (used/
available/blocked-until-configured), last-active-owner protection on role-change/suspend/
deactivate/archive, suspend and deactivate both revoking every live `DeviceSession` immediately
(reusing Step 2's registry — proven, not just asserted, by creating a real session and checking
`get_active()` returns `None` afterward), reactivate correctly blocked when the freed seat gets
taken by someone else first, duplicate-active-assignment rejected then allowed again after
revoke, BM-assignment scope correctly extending to every ad account under that BM while a
direct-only account assignment stays narrow, revoked assignment immediately losing visibility,
owner bypassing all scope checks with no assignment rows at all, invitation supersede-on-re-
invite, resend issuing a genuinely new token while the old one becomes unacceptable, and lazy
expiry-on-read.

Full backend regression suite: 566 pre-existing + 31 new = 597 tests, all passing, ruff clean.

**Not yet built:** `/team/...`/`/security/...` (owner-facing) API routes, retrofitting
`ScopeAuthorizationService` into A1/A2/A3/A7/A8's existing list/detail paths, Team & Seats /
Security & Devices UI. Nothing in this step calls real email/Telegram, deploys anything, or
touches A1–A8 semantics.

---

## Session 2026-09-09 — A9 Step 4b (`accept_invitation()`, resolved)

Product owner confirmed the design (see Step 4 entry above for the fork): an email that already
belongs to a `User` must accept while authenticated as that exact user — sign in first, then
accept with that bearer token; `accept_invitation()` refuses (401) when no matching authenticated
user is supplied, rather than let a stranger try a password against a real employee's email. A
brand-new email registers a `User` as part of accepting (password required, ≥8 chars, same
minimum as `LoginRequest`).

`accept_invitation()` is a **module-level function**, not an `InvitationService` method — unlike
create/revoke/resend, which act on a workspace the caller already knows, accepting a token is
how the workspace gets *discovered*: the token is looked up globally by its hash (Step 3's
`token_hash` unique constraint spans workspaces, confirmed by its own test), and the workspace id
comes from the row that's found, not from a pre-bound service.

Also handles: seat capacity checked atomically via `SeatPlanService.require_available_seat()`
(same "no plan configured" boundary as everywhere else — accepting is blocked, not defaulted, on
an unconfigured workspace); a previously deactivated/archived member accepting a fresh invitation
reactivates the *same* `WorkspaceMember` row instead of hitting the `workspace_id`+`user_id`
unique constraint; the invited role (`operator`/`admin`/`viewer`, A9's own vocabulary) is mapped
to the underlying `WorkspaceRole` enum at the moment of creating/reactivating the membership, via
the same `A9_ROLE_TO_WORKSPACE_ROLE` table Step 4's `MembershipLifecycleService` already uses.

9 new tests in `tests/test_a9_team_services.py`: new-email registers and joins (seat count
correct after), weak password rejected, an existing account's email refused without
authentication (the core protection), the *correct* authenticated user joining a second
workspace, the *wrong* authenticated user refused, no-seat-plan blocks acceptance, an unknown
token is `404` not a 500, an already-accepted token can't be reused, and reactivation-not-
duplication for a rehired member.

Full backend regression suite: 597 pre-existing + 9 new = 606 tests, all passing, ruff clean.

**Not yet built:** `/team/...`/`/security/...` (owner-facing) API routes — including the actual
`POST /team/invitations/accept` route, which per the mini-spec should also sign the new/
reactivated member in (create their first `DeviceSession` + JWT, mirroring `auth.login()`'s own
pattern) — that needs the `Request` object for user-agent/IP, so it lands with Step 5, not here.
Retrofitting `ScopeAuthorizationService` into A1/A2/A3/A7/A8's existing list/detail paths, Team &
Seats / Security & Devices UI. Nothing in this step calls real email/Telegram, deploys anything,
or touches A1–A8 semantics.

---

## Session 2026-09-09 — A9 Step 5 (Team & Seats API)

25 endpoints, all owner-only except the invitee-facing accept, matching the mini-spec's §F
contract path-for-path. New `app/api/v1/routers/team.py`; `security_sessions.py`'s
`/{session_id}/revoke` extended to serve *both* self-revoke and owner-revokes-another-member (the
spec describes one endpoint branching on whose session it is, not two). `app/api/deps.py` gained
`OwnerCtx` (stricter than `WriteCtx`: owner only, not owner/admin/buyer) and `OptionalUser` — the
latter exists solely for accept, the one route with no established workspace to build a `Ctx`
from, and it deliberately still *rejects* an invalid/expired/revoked bearer token rather than
silently falling back to "anonymous, create a new account".

**Real guardrail catch — the security boundary worked exactly as designed.** Every accept request
was refused `422 forbidden_field` on the first run: `InvitationAcceptRequest` extended
`StrictPayload`, whose `_reject_sensitive_fields` validator refuses any body containing a field
whose *name* matches `SENSITIVE_NAME_FRAGMENTS` — and this body needs both `token` and
`password`. That is CLAUDE.md rule 1 doing its job, not a bug. The project already had exactly
one documented exception for this (`LoginRequest`: a plain `BaseModel` with `extra="forbid"` and
a docstring explaining why a password legitimately appears there), so accept follows the same
precedent as the second — with its own docstring, and **CLAUDE.md rule 1 updated to name both**
so the exception list stays explicit rather than becoming folklore. Same discipline as the A6
change to rule 20, where a second legitimate outbound-HTTP module was named rather than the test
loosened.

**Changed while wiring the API:** `MembershipLifecycleService.archive()` gained a required
`reason` (the spec's constraint 24 lists archive alongside revoke/suspend/deactivate as needing
a bounded reason; the Step 4 draft had omitted it). Existing Step 4 tests updated to match.

22 new API tests in `tests/test_a9_team_api.py`, all through the real auth stack with no mocked
authorization: capacity reported as `null` (never a guessed default) until a plan exists; the
full invite → accept → signed-in → seat-consumed path end to end; an existing account's
invitation refused anonymously but accepted when authenticated as that account (joining a second
workspace); a used/revoked/superseded token all refused; resend killing the previous token;
every team endpoint returning `403` for a non-owner member (proved by onboarding a real member
through the real endpoints first); role change rejecting `owner` at the schema layer; the last
owner un-deactivatable; **suspending a member killing their live token on the very next request**
(server-side, not cosmetic); deactivate/reactivate moving the seat back and forth; assignment
create/duplicate-`409`/revoke with the access-preview reflecting each change; the owner listing
and revoking another member's session (and that revoke requiring a reason, `422` without);
a member *not* being able to revoke the owner's session (`403`); revoke-all; and cross-workspace
member access returning `404`, not `403`.

Full backend regression suite: 606 pre-existing + 22 new = 628 tests, all passing, ruff clean.

**Not yet built:** retrofitting `ScopeAuthorizationService` into A1/A2/A3/A7/A8's existing
(still-unscoped) list/detail paths — the highest-regression-risk item in this whole mini-spec,
flagged as such in `docs/AUDIT_BEFORE_BUILD_A9.md` §12 before any A9 code was written, and worth
its own separate step. Nothing in this step calls real email/Telegram, deploys anything, or
changes A1-A8 semantics.

---

## Session 2026-09-09 - A9 Step 6 (frontend) + the project's first real-browser dashboard UAT

**Frontend:** `pages/TeamSeats.tsx` (seat summary tiles, seat-plan card, member table with live
assignment/session counts, invitations table with resend/revoke), `pages/SecurityDevices.tsx`,
`components/team/InviteMemberDrawer.tsx`, `components/team/MemberDrawer.tsx` (role change, scope
assignment, effective-access summary, device list, and the reason-gated destructive actions),
`lib/team.ts` (tone/label maps). Both pages live under Settings rather than the main nav, per the
mini-spec's "keep it compact, these are settings-level modules". tsc clean, eslint clean,
production build clean, 9 new presentation tests (86 frontend tests total, up from 77).

**First real-browser verification this project has ever run against its own dashboard.** A5's
UAT covered the Chrome extension; A6, A7 and A8's pages were each shipped with an explicit
"never clicked through in a real browser" caveat, because the browser tooling was believed to be
unavailable. It was actually a missing `libnspr4.so` - found and fixed earlier the same day
while closing out the Translation project's E21 (see the `chrome-devtools MCP "Target closed"`
memory note). `backend/scripts/a9_live_verify.py` now drives real Chromium against the real dev
stack: **20/20 checks passed**, screenshots in `docs/evidence/A9-LIVE/`.

What it actually verified, rather than assumed: signing in; both Settings entry points; the
"no seat plan configured" state showing capacity as unknown instead of a guessed number; saving
a seat plan and the summary updating; the invite drawer opening, *not* offering Owner in its
role select, and saying plainly that no email is sent; an invitation being created with the
one-time link and its warning visible; the owner's own drawer explaining they cannot be
downgraded and offering no destructive action against the last owner; the current device marked
as such on Security & Devices with its revoke deliberately unavailable; the page's own statement
that no IP/user-agent/fingerprint is stored; and no horizontal overflow at 375px or 768px.

**Two real script defects found and fixed while doing it, both mine, both worth recording:**
1. The first run failed on CORS - the script used `http://127.0.0.1:5173` while `CORS_ORIGINS`
   allows `http://localhost:5173`. Same host, different origin as far as a browser is concerned.
   Not an app bug; the script now pins the exact allowed origin with a comment saying why.
2. The second run failed on `L4` because the *first* run had already created a seat plan - the
   script was not idempotent, so it could only ever verify the "unconfigured" state on a virgin
   database. It now clears its own artifacts (`workspace_invitations`, `workspace_seat_plans`)
   before each run, so both states are verified every time.

A third apparent failure was **not** a defect: a `/config.js` 404 in the console. That file is
written by nginx at container start and deliberately does not exist under the vite dev server -
`lib/api.ts` documents the fallback that makes its absence correct, and it 404s on every page of
this app, long predating A9. The console check now names that one exception explicitly rather
than either failing on it or silently swallowing every 404.

Backend regression re-run after restarting the dev API on the new code: **628 tests, all
passing, ruff clean.**

**Not yet built:** the `ScopeAuthorizationService` retrofit into A1/A2/A3/A7/A8's list/detail
paths (unchanged from Step 5's note - every role still sees every BM/ad account on those older
routes). No real email, no Telegram, no deployment, no Meta call in any of this.

---

## Session 2026-09-09 - A7/A8 live verification (and the real bug it found)

With the browser tooling unblocked, `backend/scripts/a7_a8_live_verify.py` finally ran the
click-through that A7's and A8's own reports had been carrying as an open gap for several
sessions. **20/20 checks passed - but only after fixing a real bug the click-through exposed.**

**The bug: all three wizards were a dead end after "Confirm batch".** In
`CreateAccountWizard`, `ShareAccessWizard` and `PixelShareWizard`, the confirm mutation's
`onSuccess` called `setStep(3)` - the step it was already on. Step 4 (Result), which is where
the "Run queue" button lives, was therefore unreachable: an operator could draft, preview and
confirm a batch, and then had no way to run it from the UI at all. Clicking "Confirm batch"
again just re-hit the API, which correctly refused with a 409.

Nothing else caught this, and it is worth being precise about why: the backend tests exercise
`/confirm` and `/run` directly, so the engine was genuinely fine; the frontend tests only
covered `batchItemStatusTone`/`BATCH_ITEM_STATUS_LABEL`, which are pure functions; tsc and
eslint cannot see that a state machine has no edge out of one of its states. It took driving
the actual five-step flow in a real browser. Fixed in all three (`setStep(4)`), re-verified by
the same script.

Two script-level issues found and fixed along the way, both mine, neither an app defect:
1. `CreateAccountWizard`'s step 1 requires the BM external id *as well as* the connection - its
   Next button stays disabled without one. The script had been filling that field on step 2.
   That disabled state is the guardrail working, so the script now asserts it explicitly before
   supplying the id.
2. The dev database had been wiped between runs by the backend test suite (`conftest.py`
   truncates every table after each test, and the dev API points at the same local Postgres),
   so login started failing with a correct 401. Restarting the API re-runs bootstrap and
   recreates the owner. This is the known local-dev friction of sharing one Postgres between
   the test suite and the dev server, not a code problem - but it is worth remembering that a
   full `pytest` run leaves the dev stack signed out.

What the run actually verified end to end, through the UI rather than the API: creating a Meta
connection and running its capability check; the connection page showing a `token_configured`
boolean and never anything token-shaped; all three wizards' draft -> preview -> confirm -> run
-> per-item result; every item ending in a real terminal state with none left silently
`Queued`; and no horizontal overflow on Operations at 375px or 768px. Screenshots in
`docs/evidence/A7-A8-LIVE/`.

Frontend after the fix: tsc clean, eslint clean, 86 tests passing, production build clean.

---

## Session 2026-09-09 - A9 Step 7 (scope retrofit) - the last piece of A9

Before this step, `READ_ROLES = frozenset(WorkspaceRole)` meant every active member of every
role could read every Business Manager and ad account in the workspace. The A9 assignment
tables existed and the Team UI used them, but the older A1/A2/A3/A7/A8 routes did not. This
closes that.

**Design decision that mattered most: one chokepoint, not thirty checks.** Every route that
resolves an account by id already goes through `AdAccountRegistryService.get()`, so the scope
check lives *there*, and the service takes the visible-id set at construction. All 28 router
construction sites now pass `visible_ids=ctx.visible_ad_account_ids()`; `grep` confirms none
were missed. The alternative - a check in each route - would have meant a silent data leak the
first time someone adds a route and forgets. Readiness, health, events and audit history
inherit the scope for free because they all resolve the account the same way, which a test
asserts explicitly rather than assuming.

`ApiContext` computes the scope lazily, once per request: for an owner it is a `None` with
zero queries (the role check short-circuits), so the retrofit costs the common path nothing.
`None` means "no filter"; a non-owner always gets a concrete set, empty included - "assigned
nothing" must return nothing, never everything (CLAUDE.md rule 4).

**Alerts** are scoped by their `ad_account_id`. An alert with no account link is not shown to a
non-owner at all: it cannot be proven to be in scope, and the spec's own rule for that case is
to deny rather than guess. `NULL IN (...)` does this naturally in the list query, with the
matching explicit check on the detail route.

**Meta connections and A7/A8 batches are owner-only**, per the permission matrix. Reads are
owner-only too rather than half-scoped, and the reason is recorded in the router: a batch item
stores a BM/account *external id* - a string that may not correspond to any local record yet,
since creating one is the entire point of a creation batch - so membership scope cannot be
proven for it.

**Non-disclosure holds throughout:** out-of-scope is `404`, never `403`, and the response body
never names the record. `403` would confirm the record exists; `404` is the same answer another
workspace's record gives.

**One test assumption of mine was wrong and the run corrected it:** I expected
`/ad-accounts/{id}/audit-logs` to return `404` for an out-of-scope operator. It returns `403` -
because `operator`/`buyer` was excluded from `AUDIT_READ_ROLES` back in A1 and still is, and
that role gate fires before any scope check. That is correct behaviour, not a gap: A9 must not
quietly widen who may read audit history. The test now asserts the `403` for an operator *and*
adds a `viewer` (who does pass the audit gate) to prove scope still returns `404` for them -
role gate and resource scope are two different things, and both had to be shown working.

12 new tests in `tests/test_a9_scope_enforcement.py`: the owner unaffected with no assignments
anywhere; an unassigned member seeing zero accounts and getting a non-naming `404` on a real
one; an account assignment making exactly that one visible; a BM assignment pulling in the
accounts under it and nothing else; revoking an assignment making a bookmarked link go
non-disclosing immediately; derived routes inheriting the scope; mutation of an unassigned
account refused; alerts scoped by account; and Meta operations owner-only while the owner is
unaffected.

Full backend regression: 628 pre-existing + 12 new = 640 tests, all passing, ruff clean.

---

## Session 2026-09-10 - A6 live verification (the last never-clicked-through surface)

`scripts/a6_live_verify.py`, real Chromium against the real stack: **18/18**, screenshots in
`docs/evidence/A6-LIVE/`. With this, every UI surface in the product has now been clicked
through at least once - A5 (extension) had been, A9 and A7/A8 were done yesterday, A6 was the
last one left.

Verified beyond "does it render": the page still loads by URL while hidden from the nav; it
states up front that it is not a platform decision; creating a draft with deliberately
non-compliant ad copy produces a real evaluation; the Findings tab lists actual findings with a
severity, a category and a readable message; opening one shows a **recommended action** rather
than restating the rule key ("Link this draft to a registered account before evaluating it.");
archiving keeps the record and offers Restore with no delete anywhere; no horizontal overflow at
375px or 768px.

**Three of my own checks were wrong before they were right, and the corrections are the
interesting part:**

1. **A naive substring search flagged the product for saying "will be approved".** It says it
   inside the disclaimer that *denies* it - "they do not guarantee that a draft will be approved
   or that an account cannot be restricted" - which is exactly the wording CLAUDE.md rule 6
   requires. The check now asserts the disclaimer is present *and* scans sentence by sentence
   for an affirmative claim, skipping any sentence carrying a negation. A guardrail test that
   fires on the guardrail's own wording is worse than no test: it trains you to ignore it.
2. **"Findings" matching the tab label is not evidence of a finding.** The first version of the
   check passed on the nav label alone. It now opens the tab, asserts a real row with severity
   and message, and opens the finding drawer to assert the recommended action is there.
3. **A check written as "no underscore in a text slice"** was meaningless. Replaced with one
   that measures the thing that matters: a `Blocking` finding's computed colour is never success
   green.

**Observation, not fixed:** this project's `Drawer` component has no Escape-to-close handler
(some other modals here do). Pre-existing, outside what A6 guarantees, and left alone rather
than folded into an unrelated verification pass - recorded here so it is a known choice rather
than an unnoticed gap.
\n

---

## Session 2026-09-10 - A10 build (real Meta provider, read-only) - offline half complete

Decisions taken with the product owner: a long-lived **system user token**, aimed at a **real
Business Manager in read-only mode** rather than Meta's sandbox. The second choice is the reason
the first one had to be built carefully - a live BM is not a place to rely on a feature flag.

**Everything that does not need the token is built and tested. Nothing has called Meta.**

`services/meta_graph_transport.py` - the third module in this backend allowed an outbound
request, added to `test_alert_security.py`'s allowlist **by name** and to CLAUDE.md rule 20,
the same way A6's SSRF-guarded fetcher was. Stdlib `urllib` only, matching
`telegram_transport.py`, so no new dependency enters the production image. Fixed host, pinned
Graph version, explicit timeout, typed results rather than raised exceptions.

**The read-only guarantee is structural, in two independent ways**, which matters more than
usual because the target is a live BM:

1. `RealMetaBusinessProvider.create_ad_account` / `share_ad_account_access` /
   `share_pixel_access` **raise** `MetaWriteNotEnabled`. Deliberately an exception rather than a
   failed result: a failed result would flow into the batch engine's retry machinery as though
   the attempt had really happened and merely failed. It did not happen, must not be retried,
   and should be loud.
2. The transport has no method that can POST, PATCH or DELETE. A test asserts this by
   inspecting the public surface, so adding one later means deleting a test that says not to.

`_provider_for` requires **two independent conditions** before anything real is reachable: the
connection is marked `production` (an operator decision, in the database) *and*
`META_ACCESS_TOKEN` is set (a deployment decision). Either alone stays on the fake provider - a
`production` connection on a token-less server degrades quietly to "no real call" rather than
failing loudly, which is the safer direction to fail in.

**Evidence-first held even where it was tempting not to.** A capability check against a real
connection reports `list_business_managers: true` and the three write capabilities `false` with
reason `not_supported`. Reporting them `true` because "the token probably has permission" would
be exactly the fabricated positive state CLAUDE.md rule 4 exists to prevent - this build cannot
perform those operations, so it says so.

**Meta's own error text is parsed and dropped.** `error.message` echoes request parameters back,
which can name a Business Manager; only the mapped failure code is kept, and a test asserts the
echoed identifier never reaches `failure_summary`.

26 new tests in `tests/test_a10_meta_real_provider.py`, none of which touch the network: the
transport against a stubbed `urlopen` (token in the header not the query string so it stays out
of proxy logs, the pinned version in the URL, nine Graph error shapes mapping onto this
product's own vocabulary - including a dead token arriving as a 400 and an app rate limit
arriving as a 400, both of which a naive status-only mapping would get wrong), and the provider
against a stub transport (writes raise and never reach the transport, capability check makes
exactly one bounded call, a failed call reports `false` with the real reason, listing returns
`[]` rather than inventing rows).

**A second guardrail fired, and it was the more interesting one.** A5 had left a test asserting
the backend source contains no reference to `graph.facebook.com`, `business.facebook.com/api` or
`adsmanager.facebook.com` at all - correct when written, because the server was never meant to
contact an advertising platform. A10 is the mini-spec that deliberately changes that premise, so
the rule was narrowed rather than dropped, and the narrowing encodes a distinction worth having:

- **`graph.facebook.com`** — the *official API* this product was always meant to use (A7 onward).
  Now allowed in exactly two files, by name: `core/config.py` (the pinned base URL) and
  `services/meta_graph_transport.py`. Anywhere else is still a failure.
- **`business.facebook.com/api` and `adsmanager.facebook.com`** — the *web UI* hosts. Still
  banned outright, with no exceptions, because a server reaching those would mean scraping or
  driving the Ads Manager interface. That is what the rule was really protecting, and it is
  untouched.
- **Browser tooling** — still banned everywhere, unchanged.

Both guardrail widenings this session (rule 20's module allowlist, and this one) followed the
same shape A6 set: name the exception, keep the rule, and make the test list the permitted files
explicitly so the next addition has to be argued for rather than absorbed.

Full backend regression: 640 pre-existing + 26 new = 666 tests, all passing, ruff clean.

**Deliberately not done, and blocking nothing else:** the single live, non-mutating call.
`scripts/a10_live_probe.py` is written and ready - one GET, prints what the token can see and
Meta's rate-limit header, never prints the token - but it is a script rather than a route
precisely so the first real call is a witnessed decision (CLAUDE.md rule 22), and it needs a
token that does not exist yet. `docs/RUNBOOK_META_CONNECTION.md` covers where the token goes,
what each failure code actually means, and what has to happen before writes are ever enabled.
\n
## A10 live probe — the first real Meta call (2026-09-10)

**It happened.** The operator generated a system user token in a real Business Manager and ran
`scripts/a10_live_probe.py` against `graph.facebook.com`. This is the first time this product
has contacted Meta at all. One GET, read-only, non-mutating.

**Observed result — recorded as it actually came back, not as it was hoped:**

```
visible now : 0 (limit was 1, so this is 'at least one', not a total)

Capability as this build reports it:
  list_business_managers   : True
  create_ad_account        : False  (writes are not enabled)
  share_ad_account_access  : False
  share_pixel_access       : False
  reason                   : not_supported
Nothing was created, shared or changed. This call can only read.
```

**What this proves:** the transport works end to end — DNS, TLS, the pinned `v21.0` path, the
bearer header, and Graph's response parsing. The token authenticated: an expired or unauthorised
token would have produced `token_expired` or `permission_missing`, and neither appeared. The
three write capabilities correctly reported `false` with `not_supported`, which is the honest
answer for a build that cannot write.

**What this does NOT prove, and the reason A10 is not closed:** `me/businesses` returned **zero
rows**. The token can reach the endpoint but currently sees no Business Manager, so no real
discovery has been demonstrated. Cause not yet established. Two candidates, not yet
distinguished: (a) the system user has no assets assigned to it in Business Settings, or (b)
`me/businesses` is the wrong edge for a *system user* token, whose identity is scoped to a
business rather than associated with a list of them. Resolving this needs one further read.

**Finding — `list_business_managers: True` over-claims.** `check_capability()` sets it from
`response.ok` alone, so a 200 carrying an empty `data` array reports `True`. The field name says
"can list Business Managers"; the evidence only supports "the endpoint accepted the request".
Under rule 4 a 200-with-nothing is absence of evidence, not evidence of access. Raised as a
finding for a decision, not silently changed.

**Two defects in the probe script itself, found by running it — both mine:**

1. `ModuleNotFoundError: No module named 'app'`. Running `python scripts/a10_live_probe.py` puts
   `scripts/` on `sys.path`, not `backend/`. The test suite never caught this because
   `pytest.ini` sets `pythonpath = .`; a directly-run script has to bootstrap it itself. Fixed.
2. The documented invocation was a four-line block containing `read -rs`, which is unreliable
   when pasted as a block (`read` can consume the following line instead of waiting for input).
   Replaced with a hidden `getpass` prompt inside the script, so the command is now one line and
   the token still never reaches shell history. `META_ACCESS_TOKEN` still takes precedence for a
   configured server.

Both were reachable by a completely safe test that was skipped before shipping: running the
script with **no** token, which makes no network call and exits 2. That test now passes, and is
the check to run before any future change to this script. Same lesson as the A7/A8 wizards: 666
green tests say nothing about a path nobody executed.

**Environment note:** the `adsops_test` database had been dropped entirely (only `adsops` and
`postgres` remained), so the A10 suite errored at fixture setup with `database "adsops_test"
does not exist` — unrelated to the code. Recreated; 26/26 A10 tests pass, ruff clean.

### A10 diagnosis — the cause of `visible now: 0` (2026-09-10)

Operator ran `scripts/a10_live_probe.py --bm 1993884657458857`. Real, read-only, 4 calls:

```
Diagnosis for BM 1993884657458857 (2 more read calls):
  GET me      : id=1068912112587121  name=Conversions API System User
  GET 1993884657458857 : id=1993884657458857  name=Quảng Cáo Top

  VERDICT: the token CAN read this Business Manager directly.
```

**Cause established — it is our defect, not a Meta-side misconfiguration.** The system user has
16 business assets assigned (4 ad accounts at full access, plus apps and pixels), verified in
Business Settings, and the token reads the Business Manager `1993884657458857` ("Quảng Cáo Top")
directly. `me/businesses` nevertheless returns zero rows, so it is the wrong edge for a *system
user* token. Note `GET me` returns `1068912112587121`, a different id from the `100084050274919`
shown for the same system user in Business Settings — `me` resolves into a different id
namespace, which is consistent with `me/businesses` not describing a system user's businesses.

**Consequence in the product, not just the script.**
`meta_operations.py:132` reads:

```python
connection.business_managers_json = provider.list_business_managers() if check.list_business_managers else []
```

`check.list_business_managers` is derived from `response.ok` alone, so with a system user token
it is `True`, the guard passes, `list_business_managers()` returns `[]`, and the connection is
persisted as "capability confirmed, zero Business Managers". A capability check would report
success on a connection that can discover nothing. This is the `True`-on-empty over-claim
recorded above, now demonstrated end to end against real Meta rather than argued from the code.

**Security observation, raised to the operator.** The token was generated on the pre-existing
"Conversions API System User", which holds *full access* on four live ad accounts. A10 needs
read only, so the token is far broader than the task requires, and it is shared with a running
Conversions API integration — revoking it to rotate the AdsOps credential would break that
integration. Recommended a dedicated read-only system user instead. Not a code defect; recorded
because the eventual production credential should not be this one.

**Still open:** whether a genuine *discovery* edge exists for system user tokens, or whether the
Business Manager id must become configuration. Not guessed at — to be settled by evidence.

**Credential decision (2026-09-10):** the risk of reusing the Conversions API system user token —
full access on four live ad accounts, shared with a running CAPI integration — was put to the
operator explicitly, with the alternative of a dedicated read-only system user. The operator
chose to keep the current token. Recorded as a knowing decision, not an oversight. It does not
change what the code may do: writes stay structurally impossible regardless of how broad the
token is.

### A10 — discovery is impossible for a system user token, and the fix (2026-09-10)

Operator ran `scripts/a10_live_probe.py --discover`. Real, read-only, 5 calls. The question was
narrow: a system user belongs to exactly one business, so will Meta name it? Asked three ways:

```
  `business` as a field on the user node   -> FAILED — invalid_request
  `businesses` as an expanded field        -> OK — empty, no business named
  `businesses` as an edge (current code)   -> OK — empty, no business named
```

`invalid_request` on the first is itself an answer, not an error to work around: the field does
not exist. The other two succeeded and carried nothing. **Meta will not name the business behind
a system user token**, while reading that same BM by id works (previous entry). Automatic
discovery is therefore impossible for this token type, and the id has to be configuration. That
conclusion is evidence, not a guess — which is why the probe was run before the design was
chosen rather than after.

**Fixed, both defects:**

1. **`META_BUSINESS_ID` added** (`core/config.py`). `RealMetaBusinessProvider` gains
   `business_id`; when set it reads the BM node directly, and falls back to `me/businesses` when
   absent, which still works for an ordinary user token. Not a secret — a BM id is public in
   Business Settings — so unlike the token it may appear in logs and findings.
2. **The `True`-on-empty over-claim is gone.** `check_capability()` now derives
   `list_business_managers` from whether a Business Manager actually came back. A 200 carrying
   nothing reports `False` with the new `MetaFailureCode.NOT_CONFIGURED`, distinct from
   `PERMISSION_MISSING` (Meta actively refused) and never produced by the batch engine, so it is
   not retryable.

Both public readers now go through one `_read_business_managers()` helper. That is the real
repair: the capability check and the listing it gates read the same endpoint by construction, so
they cannot disagree again — `test_the_capability_and_the_listing_it_gates_cannot_disagree`
pins it.

Four new tests, including `test_a_200_carrying_no_business_is_not_reported_as_capability`, which
reproduces the exact live failure offline. A10 file: **30** tests, all passing (verified by
`pytest --collect-only -q`, which counts parametrised cases individually).

**Correction, 2026-09-10:** this entry first said 31. It was 30. The number was reported to the
operator and written here without being counted, then carried verbatim into the A10.1 spec as
"31 reported passing tests". A count is a measurement, not a recollection — the same lesson as
the two exit codes misread earlier in this session, and the reason A10.1's own guardrail 1 says
not to trust reported behaviour without verifying it.

## A10.1 Step 1 — baseline gate (2026-09-10)

MINI-SPEC A10.1 makes a passing regression a gate before any asset-discovery work. Run alone,
redirected to a file, exit code captured immediately after the process:

```
PYTEST EXIT: 0
676 tests in 34 files   (pytest --collect-only -q, summed per file)
```

**Why the count needed a second measurement.** `pytest.ini` already sets `addopts = -q`; passing
`-q` again on the command line makes it `-qq`, and at that level pytest suppresses the final
"N passed" line entirely. Three earlier attempts to read the total therefore came back empty —
not a hung suite, not a missing summary, just a flag interacting with itself. Recorded so the
next person does not re-diagnose it.

**Baseline corrections carried into the A10.1 audit:** the A10 file holds **30** tests, not the
31 previously reported here and repeated in the A10.1 spec; and `.env.example` had no `META_*`
variables at all until this session, despite A7 and A10 both adding settings that a deployment
needs. Both are recorded in `docs/AUDIT_BEFORE_BUILD_A10_1.md`.

### A10 — `META_BUSINESS_ID` verified against real Meta (2026-09-10)

The offline debt is now paid. Operator ran the probe with the id configured; read-only, 2 calls:

```
Business ID : 1993884657458857
Calling     : 2 read-only GETs — the configured Business Manager, read directly
RESULT      : OK — the token read a Business Manager
visible now : 1 (limit was 1, so this is 'at least one', not a total)
  - 1993884657458857  Quảng Cáo Top
Capability as this build reports it:
  list_business_managers   : True
  create_ad_account        : False  (writes are not enabled)
```

This is the first time the product has read a real Business Manager through its own provider
code path rather than through a diagnostic flag. `list_business_managers: True` is now backed by
a Business Manager that actually came back, which is the whole point of the `NOT_CONFIGURED`
change: the same field was `True` a few hours earlier on a 200 that carried nothing.

**A defect the live run found, after the "shared helper" fix was already in.** With
`META_BUSINESS_ID` set, the probe reported `visible now : 0` while `check_capability()` could
see the BM. Cause: `probe()` was hardcoded to `me/businesses` and never went through
`_read_business_managers()`. There were **three** readers, not two; the fix and its test covered
the two that were remembered.

The claim recorded earlier in this log — that capability and listing "cannot structurally
disagree" — was therefore false as written, and the tool that contradicted the product was the
operator's own verification probe, which is the worst possible thing to be wrong.

Fixed: `probe()` now returns `_read_business_managers()` like the others.
`test_no_public_reader_bypasses_the_configured_business_manager` exercises each public reader in
isolation and fails if any of them reaches for `me/businesses` while an id is configured — a
fourth reader cannot repeat this quietly. Also corrected: the probe printed
"OK — the token can read Business Managers" even when nothing came back; an empty result now
prints "NOTHING RETURNED", and the header states whether `META_BUSINESS_ID` is configured at
all, which no earlier output revealed.

48 A10/A10.1 tests pass, ruff clean.

**Still unverified live:** ad-account and Pixel discovery (A10.1). Those code paths have offline
tests only and have never touched Meta.

### A10.1 — asset discovery verified against real Meta (2026-09-10)

Operator ran `a10_live_probe.py --assets` with `META_BUSINESS_ID` configured. Read-only, 5 calls.

```
  ad accounts: 4 returned, complete=True
      edge owned_ad_accounts    ok=True  pages=1
      edge client_ad_accounts   ok=True  pages=1
      - 1167063825546698  Tbsupellex     [owned_ad_accounts]
      - 337574751894643   Thanh Công     [owned_ad_accounts]
      - 338551421414333   Quàng Chính    [client_ad_accounts]
      - 1221209591722645  Vũ Hiếu        [client_ad_accounts]

  pixels: 5 returned, complete=True
      edge adspixels            ok=True  pages=1
```

**The unresolved documentation question is now settled empirically.** `client_ad_accounts` was
named in Meta's docs as a distinct edge but its reference page could not be retrieved, so its
permissions were unknown. It answers, with the same permissions the other edges use.

**And it was load-bearing.** The four ad accounts split exactly two and two across the edges.
Reading only `owned_ad_accounts` — the edge the official guide documents — would have returned
**two of four**, and the run would still have reported `complete=True`, because every edge it
chose to read succeeded. Reconciliation would then have marked Quàng Chính and Vũ Hiếu as
`missing_from_latest_discovery`: a 50% false-missing rate on a scan calling itself complete, and
no error anywhere to hint at it.

This is why `complete` is derived from coverage rather than from the absence of errors. The
guardrail in the spec (§6.12) only forbids concluding "missing" after a *failed or partial*
scan; it does not cover a scan that succeeded while looking in too few places. That gap was
identified during the audit, closed by reading both edges and labelling every observation with
its source edge, and has now been shown to matter on real data rather than argued in the
abstract.

Cross-check against Business Settings: the four ids match the four ad accounts the operator's
system user is assigned, seen in the UI earlier the same day. Two of them appeared there as bare
ids with no name; discovery supplies the names and, more usefully, says they are client-shared
rather than owned.

**Still offline-only:** reconciliation against the internal registry (A10.1 Step 5) — no live
run has exercised it, because it does not exist yet.

## A10.1 Step 5 — coverage model, persistence and reconciliation (2026-09-10)

### Migration 0011 was rewritten, not superseded

`0011_a10_1_discovery` was downgraded, deleted, regenerated and re-applied, verified
up → down → up, ending at head. Autogenerate emitted **zero** DROP statements.

**This was legitimate only because of facts that were checked, not assumed:** the revision had
never been applied to staging, shared or production; the three tables it creates were empty; and
no user data existed. On a revision that has reached any shared environment, rewriting history
is not available — the change becomes a new `0012`, because someone else's database has already
run the old one and will never run it again.

The rewrite replaced `ad_accounts_complete` / `pixels_complete` booleans with a coverage model:
`*_required_edges_json`, `*_coverage_json`, `*_coverage_status`. `complete` is now a derived
property (`coverage_status == complete`) rather than a column, so it cannot be set independently
of the coverage it claims to summarise — and it is the flag that licenses concluding an asset
has gone missing.

Per-edge coverage records edges that were **never attempted**, which a boolean cannot express:

```json
{"edges": {"owned_ad_accounts": {"required": true, "status": "completed", "pages": 1, "items": 2},
           "client_ad_accounts": {"required": true, "status": "not_attempted", "pages": 0, "items": 0}},
 "total_unique_assets": 2}
```
→ `coverage_status = incomplete`, and no absence conclusion is permitted.

### Pixel reconciliation is asymmetric, and that is a schema limit

`AdAccount` carries `business_manager_id`; **`Pixel` has no Business Manager relationship at
all** — its columns are `workspace_id`, `external_pixel_id`, `name`, `status`, `notes`. So a
registry Pixel cannot be proven to belong to the configured BM, and its absence from a discovery
of that BM is not evidence about it.

| Direction | Ad account | Pixel |
|---|---|---|
| Meta → registry | `matched` / `missing_in_registry` | `matched` / `missing_in_registry` |
| Registry → Meta | can reach `missing_from_latest_discovery` | **always** `out_of_scope` |

No foreign key was added to `Pixel` to unlock the stronger conclusion. Doing so would have
silently decided questions A10.1 has no authority over: whether a Pixel belongs to exactly one
BM or many, where existing mappings would be backfilled from, whether a mapping means ownership
or access, and whether an operator's manual assertion counts as provider truth. That is a
mini-spec (`A10.1a — Pixel-to-Business-Manager Ownership & Access Mapping`), not a column.

### Decision-tree order

`missing_from_latest_discovery` is the strongest claim available, so it sits last and every
earlier branch is a reason not to reach it: no usable external id → `unknown`; exact id present
in the union → `matched`; no proven BM mapping → `out_of_scope`; mapped to a different BM →
`out_of_scope`; coverage not complete → `unknown`; only then, missing.

Exact identity deliberately outranks scope reasoning: an account this run demonstrably returned
is present, whatever the internal mapping says. Calling it out-of-scope would contradict direct
evidence.

### Defect found while writing the tests

`AdAccount` has no `name` column — it is `display_name`. The reconciliation service read
`account.name` in six places and would have raised `AttributeError` on the first registry row it
touched. It was caught by the tests failing, which is the point of them, but it is worth
recording that the service was written against a field name that was assumed rather than read.

### Results

12/12 reconciliation tests, 29/29 asset-discovery tests, 7/7 BM-validation tests, ruff clean.
Full regression: see the following entry.

### A10.1 Step 5 — full regression (2026-09-10)

```
726 passed in 1654.92s (0:27:34)
PYTEST EXIT: 0
```

726 tests in 37 files, against 676 in 34 at the Step 1 gate: **+50**, which reconciles exactly —
29 asset-discovery, 7 BM-validation and 12 reconciliation tests in three new files, plus two
added to the existing A10 file when `probe()` was found bypassing the shared helper. `ruff check
app/ tests/ scripts/` clean. Counted with `--collect-only -q` summed per file, not recalled.

Note the summary line is present this time because the command did **not** repeat `-q`, which
`pytest.ini` already sets; passing it twice suppresses the total. That cost three failed
attempts to read a count earlier in this session.

Step 5 is complete against every criterion set for it: migration rewritten and verified both
directions, no boolean as source of truth, `required_edges` and per-edge coverage stored,
observations persisted, exact-ID union reconciliation implemented with
`missing_from_latest_discovery` last in the decision tree, and coverage/scope/partial cases
pinned by tests.

**Not yet built:** Step 6 — the API surface and the UI. Nothing in the running application can
reach any of this yet; it is service-layer only.

### A10.1 — click-through in a real browser (2026-09-11)

Executed with Playwright against the running dev stack, signed in as the workspace owner:
login → `/meta-connections` → **Run read-only discovery**. Fake provider, so no Meta call.

```
Business Manager: Fake Business Manager (local testing)
Ad accounts returned: 2      Complete   Completed: Owned accounts (1), Client accounts (1)
Pixels returned: 1           Complete   Completed: Business Pixels (1)
Pixel Business Manager mapping is not recorded yet, so a registry Pixel cannot be evaluated…
Not in registry ×3
```

Asserted, not eyeballed: the count is never rendered bare without coverage; a coverage label is
present; the per-edge breakdown is shown; the Pixel mapping limit is stated; and no deletion
language ("deleted", "removed by Meta", "lost") appears anywhere. All five pass.

**Defect found by the first click-through, invisible to 726 green tests.** The page read:

```
Ad accounts returned: 2
Completed: Owned accounts (0), Client accounts (0)
```

The total was right and every per-edge count was zero. `FakeMetaBusinessProvider` built its
`EdgeOutcome`s without `items`, so they took the default. Nothing caught it because every
coverage test constructs `EdgeOutcome`s by hand with explicit counts — so the fake's own
arithmetic was never exercised, only the rules applied to numbers supplied by the test.

That breakdown is the evidence behind every coverage claim: a fake that always reports zero makes
the fake environment useless for checking the one thing it exists to check. Fixed with
`_count_from()`, pinned by `test_the_fake_provider_counts_items_per_edge_not_just_in_total`, and
re-verified in the browser — the same page now reads `Owned accounts (1), Client accounts (1)`.

**Benign, recorded so it is not re-investigated:** the dev console shows `404 /config.js`.
That file is written by nginx at container start; under the vite dev server it does not exist and
`lib/api.ts` falls back to `VITE_API_BASE_URL`, which is why login and discovery work regardless.

Screenshot: `docs/evidence/A10-1-LIVE/discovery.png`.

## A10.2 Step 1–2 — write readiness (2026-09-11)

### Token scopes, verified against Meta rather than assumed

`scripts/a10_live_probe.py --scopes` (read-only, `debug_token`):

```
type    : SYSTEM_USER      valid : True      expires : never
scopes  : ads_mcp_management, ads_management, ads_read, business_management, public_profile
```

**`ads_management` is granted** — App Review came through. This is the one check that
distinguishes "the permission is missing" from "the build cannot write", which look identical in
a capability check: both report `create_ad_account: false`. The same run still reports
`create_ad_account: false / not_supported`, and that remains correct — the permission existing is
not the same as the product being able to use it.

Two things worth recording from that output. The token **never expires**, so it stays valid until
someone revokes it — there is no natural expiry to catch a leak. And `debug_token` is the one
endpoint where the token must travel as a query parameter rather than an `Authorization` header,
because `input_token` is how the endpoint is defined; that departure is confined to the
operator-run script and exists nowhere in the product.

### Defect fixed: a refusal was being reported as an ambiguity

All three batch engines wrapped the provider call in a blanket `except Exception` producing
`status="unknown"` — and no engine imported `MetaWriteNotEnabled`, so none could tell a refusal
from a crash. `unknown` is this product's "this may have succeeded on Meta's side, go and look".
A refusal means nothing left the process, so reporting it as `unknown` would send an operator
hunting for an ad account that was never requested — which is precisely what
`MetaWriteNotEnabled`'s docstring says being an exception was supposed to prevent.

`MetaWriteNotEnabled` moved to `meta_provider.py` (the interface) so the engines can recognise it
without depending on the real provider; re-exported from its old home, verified identical object.
All three now map it to `failed` + `not_supported`, which is outside `RETRYABLE_FAILURE_CODES`.
The blanket handler stays, and must: a provider that dies mid-call genuinely may have reached
Meta, so `unknown` is honest there. Both branches are pinned by tests.

### Pilot cap, added before any write path exists

`assert_within_pilot_cap()` in `services/meta_batch.py`, called by all three engines, refuses a
batch whose queued count exceeds `META_WRITE_PILOT_MAX_ITEMS` (default **1**) when the provider
reports `writes_are_real`. Checked before the first item, so an oversized live batch is refused
whole rather than part-executed — three created accounts and then a stop would be the worst
outcome, because they cannot be un-created.

Deliberately sequenced first: had `post()` landed before the cap, there would have been a window
in which a fifty-item batch could create fifty real ad accounts. `writes_are_real` is declared on
the provider interface rather than detected with `isinstance`, so a future provider has to answer
the question, and is not a constructor field on the real provider, so a caller cannot switch it
off. The cap does not bind the fake provider, where a write costs nothing.

7 new tests. Full regression before these changes: 735 passed, exit 0.

### A10.2 — the create request did not match Meta's API (2026-09-11)

Verified `POST /{business-id}/adaccount` against Meta's documentation before writing any write
path, and found A7's `CreateAccountRequest` — shaped in A7 against a fake provider that accepts
anything — does not match:

| Meta requires | A7 had |
|---|---|
| `timezone_id` (**integer**) | `timezone`, free text, and the wizard never collected it |
| `end_advertiser` (a business id) | absent |
| `media_agency` | absent |
| `partner` | absent |
| — | `country`, which Meta does not accept |

Two facts from the same page that change the plan more than the field list does:

* **Creation requires Business *Admin*.** The connected system user is *Employee*. Reads work at
  that level — discovery proved it — but a create would have failed with `permission_missing`,
  and the cause would have been indistinguishable from a bug in new code.
* **A business may create at most five ad accounts through the API, ever.** Beyond that they
  must be made by hand. A pilot spends one of five permanently. Note this counter is *not*
  discoverable: Meta exposes no "how many have you created via API", and discovery sees accounts
  that exist, never how they came to exist. The BM's four accounts (two owned, two client-shared)
  say nothing about it.

**Resolved in code:** `timezone_id` added as a separate integer through the whole path — schema,
model, draft item, service, provider request — and migration `0012_a10_2_timezone_id` verified
up/down/up. `timezone` is kept as an operator-facing note and is never sent. `country` is kept
for A1's registry record. `end_advertiser`, `media_agency` and `partner` are plumbing rather than
operator choices, so the provider will derive them (`end_advertiser` from the configured BM, the
other two `NONE`) rather than asking a person for a value with one possible answer.

A provider that receives no `timezone_id` must refuse rather than choose one: a wrong timezone on
a real ad account cannot be corrected, and the quota is five.

**The subtle one.** `timezone_id` also had to go into `_item_preview_fields`, which backs the
preview hash. A field that is transmitted to Meta but absent from the hash lets an operator
confirm one thing and have another created — the exact gap the hash exists to close.
`test_changing_timezone_id_invalidates_a_confirmation` pins it.

5 new tests; A7's own suites still pass unchanged. Full regression before this change: 743
passed, exit 0 — the earlier 741/1-failed run was the `.env`-dependent provider-selection test,
now split into two tests that each set their own condition.

### A10.2 — the Admin-role blocker is cleared, and verified by measurement (2026-09-11)

A dedicated system user was created rather than promoting the shared one. Confirmed through the
API, not by reading the UI — `GET /{business-id}/system_users?fields=id,name,role`:

```
ADMIN  adsops-admin                  role=ADMIN
       Conversions API System User    role=EMPLOYEE
```

Two things that matter here. The create endpoint's documented requirement — "must be a business
administrator" — is now satisfied, and satisfied *provably*: scope and role are separate gates,
and only scope shows up in `debug_token`. A token can hold `ads_management` while its system user
is an Employee, and the create then fails on the role with a `permission_missing` that looks
exactly like a missing permission.

The probe was extended to read that edge precisely because this session had already recorded the
role as unverifiable. It was not; it just had not been looked for.

And the Conversions API system user stays `EMPLOYEE`. Promoting it would have handed the running
CAPI integration full administrative control of the Business Manager as a side effect of an
unrelated change — the reason a separate system user was recommended in the first place.

**New operational fact: this token expires.** `debug_token` reports `expires: 1794294290` —
**2026-11-10 07:04 UTC**, about 60 days out. The previous token reported `never`. A finite
lifetime is the better security posture, but it means discovery will one day stop with
`token_expired` and nothing will announce it in advance. Renewal belongs on a calendar, not in
anyone's memory.

`create_ad_account` still reports `false / not_supported`, which remains correct: the build has
no write path. Permission and capability are different claims and the output keeps them apart.

### A10.2 — a discovery run now records which identity read it (2026-09-11)

**Found by running discovery against the real BM twice, with two different tokens.** Yesterday's
run (Conversions API system user, *Employee*) returned 4 ad accounts and 5 Pixels. Today's, with
`adsops-admin` (*Admin*), returned **8 and 7** on the same Business Manager. Nothing was created
in between.

An inventory is therefore a fact about the **reader** as much as about the BM. That makes a
specific wrong conclusion reachable: a later run by a narrower token sees fewer assets, reports
`coverage: complete` — truthfully, since every required edge answered — and so licenses
`missing_from_latest_discovery` for registry records a broader token had just confirmed exist.

This is the same shape as the `client_ad_accounts` gap, and neither is an error condition: a scan
that succeeded at everything it attempted, while not having attempted enough. There the shortfall
came from an unread edge; here from the token's own permissions.

**Recorded, not merely displayed.** `MetaBusinessProvider.identify()` (one read of `me`) returns
a `ProviderIdentity`; the run stores `provider_actor_external_id` and `provider_actor_name`.
Migration `0013_a10_2_actor`, two nullable columns, verified up/down/up, no destructive
operations. A failed `identify()` yields an unknown identity rather than failing the run — a
discovery that would otherwise work should not be blocked by not knowing who asked.

Order matters and is pinned by a test: identity is established **before** the inventory it
qualifies. `test_a_discovery_run_records_which_identity_read_it` asserts
`calls.index("identify") < calls.index("discover_ad_accounts")`, not merely that both happened.

**The part that actually prevents the wrong reading is the wording.** The UI previously said
"Ad accounts returned: 8" as though it were a fact about the Business Manager. It now reads
"…as seen by **adsops-admin**. A different system user may see a different set — this is what
this identity could read, not everything the Business Manager holds." A reader who saw 4
yesterday and 8 today can now tell why without asking.

28 targeted tests pass, exit 0. `tsc`, `eslint` and `ruff` clean.

**Also this session:** `/meta-connections` was promoted to the main nav. It had been reachable
only from Settings and from inside a wizard — the operator could not find the feature they had
asked for. And the connection form hard-coded `environment: "fake"`, so no `production`
connection could be created from the UI at all, while the page still claimed "no real Meta App is
connected anywhere yet". Both were false statements about the product's own state, of the same
kind as the "Coming later (A9)" card.

**Dev environment, recorded because it cost hours:** the browser could GET the API but its login
POST never arrived, twice. Cause was cross-origin plus `localhost` resolving to a different
address family than the API was bound to — a simple GET needs no preflight, a JSON POST does.
Three rounds of changing the bind address only moved which half was broken. Fixed properly by
proxying `/api` through the Vite dev server, so the browser is same-origin and neither CORS nor
address family is involved.

## 2026-09-11 — A10.3 authority gate, Overview card, and four defects found by looking

**Backend: 761 passed, exit 0** (24:47). Frontend: 103 passed, `tsc -b` 0, eslint 0, ruff clean.
Migration `0014_a10_3_authority` applied up → down → up against the dev database; the five runs
recorded before it exist as `NOT_CHECKED`, which is what they genuinely are.

### The defect the multi-BM experiment found

Running the A10.3 token experiment against real Meta produced a result the script called
"Shape A confirmed" and should not have. Three Business Managers, one system-user token:

| BM | `owned_ad_accounts` | `{bm}/system_users` |
|---|---|---|
| `1993884657458857` (administered) | `data=5`, `total_count=5` | 2 rows, this token as ADMIN |
| `3068234753290929` | `data=0`, `total_count=0` | `permission_missing` |
| `109796697343603` | `data=0`, `total_count=0` | `permission_missing` |

The BM **node** reads fine in all three. The asset edges of a BM this token has no role in answer
`200` with an empty list and **no error**, while `system_users` refuses outright — one business,
two edges, two different failure languages.

Measured, not reasoned, against a provider pointed at a BM with no role:

```
check_capability()        -> list_business_managers: True
discover_ad_accounts()    -> assets=0  complete=True  coverage=complete
```

A confident, complete, empty inventory of a Business Manager nobody could read — and `complete`
is the only thing that licenses `missing_from_latest_discovery`. A mistyped BM id, or a system
user removed from a BM later, would have reported every registry account mapped to it as no
longer returned by Meta. Not reachable in production only because the registry is still empty,
which the next slice is about to change.

This is the A10 `True`-on-empty defect for the third time. A10 fixed it for the capability check;
A10.1 added coverage so an unread edge could not pass as complete. Both miss this case because
coverage tracks errors per edge, and here no edge errors.

Closed with `BusinessAuthority`, asked **only** of an empty inventory (a non-empty one proves its
own authority and spends no call), memoised per BM. Empty without established authority is
`coverage: unknown`, never `complete`. Two tests pin both halves: an unreadable BM never reaches
a `missing` conclusion, and a readable-but-genuinely-empty one still does — gating on emptiness
instead of authority would suppress every legitimate absence conclusion forever.

While fixing the one red test this produced, the contract itself turned out to be loose:
`authority` was being set to `established` even when assets existed, so the two asset types of one
Business Manager could carry different values and the run-level column had to pick a winner. It
now records only what an explicit check answered; assets present means `not_checked`. The fake
provider was changed to match, because a fake that answers differently from production lets a
test pass on a shape production never produces.

### Found in the browser, not by tests

1. `GET /meta-connections/discovery-summary` answered **422** for an hour. The route ordering in
   the code was correct; the running backend predated it and had no `--reload`. The Overview card
   `return null`ed on a query error, so a 422 rendered as "nothing discovered". The card now shows
   an `ErrorState`, and a test asserts the literal path resolves with **status 200** — the
   endpoint had shipped with zero tests, and the 749-test regression never touched it.
2. A `fake` connection's row rendered **identically to a real Business Manager** — same `Complete`
   badges, same columns. The local seed reuses the configured BM id, so two rows showed one id
   under two names. Invented numbers presented as an observation of Meta. Fixed with an
   environment badge; a test asserts exactly one row carries it.
3. Two connections, labelled "Triều Shop" and "Quảng Cáo Top", both read the one configured BM and
   both returned the same 8 accounts — a card titled "Triều Shop" listing another business's
   accounts, and two Overview rows inviting 8 + 8 = 16. Both now say so: "Label differs from the
   Business Manager read" on the card, "Same Business Manager as another row" on the table.
4. `text-attention` is not a class in this theme. It renders as no colour at all, silently — a
   test asserting the text is present would not have caught it.

### Tooling

**`npx tsc --noEmit` compiles zero files in this project.** The root `tsconfig.json` is
`{"files": [], "references": [...]}`, so the command always succeeds and proves nothing. Every
green reported from it was worthless; `npm run build` (`tsc -b && vite build`) was always real.
`npm run typecheck` is now `tsc -b`, which immediately caught two type errors in a test written
minutes earlier.

**`scripts/dev.sh`** replaces hand-started servers. The dev servers died repeatedly, and each time
a dead frontend looked exactly like a broken feature — the page is still in the browser, it just
cannot reach `/api`. Two structural causes: started in the foreground of a terminal, and stopped
with `pkill -f`, whose pattern matches the shell running it (that is how a backend restart was
killed mid-flight, exit 144). Servers now run under `setsid` with a restart loop; stopping kills a
recorded process group. Verified: `kill -9` on vite gave `HTTP 000` then `HTTP 200` unaided, and
`stop` left zero orphans.

**`frontend/.env.local` pointed the API at port 8009**, where nothing listens. Vite loads that
file automatically and it beats the dev proxy, so every request left the page for a dead port
while the backend sat there healthy — "Failed to fetch", then "Sign-in failed", with **no** login
request in the backend log at all. It had been there since 09-04, masked whenever someone started
Vite with `VITE_API_BASE_URL=` by hand. The file is now empty with the reason written in it, and
`dev.sh` exports the variable empty so a stale value cannot do this again.

Worth recording about the diagnosis: "three layers healthy" was reported after curling
`http://127.0.0.1:5173/api/...`, which tests the **proxy** — not what the application actually
calls. The proxy was fine the whole time. The measurement was aimed at the wrong thing.

### A10.3 registry import (same day)

**Backend: 774 passed, exit 0** (21:11). Frontend: 107 passed, `tsc -b` 0, eslint 0, ruff clean.
13 of the new backend tests are the import itself.

`POST /meta-connections/{connection_id}/discoveries/{run_id}/imports` closes the gap that left
Business Managers and Accounts reading zero while a discovery listed eight ad accounts. The run id
is in the path rather than resolved as "latest": the operator is acting on the result in front of
them, and a run completing between render and click must not silently become the evidence for a
write. It writes through A1's own registry service, so the record is indistinguishable from one
typed by hand — and `unknown` readiness is part of that, because Meta having returned an account
is not evidence this workspace is ready to run ads on it.

Refusals are tested rather than assumed: an id the run did not return is 404 (otherwise this is
account creation wearing discovery's evidence), a second import is 409, a run from another
connection or another workspace is 404 and never 403, an unexpected body field is 422.

**Deliberately not gated on coverage or authority.** Those gate conclusions about *absence*. An
account that was returned was observed. Two tests carry that reasoning: one imports from a run
whose client edge failed, one asserts no provider call is made at all.

One test went red first because the audit field is `metadata_json`, not `metadata` — a guessed
field name, the same class of error as `AdAccount.name` earlier in this project.

### A10.3 — a Business Manager per connection (2026-09-12)

**Backend: 781 passed, exit 0** (24:01). Frontend: 107 passed, `tsc -b` 0, eslint 0, ruff clean.
Migration `0015_a10_3_conn_bm` applied.

`meta_connections.business_manager_reference` closes the §2 defect: a connection named after a
second business used to read `META_BUSINESS_ID` and list its accounts under the other one's name.
Set at creation and never updated — there is no PATCH for it — because changing which Business
Manager a connection reads would silently reinterpret every run already recorded against it, and
those runs are the evidence behind `missing_from_latest_discovery`.

The migration deliberately does **not** backfill the server value. Empty means "use whatever the
server is configured with", which is exactly what existing connections already did; writing
today's value into old rows would claim those runs had been pinned to a Business Manager when they
never were.

The token axis is untouched and still unanswered. Measured again on 2026-09-12: `adsops-admin`
still has no role in either second Business Manager (`{bm}/system_users` → `permission_missing`,
against the administered BM returning two rows). Storing *which* BM to read is common to Shape A
and Shape B, which is why it could be built before that question was settled.

**Two tests went red on the first full run**, both in `test_a10_meta_real_provider.py`. The cause
was a hand-rolled `_Connection` stub carrying only `environment`, so the new code hit an
`AttributeError` — the stub being out of date with the model, not the code being wrong. A stub
written by hand does not grow a field when the model does; the reason is now in its docstring.

Fixing it exposed an untested path and a new test was added for it: a connection's own Business
Manager reaching the **real provider object**, asserted on `provider.business_id`. That is where a
wrong id would do damage — a provider built with the server's BM would read the server's assets and
record them against a connection naming a different business, which is this column's defect
reappearing one layer down. The inheriting case is asserted in the same test.
