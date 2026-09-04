# AdsOps Control Center — agent instructions

Governing process: `MINI_SPEC_PLAYBOOK.md`. Read it, plus `FEATURES.md`, `ARCH.md`, `API.md` and
`TEST_LOG.md`, before changing code. Current release: MINI-SPEC A3 (alerts + Telegram), on A2 (health) and A1 (registry).

## Hard rules (these are product requirements, not preferences)

1. Never store or accept passwords, cookies, session data, access/refresh tokens, credentials or
   raw proxy authentication secrets. The API refuses such fields — keep it that way.
2. Never hard-delete a domain entity. Use `archived_at`; audit history is permanent.
3. Every mutation writes a redacted audit row **in the same transaction** as the change.
4. Missing evidence is never positive evidence. It degrades to `unknown` or `not_ready`.
5. `unknown` and `not_ready` must never be rendered with success styling. The colour map in
   `frontend/src/lib/readiness.ts` is the only place that decision lives.
6. Never claim an account cannot be restricted or that an ad will be approved — in code,
   copy, comments or docs.
7. No Chromium, Playwright, Selenium, fingerprinting, cookie handling or proxy rotation.
8. Workspace scope always comes from the authenticated membership, never from a request body.
9. Do not introduce a numeric risk score.
10. Do not scatter a hard-coded user id; authorization goes through `WorkspaceAccessService`.
11. Readiness and health are different questions. Do not merge them, do not let health write a
    readiness state (health calls the readiness rollup with `persist=False`), and do not give
    either a numeric score.
12. Acknowledging a health signal is not resolving it: an acknowledged signal keeps counting.
13. `clear_signals` may only ever be worded "No current issues found by configured checks".
14. A health signal action must never mutate the A1 event, checklist item or evidence behind it.
15. Health evaluation runs inside a SAVEPOINT. An A1 mutation must still commit when it fails,
    and the account's health must then read `unknown` — never a stale clear result.
16. Alerts are a notification/attention layer. They never recompute health, and an alert action
    never mutates the A2 signal, the A1 event, the checklist item or the evidence behind it.
17. Acknowledging an alert is not resolving it. Suppression needs a reason and a finite expiry,
    mutes delivery only, and never hides an alert or its history.
18. The Telegram bot token lives only in server configuration. It never reaches the database, an
    API response, an audit row, a log line or the frontend bundle.
19. Telegram is one-way. No bot command, callback or endpoint may change anything.
20. Only `services/telegram_transport.py` may make an outbound request, and only to the
    configured API base. Tests use `FakeNotificationTransport`; never send a real message without
    the user's explicit approval of a named chat.
21. Alert derivation runs in a nested SAVEPOINT inside the health evaluation. An alerting failure
    must degrade alerting only.

## Working style

- Audit before build; confirm gaps; pick one design; implement only the agreed scope.
- Additive-first. Reuse the existing entities, enums, services and components.
- An unrelated defect becomes a documented follow-up, not silent scope.
- Update `FEATURES.md`, `ARCH.md`, `API.md` and `TEST_LOG.md`, then submit the MINI-SPEC report.
- Record real results in `TEST_LOG.md`. Never write that something was verified when it was not.

## Commands

```bash
cd backend  && .venv/bin/python -m pytest && .venv/bin/ruff check .
cd frontend && npx vitest run && npm run build && npx eslint .

# live verification against a running API (opt-in)
VITE_API_BASE_URL=http://127.0.0.1:8000 ADSOPS_LIVE_API=http://127.0.0.1:8000 \
ADSOPS_LIVE_EMAIL=... ADSOPS_LIVE_PASSWORD=... npx vitest run src/test/live.app.test.tsx
```
