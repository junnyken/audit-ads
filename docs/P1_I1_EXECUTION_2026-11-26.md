# P1-I1 — execution and verification tracker

2026-11-26. Dành cho người triển khai/PO. Local implementation in progress, NOT release signoff.

## Scope

User requests actual schema → service/API → UI following reviewed P1 contract. Backend and frontend workers own disjoint backend/** and frontend/**; main owns documentation/review. No production migration/deploy, stack/DB creation, provider call or live notification authorized by this implementation step.

## Planned verification map

| Boundary | Local verification | Remaining real-environment evidence |
|---|---|---|
| Field validation/crypto | Pure schema/crypto tests; dedicated key unavailable fails closed | Provisioned keys/rotation procedure |
| Service/API/RBAC | Isolated in-memory SQLite routes/session; no destructive repo fixtures | PostgreSQL locks, concurrent transactions, actual role/seat isolation |
| Migration | Head graph/offline SQL inspection, additive to 0026 | Verified shared staging migration clean + existing data and rollback rehearsal |
| Audit/privacy | Allowed fields only, atomic transaction failure tests, PIN counter commit | Actual DB commit failure/locking behavior and safe operational logs |
| UI | Mocked API component tests including If-Match/reveal clearing/no permission | Real browser, 375/768/1280, keyboard/contrast and authenticated integration |
| Release | Code/build results to append after worker/main checks | P0 schema/backup/restore/artifact/login gates; not waived |

## Safety baseline

Production last verified FE v108 / BE v104 at f081c19a; this document does not remeasure it. Original local checkout remains earlier commit with approved patches and docs; do not reset dirty changes or build-release from ambiguous state. Preexisting desktop obj deletions are unrelated. No multiple pytest using shared DB; only isolated standalone tests while actual target is unknown.

## Status

Implementation workers started; no result/test count claimed yet. Append actual outputs and gaps after main reviews. Completion of a worker is not production acceptance. Wording remains proposal for BA review and does not acquire approval from test success.

## Main verification checkpoint

Both native workers timed out (backend run 5efac5f44e384963915c776e9055e665; frontend bc10249406bd4e579f0f40caedd08206), leaving edits. No worker success claimed. Main reviewed model/schema/service/router/client/UI and ran independent checks.

- Backend isolated SQLite/API suite: 74 passed in 26.87s. First invocation wrong cwd ran zero tests; corrected run found token-helper setup error, then added real app CORS test exposed test settings property mismatch. Both test setups corrected against actual code; final 74 pass. No production DB connected.
- Backend ruff app + new standalone test passed. Alembic head 0027_p1_email_registry; offline SQL 0026:head generated (3257 bytes), not a PostgreSQL migration rehearsal.
- Frontend focused registry/client/mockup: 33 passed after fixing ambiguous modal selector (initial 32 pass/1 fail). Typecheck/build/lint exit0, existing 10 Hooks warnings. Full suite rerun started; append final result separately.
- Main added CORS If-Match allowed / ETag exposed, tested origin preflight positive and negative via actual app middleware without lifespan/DB. Main scoped eligible-member query cache to user/workspace/role.

## Known incomplete integration / release blockers

Admin assignment options currently use existing /team/members, which is owner-only. Admin receives safe error and cannot select new assignees; backend reassign supports admin with known eligible UUID, but UI does not yet provide an admin-authorized picker. Do not expand generic team RBAC silently; a narrowly scoped registry picker needs a contract addition before completing this acceptance. Owner can use picker. This slice remains partial, not release-ready.

PostgreSQL lock/race/migration rehearsal, actual browser/viewport/wording review, secure index key provisioning, P0 backup/schema/restore/login are not verified. No commit/push/deploy/migration/stack creation this implementation step.

## P1-I1 final local checkpoint — 2026-11-26

Main full frontend: 676 passed / 20 skipped (49 passed / 1 skipped files), 69.70s, exit0; subsequent typecheck passed. Focused new UI/client/mockup 33 passed. Backend isolated SQLite/API 74 passed in 26.87s; ruff app + standalone test passed. Production frontend build/lint passed before final cache-key scoping edit (0 lint errors, 10 existing Hooks warnings); final full tests/typecheck cover that edit. No real browser/PostgreSQL acceptance claimed.

Schema/service/API/UI source slice exists, but P1-I1 is PARTIAL: admin assignee picker still hits owner-only team endpoint. Preserve team RBAC; next patch needs a scoped registry eligibility projection or separately agreed solution. No release until this and PG migration/locks, secure keys and P0/D1 gates are resolved. Migration head 0027_p1_email_registry and offline SQL generation verified only. No production deploy/migration, no new stack/DB, no commit/push in this step.

## Assignee picker integration follow-up

Resolved in source: registry-only GET /email-registry/eligible-members projection for owner/admin; does not widen owner-only team routes. Only active eligible same-workspace members, id/full_name output, no-store/audited/bounded; buyer/viewer/auditor denied. UI switched from /team/members and cache remains auth scoped. Contract amendment recorded. Tests started after this edit; prior 74 backend/676 frontend counts predate picker addition, do not treat them as final patch counts.

Picker follow-up backend verification: 79 passed in 30.42s, ruff passed. Frontend first picker rerun exposed old full-team fixture incompatible with new minimal DTO; fixture changed to actual {id,full_name}; backend still asserts inactive/foreign/viewer exclusions. Full frontend chain restarted, final result pending. Previous admin-picker blocker is resolved in source; PostgreSQL/staging/release gates remain.

## P1-I1 final source verification after picker integration

Backend 79 passed in 30.42s (isolated SQLite/API), ruff app + standalone test passed. Final full frontend 676 passed / 20 skipped (49 passed / 1 skipped files); typecheck, production build and lint chain exit0 (10 existing Hooks warnings). Final picker uses minimal server DTO id/full_name; no team RBAC expansion. Actual browser, PostgreSQL locks/races/migration rehearsal, secure production key provisioning and P0 backup/schema/login remain unverified. Local schema/service/API/UI implementation complete for this slice; operational/staging acceptance remains open. No commit/push/deploy or production migration; no new stack/DB/server.

## P1 completion follow-up — 2026-11-26

Native Sol read review aa02cd03c23940dfbc84cd96768089b4 completed: verified invisible-entry existence leak (buyer got403 vs missing404). Main changed entry lookup to include buyer assignment predicate, updated regressions to compare detail/history error codes/messages and reveal no-decrypt; reassignment revocation now404. Final standalone backend79 passed30.17s; ruff passed. No frontend source changes in this follow-up; previous676/20skip not rerun/claimed new. Added comment-only optional index key guidance to .env.example (no active empty secret setting).

Read-only environment checks: Vibe list_stacks contains existing AdsOps stack only, matching Docker containers absent, relevant workspace test/DB vars absent. These bounded checks do not prove no staging exists elsewhere. No new stack/DB created or production test/migration attempted.

Prepared manual provider runbook and completion ledger. Google recovery support page183723 read successfully; two Microsoft support URLs returned404 and search returned no usable source, so no Microsoft waiting period/process certified. No reminder/provider automation implemented. No commit/push/deploy or production changes; staging/PG/auth/backup/restore/key/manual QA gates remain open.
