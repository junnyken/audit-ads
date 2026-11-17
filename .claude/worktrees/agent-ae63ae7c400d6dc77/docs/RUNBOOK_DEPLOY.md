# Runbook — Deploy

**Purpose.** Put a specific, identified release of AdsOps Control Center onto a target
environment, with a verified backup behind it and a rollback path in front of it.

**Scope.** Stage B of MINI-SPEC A4. Nothing here runs without the product owner's explicit
approval of a fully resolved plan.

> **No command in this runbook has been executed against a production target.** Every command
> below was exercised against a local staging-equivalent stack; see `TEST_LOG.md`.

## Prerequisites

- [ ] The product owner has approved a resolved deployment plan (target, method, domain, ports,
      database, backup destination, release identifier, migration command, service list,
      rollback command, dispatcher state).
- [ ] A git remote exists and the release commit is pushed. Coolify and Vibe Host both build
      from a remote; a local-only repository cannot be deployed by either.
- [ ] `/etc/adsops/production.env` exists on the target, mode `0600`, owned by the deploy user,
      and contains no placeholder and no pilot credential.
- [ ] `IMAGE_TAG` is set to the release commit. Never `latest`.
- [ ] Disk has room for the database plus one backup (`df -h`).
- [ ] A maintenance window is agreed. Expect **under 2 minutes** of API downtime for an
      additive migration; longer if a future migration rewrites a table.

## Steps

Everything below uses redacted placeholders. Substitute real values from the approved plan.

### 1. Confirm the target and the release

```bash
ssh <DEPLOY_USER>@<TARGET_HOST>
cd <APP_DIR>
git fetch --all && git checkout <RELEASE_COMMIT>
docker compose --env-file <ENV_FILE> -f docker-compose.yml -f docker-compose.production.yml ps
df -h .
```

Expected: the current release is running, disk has headroom.

### 2. Back up, and verify the backup

```bash
scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR>
```

Expected: `==> N bytes, M tables, sha256 …` and `==> backup complete`. The script refuses a dump
that defines fewer than 20 tables or carries no `alembic_version` marker, and renames it
`.suspect` rather than pretending it worked.

**If it fails, stop.** Do not migrate without a backup.

### 3. Build or pull the release images

```bash
IMAGE_TAG=<RELEASE_COMMIT> docker compose --env-file <ENV_FILE> \
  -f docker-compose.yml -f docker-compose.production.yml build
docker images | grep <RELEASE_COMMIT>
```

Expected: `<REGISTRY>/api:<RELEASE_COMMIT>` and `<REGISTRY>/web:<RELEASE_COMMIT>`. On a managed
platform the platform builds instead; confirm it built the intended commit.

### 4. Migrate — an explicit, separate step

```bash
scripts/release_migrate.sh --env-file <ENV_FILE>
```

Expected: `==> revision after migration: <REVISION>` then
`==> migration release complete. Safe to start release <IMAGE_TAG>.`

The API image does **not** migrate on start. That is deliberate: a crash-looping container
would otherwise replay migrations with nobody watching.

**If the migration fails the script exits non-zero. Do not start the new version.** Go to
`RUNBOOK_ROLLBACK.md`.

### 5. Start the services

```bash
IMAGE_TAG=<RELEASE_COMMIT> docker compose --env-file <ENV_FILE> \
  -f docker-compose.yml -f docker-compose.production.yml up -d
```

Services: `db`, `api`, `dispatcher`, `web` (plus `edge` only with `--profile edge`).

### 6. Verify health before letting traffic in

```bash
docker compose --env-file <ENV_FILE> -f docker-compose.yml -f docker-compose.production.yml ps
docker compose --env-file <ENV_FILE> -f ... exec -T api curl -fsS http://localhost:8000/health/live
docker compose --env-file <ENV_FILE> -f ... exec -T api curl -fsS http://localhost:8000/health/ready
docker compose --env-file <ENV_FILE> -f ... logs --tail 50 api | grep -i "configuration finding"
```

Expected: every service `running`, `db` and `api` `healthy`, `/health/ready` reporting
`"database":"reachable"`, and **no configuration finding** in the log. A production process
with a blocking finding refuses to start at all.

### 7. Verify the public route

```bash
curl -sI https://<PUBLIC_DOMAIN>/ | head -20
curl -s  https://<PUBLIC_DOMAIN>/health/live
curl -s -o /dev/null -w '%{http_code}\n' https://<PUBLIC_DOMAIN>/api/v1/system/status
```

Expected: HTTPS works; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
`Content-Security-Policy` present; `/health/live` returns exactly `{"status":"ok"}`; the API
route returns **401** without a token.

Also confirm nothing else is public:

```bash
ss -tlnp | grep -E ':(5432|8000)\b'    # expect no public bind
curl -s -o /dev/null -w '%{http_code}\n' https://<PUBLIC_DOMAIN>/openapi.json
```

Expected: no database or API port bound publicly; the API's own `/openapi.json` is 404 (a
frontend SPA fallback may still return the app's HTML page — check the content type).

### 8. Sign in as the production owner

Sign in at `https://<PUBLIC_DOMAIN>` with the production owner account. Confirm the pilot
credential is refused:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<PUBLIC_DOMAIN>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<OWNER_EMAIL>","password":"pilot-local-password"}'
```

Expected: **401**.

### 9. Smoke-check A1–A4

In the browser: Overview, Accounts, Readiness, Account Health, Alerts, Audit Log, System Status,
Settings. Confirm readiness, health and alert states are still shown as separate values, and
that Settings shows the Telegram chat masked and no token.

### 10. Confirm the dispatcher state matches the approved policy

System Status → Notification delivery.

- Transport should read **Disabled** unless a real send has been separately approved.
- The dispatcher should move to **Current** within one interval.

### 11. Record the release

Append to `TEST_LOG.md`: release identifier, migration revision before and after, backup file
name and checksum prefix, start time, health results, dispatcher state, and the rollback tag.

## Verification checkpoints

| # | Checkpoint | Fail → |
|---|---|---|
| 2 | Backup verified | Stop |
| 4 | Migration succeeded | `RUNBOOK_ROLLBACK.md` |
| 6 | Health checks pass | `RUNBOOK_ROLLBACK.md` |
| 7 | HTTPS + headers + nothing else public | Fix the proxy before announcing the release |
| 8 | Owner login works, pilot credential refused | Stop; rotate credentials |
| 9 | A1–A4 smoke passes | `RUNBOOK_ROLLBACK.md` |

## Failure handling

- **A container will not start.** `docker compose logs <service> --tail 200`. A production
  process that refuses to boot over configuration says which finding code stopped it.
- **`/health/ready` reports unreachable.** The database is down or `DATABASE_URL` is wrong.
  Check `docker compose ps db` first.
- **Health passes but the page is blank.** Almost always a `CORS_ORIGINS` mismatch with the real
  public origin. Check the browser console.
- **Anything worse.** `RUNBOOK_INCIDENT_RESPONSE.md`.

## Rollback / escalation

Roll back if health checks fail, the smoke check fails, or an error appears that the team cannot
explain within the maintenance window. `RUNBOOK_ROLLBACK.md`.
