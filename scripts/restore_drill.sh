#!/usr/bin/env bash
# Restore drill against an ISOLATED database. Never touches the production database.
#
#   scripts/restore_drill.sh --file backups/adsops-2026....sql.gz [--env-file ...]
#
# It restores into a throwaway database named adsops_restore_drill_<timestamp>, verifies the
# schema and the alembic revision came back, prints a table count, and drops it again. A
# backup that has never been restored is an assumption, not a recovery plan.
set -euo pipefail

ENV_FILE="${ADSOPS_ENV_FILE:-.env}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)
DB_SERVICE="${ADSOPS_DB_SERVICE:-db}"
ARCHIVE=""
KEEP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)     ARCHIVE="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --keep)     KEEP=1; shift ;;
    -h|--help)  sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$ARCHIVE" ]] || { echo "--file is required" >&2; exit 2; }
[[ -f "$ARCHIVE" ]] || { echo "archive not found: $ARCHIVE" >&2; exit 1; }
# shellcheck source=scripts/_env.sh
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
require_env_file "$ENV_FILE"
POSTGRES_USER="$(read_env_var POSTGRES_USER "$ENV_FILE" || echo adsops)"
POSTGRES_DB="$(read_env_var POSTGRES_DB "$ENV_FILE" || echo adsops)"
POSTGRES_PASSWORD="$(read_env_var POSTGRES_PASSWORD "$ENV_FILE" || true)"
[[ -n "$POSTGRES_PASSWORD" ]] || { echo "POSTGRES_PASSWORD must be set in the env file" >&2; exit 1; }

if [[ -f "${ARCHIVE}.sha256" ]]; then
  echo "==> verifying checksum"
  (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
fi

DRILL_DB="adsops_restore_drill_$(date -u +%Y%m%d%H%M%S)"
# A guard, not a formality: this name must never be able to collide with a real database.
case "$DRILL_DB" in
  "$POSTGRES_DB") echo "refusing: drill name equals the production database" >&2; exit 1 ;;
esac

psql_exec() {
  docker compose "${COMPOSE_FILES[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" \
    "$DB_SERVICE" psql -U "$POSTGRES_USER" "$@"
}

echo "==> creating isolated database ${DRILL_DB}"
psql_exec -d postgres -c "CREATE DATABASE ${DRILL_DB}" >/dev/null

cleanup() {
  if [[ "$KEEP" -eq 0 ]]; then
    echo "==> dropping ${DRILL_DB}"
    psql_exec -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)" >/dev/null || true
  else
    echo "==> keeping ${DRILL_DB} (--keep)"
  fi
}
trap cleanup EXIT

echo "==> restoring"
gunzip -c "$ARCHIVE" | psql_exec -v ON_ERROR_STOP=0 -d "$DRILL_DB" >/dev/null

TABLES="$(psql_exec -tAd "$DRILL_DB" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')"
REVISION="$(psql_exec -tAd "$DRILL_DB" -c \
  "SELECT version_num FROM alembic_version" | tr -d '[:space:]')"
ACCOUNTS="$(psql_exec -tAd "$DRILL_DB" -c \
  "SELECT count(*) FROM ad_accounts" | tr -d '[:space:]')"

echo "==> restored: ${TABLES} tables, alembic revision ${REVISION}, ${ACCOUNTS} ad accounts"

FAILED=0
[[ "${TABLES:-0}" -ge 20 ]] || { echo "FAIL: expected at least 20 tables" >&2; FAILED=1; }
[[ -n "${REVISION:-}" ]]    || { echo "FAIL: no alembic revision in the restored database" >&2; FAILED=1; }

# Recorded through the API container for the same reason as in backup.sh: the database lives
# on the private compose network, not wherever a host virtualenv points.
STATUS=$([[ "$FAILED" -eq 0 ]] && echo succeeded || echo failed)
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
  exec -T api python -m app.commands.record_operation restore_drill "$STATUS" \
    --table-count "${TABLES:-0}" --revision "${REVISION:-unknown}" >/dev/null 2>&1 \
  || docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
       run --rm --no-deps -T api python -m app.commands.record_operation restore_drill "$STATUS" \
         --table-count "${TABLES:-0}" --revision "${REVISION:-unknown}" >/dev/null 2>&1 || true

[[ "$FAILED" -eq 0 ]] || exit 1
echo "==> restore drill passed"
