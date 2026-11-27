# P2 CSV export contract — approved source follow-up

2026-11-26. User asks fix all reproduced issues and complete plan source work; user deploys later.

- Export means ALL results matching current server filters and current platform/quick/card client filters, not current page.
- Fetch fresh page1 onward sequentially with25rows/page; cap10000 underlying authorized results, explicit error/no partial file above limit. Each page count/page/size/total checked; duplicate IDs or changed totals fail closed. These checks do not prove point-in-time snapshot when data mutates while total stays stable. No perfect snapshot claim.
- Both export actions share busy/cancel/error state; auth/token/route/filter change invalidates run. Cancellation prevents download, not abort server HTTP already sent.
- Text starting formula prefixes =,+,-,@ after whitespace/control gets leading apostrophe. Actual validated numeric raw columns keep negative/zero/exact decimal. Invalid numeric/formula-like values treated as text. Existing unknown emdash, column order, UTF8BOM,CRLF and quote escaping retained.
- No new endpoint/backend auth/CSV full email exposure. File uses existing account payload scope. Excel/LibreOffice/manual browser compatibility still must be tested; local Blob tests not certificate.
- No custom data-snapshot or export-all background task; future >10000bulk or immutable snapshot requires separate contract.

Implementation targets: frontend/src/lib/accountsCsv.ts, Accounts.tsx, accounts-csv.test.tsx, i18n/accountsExport.ts. Focused worker15tests reported pass; main combined and final full-suite results recorded in TEST_LOG after I2 stabilizes.
