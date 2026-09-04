#!/usr/bin/env bash
# Controlled migration release step.
#
#   scripts/release_migrate.sh --env-file /etc/adsops/production.env [--skip-backup]
#
# Order matters and is not negotiable: back up, record the current revision, migrate, verify.
# If the migration fails the script exits non-zero and the caller must NOT start the new
# application version — a half-migrated schema behind new code is the worst of both.
#
# It never downgrades. Rolling a schema back is a decision a person makes with the incident in
# front of them; see RUNBOOK_ROLLBACK.md.
set -euo pipefail

ENV_FILE="${ADSOPS_ENV_FILE:-.env}"
SKIP_BACKUP=0
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)    ENV_FILE="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/_env.sh
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
require_env_file "$ENV_FILE"
IMAGE_TAG="$(read_env_var IMAGE_TAG "$ENV_FILE" || true)"
[[ -n "$IMAGE_TAG" ]] || { echo "IMAGE_TAG must be set in the env file" >&2; exit 1; }

if [[ "$SKIP_BACKUP" -eq 0 ]]; then
  echo "==> pre-migration backup"
  scripts/backup.sh --env-file "$ENV_FILE"
else
  echo "==> WARNING: backup skipped by request"
fi

run_alembic() {
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
    run --rm --no-deps -T api alembic "$@"
}

BEFORE="$(run_alembic current 2>/dev/null | tail -1 | awk '{print $1}')"
echo "==> current revision: ${BEFORE:-none}"

START="$(date +%s)"
if ! run_alembic upgrade head; then
  echo "MIGRATION FAILED — do not start the new application version." >&2
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
    run --rm --no-deps -T api python -m app.commands.record_operation migration_release failed \
      --error-code alembic_upgrade_failed >/dev/null 2>&1 || true
  exit 1
fi
DURATION=$(( $(date +%s) - START ))

AFTER="$(run_alembic current 2>/dev/null | tail -1 | awk '{print $1}')"
echo "==> revision after migration: ${AFTER:-unknown} (${DURATION}s)"
[[ -n "${AFTER:-}" ]] || { echo "could not read the revision after migrating" >&2; exit 1; }

docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
  run --rm --no-deps -T api python -m app.commands.record_operation migration_release succeeded \
    --revision "$AFTER" --duration-seconds "$DURATION" >/dev/null 2>&1 || true

echo "==> migration release complete. Safe to start release ${IMAGE_TAG}."
