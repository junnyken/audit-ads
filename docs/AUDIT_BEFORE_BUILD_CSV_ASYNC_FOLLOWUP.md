# Follow-up fixes — CSV integrity and async form lifecycle

2026-11-26. User explicitly authorizes fixing all three reproduced defects and continuing plan source work; user will deploy later. No production deployment/migration/new stack/DB.

## Goal / scope

1. Spreadsheet-safe CSV textual cells without corrupting genuine raw numeric negative/precision values.
2. Export ALL current authorized filtered account results, not current page; carry server filters and client platform/quick/card filters; bounded sequential pagination, fail closed on errors/duplicates/count/page inconsistency, no partial file. Backend API has no immutable snapshot: document limitation honestly, not a perfect snapshot promise.
3. Old form instance callbacks cannot close/overwrite a newly opened email form after cancel/navigation/auth change. Server mutation may still finish; invalidate correct scoped cache without stale UI callbacks.

## Design / constraints

Reuse current API/auth/schema/components/i18n, no new backend export endpoint/permissions/engine. CSV policy: protect text starting formula prefixes including leading control/whitespace; numeric raw fields emitted unchanged only if strict decimal syntax valid, malformed numeric text protected as text; unknown marker retained. Escape commas/quotes/CR/LF, BOM/CRLF/header order. Export limit explicitly disclosed, no silent truncation; cancel/late response/auth scope no wrong-user download.

Minimal lifecycle guard in EntryForm and AdminAction (same class of callback), callbacks separated safe server-change invalidation vs current-instance UI; no synthetic cancellation of sent write, clear plaintext local state. Add deferred promise regressions negative fail-before/pass-after.

## Test / rollback

Actual click/Blob tests formula prefix vectors/negative numbers/high precision, multi-page/filter/client filters, failure/duplicates/count drift/limits/no partial download; UI old success/failure canceled/reopened draft preserved plus correct cache invalidation. Full frontend suite/typecheck/build/lint. No PG/provider/browser claims. Rollback source artifact only, no DB changes. Record remaining snapshot consistency limits. Existing investigation characterization fixtures archived are not safe regression tests.
