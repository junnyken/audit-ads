# Runbook — Incident response

**Purpose.** A first hour that does not make things worse.

**Scope.** Operational incidents on a deployed AdsOps Control Center: the app is down, slow,
delivering nothing, delivering too much, or locked out.

## Order of operations

1. **Observe before acting.** System Status first. Half of these incidents are visible there in
   one screen, and a restart destroys the evidence.
2. **Stop the bleeding**, preferring the reversible action.
3. **Preserve evidence** — take a backup before any repair that writes.
4. **Fix, then verify**, using the relevant runbook.
5. **Write it down** in `TEST_LOG.md`: what happened, what was done, what is still open.

Never respond by downgrading the schema or restoring a backup as a first move. See
`RUNBOOK_ROLLBACK.md`.

## Triage

| Symptom | Look at | Usual cause |
|---|---|---|
| Site does not load | Reverse proxy / platform, then `docker compose ps` | Proxy or certificate, not the app |
| Loads but every call fails | `/health/ready`, `api` logs | Database unreachable or misconfiguration |
| Slow | System Status host bands, `db` logs | Memory or disk pressure on a shared host |
| No notifications arriving | System Status → dispatcher and transport | Dispatcher stale, or transport disabled |
| Too many notifications | Alert Center, run history | An alert storm; suppress before restarting anything |
| Nobody can sign in | `api` logs | JWT secret changed, or the owner account |
| Disk nearly full | `df -h`, backup directory | Backups or container logs |

## A. API is down or unhealthy

```bash
docker compose --env-file <ENV_FILE> -f docker-compose.yml -f docker-compose.production.yml ps
docker compose --env-file <ENV_FILE> -f ... logs api --tail 200
docker compose --env-file <ENV_FILE> -f ... exec -T api curl -fsS http://localhost:8000/health/ready
```

- **Refuses to start with a configuration finding.** The message names a finding code and never
  the value. Fix the env file and start again. This is the process working as intended.
- **Restart loop.** Check memory (`docker stats --no-stream`) against the limits in
  `PRODUCTION_ENVIRONMENT.md`.
- **`/health/ready` says unreachable.** Check `db` first: `docker compose ps db`,
  `docker compose logs db --tail 100`.
- **Healthy but wrong behaviour after a release.** → `RUNBOOK_ROLLBACK.md` §A.

## B. Notifications stopped

1. System Status → **Dispatcher**.
   - **Never run** → the dispatcher container is not running. `docker compose ps dispatcher`.
   - **Stale** → it ran before and stopped. `docker compose logs dispatcher --tail 100`.
   - **Current** but nothing arrives → look at the transport, not the dispatcher.
2. **Nothing is lost while the dispatcher is down.** The outbox is a database table; deliveries
   sit in it until something drains them.
3. Restart or drain by hand:
   ```bash
   docker compose --env-file <ENV_FILE> -f ... restart dispatcher
   docker compose --env-file <ENV_FILE> -f ... exec -T dispatcher \
     python -m app.commands.run_dispatcher --once
   ```
4. Deliveries stranded by a dispatcher that died mid-send are reclaimed by the sweep:
   ```bash
   docker compose --env-file <ENV_FILE> -f ... exec -T dispatcher \
     python -m app.commands.run_dispatcher --recovery-sweep
   ```
   It sends nothing; it only returns leased rows to the queue.
5. Persistent `failed_final` deliveries: open the alert in the Alert Center. The failure code
   (`invalid_recipient`, `unauthorized`, `message_rejected`) says whether a person or a
   configuration change is needed. These are never retried automatically, on purpose.

## C. Too many notifications

1. **Do not delete alerts.** Suppress, with a reason and an expiry — the history is the evidence
   for what happened.
2. Stop delivery immediately without losing anything:
   ```bash
   docker compose --env-file <ENV_FILE> -f ... stop dispatcher
   ```
   Alerts keep being derived and stay visible in the app; only outbound delivery pauses.
3. Or turn off a severity in **Settings → Notification policy**, which is recorded and
   reversible.
4. Investigate the source in the Alert Center: alerts carry the A2 rule and version that
   produced them.

## D. Host resource pressure

1. System Status host bands (warning 75–80%, critical 85–95%).
2. Disk: container logs are capped at 10 MB × 5 per service; backups are usually the growth.
   ```bash
   du -sh <BACKUP_DIR>
   find <BACKUP_DIR> -name 'adsops-*.sql.gz' -mtime +7 -delete
   ```
   Never delete the newest verified backup.
3. Memory: `docker stats --no-stream`. If the API is at its limit, reduce
   `NOTIFICATION_DISPATCH_BATCH_SIZE` or raise `DISPATCHER_INTERVAL_SECONDS` before raising a
   memory limit on a host that is already full.

## E. Nobody can sign in

1. Check whether `JWT_SECRET` changed — every existing token becomes invalid, which looks
   exactly like this. Signing in again should work.
2. If the owner account itself is the problem, reset the password hash directly. There is no
   stored recovery credential in this repository, by design.

```bash
# Generate a hash without ever typing the password into a shell command:
docker compose --env-file <ENV_FILE> -f ... exec -T api python - <<'PY'
import getpass
from app.core.security import hash_password
print(hash_password(getpass.getpass("new password: ")))
PY

# Apply it:
docker compose --env-file <ENV_FILE> -f ... exec -T -e PGPASSWORD=<REDACTED> db \
  psql -U <DB_USER> -d <DB_NAME> \
  -c "UPDATE users SET password_hash='<HASH>' WHERE email='<OWNER_EMAIL>'"
```

Change it again through the app afterwards, and record that the reset happened.

## F. Suspected credential exposure

1. **Bot token.** Revoke it with BotFather, set the new one server-side, restart `api` and
   `dispatcher`. The token is in no database row, API response, audit row or log line, so the
   env file and the person who handled it are the only exposure paths to check.
2. **Database password / JWT secret.** Rotate in the env file, restart. Rotating `JWT_SECRET`
   signs everyone out — that is the point.
3. **Pilot credential in a deployment.** The process refuses to start with it, but if one was
   ever created: change it immediately and check `audit_logs` for what that account did.

## Evidence to keep

Before any repair that writes:

```bash
scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR>
docker compose --env-file <ENV_FILE> -f ... logs --tail 1000 > <INCIDENT_DIR>/compose.log
docker compose --env-file <ENV_FILE> -f ... ps > <INCIDENT_DIR>/ps.txt
```

The application's own audit log is permanent and never hard-deleted, so the in-app history
survives whatever happens to the containers.

## Escalation

Escalate to the product owner immediately for: suspected credential exposure, any data loss,
any message reaching an unintended recipient, or a decision to restore from backup — **before**
the data loss window starts, not after.
