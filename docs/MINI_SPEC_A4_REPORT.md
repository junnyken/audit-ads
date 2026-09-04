# MINI-SPEC A4 Report — Deployment Readiness, Controlled Telegram Test Send & VPS Observability

Date: 2026-09-05 · Status: **Stage A complete. Stage B not started.**
Baseline audited: `974af31` (A3) on `a4b7881` (A2) on `1692462` (A1)

## 1. Summary

**Stage A artifacts completed.** AdsOps Control Center now has a versioned production Compose
stack with explicit immutable image tags, resource bounds and hardened containers; startup
validation that refuses to boot an unsafely configured production process; verified backup,
isolated restore drill, explicit migration release and application rollback tooling; a
resource-bounded dispatcher container that finally drains the A3 outbox on a schedule and
records every pass; a System Status page covering release, database, dispatcher, backup, host
resources, configuration findings and run history; a controlled Telegram test-send flow behind
four independent gates; and six operational documents.

**Stage B actions: explicitly NOT executed.** Nothing was deployed to any target — no
`docker compose up` against a VPS, no Coolify or Vibe Host action, no DNS, firewall or proxy
change. **No real Telegram message was sent**; no bot token exists in this repository or its
environment, the transport stayed `disabled` or `fake`, and `ALLOW_TEST_SEND` stayed `false`.
Both actions need their own separate approval, and the target is not yet resolved (§2).

**What A4 intentionally did not add:** any advertising-platform automation or enforcement
bypass; browser automation, antidetect, proxy or credential handling; Telegram commands or
bot-driven actions; a new health, alert or notification engine; automatic real dispatch after a
deployment; a scripted production restore or automatic schema downgrade; a Docker socket mount;
a monitoring stack; CI/CD; and any auth/RBAC redesign.

## 2. Audit Before Build

**Verified A1/A2/A3 baseline (measured, not trusted):** 111 routes, methods `{GET, PATCH, POST}`,
**zero DELETE**, 24 ORM tables, three migrations, and no Celery, Redis, scheduler, bot command,
browser automation or real Telegram delivery anywhere. Outbox, lease, retry, quiet hours,
nested savepoints and server-side token handling all confirmed in code. **Every figure the A4
brief quotes is accurate; no deviation from the A3 report was found** — the brief's "24 tables"
and the A3 report's "25 tables" are the same schema counted with and without `alembic_version`.

**Exact files/docs inspected:** the playbook, `CLAUDE.md`, `README.md`, `FEATURES.md`,
`ARCH.md`, `API.md`, `TEST_LOG.md`, all three prior audits and reports, `HEALTH_RULES_V1.md`,
`ALERT_POLICY_V1.md`; `docker-compose.yml`, both Dockerfiles, `frontend/nginx.conf`,
`.dockerignore`, `.env.example`, `.gitignore`, `alembic.ini`, all three migrations, `pytest.ini`;
`main.py`, `bootstrap.py`, `core/config.py`, `core/logging.py`, `core/redaction.py`,
`api/middleware.py`, `api/deps.py`, `routers/system.py`, `routers/alerts.py`, the four
notification services, `quiet_hours.py`, `notification_templates.py`, every command, `conftest.py`
and all 283 tests; and on the frontend `App.tsx`, `AppShell.tsx`, `SystemStatus.tsx`,
`Settings.tsx` and the four presentation maps. **No script, Makefile, proxy template, backup
tooling, rollback tooling, CI config or runbook existed before A4.**

**Regression baseline results:** 283 backend, 52 frontend hermetic, 16 live-API, ruff, eslint,
tsc and the production build — all green before a line of A4 was written. Required scans all
clean (§`docs/AUDIT_BEFORE_BUILD_A4.md` §1).

**Target environment audit — INCOMPLETE, and reported as such.** This workspace is **not** the
VPS in the brief: 12 vCPU / 62 GB (not 4/8), filesystem **89% full**, `systemd` not running, **no
crontab**, nothing on 80/443, no reverse proxy, and `audit-ads` has **no git remote**. Domain,
TLS method, database location, backup destination and firewall state are unresolved. A
workspace limitation also surfaced: this Docker-in-Docker cgroup is `domain threaded` and
**cannot apply any resource limit**, so the overlay's CPU/memory limits are validated by
`compose config` but were not exercised at runtime.

