# P1-D2 — Audit Before Build: independent email registry

- ID: P1-D2. Parent: P1 Email & Recovery Operations. Date: 2026-11-26.
- Author: Codex, documentation author; main remains reviewer and operational owner.
- Status: selected contract after main source review and user confirmation of conservative role mapping; NOT schema/API/UI implementation or release approval.
- Deliverables: this audit and [mini-spec](P1_EMAIL_REGISTRY_CONTRACT.md) only.

## Context and goal

Finalize one implementable metadata, authorization and audit contract before real schema/API/UI.
Approved scope is independent email registry, Gmail PERSONAL and Microsoft with unknown type allowed,
masked lists, owner/admin plus assigned responsible member reveal in the same workspace, no full-address CSV.
No new passwords, OTP/codes, TOTP seeds, cookies, provider OAuth or mailbox automation; manual evidence only.

Bounded inspection: three requested planning/mockup documents, Playbook/CLAUDE guardrail excerpts,
and 13 relevant backend source/test files below. No configuration secrets, network, database,
server, migration, test execution or git operations were used. Source line references describe this checkout,
not deployed schema. No repository-wide capability or production-health certification is implied.

## Evidence and gap inventory

| Surface | Existing evidence | Reuse / confirmed design gap |
|---|---|---|
| Approved scope/order | `docs/ADSOPS_MASTER_PLAN_2026-11-26.md:34`, `:36`, `:168`–`:170`; `docs/P1_EMAIL_SCOPE_DESIGN_2026-11-26.md:7`–`:18` | Preserve independent registry; D2 precedes I1; P0 and D1 remain gates. |
| Mockup | `docs/mockups/p1-email/README.md:13`–`:19` | Built artifact/test workflow and fixture interactions are documented. Manual viewport/keyboard/wording review is explicitly incomplete; no signoff inferred. |
| Existing entity | `backend/app/models/entities.py:177`–`:197` | F1 contact ciphertext/hint belongs to PersonalAccountReference. Do not make fake Facebook identities or copy contacts automatically. New independent entity is proposed. |
| Strict intake | `backend/app/schemas/common.py:19`–`:33`; `backend/app/core/redaction.py:19`–`:67` | `extra=forbid`, whitespace trim, recursive sensitive-key refusal. `email` is not a forbidden key; create contact intake can remain StrictPayload. No new BaseModel bypass for intake. |
| F1 exceptions | `backend/app/schemas/facebook_identities.py:19`–`:34`; `CLAUDE.md:31`–`:49` | Existing RevealEmailRequest carries only verified PIN. Reuse this exact request shape/verification, subject to explicit caller-boundary review; no new password/provider exception. |
| Encryption | `backend/app/core/secret_vault.py:46`–`:54`, `:120`–`:144` | Contact Fernet encryption/decryption/mask functions exist; key missing/malformed raises. No keyed blind-index API in inspected vault; index/key lifecycle is new work, not an existing capability. |
| Important F1 difference | `backend/app/services/facebook_identities.py:235`–`:280` | F1 permits hint-only storage without key and permits holder reveal without role restriction. Neither behavior is copied into the standalone contract. |
| PIN/transaction | `backend/app/services/facebook_identities.py:133`–`:176`; `backend/app/api/v1/routers/facebook_identities.py:79`–`:90` | Viewer PIN verification locks user row, records failures; router commits rejected/locked PIN state before raising, and commits success before returning full address. Reuse deliberately. |
| Workspace context | `backend/app/api/deps.py:100`–`:124`, `:250`–`:284` | Auth-derived workspace, active user, unarchived workspace, suspension rejection, membership, write/license and owner/admin dependencies. New service must scope every query; context alone is insufficient. |
| Roles/seats | `backend/app/core/enums.py:16`–`:21`, `:696`–`:705`; `backend/app/models/entities.py:117`–`:137`; `backend/app/services/workspace.py:18`–`:35`, `:45`–`:67` | No MEMBER enum. buyer≈operator; viewer/auditor read-only. Membership lookup checks archive but not status. Explicit ACTIVE seat and active assigned user checks are required additions for P1. |
| Audit | `backend/app/services/audit.py:26`–`:49`; `backend/app/core/redaction.py:136`–`:150` | Same-session add + redaction, not an auto-commit/durable event sink. Redactor is not an email detector; build a P1 whitelist, never serialize entire request/model. |
| Errors/paging | `backend/app/core/errors.py:33`–`:80`, `:98`–`:108`; `backend/app/schemas/common.py:40`–`:55` | Reuse error envelope and Page; validation omits rejected input. New conflict/precondition rules remain proposed. |
| Regression evidence | `backend/tests/test_f1_facebook_identities.py:150`–`:194` | Source assertions cover mask/reveal/audit and hint-only fallback. Tests were read, not run; these do not prove standalone registry behavior. |

