# P0 frontend audit — 2026-11-26

Authorized: five frontend pages only, focused new tests and this audit. No network, production, backend, Settings or commits.

Confirmed gaps: Overview lacks T1 attention tiles/health query, readiness distribution, Meta status/freshness and discovery permission note. Reuse existing StatTile, SegmentBar, PlatformStatusSummaryCard, SpendFreshnessCounts, DiscoveryOverview, tokens/i18n. Keep newer telemetry/features. Inventory orphan warning absent. Accounts already has grouping; restore required default columns and chooser persistence contract. Alerts hides delivery/notified by default.

Historical navigation conflicts: Operations test requires exactly four links but valid Meta Connections, Extension and Playbook links now exist. Assets test requires old reference names while current five tabs have descriptive labels/counts and richer panels. Preserve new functionality; report conflicts rather than weaken tests.

Validation: focused suites then one full suite (maxWorkers2/minWorkers1), lint/typecheck/build. Browser, dark mode, responsive layout and screen reader verification not performed. No new libraries or wording.

## Implementation and verification

Changed by this task: `frontend/src/pages/Overview.tsx`, `Accounts.tsx`, `Alerts.tsx`, and this audit only. Existing edits retained. Assets/Operations inspected without edits; no existing test changed, removed, weakened or skipped. No new dependency, API, enum or wording. Overview CRLF preserved; Accounts/Alerts kept their existing LF format.

- Overview: restored independent health-summary query and four attention tiles with loading/error/retry states; readiness SegmentBar uses central tones and filter links. Reused Meta summary/freshness components and owner discovery component, with an explicit existing permission note for non-owners. Inventory orphan banner links to `?unassigned_identity=true`; inventory BM/VIA links open Accounts' existing grouping through `view_mode`.
- Accounts: six default data columns plus account/actions (eight total): recorded, Meta, readiness, checklist, spend, updated. Chooser saves to the original per-viewer `accounts` key and falls back to existing `accounts_v3` preferences, preserving prior choices and optional columns.
- Alerts: delivery and last-notified columns visible by default; existing optional columns retained.

Commands/results (all local, no live/server/DB work):

1. Focused run: `npm run test -- src/test/u1b.overview-accounts.test.tsx src/test/accounts-spend.test.tsx src/test/alerts.components.test.tsx src/test/u1d.actions.test.tsx src/test/u1d.lists.test.tsx --maxWorkers=2 --minWorkers=1`: initially 118 passed / 3 failed. Fixed the duplicate readiness span by making the legend entries useful filter links.
2. Focused restoration recheck: `npm run test -- src/test/u1b.overview-accounts.test.tsx src/test/accounts-spend.test.tsx src/test/alerts.components.test.tsx --maxWorkers=2 --minWorkers=1`: 55 passed / 0 failed.
3. Full suite ONCE: `npm run test -- --maxWorkers=2 --minWorkers=1`: **638 passed / 3 failed / 20 skipped**, 42 files passed / 3 failed / 1 skipped; 77.92s. Baseline 628 passed / 13 failed / 20 skipped, so ten failures resolved. Existing skips retained.
4. `npm run lint`: exit 0, zero errors / ten warnings in other files.
5. `npm run typecheck`: exit 0.
6. `npm run build`: exit 0, Vite built in 9.23s.
7. `git -c core.whitespace=cr-at-eol diff --check -- frontend/src/pages/Overview.tsx frontend/src/pages/Accounts.tsx frontend/src/pages/Alerts.tsx`: clean. Plain git whitespace check treats preserved CRLF as trailing whitespace.

Logs: `/tmp/adsops-p0-20261126/frontend-p0-{focused,focused-restored,final-full,lint,typecheck,build}.txt`.

## Unresolved with specific evidence

- `src/test/u1d.actions.test.tsx:97`: exact global link-array assertion expects four entries; actual retains those four plus `/meta-connections`, `/chrome-extension`, `/operations-guide`. These are current functional hubs in `Operations.tsx`. Removing them for green would remove useful navigation.
- `src/test/u1d.lists.test.tsx:163`: exact tab-label assertion expects Page/Pixel/reference labels; actual has five tabs with Fanpage, Dataset/Pixel, Payment Card, Chrome Profile, Static IPv4 Proxy labels and counts (`Assets.tsx:528`). The same test's keyboard and reference-policy-note assertions are not reached after the label failure; no claim that those pass. The old reference-policy note is absent from the current richer Assets page. This needs main's acceptance/policy decision, not arbitrary tab/function removal or insertion of potentially conflicting policy copy.
- `src/test/u1f.meta-settings.test.tsx:825`: Settings password/autocomplete assertion still fails; Settings/Telegram are explicitly owned elsewhere. No changes here.

No browser UAT, visual contrast/layout, mobile, dark-mode or real assistive-technology verification. Existing axe checks in passing focused suites are jsdom checks, not visual verification. No production, network, server, DB operation or commit performed.
