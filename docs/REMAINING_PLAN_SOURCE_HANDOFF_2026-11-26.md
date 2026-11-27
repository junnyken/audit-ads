# Remaining plan source handoff — no deployment

2026-11-26. User delegates fixes and source-plan continuation while away, will deploy later.

## Decisions executed

- CSV scope chosen ALL current filters (server plus platform/quick/card), not current page; no partial file and explicit limit10000. Count/ID validation cannot prove immutable database snapshot. Cancellation suppresses download, does not promise abort server work.
- CSV formula protection applies to text including whitespace/control-prefix cases; strict raw numeric columns preserve valid negative/precision/zero. Not real Excel/LibreOffice compatibility certification.
- Email form/admin mutation old-instance callback guarded; sent write may finish, original auth-scope cache invalidation still happens; no stale UI close/error. No fake mutation undo.
- P1-I2 defaultoff in-app attention from due-at read query; registry-only admin config persists in existing AlertPolicy storage, no dispatcher/outbound/new engine. Migration0028 additive after0027, not executed on DB.

## Verification status

Lifecycle31tests pass8.26s, negative control2fail when guards removed/restored. CSV worker15focused pass, protection negative control reported; main combined rerun initially44pass2fail due new reminder config missing from old fixture, fixture corrected to actual API shape (not assertions weakened); final after full worker handoff pending.

## Operational constraints not waived

No deployment/migration/stack/DB/server or live provider/Telegram. No commit/push required by current instruction, no main publication while user away. Still need PG migration/locks/races, staging auth/RBAC/UAT, backup restore/artifact rollback, production keys and exposed token revocation, manual UI/wording review, Microsoft provider-source verification. P2 workflow/time-saving claims require measured real tasks; no fabricated improvement percentages. P3 deployment is explicitly left to user after gates, not executed.