## Design choice and scope

One additive entity with immutable provider/address identity, workspace-scoped keyed uniqueness,
manual evidence and archive-only lifecycle. Reuse contact encryption, current-user PIN, workspace context,
redacted same-session audit and standard error/page response shapes. Extend audited boundaries explicitly;
do not change Meta/F1 meanings or globally relax StrictPayload.

A. Domain: new email registry only; no asset-link table, imports, automatic F1 synchronization or mailbox records.
B. Service: role/seat checks, immutable identity, manual transitions, optimistic concurrency, fail-closed vault/index.
C. API: all paths in the mini-spec are PROPOSED; no route is claimed to exist.
D. UI: future list/detail/form/history; D1 fixture is reference only, wording/manual acceptance still pending.
E. Tests: future unit + HTTP/DB integration + F1 regression + staging verification per matrix; none executed here.

## Implementation handoff and gates

1. Main reviews both documents and verifies critical claims: F1 fallback differs, no MEMBER enum,
   seat-status gap, contact decrypt caller restriction, no blind-index API, explicit commit on PIN failure.
2. PO/BA completes D1 wording and manual 375/768/1280 + keyboard review. Resolve narrow decisions
   at the contract end; no repeat approval of independent registry or already approved reveal scope.
3. Before implementation, review existing API/ARCH/FEATURES/TEST_LOG and current migration head;
   before deployment require P0 target schema inventory, verified backup/restore/artifact rollback and login evidence.
4. Future ordered targets (not changed now): `backend/app/core/secret_vault.py` (audited contact/index boundary
   and key lifecycle), `backend/app/core/enums.py`, new `backend/app/models/email_registry.py` plus model registration,
   additive file under `backend/alembic/versions/`, new `backend/app/schemas/email_registry.py`,
   P1 permission helpers in `backend/app/services/workspace.py`, new `backend/app/services/email_registry.py`,
   new `backend/app/api/v1/routers/email_registry.py` plus router registration.
5. Add future backend validation/RBAC/transaction/migration tests, then frontend client/list/detail/form/history
   in existing Assets structure; update API/ARCH/FEATURES/TEST_LOG only to describe actual implemented capability.
   Audit decrypt-caller regression assertions before expanding callers; no decrypt_secret/Meta exception changes.
6. Rehearse additive migration and full HTTP+DB tests on verified shared staging; do not create another beta.
   Main owns any later production action under separate operational authorization.

## Verification, success and rollback

Document acceptance: exactly two requested files; field/API/RBAC/state/audit/key gaps concrete; source references
checked against bounded excerpts; >20 actionable tests specified; no claim that implementation/tests/UAT passed.
Future success: every matrix case passes with recorded evidence and all gates above close before release.

Rollback now: revise these two documents to the last reviewed contract. Future rollback: stop new entry points
through the actual routing/release mechanism, revert application artifact, keep additive schema/data/history.
No automatic database downgrade, hard delete, volume deletion or invented feature flag.

Main review follow-up: directly checked secret_vault contact functions, RevealPinService failure transaction, reveal router commit behavior, WorkspaceRole enum, StrictPayload, errors and AuditLogService. User selected limited registry access: owner/admin and assigned buyer only; viewer/auditor denied in I1. No tests ran in this documentation-only step. Field/API/role tables remain implementation specifications, not deployed capability.

`needs_main_action`: collect remaining P0/D1 acceptance, then implement the reviewed contract in the ordered targets above. No repeated role/scope approval needed. Exact legal retention and operational key lifecycle remain policy prerequisites before release.
