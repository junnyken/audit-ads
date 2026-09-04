# Runbook — Backup and restore

**Purpose.** Produce database backups that have actually been proven to restore, and know how
old the newest good one is at any moment.

**Scope.** The PostgreSQL database. Uploaded evidence files are out of scope because this
release stores none.

## Prerequisites

- The stack is configured on the host, and `<ENV_FILE>` is readable by the deploy user only.
- `<BACKUP_DIR>` exists with at least 512 MB free. The script refuses to run below that rather
  than filling the disk and causing the incident it was meant to prevent.

## Backup

```bash
scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR> [--retention-days 7]
```

What it does, in order:

1. Refuses if `<BACKUP_DIR>` has under 512 MB free.
2. `pg_dump --clean --if-exists`, gzipped, to `adsops-<UTC timestamp>.sql.gz`.
3. Checks the byte floor and the gzip integrity.
4. **Checks the content**: at least 20 `CREATE TABLE` statements and an `alembic_version`
   marker. Size alone is a poor test — a freshly deployed database is legitimately small, and an
   earlier byte-only floor rejected exactly that.
5. Writes `<file>.sha256` and `<file>.json` (size, table count, checksum, database label).
6. Records a `backup` run through the API container, so System Status can show backup age
   without reading the filesystem.
7. Deletes local archives older than the retention window.

A dump that fails any check is renamed `.suspect` and the script exits non-zero. It is never
silently accepted.

### Verification checklist

- [ ] Exit code 0.
- [ ] `==> N bytes, M tables, sha256 …` printed, `M` matching the current schema.
- [ ] `<file>.sha256` and `<file>.json` exist beside the archive.
- [ ] `sha256sum -c <file>.sha256` passes.
- [ ] System Status shows **Backup: Current**.

### Retention and off-host copies

- Default: 7 days locally.
- **The archives are not encrypted, and they contain operational data.** Treat `<BACKUP_DIR>`
  as sensitive: `chmod 700`, owned by the deploy user.
- **Off-host copies are a manual step in this release.** Nothing in A4 ships credentials to
  an object store. Until a MINI-SPEC adds it, copy deliberately, e.g.:
  ```bash
  gpg --symmetric --cipher-algo AES256 <BACKUP_FILE>
  scp <BACKUP_FILE>.gpg <OFFSITE_HOST>:<OFFSITE_DIR>/
  ```
  A backup that only exists on the machine it protects does not survive that machine.

### Scheduling

The dispatcher runs as a container; the backup does not. Schedule it with whatever the target
provides — a host cron entry, a platform scheduled job, or a systemd timer:

```
15 3 * * *  cd <APP_DIR> && scripts/backup.sh --env-file <ENV_FILE> --dir <BACKUP_DIR> >> <LOG> 2>&1
```

Once a daily backup is running, System Status reports **Backup: Stale** after 26 hours.

## Restore drill

**A backup that has never been restored is an assumption, not a recovery plan.** Run this after
the first deployment, after any migration that changes shape, and monthly.

```bash
scripts/restore_drill.sh --file <BACKUP_FILE> --env-file <ENV_FILE> [--keep]
```

It verifies the checksum, creates `adsops_restore_drill_<timestamp>`, restores into it, checks
the table count and `alembic_version`, prints the account count, records the drill, and drops
the database again. It refuses to use a name matching the production database.

Expected: `==> restored: N tables, alembic revision <REV>, M ad accounts` then
`==> restore drill passed`.

### Verification checklist

- [ ] Checksum verified.
- [ ] Table count matches the current schema.
- [ ] Alembic revision matches the release the backup came from.
- [ ] Account count is plausible.
- [ ] The drill database was dropped (or kept deliberately with `--keep`).
- [ ] System Status shows the restore drill in run history.

## Real restore

Restoring over the real database is deliberately **not** scripted. See
`RUNBOOK_ROLLBACK.md` §C — it is an incident procedure with a data loss window, and it belongs
next to the decision about whether to accept that window.

## Failure handling

| Symptom | Meaning | Action |
|---|---|---|
| `refusing to back up: less than 512 MB free` | Disk is nearly full | Free space or move `<BACKUP_DIR>`; check System Status disk band |
| `backup defines only N tables` | Truncated dump, usually a dropped connection | Re-run; if it repeats, check database health |
| `backup has no alembic_version marker` | Wrong database, or the dump did not complete | Check `POSTGRES_DB` in the env file |
| `.suspect` file present | A previous backup failed verification | Investigate before trusting the next one |
| Restore drill fails | The archive is not restorable | **Escalate now.** Take a fresh backup and drill it; do not deploy while no verified backup exists |

## Escalation

No verified backup within 26 hours, or a failed restore drill, blocks the next deployment.
Raise it with the product owner rather than deploying past it.
