# P1-I1 — Audit Before Build / implementation scope

2026-11-26. Dành cho PO/BA và người triển khai. User explicitly requests schema → service/API → UI according to P1_EMAIL_REGISTRY_CONTRACT.md after D1/D2 handoff.

## Context / Goal

Independent metadata registry Gmail personal/Microsoft, user-confirmed owner/admin and assigned active buyer only. Viewer/auditor denied, full contact PIN reveal only, lists masked, no full-address export. Implement one vertical slice locally without claiming production readiness.

## Constraints

Contract is source of chosen fields, state transitions, null/patch semantics, permissions and audit. No provider automation/OAuth/mailbox, secrets, attachments, asset links, reminders or exports. No new stack/DB/server. No production writes/migrations/deploy. Shared staging not verified: no DB-reset pytest or integration against unidentified DB. Allowed standalone SQLite in-memory tests, pure tests and offline migration SQL; PostgreSQL locking/migration evidence remains missing until proper staging exists. No global guard weakening, crypto outside secret_vault, F1 behavior regressions or copied plaintext in logs. Existing unrelated dirty desktop/docs kept.

## Scope A–E / Design Choice

A: additive EmailRegistryEntry/migration next head after 0026, no F1 import.
B: encrypted contact and dedicated keyed uniqueness in vault, explicit fail-closed keys; scoped permission service, manual evidence, version checks, redacted atomic audit.
C: proposed email-registry routes become implemented, strict DTOs/errors/paging, current PIN reuse deliberate caller boundary; no plaintext on audit failure.
D: existing token/primitives-based Email registry list/detail/form/review/history/reveal, role restricted entry point, i18n wording marked proposal awaiting BA review, no fixture production data.
E: backend standalone guards/service/SQLite route tests without destructive conftest; frontend mocked API tests/typecheck/build/lint; sequential backend test runs. Do not claim full 34-case PostgreSQL acceptance from local tests.

Backend worker owns backend/** only; frontend worker owns frontend/** only. Main owns docs and final review/integration, no overlapping edits. API naming and shape follow D2 exactly; any mismatch returned to main rather than silent contract drift. Shared header support may be added minimally in frontend client if needed. No new deps unless truly essential and reported first.

## Test / Acceptance / Rollback

Record actual commands/counts/failures. Protect cross-workspace/roles/active memberships, PIN error durability, blind-index uniqueness and raw DTO/audit leak, concurrency preconditions, manual evidence/timezone, archive, UI no permission/error/empty/readback and header wiring. Review lock order and current workspace/user access. PG lock/race/index and migration rehearsal not run without target; keep release blocked.

Rollback local code artifact; additive schema kept if later deployed, no automatic downgrade/drop/restore. Production release requires verified backup/schema/artifact and key provisioning; this build request does not waive those gates. Manual viewport/wording review is still pending and must be stated in report.
