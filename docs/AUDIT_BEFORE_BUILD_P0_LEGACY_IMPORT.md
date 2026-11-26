# P0 — Retire manual-token import and guard destructive test fixtures

Date: 2026-11-26. User explicitly requested fixing remaining P0 defects and completing P0. Local changes only; deployment remains gated on production inventory/backup/staging evidence.

## Context / confirmed gaps
The legacy auto-connect-token route accepts raw credentials against CLAUDE rules 1/40, matches identity by label OR stable id, auto-restores archived entities/links, sets unverified 2FA and ownership defaults, and commits without complete audit. Fixing individual mutations would leave an explicitly forbidden credential path operational.

Backend tests/conftest.py uses an inherited DATABASE_URL with setdefault and unconditionally DROP SCHEMA/TRUNCATE via autouse fixtures. Test target must be proven before destructive SQL.

## Goal / single design
Retire the legacy import implementation completely, retain authenticated route as a safe rejection/tombstone, use StrictPayload for input, and direct legitimate connection work to existing official flow. No raw credential is accepted, no provider call, DB mutation, guessed defaults, merge or archive restore remains in this path. Official Meta Login remains unchanged. Frontend migration is separate coordination; do not present this path as functional.

Require explicit ADSOPS_ALLOW_TEST_SCHEMA_RESET=1 plus ENVIRONMENT=test and a PostgreSQL database name ending _test before fixture reset/TRUNCATE. This is an additional fail-closed local test safety gate, not proof a remote DB is staging. No new DB/service.

## Scope A–E / acceptance
A: no schema. B: remove forbidden mutation path; reusable test-target guard. C: legacy route rejects secret-bearing payload with existing forbidden_field shape; empty payload rejects with validation_error. Authentication unchanged. D: no new UI or wording authored here. E: actual FastAPI router in-process tests with overridden auth context and no DB/network, plus test-target unit tests. Run existing standalone SQLite backend suites --noconftest only after inspecting fixtures. Full PostgreSQL integration and live production remain explicit gates.
