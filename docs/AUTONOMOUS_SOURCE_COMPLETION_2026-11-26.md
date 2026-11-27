# Autonomous source completion — 2026-11-26

Dành cho chủ sản phẩm/người triển khai. User explicitly asks fix3issues and continue remaining plan while away; user deploys later. No production deploy/migration, new stack/DB or secret provisioning.

## Current work

- CSV worker: formula-safe text vs exact raw numbers; full filtered pagination with limits/failure safety, no partial file. Owns Accounts/export helper/tests and separate export i18n only.
- Main: stale form/admin callbacks fixed via mounted-instance+submit guard, original auth-scope cache invalidation. Added deferred success/failure and admin-dialog regression; first30Email tests pass before admin addition, latest verification pending.
- P1-I2 worker: defaultoff admin-configured in-app attention derived at read; existing AlertPolicy storage extended, no new scheduler/outbound/provider. Owns backend and ReminderPolicy/Emails/i18n plus separate UI reminder tests. Existing generic team/policy RBAC unchanged.

## Completion constraints

P2 attention/reporting baseline exists; improvements must reuse existing capability and evidence, not invent metrics or duplicate engines. P1-I2 scope chosen for safe in-app manual operations, not broad notifications. Source done does not close PG migration/race/staging/manual UI/wording/backup/auth gates. No commit/push unless explicitly requested for this batch; no automatic deploy main.

## Verification to append

Actual focused and final complete tests, typecheck/build/lint; sequential backend pytest; offline migration SQL only, no PG claims. Deferred lifecycle negative controls must prove fail before/pass after; CSV baseline fixture count must not be mistaken for independent test coverage. Report all worker errors/timeouts and unresolved gates.

Lifecycle main checkpoint:31Email UI tests passed8.26s, scoped lint exit0. Negative control removed guards in actual EntryForm/AdminAction temporarily, selected tests2failed/1passed/28deselected, then finally restored both fixed source byte buffers. This proves regression detects stale success callbacks; no negative source left. Failure path test remains positive guard assertion. No production activity.

## Final delegated source batch — 2026-11-26

User requested3fixes+continue plan and explicitly deploy later. Main final backend registry+reminder isolated suite100passed35.58s; ruff app+tests pass. Frontend full706passed/20unchanged skipped,50passed/1skipped files,74.32s; typecheck/build/lint chainexit0,0errors10existing Hooks warnings. Single Alembic head0028, offline0026:headSQL through0027/0028 generated; no PG migration. Focused60 not added to706. Lifecycle negative control2failed after guards removed then restored; actual Blob CSV tests cover formula/numerics/full pagination/errors/cancel/scope.

Three issues fixed source: spreadsheet text protection, all-filtered-page bounded export/no partial file, canceled request instance isolation+original-scope cache refresh. P1-I2 implemented defaultoff admin-configurable derived in-app attention using AlertPolicy; no dispatcher/outbound/Meta/Microsoft/Google automation, no new stack/DB. Reminder worker failed codex_turn_failed, main independently reviewed/tested; CSV worker completed, main final suite verified. Initial combined44pass2fail mock-policy shape corrected, assertions kept.

No commit/push/deploy/production migration. StagingPG/races/auth/backup/restore/key/retention/manual UI/wording/real spreadsheet/provider Microsoft source and measuredP2workflow remain unverified; P3deploy deferred by user. See FINAL_SOURCE_BATCH_HANDOFF_2026-11-26.md; do not mark full operational plan complete from local tests.

## Additional migration verification — 2026-11-27

Main added tests/test_p1_migration_parity_standalone.py: invokes actual Alembic upgrade functions in PostgreSQL offline context and compares DDL with SQLAlchemy model compilation (0027 full table and0028 column). No engine/DB connection. Initial3pass1fail exposed0028 no-op downgrade silently allowing revision marker to move while column retained. Changed downgrade to deliberate RuntimeError consistent with0027/application-only rollback; no destructive schema change. Runbook current head corrected to0028.

Combined isolated registry/reminder/parity104passed34.85s. Expanded lint initially found42trailing-whitespace issues in0027SQL, then formatting-only cleanup; final ruff app+3tests+0027/0028 passed, migration parity4passed0.67s after cleanup. Full frontend706/20skip belongs previous source batch, not rerun because no frontend logic changed here. No PostgreSQL migration/staging/UAT/production/write/deploy/new stack or DB. Key/auth/staging config still unset. This closes source DDL parity/rollback-guard checks, not operational rehearsal.
