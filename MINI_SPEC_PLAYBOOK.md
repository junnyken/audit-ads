# MINI-SPEC Playbook

Governing process document for AdsOps Control Center. Every MINI-SPEC follows it.

## The seven steps

1. **Audit before build.** Inspect the repository, docs, architecture, security posture and UX
   inventory. Produce `docs/AUDIT_BEFORE_BUILD*.md`. No implementation code is written first.
2. **Confirm gaps and boundary.** Every gap is classified as one of `vocabulary`,
   `architecture`, `data_model`, `state_machine`, `API`, `frontend_UX`, `security`,
   `observability`, `testing`, `deployment`. Unrelated defects become documented follow-ups,
   never silent scope.
3. **Select one design choice.** State the chosen design, why, and the designs deliberately
   rejected.
4. **Implement only the agreed scope.** Additive-first. Reuse existing vocabulary, entities,
   patterns and components. Do not rebuild what already works without a confirmed gap.
5. **Run tests, lint, build and migration verification.** Migrations must apply to a clean
   database. Existing tests must keep passing.
6. **Update `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`.**
7. **Submit a MINI-SPEC Report** before the next phase starts. The next MINI-SPEC is *proposed*,
   never started automatically.

## Standing guardrails (all MINI-SPECs)

- Evidence-first: missing evidence is never positive evidence.
- Never claim an account cannot be restricted, or that an ad is guaranteed approval.
- Never store passwords, cookies, sessions, session/access/refresh tokens, credentials, or raw
  proxy authentication secrets — reject and redact them.
- Never hard-delete a domain entity; archive with `archived_at` and keep audit history.
- Every mutation writes a redacted, immutable audit record in the same transaction.
- Enforce workspace authorization server-side on every endpoint.
- No Chromium / Playwright / Selenium / fingerprinting / cookie handling / proxy rotation.
- `unknown` and `not_ready` are never rendered with success styling, and neither is `unknown`
  health.
- Readiness and health stay separate concepts in the model, the API and the UI. Neither may be
  reduced to a numeric score, and neither may be worded as safety, approval or immunity.
- Acknowledging an issue is not resolving it, at any layer.
- No outbound message may carry a secret, a raw provider response, a stack trace or an unusable
  link, and no credential may live anywhere but server configuration.
- Deployment and a first outbound message are irreversible external actions. They are separate
  stages with separate approvals, and neither happens because a spec was accepted.
- Report what was measured, not what the previous report claimed. When the environment cannot
  prove something, say exactly what is missing instead of narrowing the claim quietly.

## MINI-SPEC Report format

`1. Summary · 2. Audit Before Build · 3. Design Choice · 4. Changed Files ·
5. New API/DB/State · 6. Tests · 7. Live Verification · 8. Remaining Limits / Follow-ups`
