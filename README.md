# AdsOps Control Center

Single-operator-first operations platform for managing 30+ advertising accounts from one
dashboard instead of a wall of Chrome windows: an account registry, ownership and asset
mapping, an evidence-first readiness checklist, account events and an immutable audit trail.

**Release: MINI-SPEC A4 Stage A — Deployment Readiness, Controlled Telegram Test Send & VPS
Observability**, on top of **A3 — Alert Center & Telegram Notification Delivery**,
**A2 — Evidence-Based Account Health** and **A1 — Account Registry & Stability Readiness.**

> Nothing has been deployed, and no real Telegram message has ever been sent. A4 Stage A builds
> the artifacts, checks and runbooks for both; each needs its own explicit approval.

Separate questions, answered separately and shown side by side:

| | Question | States |
|---|---|---|
| **Readiness** (A1) | Are the required operational records documented and current? | `unknown` · `not_ready` · `ready_with_warnings` · `operationally_ready` |
| **Health** (A2) | What needs attention right now, and why? | `unknown` · `attention_needed` · `warning` · `critical` · `clear_signals` |
| **Alert** (A3) | What is waiting for you, in what workflow state? | `open` · `acknowledged` · `suppressed` · `resolved` · `expired` · `archived` |
| **Notification** (A3) | What was actually sent, and what happened to it? | `pending` · `sent` · `failed_transient` · `failed_final` · `skipped` · `cancelled` |

None implies the others. `clear_signals` means *no current issues found by configured checks* —
nothing more.

## What this product is not

It is an operations, compliance-readiness and evidence-management system. It deliberately does
**not**:

- connect to, or change anything on, an advertising platform;
- store passwords, cookies, session data, access/refresh tokens or proxy credentials — the API
  refuses those fields outright;
- run browser automation, antidetect browsers, fingerprint manipulation or proxy rotation;
- hard-delete anything, or let readiness be a numeric "risk score";
- claim an account cannot be restricted, or that an ad will be approved;
- produce a ban-risk, safety or trust score, or predict platform enforcement;
- act on a health signal automatically — every action is manual and recorded;
- offer any Telegram command that changes anything: delivery is one-way, informational only;
- store the Telegram bot token anywhere but server configuration.

Readiness is an internal operational state derived from what the operator recorded. Missing
evidence never counts as positive evidence.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| API | FastAPI, Pydantic v2, SQLAlchemy 2.0 (sync), Alembic |
| Database | PostgreSQL 16 |
| Deployment | Docker Compose (one API container, one DB, nginx for the SPA) |

No Redis and no Celery. Readiness, health and alert derivation all run inside the transaction
that changed the data — health inside a SAVEPOINT and alerts inside a nested one, so neither can
roll back the operator's actual change. Notification delivery uses a database-backed
transactional outbox with a bounded dispatcher, so a message survives a restart without a broker.
Periodic work is two commands a later phase can schedule:
`python -m app.commands.evaluate_health` and `python -m app.commands.dispatch_notifications`.

## Local setup

```bash
cp .env.example .env          # then edit: JWT_SECRET, POSTGRES_PASSWORD, BOOTSTRAP_OWNER_*

# database
docker run -d --name adsops-db \
  -e POSTGRES_USER=adsops -e POSTGRES_PASSWORD=adsops -e POSTGRES_DB=adsops \
  -p 5434:5432 postgres:16-alpine

# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export DATABASE_URL="postgresql+psycopg://adsops:adsops@localhost:5434/adsops"
export JWT_SECRET="dev-secret" BOOTSTRAP_OWNER_EMAIL="you@matbao.com" BOOTSTRAP_OWNER_PASSWORD="dev-password"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# optional: three development fixtures (complete / missing payment review / restricted)
.venv/bin/python -m app.seeds.fixtures

# optional: evaluate health for a bounded batch (the scheduler seam)
.venv/bin/python -m app.commands.evaluate_health --batch 5

# optional: work the notification outbox. NOTIFICATION_TRANSPORT defaults to "disabled";
# set it to "fake" to see rendered messages without a network call.
NOTIFICATION_TRANSPORT=fake .venv/bin/python -m app.commands.dispatch_notifications --batch 10

# A4: the same work on a schedule, as a bounded loop (this is what the dispatcher container runs)
NOTIFICATION_TRANSPORT=fake .venv/bin/python -m app.commands.run_dispatcher --once

# frontend
cd ../frontend && npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev     # http://localhost:5173
```

The first API start creates the workspace and the owner from `BOOTSTRAP_OWNER_*`. It is
idempotent — once a workspace exists, restarting changes nothing.