**Confirmed A4 gaps** (full table in the audit): G1 migrate-on-start (deployment); G2 no image
tags (deployment); G3 no prod/dev separation or hardening (deployment); G4 no TLS layer, CSP or
body limits (deployment, security); G5 public API docs (security); G6 no production config
validation (security, architecture); G7 no backup/restore (deployment); G8 no migration or
rollback tooling (deployment); G9 no dispatcher scheduling (architecture); G10 no release,
backup-age, dispatcher or host observability (observability); G11 no operational run record
(data_model, observability); G12 `worker_status` a constant (observability); G13 no test-send
flow (API, state_machine); G14 no runbooks (deployment); G15 nothing blocked the pilot
credential (security); G16 no real-browser UAT (testing); G17 no CI (deployment, follow-up).

**Deployment target resolution:** unresolved. `docs/AUDIT_BEFORE_BUILD_A4.md` §6 lists every
value an operator must supply — host, method, git remote, domain, TLS method, ports, database
location, backup destination and the Telegram test chat — alongside what A4 already resolved
(release identifier, migration command, service list, rollback command, dispatcher state).

**Out-of-scope findings:** still no CI runner and no rate limiting; the pytest harness still
assumes a single runner; this workspace's disk is 89% full, which is a workspace problem rather
than a product one.

## 3. Design Choice

**Production topology:** a versioned Compose overlay supporting **both** a managed platform
(Coolify / Vibe Host terminating TLS) and a self-managed VPS (optional `edge` nginx profile).
The audit could not confirm the target, and artifacts that only work on one would be guesswork.
Database, API and dispatcher have no host port; `web` binds to loopback.

**Dispatcher schedule/recovery: a dedicated bounded container** (A4 §E Option 3). systemd is not
running here, no crontab exists, and neither managed platform gives host-unit access — a
container is the only mechanism that works on every reachable target. One pass at a time, batch
10, sleep between passes, a stop signal honoured within a second, a recovery sweep every tenth
pass, and every pass recorded so a stopped dispatcher is a visible state rather than silence.

**Environment/secret strategy:** runtime injection from a file outside git (mode `0600`) or the
platform's secret store; nothing in an image layer. `.env.example` keeps names only, asserted by
a test. Startup validation refuses production boot on a missing/placeholder/short secret, a
wildcard CORS origin, `telegram` transport without a token, or a non-HTTPS public URL — and
refuses the documented pilot credential in **every** environment. Findings carry a code and a
sentence, never the value.

**Backup/restore/rollback:** `pg_dump` + gzip + SHA-256 + JSON metadata, verified by **content**
(≥20 `CREATE TABLE` plus an `alembic_version` marker) rather than size; a restore drill into an
isolated throwaway database that refuses any name matching production; an explicit migration
release that backs up first and aborts before the version switch on failure; and
application-only rollback to a previous immutable tag. A production restore is deliberately
**not** scripted, and a schema downgrade is never automatic.

**Observability:** one additive table (`operational_runs`, not workspace-scoped, allowlisted
summary), plus host CPU/memory/disk read from `/proc` and `shutil` — **never** the Docker
socket. Bands are `ok`/`warning`/`critical`/`unknown`, and `never`/`stale`/`current` stay
distinct everywhere.

**Controlled test-send safety design:** owner-only, a server-side switch off by default, an
explicit confirmation, and an approval code binding the destination, environment and message.
The request schema carries **no recipient and no message body** — structural, not a check that
could be skipped. It creates no Alert and writes no `NotificationDelivery`, so its dedupe key
sits entirely outside the alert outbox. Exactly one message per approved preview.

**Why this design:** it builds on A3's durable outbox without adding a broker; it fits a
4 vCPU / 8 GB host with every service bounded; it keeps the public attack surface to one
proxy-fronted port; it makes backup, migration, deployment and test send four separately
observable steps; and it lets an operator validate Telegram configuration without accidentally
notifying a real audience.

## 4. Changed Files

**Application/backend (new):** `app/core/production_checks.py`, `app/models/operations.py`,
`app/services/operations.py`, `app/services/test_send.py`, `app/schemas/operations.py`,
`app/api/v1/routers/operations.py`, `app/commands/run_dispatcher.py`,
`app/commands/record_operation.py`, `alembic/versions/0004_a4_operational_runs.py`.

**Application/backend (extended):** `core/config.py` (release, environment label, docs gate,
dispatcher and test-send settings), `core/enums.py` (two additive enums), `main.py` (startup
validation, docs gating), `routers/system.py` + `schemas/audit.py` (release stamp, honest
dispatcher status), `models/__init__.py`, `api/v1/__init__.py`, `pytest.ini`, `tests/conftest.py`.

**Frontend (new):** `src/lib/operations.ts`.
**Frontend (extended):** `src/lib/types.ts`, `src/pages/SystemStatus.tsx` (the A1 identity block
kept, plus release/dispatcher/backup tiles, host resources, configuration findings, run history
and the verification flow).

