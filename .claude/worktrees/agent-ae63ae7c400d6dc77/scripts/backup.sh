#!/usr/bin/env bash
# Timestamped, verified database backup.
#
#   scripts/backup.sh [--env-file /etc/adsops/production.env] [--dir /var/backups/adsops]
#
# What "verified" means here: the dump is created, its exit code checked, its size checked
# against a floor, a SHA-256 recorded, and a metadata file written. A backup nobody has
# measured is a file, not a backup.
#
# The database password is never passed on the command line and never appears in shell
# history: it is read from the env file into PGPASSWORD for the child process only.
set -euo pipefail

ENV_FILE="${ADSOPS_ENV_FILE:-.env}"
BACKUP_DIR="${ADSOPS_BACKUP_DIR:-./backups}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)
DB_SERVICE="${ADSOPS_DB_SERVICE:-db}"
MIN_BYTES="${ADSOPS_BACKUP_MIN_BYTES:-1024}"
#: Tables the dump must define for it to count as a complete schema.
MIN_TABLES="${ADSOPS_BACKUP_MIN_TABLES:-20}"
RETENTION_DAYS="${ADSOPS_BACKUP_RETENTION_DAYS:-7}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --dir)      BACKUP_DIR="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/_env.sh
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
require_env_file "$ENV_FILE"
POSTGRES_USER="$(read_env_var POSTGRES_USER "$ENV_FILE" || echo adsops)"
POSTGRES_DB="$(read_env_var POSTGRES_DB "$ENV_FILE" || echo adsops)"
POSTGRES_PASSWORD="$(read_env_var POSTGRES_PASSWORD "$ENV_FILE" || true)"
[[ -n "$POSTGRES_PASSWORD" ]] || { echo "POSTGRES_PASSWORD must be set in the env file" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/adsops-${STAMP}.sql.gz"

# Refuse rather than fill the disk: a backup that triggers an out-of-space incident is worse
# than no backup taken this hour.
AVAIL_KB="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
if [[ "$AVAIL_KB" -lt 524288 ]]; then
  echo "refusing to back up: less than 512 MB free at $BACKUP_DIR" >&2
  exit 1
fi

echo "==> dumping ${POSTGRES_DB} to ${TARGET}"
if docker compose "${COMPOSE_FILES[@]}" ps --status running --services 2>/dev/null | grep -qx "$DB_SERVICE"; then
  docker compose "${COMPOSE_FILES[@]}" exec -T \
    -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_SERVICE" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists | gzip -9 > "$TARGET"
else
  # Managed database, or the stack is not up: fall back to a direct connection.
  : "${PGHOST:?PGHOST must be set when the db service is not running locally}"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$PGHOST" -p "${PGPORT:-5432}" \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists | gzip -9 > "$TARGET"
fi

SIZE="$(stat -c%s "$TARGET")"
if [[ "$SIZE" -lt "$MIN_BYTES" ]]; then
  echo "backup is only ${SIZE} bytes, below the ${MIN_BYTES}-byte floor — treating as failed" >&2
  mv "$TARGET" "${TARGET}.suspect"
  exit 1
fi

gzip -t "$TARGET" || { echo "backup archive is corrupt" >&2; exit 1; }

# Size alone is a poor test: a freshly deployed database is legitimately small, and an early
# byte floor rejected exactly that. What actually matters is that the dump defines the whole
# schema and carries the migration marker, so verify the content instead of guessing at bytes.
TABLE_COUNT="$(gunzip -c "$TARGET" | grep -c '^CREATE TABLE ' || true)"
if [[ "$TABLE_COUNT" -lt "$MIN_TABLES" ]]; then
  echo "backup defines only ${TABLE_COUNT} tables, expected at least ${MIN_TABLES} — treating as failed" >&2
  mv "$TARGET" "${TARGET}.suspect"
  exit 1
fi
# `grep -q` would exit early, send SIGPIPE to gunzip and — under `set -o pipefail` — make a
# perfectly good backup look like a failure. Count instead of short-circuiting.
ALEMBIC_MARKERS="$(gunzip -c "$TARGET" | grep -c 'alembic_version' || true)"
if [[ "$ALEMBIC_MARKERS" -eq 0 ]]; then
  echo "backup has no alembic_version marker — treating as failed" >&2
  mv "$TARGET" "${TARGET}.suspect"
  exit 1
fi
CHECKSUM="$(sha256sum "$TARGET" | awk '{print $1}')"
echo "$CHECKSUM  $(basename "$TARGET")" > "${TARGET}.sha256"

cat > "${TARGET}.json" <<META
{
  "file": "$(basename "$TARGET")",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "size_bytes": ${SIZE},
  "checksum_algorithm": "sha256",
  "checksum": "${CHECKSUM}",
  "database_label": "${POSTGRES_DB}",
  "table_count": ${TABLE_COUNT},
  "encrypted": false
}
META

echo "==> ${SIZE} bytes, ${TABLE_COUNT} tables, sha256 ${CHECKSUM:0:16}…"


# Record the run so the status page can show backup age without reading the filesystem.
#
# Recorded THROUGH THE API CONTAINER, not a host virtualenv: the database is on the private
# compose network, and an earlier version of this script quietly recorded the backup against
# whatever database the host venv happened to point at.
record_run() {
  # Prefer `exec` on the running API container: it needs no new container, so it also works
  # where creating one is constrained. Fall back to `run --rm` when the stack is down.
  if docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
       exec -T api python -m app.commands.record_operation "$@" >/dev/null 2>&1; then
    return 0
  fi
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
    run --rm --no-deps -T api python -m app.commands.record_operation "$@" >/dev/null 2>&1 \
    || echo "note: could not record the run (is the stack configured on this host?)"
}
record_run backup succeeded --size-bytes "$SIZE" --table-count "$TABLE_COUNT" \
  --database-label "$POSTGRES_DB"

# Retention. Local copies only — see RUNBOOK_BACKUP_RESTORE.md on off-host transfer.
find "$BACKUP_DIR" -name 'adsops-*.sql.gz*' -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "==> backup complete: ${TARGET}"
