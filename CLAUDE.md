# AdsOps Control Center — agent instructions

Governing process: `MINI_SPEC_PLAYBOOK.md`. Read it, plus `FEATURES.md`, `ARCH.md`, `API.md` and
`TEST_LOG.md`, before changing code. Current release: MINI-SPEC A1.

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
```
