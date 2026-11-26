# Audit before build — P0 Telegram (2026-11-26)

Scope: automation_ops.py, telegram_bot_helper.py, Settings.tsx and focused tests. No production, live HTTP/send, servers, DB service, deployment or commit.

Read: CLAUDE.md rules 2/3/18/20/22; MINI_SPEC_PLAYBOOK.md; relevant Telegram sections in FEATURES.md, ARCH.md, API.md, TEST_LOG.md; RUNBOOK_TELEGRAM_TEST_SEND.md.

Before change: config/detect-chat/test-send accept bot_token dictionaries; config verifies supplied secrets over HTTP. Helper stores encrypted token in audit metadata, copies legacy envelopes into new rows and prefers workspace tokens. Settings captures and submits the token.

Goal: reject credential/unknown fields before HTTP/DB; resolve token only from server configuration; preserve nonsecret chat/notification settings and all old audit rows; never copy legacy envelope/mask into new rows or responses. Remove Telegram input/state/payload, reuse existing i18n.

Tests: --noconftest, SQLite in memory, unreachable DATABASE_URL, HTTP denied or mocked. Verify endpoint rejection, server resolver and audit preservation; existing commercial/auth and operational telemetry suites; scoped backend ruff and frontend typecheck. Preserve CRLF. No tests weakened.

Conflict: old generic Settings password-selector test forbids legitimate account change-password and AI API-key fields. Keep those fields and report conflict. Existing helper HTTP placement (rule 20) and test-send approval-gate differences remain outside this credential-only scope.

Verification completed: 58 passed in 17.01s (50 focused Telegram regressions, 8 existing commercial/auth and operational telemetry tests). Command: DATABASE_URL=postgresql+psycopg://unused:unused@127.0.0.1:1/unused_test ENVIRONMENT=test RATE_LIMIT_ENABLED=false NOTIFICATION_TRANSPORT=fake TELEGRAM_BOT_TOKEN= PYTHONPATH=backend /tmp/adsops-p0-20261126/venv/bin/pytest --noconftest backend/tests/test_p0_telegram_server_only.py backend/tests/test_commercial_auth_and_license.py backend/tests/test_operational_telemetry_and_early_alerts.py -o addopts= -q

Initial combined run had 56 passes and one auth reset failure due to rate limiting: the new module imported configuration before existing suites set their environment defaults. Explicit RATE_LIMIT_ENABLED=false from process startup fixed the test setup; no assertion or production rate-limit code changed. Final ruff check backend: All checks passed. Frontend npm run typecheck: exit 0. Scoped git diff --check: pass. Existing edited source files were LF and remain LF; this new audit document retains CRLF. No existing audit deletion, real Telegram send, external service access, deployment or commit performed.

Limits: focused offline verification only; old generic password-selector conflict remains at frontend/src/test/u1f.meta-settings.test.tsx:824-825. Legitimate password and AI key inputs retained. Legacy audit credentials remain stored in old rows per the preserve-history requirement, but are ignored by the resolver and omitted from new records/responses. Any historical credential rotation/remediation is an operator action outside this patch.
