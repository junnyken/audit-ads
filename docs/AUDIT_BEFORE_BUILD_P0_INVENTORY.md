# P0 — Audit before build: identity inventory completeness

Date: 2026-11-26. Authorization: user requested execution of ADSOPS_UPGRADE_PLAN_2026-11-26.md, including P0 fixes for reproduced failures. No production deployment authorized by this document itself.

## Context / Goal
Read CLAUDE.md, MINI_SPEC_PLAYBOOK.md and relevant sections of FEATURES.md, ARCH.md, API.md, TEST_LOG.md. Prevent a failed or truncated businesses read from being returned as a successful empty/complete inventory.

## Confirmed gap
`backend/app/services/meta_graph_transport.py`, function `fetch_facebook_identity_and_businesses`: one page (limit 50), broad exception -> empty list. Caller treats the tuple as a successful import. Classification: API, observability, testing. Existing bearer-header regression covers only one successful page.

## Scope A–E / Design choice
A: No schema or model changes. B: Retain tuple success contract; fail closed on malformed provider response, Graph error, missing identity id, pagination failure or bounded-pagination exhaustion. Follow only cursors on the fixed /me/businesses endpoint, never provider-supplied next URLs. C: Existing caller already converts exceptions into validation failure before mutations; retain that behavior. D: No UI changes. E: Stdlib isolated regression checks against the actual function AST, fake urlopen only; no DB/network/app startup. Full integration remains blocked on an identified staging database and Python dependencies.

## Constraints / acceptance
No real Meta call, token logging, schema migration, DB creation, deployment, UI change or archive semantics changes. Existing single-page bearer behavior preserved; valid empty list accepted; multi-page results complete; failures raise before import mutation. Do not remove manual-token endpoint in this slice: requires compatibility review and official-flow migration. Exact-id matching/auto-restore findings remain release blockers, not silently fixed without integration coverage.
