# P0 restore drill fail-closed audit

Date 2026-11-26. User authorizes remaining P0 fixes. Local source only.

Context: scripts/restore_drill.sh checks checksum only if present, invokes psql ON_ERROR_STOP=0, and psql docker compose omits requested --env-file. This can ignore SQL failures and select a different interpolation configuration. The project requires backup restore evidence before release.

Goal: a corrupt/unverified archive or SQL failure cannot be reported as restored successfully.

Scope A–E: no schema/domain/API/UI changes. Require checksum sidecar and gzip validation before any Docker call; consistently select --env-file; use pg_dump --no-owner --no-acl (including --clean --if-exists) and restore ON_ERROR_STOP=1; preserve old archives, never delete/overwrite production. Regression via temporary fake docker that records invocations/failure, never invokes real Docker/DB. No real backup/restore performed. Verify missing/mismatched checksum, corrupt archive, SQL failure and valid fake path. Successful fake path is control-flow evidence only, not a restore drill.