## Tests

```bash
cd backend
createdb adsops_test   # or: docker exec adsops-db psql -U adsops -d adsops -c "CREATE DATABASE adsops_test"
.venv/bin/python -m pytest              # 344 tests against a real PostgreSQL database
.venv/bin/ruff check .

cd ../frontend
npx vitest run                          # 60 hermetic tests
npm run build                           # tsc + production bundle
npx eslint .

# live UI verification against a running API (opt-in)
VITE_API_BASE_URL=http://127.0.0.1:8000 ADSOPS_LIVE_API=http://127.0.0.1:8000 \
ADSOPS_LIVE_EMAIL=you@matbao.com ADSOPS_LIVE_PASSWORD=dev-password \
npx vitest run src/test/live.app.test.tsx
```

The pytest session drops and rebuilds the schema with Alembic, so every run is also a
clean-database migration check.

## Deployment

```bash
cp .env.example .env       # POSTGRES_PASSWORD and JWT_SECRET are required
docker compose up -d --build
# http://<host>:8080  (nginx serves the SPA and proxies /api to the API container)
```

Every service declares a memory limit and a health check; the compose file is sized for the
target VPS (4 vCPU / 8 GB, already loaded).

## Documentation

| File | Contents |
|---|---|
| [`MINI_SPEC_PLAYBOOK.md`](MINI_SPEC_PLAYBOOK.md) | The seven-step delivery process and standing guardrails |
| [`FEATURES.md`](FEATURES.md) | What ships, what is deliberately excluded |
| [`ARCH.md`](ARCH.md) | Architecture, data model, readiness algorithm, security model |
| [`API.md`](API.md) | Endpoint reference, conventions, error shape |
| [`TEST_LOG.md`](TEST_LOG.md) | Actual test and live-pilot results with dates |
| [`docs/AUDIT_BEFORE_BUILD.md`](docs/AUDIT_BEFORE_BUILD.md) | The A1 pre-implementation audit |
| [`docs/MINI_SPEC_A1_REPORT.md`](docs/MINI_SPEC_A1_REPORT.md) | The A1 completion report |
| [`docs/AUDIT_BEFORE_BUILD_A2.md`](docs/AUDIT_BEFORE_BUILD_A2.md) | The A2 audit, including the re-verified A1 baseline |
| [`docs/HEALTH_RULES_V1.md`](docs/HEALTH_RULES_V1.md) | Every health rule, what fires it and what closes it |
| [`docs/MINI_SPEC_A2_REPORT.md`](docs/MINI_SPEC_A2_REPORT.md) | The A2 completion report |
| [`docs/AUDIT_BEFORE_BUILD_A3.md`](docs/AUDIT_BEFORE_BUILD_A3.md) | The A3 audit, including the re-verified A1/A2 baseline |
| [`docs/ALERT_POLICY_V1.md`](docs/ALERT_POLICY_V1.md) | Alert derivation, dedupe, quiet hours, retry and the message template |
| [`docs/MINI_SPEC_A3_REPORT.md`](docs/MINI_SPEC_A3_REPORT.md) | The A3 completion report |
| [`docs/AUDIT_BEFORE_BUILD_A4.md`](docs/AUDIT_BEFORE_BUILD_A4.md) | The A4 audit, including the target-environment gaps that block deployment |
| [`docs/PRODUCTION_ENVIRONMENT.md`](docs/PRODUCTION_ENVIRONMENT.md) | Every configuration value, the topology, and the resource budget |
| [`docs/RUNBOOK_DEPLOY.md`](docs/RUNBOOK_DEPLOY.md) | Deploy a release, with verification checkpoints |
| [`docs/RUNBOOK_ROLLBACK.md`](docs/RUNBOOK_ROLLBACK.md) | Roll back without destroying data |
| [`docs/RUNBOOK_BACKUP_RESTORE.md`](docs/RUNBOOK_BACKUP_RESTORE.md) | Back up, and prove the backup restores |
| [`docs/RUNBOOK_TELEGRAM_TEST_SEND.md`](docs/RUNBOOK_TELEGRAM_TEST_SEND.md) | The controlled first real message |
| [`docs/RUNBOOK_INCIDENT_RESPONSE.md`](docs/RUNBOOK_INCIDENT_RESPONSE.md) | A first hour that does not make things worse |
| [`docs/MINI_SPEC_A4_REPORT.md`](docs/MINI_SPEC_A4_REPORT.md) | The A4 Stage A completion report |