**Docker/Compose:** `docker-compose.production.yml` (new), `backend/Dockerfile` (no
migrate-on-start, release arg, proxy headers, no server header).

**Reverse proxy:** `deploy/nginx/edge.conf` (new), `frontend/nginx.conf` (CSP, body limit,
`server_tokens off`, COOP).

**Scripts/runbooks:** `scripts/_env.sh`, `backup.sh`, `restore_drill.sh`, `release_migrate.sh`,
`rollback.sh`; `docs/RUNBOOK_DEPLOY.md`, `RUNBOOK_ROLLBACK.md`, `RUNBOOK_BACKUP_RESTORE.md`,
`RUNBOOK_TELEGRAM_TEST_SEND.md`, `RUNBOOK_INCIDENT_RESPONSE.md`.

**Documentation:** `docs/PRODUCTION_ENVIRONMENT.md`, `docs/AUDIT_BEFORE_BUILD_A4.md`,
`docs/MINI_SPEC_A4_REPORT.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `README.md`,
`CLAUDE.md`, `.env.example`, `docker-compose.yml`.

**Tests:** `tests/test_a4_configuration.py` (21), `test_a4_operations.py` (22), `test_a4_api.py`
(18); `frontend/src/test/operations.test.ts` (8) and three A4 scenarios in `live.app.test.tsx`.

## 5. New API/Runtime/Operations State

**Production configuration validation:** `check_settings` / `enforce`. Production **refuses to
start** on a blocking finding; other environments log a warning. Findings are
`{code, severity, message}` and never contain a value.

**Health/status endpoints:** `/health/live` returns exactly `{"status":"ok"}`; `/health/ready`
reports database reachability without naming it. `/api/v1/system/status` gains
`release_version`, and `worker_status` is now derived (`running` / `stale` / `not_configured`).
`/docs`, `/redoc` and `/openapi.json` are off in production.

**New routes (6, all authenticated; four owner-only):** `GET /operations/overview`,
`GET /operations/runs`, `GET /operations/configuration`, `POST /operations/test-send/preview`,
`POST /operations/test-send/execute`, `POST /operations/test-send/reset`. Route count 111 → **117**,
still **no DELETE**, and the operations surface uses only `GET` and `POST`.

**Dispatcher runtime/schedule:** `python -m app.commands.run_dispatcher`, default 60-second
interval, batch 10, concurrency 1, recovery sweep every tenth pass, `SIGTERM`/`SIGINT` honoured
within a second. `--once` supports a timer-based target instead.

**Backup metadata/status:** `<file>.sha256` and `<file>.json` (size, table count, checksum,
database label) beside each archive, plus an `operational_runs` row so status shows backup age
without touching the filesystem.

**Deployment commands:** `scripts/release_migrate.sh`, `scripts/backup.sh`,
`scripts/restore_drill.sh`, `scripts/rollback.sh`, and
`docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`.

**Telegram test-send preview/control path:** preview → owner approval → execute with an approval
code and confirmation → exactly one message → run recorded → disarm. Refusals are explicit and
safe.

**Authorization behaviour:** unchanged for A1–A3. Run history, configuration and both test-send
endpoints are owner-only; overview is available to any member. Cross-workspace behaviour is
untouched.

## 6. Tests

| Layer | Result |
|---|---|
| A1/A2/A3 regression | **283 passed, unchanged** |
| A4 backend | 61 new (21 configuration + 22 operations + 18 API) |
| **Backend total** | **344 passed** |
| Container/Compose | Both images built; explicit tags; non-root; no secret in any layer or env var; `CMD` does not migrate; health checks present; both nginx configs pass `nginx -t` |
| Configuration/secret scan | `.env.example` holds no token-shaped value; no secret in image layers, API responses, logs or the frontend bundle; findings never echo a value |
| Migration/backup/restore | Clean migration (26 tables); upgrade path applied to a live A3 database with 14 accounts and 54 alerts intact; downgrade drops only the new table; backup verified by content and checksum; restore drill into an isolated database passed; a failed migration exits non-zero before the version switch |
| Network/security | Only `web` bound a host port, on loopback; API `/docs` 404 in production; unauthenticated API call → 401; six security headers including a full CSP; unauthenticated operations endpoints → 401; non-owner → 403 |
| Dispatcher/fake transport | Bounded loop verified running in the stack; passes recorded; `stale → current` after a pass; recovery sweep sends nothing; real transport stays disabled by default |
| Observability | Release, revision, dispatcher, backup, due/failed counters and host bands all live-verified; disk correctly reported **critical** at 88.7% |
| Manual browser UAT | **NOT DONE** — see §8 |
| Lint/typecheck/build | ruff, eslint and tsc clean; bundle 359.85 kB (100.88 kB gzip), +12.0 kB over A3 |

**Defects found and fixed:** ten, listed in `TEST_LOG.md` §9. The substantive ones: the API image
migrated on every start; API docs were public; the `edge` profile's variables were required even
when the profile was off; the backup script rejected a valid backup of a small database; `grep -q`
under `pipefail` made a good backup look corrupt; `source`-ing the env file executed a value
containing a space; backup runs were recorded in the wrong database; `worker_status` was a
constant that A4 would have made a lie; and A1's own credential guard rejected my `preview_token`
field — the guard was right, the field name was wrong, and it is now `approval_code`.

## 7. Live Verification

**Stage A local/staging verification:** the full production stack ran locally on a fresh volume
under `ENVIRONMENT=staging` with strict validation on — 0 errors, 0 warnings. The API started
**before** any migration, proving the image no longer migrates; `alembic upgrade head` then
applied four revisions as a separate step. Only `web` bound a host port, on `127.0.0.1:8099`.
Routing, security headers, 401-without-token, production owner login and pilot-credential
refusal (401) all verified, plus a controlled restart with `unless-stopped` and read-only root
filesystems. Backup and restore-drill scripts ran end to end against that stack. Torn down with
`down -v`. A separate 32-check live pass against the pilot API verified the A4 behaviour in
detail — **32/32**.

**Stage B deployment execution: NOT EXECUTED.** No target was touched.

**Backup/migration/HTTPS/health results:** not applicable to a target — none was deployed. The
staging-equivalent results are above and in `TEST_LOG.md` §5–6.

**Telegram real test send: NOT EXECUTED.** No approved target, no approved chat, no bot token.

**Exact approved target/reference:** none. Nothing was approved and nothing was executed.

**Resource observations:** API image 325 MB, web image 74 MB. Dispatcher passes complete in
~120 ms with an empty queue. Host observation on this workspace: CPU `ok`, memory `warning`,
disk `critical` (88.7% used, 55 GB free) — a real signal about a genuinely full workspace, and
the reason A4 ships a disk band rather than assuming headroom. **The compose CPU/memory limits
were not exercised at runtime**, because this Docker-in-Docker cgroup cannot apply any.

**Rollback readiness:** `scripts/rollback.sh --to <TAG>` refuses a mutable tag, restarts the
application on the previous immutable tag without touching the database, and waits for the
health check. Every migration through `0004` is additive, so an older release runs against the
newer schema; `0004` also downgrades cleanly, verified.

## 8. Remaining Limits / Follow-ups

**Intentionally excluded:** advertising-platform automation or mutation; enforcement, checkpoint
or review bypass; browser automation, fingerprinting, proxy rotation, cookie or credential
handling; Telegram commands, callbacks or bot-driven operations; bulk account operations; a new
health, alert or notification engine; a second delivery channel; automatic real dispatch after
deployment; a scripted production restore; automatic schema downgrade; a Docker socket mount; a
monitoring stack; CI/CD; auth/RBAC redesign.

**Production gaps not accepted (they block Stage B):**

1. **The deployment target is unresolved.** No git remote on this repository (Coolify and Vibe
   Host both build from one), no domain, no confirmed host, no TLS method, no backup
   destination, no approved Telegram chat. `docs/AUDIT_BEFORE_BUILD_A4.md` §6 is the checklist.
2. **No real deployment has happened**, so HTTPS, the platform proxy, certificate renewal and
   real-host resource behaviour are all unverified.
3. **No real Telegram message has ever been sent.** The transport's request shape and failure
   mapping are covered by structure and unit-level reasoning, not by a real call.
4. **Resource limits are unproven at runtime** in this workspace.
5. **No real-browser UAT.** A person has still never clicked through the app. The checklist is
   in `RUNBOOK_DEPLOY.md` §9 and A4 §10.8.
6. **Off-host backup transfer is manual**, and archives are unencrypted at rest.

**CI / rate-limit / role-management follow-ups:** still no CI (a documented follow-up by A4 §3);
still no rate limiting on authentication or the API; workspace roles exist in the data model but
have no management UI; and the pytest harness still assumes a single runner.

**Recommended next MINI-SPEC:** **Stage B of this spec first** — resolve the target with the
product owner, deploy under `RUNBOOK_DEPLOY.md`, then, as a separate approval, perform the
controlled test send under `RUNBOOK_TELEGRAM_TEST_SEND.md`. Only once operational stability is
confirmed should the next capability start; A4 §14 recommends **B1 — Chrome Context Extension**,
read-only and context-first.

**Stage B is not started, and will not start without explicit approval for each action.**
