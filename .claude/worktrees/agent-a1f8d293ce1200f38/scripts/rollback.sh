#!/usr/bin/env bash
# Application rollback to a previously deployed image tag.
#
#   scripts/rollback.sh --to <previous-image-tag> --env-file /etc/adsops/production.env
#
# This rolls back the APPLICATION ONLY. It never downgrades the database, because an automatic
# schema downgrade during an incident destroys data that the running release already wrote.
# See RUNBOOK_ROLLBACK.md for when a downgrade or a restore is genuinely the right answer.
#
# Every A1–A4 migration so far is additive, so an older release runs against a newer schema:
# it simply ignores the columns it does not know about. Verify that claim for any future
# migration before relying on this script.
set -euo pipefail

ENV_FILE="${ADSOPS_ENV_FILE:-.env}"
TARGET_TAG=""
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)       TARGET_TAG="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -h|--help)  sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$TARGET_TAG" ]] || { echo "--to <image tag> is required" >&2; exit 2; }
[[ "$TARGET_TAG" != "latest" ]] || { echo "refusing to roll back to a mutable tag" >&2; exit 1; }
# shellcheck source=scripts/_env.sh
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
require_env_file "$ENV_FILE"

echo "==> rolling application back to ${TARGET_TAG} (database untouched)"
IMAGE_TAG="$TARGET_TAG" docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
  up -d --no-build api dispatcher web

echo "==> waiting for the API health check"
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
       exec -T api curl -fsS http://localhost:8000/health/live >/dev/null 2>&1; then
    echo "==> API is live on ${TARGET_TAG}"
    exit 0
  fi
  sleep 2
done

echo "API did not become healthy after rollback — escalate, see RUNBOOK_INCIDENT_RESPONSE.md" >&2
exit 1
