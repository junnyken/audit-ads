# Runbook — Rollback

**Purpose.** Get back to a known-good release quickly, without destroying data written by the
release you are leaving.

**Scope.** Application rollback first. Schema downgrade and database restore are separate,
heavier decisions covered below.

## The rule

**Never downgrade the database as a first response.** The release you are rolling back from has
already written rows. A schema downgrade drops the columns holding them, and no rollback is
worth silently deleting an operator's work.

Every migration through `0004_a4_operational_runs` is **additive** — new tables and columns, no
alterations to existing ones. An older application release runs fine against a newer schema: it
ignores what it does not know about. Verify that claim for any future migration before relying
on it.

## Decide which rollback you need

| Symptom | Action |
|---|---|
| New release is unhealthy, schema is fine | **A. Application rollback** |
| Migration failed part-way, app not started | **B. Investigate, then A or C** |
| Data is corrupted or wrongly written | **C. Restore from backup** (data loss window) |
| A future non-additive migration must be undone | **D. Schema downgrade** (rare, deliberate) |

## A. Application rollback (default)

Prerequisites: the previous image tag, and a backup taken before the release.

```bash
scripts/rollback.sh --to <PREVIOUS_RELEASE_TAG> --env-file <ENV_FILE>
```

It refuses a mutable tag, starts `api`, `dispatcher` and `web` on the previous tag without
rebuilding, waits for the API health check, and touches the database not at all.

Expected: `==> API is live on <PREVIOUS_RELEASE_TAG>`.

Verify: `/health/ready` is 200; the public domain loads; sign in; System Status shows the
previous release identifier.

**Downtime:** seconds — the containers restart, nothing migrates.

## B. Migration failed part-way

1. Do **not** start the new application version. `release_migrate.sh` already exited non-zero.
2. Read the revision that actually landed:
   ```bash
   docker compose --env-file <ENV_FILE> -f ... run --rm --no-deps -T api alembic current
   ```
3. Alembic runs each migration in a transaction, so a failed revision leaves the previous one
   in place. If `current` shows the previous revision, the schema is intact → keep the old
   release running (it is still running; nothing was switched) and fix the migration.
4. If `current` shows something unexpected, treat it as a data incident → **C**.

## C. Restore from backup (data loss window)

Only when data is wrong or the schema is unrecoverable. **Everything written since the backup
is lost.** Announce the window before starting.

```bash
# 1. Stop everything that writes.
docker compose --env-file <ENV_FILE> -f ... stop api dispatcher

# 2. Prove the archive restores, into an isolated database, before touching the real one.
scripts/restore_drill.sh --file <BACKUP_FILE> --env-file <ENV_FILE>

# 3. Take a backup of the CURRENT broken state too — you may need it to recover
#    what happened after the good backup.
scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR>

# 4. Restore over the real database. Deliberately manual: no script does this for you.
gunzip -c <BACKUP_FILE> | docker compose --env-file <ENV_FILE> -f ... \
  exec -T -e PGPASSWORD=<REDACTED> db psql -U <DB_USER> -d <DB_NAME>

# 5. Verify, then start the matching application release.
docker compose --env-file <ENV_FILE> -f ... run --rm --no-deps -T api alembic current
IMAGE_TAG=<TAG_MATCHING_THAT_SCHEMA> docker compose --env-file <ENV_FILE> -f ... up -d
```

There is intentionally no `restore.sh`. A one-command overwrite of a production database is a
foot-gun that will eventually be run by accident.

## D. Schema downgrade (rare)

Only when a specific migration must be undone and its `downgrade()` is known to be safe for the
data present.

```bash
scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR>      # non-negotiable
docker compose --env-file <ENV_FILE> -f ... run --rm --no-deps -T api alembic downgrade <REVISION>
```

`0004_a4_operational_runs` downgrades cleanly: it drops only `operational_runs`, which holds
operational history and no product data. Verified in `TEST_LOG.md`.

## Verification checkpoints

| Checkpoint | Expected |
|---|---|
| Containers running the intended tag | `docker compose ps` shows the target tag |
| `/health/ready` | 200, `"database":"reachable"` |
| Owner login | works |
| System Status | shows the rolled-back release identifier |
| A1–A4 smoke | Accounts, Readiness, Health, Alerts all load |

## Failure handling and escalation

- **Rollback API does not become healthy.** `scripts/rollback.sh` exits non-zero after 60 s.
  Read `docker compose logs api --tail 200` → `RUNBOOK_INCIDENT_RESPONSE.md`.
- **The previous tag is gone** (pruned, never pushed). Rebuild it from the commit — the reason
  `IMAGE_TAG` must always be a commit identifier and never `latest`.
- **Rollback fixes nothing.** The problem is data or infrastructure, not the release → **C**.

Escalate to the product owner when a restore is being considered, before the data loss window
starts — not after.
