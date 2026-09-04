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
