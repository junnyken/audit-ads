# MINI-SPEC O1.1 Report — BM Discovery Workspace UX

Date: 2026-09-14 · Audit: `docs/AUDIT_BEFORE_BUILD_O1_1.md` (written before any code, per §9 and
guardrail 1)

## 1. Summary

An operator can now open one connection and see everything discovery knows about it, in four tabs:
Overview, Ad Accounts, Pixels and Discovery History. Every reconciliation row states the Graph edge
that returned it and can be filtered on that edge; the history tab lists every run the connection
has recorded, each carrying its own coverage, authority and reader identity.

Two read-only backend additions were needed, and nothing more. No migration, no new table, no new
column, no new outbound call. **The workspace is keyed by connection, not by Business Manager** —
the one substantive deviation from the spec, explained in §3.

Nothing was deployed, no Meta write was issued, no Telegram message was sent.

## 2. Audit Before Build

Recorded in full in `docs/AUDIT_BEFORE_BUILD_O1_1.md`. The findings that changed the work:

- `business_managers` is the A1 registry and holds no discovery data. Counted on 2026-09-14:
  **0 registry Business Managers and 0 registry ad accounts**, against 4 connections, 7 runs and 36
  observations. A workspace at `/business-managers/{id}/…` would have 404ed on every URL.
- `FEATURES-AUDIT-DIS.md`, named in the spec header as the source of truth, **is not in this
  repository** and never has been. `docs/META_CONNECTION_SETUP.md` is also absent; the real file is
  `docs/RUNBOOK_META_CONNECTION.md`. The other nine documents in §9.1 exist and were read.
- Discovery is owner-only across all 23 routes in `meta_operations.py`, which contradicts §9.3 q4's
  premise. Kept owner-only; the reasoning is in `docs/ACCESS_SCOPE_MATRIX.md`.
- Two spec facts were stale in our favour: the BM now returns 8 accounts (5 owned + 3 client), not
  4; and the authority gate **has** been click-through verified on real data. Add-to-Registry has
  still never been clicked.

## 3. Design Choice

**Keyed by connection.** `BusinessManagerDiscoveryRun` points at `meta_connections`; the Business
Manager it read is a string with no foreign key. The connection is where every run, observation and
coverage record actually hangs, so the workspace lives at `meta-connections/:connectionId` and the
Business Manager is presented as an attribute of the connection — which is what the schema says it
is. When imports populate the registry, a BM-keyed view becomes possible without moving any of this.

**The five endpoints of §7B were not built.** Four are keyed by `business_manager_id` and would be
read models over rows that do not exist. The two that were built are the two the UI could not be
honest without.

**History carries no reconciliation.** Reconciliation is recomputed against the registry as it
stands *now*. Attaching it to a week-old observation would place two moments side by side and
invite reading one as evidence about the other.

**`source_edge` is `null`, never guessed,** for a row that came from the registry rather than from
an observation. An internal record no observation matched was not returned by any edge, and saying
otherwise would assert a reading that never happened.

## 4. Changed Files

Backend:
- `app/services/meta_discovery.py` — `ReconciliationRow.source_edge`, set from the observation on
  matched and `missing_in_registry` rows for ad accounts and Pixels alike.
- `app/api/v1/routers/meta_operations.py` — `source_edge` in `_serialize_reconciliation`;
  `_serialize_run_summary()`; `GET /meta-connections/{connection_id}/discoveries`.
- `tests/test_o1_1_discovery_workspace.py` — new, 11 tests.

Frontend:
- `src/lib/types.ts` — `source_edge` on `ReconciliationRow`; new `DiscoveryRunSummary`.
- `src/components/meta/AssetInventory.tsx` — new; the filterable inventory of one asset type.
- `src/components/meta/DiscoverySection.tsx` — `CoverageBadge`, `ReconciliationBadge`, `edgeLabel`,
  `whyNotMissing` and `RECONCILIATION_LABEL` exported for reuse. No behaviour changed.
- `src/pages/MetaConnectionWorkspace.tsx` — new; the four-tab workspace.
- `src/pages/meta-connection/HistoryTab.tsx` — new; `DiscoveryHistoryList` (pure) plus its fetching
  and pagination wrapper.
- `src/pages/MetaConnections.tsx` — "Open workspace" on each card.
- `src/App.tsx` — the `meta-connections/:connectionId` route.
- `src/test/connection.workspace.test.tsx` — new, 17 tests.
- `src/test/discovery.components.test.tsx` — 7 fixtures updated for the new required field.

Docs: `API.md`, `ARCH.md` §4h, `FEATURES.md`, `TEST_LOG.md`, this report.

## 5. New API/DB/State

**No database change.** Every field O1.1 needed was already stored.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/meta-connections/{id}/discoveries` | Owner-only, `page`/`page_size` (max 100), newest first, **no provider call** |

`source_edge` is added to every ad-account and Pixel reconciliation row on the existing
`POST /discoveries` and `GET /discoveries/latest` responses. It is additive: no field was removed
or renamed.

## 6. Tests

**Backend 808 passed, exit 0** (797 before). **Frontend 127 passed, 20 skipped** (110 before),
`tsc -b` exit 0, `eslint .` clean, `npm run build` succeeded.

The 11 backend tests cover: the edge on owned- and client-sourced rows; the edge surviving an
import; the Pixel edge; history ordering; pagination in this project's own convention; per-run
coverage and authority including a `not_attempted` edge; the deliberate absence of reconciliation;
that the GET triggers no provider call; that nothing token-shaped appears in the payload; that
another workspace's history answers **404, never 403**; and that a connection with no runs returns
an empty page rather than an error.

The 17 frontend tests cover the edge filter (including that a row with no edge is dropped rather
than swept into the selected one), the combined edge+status filter, the per-row edge wording, the
"no observation matched this internal record" wording, that an incomplete read never looks like an
empty Business Manager, that an empty filter result is described as a fact about the filter, that
Add-to-Registry appears only on rows actually absent from the registry and never on Pixels, and —
for history — per-run coverage isolation, the authority badge, the `Fake data` badge, failures,
`Time not recorded`, and the absence of reconciliation.

**A defect the tests found in this change's own code:** an ad-account row not yet in the registry
carried `source_edge`, but the Pixel row in the same state did not. Fixed in `meta_discovery.py`.
`tsc -b` separately named all seven stale fixtures by line — the old `tsc --noEmit` compiled zero
files here and would have reported success.

## 7. Live Verification

**Performed 2026-09-14 by the operator**, in Chrome against the local stack (frontend :5173, API
:8001, Postgres :5434). The agent did not sign in: minting a session token was refused by the
safety classifier as credential materialisation and was not worked around. That refusal turned out
to be the right outcome on its own terms — an imported row must carry a real actor, and it does.

```
Add to registry: exercised = true (clicked twice, on two owned accounts)
Registry row count before: business_managers=0, ad_accounts=0, audit_logs=28
Registry row count after:  business_managers=1, ad_accounts=2, audit_logs=56
Audit entry created: confirmed
Zero Meta provider write calls during this action: confirmed
Production frontend: still not reachable, not part of this verification
```

Imported: `Q.C-1` (1069545664559001) and `Q.C - 2` (1594590901195302), both from
`owned_ad_accounts`, both from run `8d153a28…` against BM `1993884657458857`. The Business Manager
row was created once, on the first import, and reused by external id on the second — the behaviour
the design claimed, seen rather than asserted.

**Audit entry.** Each import wrote `meta_discovery.ad_account_imported` naming
`discovery_run_id`, `business_manager_reference` and `source_edge`, with a real `actor_id`. The
first also wrote `business_manager.created` carrying `created_from_discovery_run_id`. The full A1 →
A2 → A3 chain fired behind each one in the same transaction: `readiness_checklist.initialised`,
three `health_signal.opened` (`readiness_unknown`, `mandatory_readiness_evidence_missing`,
`manual_review_due_or_stale`), `health_snapshot.changed`, three `alert.created`, three
`notification.skipped` (`no_recipient_configured` / `severity_delivery_disabled` — Telegram is not
configured and nothing was sent).

Both imported accounts sit at readiness `UNKNOWN`, which is correct and worth stating: Meta having
returned an account is not evidence that this workspace is ready to run ads on it.

**Zero Meta calls.** The only `meta_graph_transport` line in the dev log is dated 2026-09-12. The
two import requests (`POST …/imports`, `201`, 362 ms and 250 ms) and the `GET …/discoveries/latest`
refetches that follow them are the whole network story of the action.

**Overview tab with a linked BM: not applicable — it was never built.** The operator's checklist
expected the Overview tab to stop saying "not yet added to registry"; no such string exists, and
that tab shows the Business Manager the *run* read, from the run, so it looks the same before and
after. What did change, and was seen: the row flipped from **Not in registry** to **Matched**, and
the registry went from empty to 1 BM / 2 accounts. There is also no confirmation dialog — the
button acts immediately; the deliberation is that it appears only on `missing_in_registry` rows,
one button per row.

### The click found a defect 145 automated tests did not

Every row rendered the same fact twice: *"Returned by Owned accounts · Returned by
owned_ad_accounts."* The server's `detail` restated in prose what `source_edge` now carries as
data, and the new tab rendered both — once translated, once raw. This is precisely the duplication
O1.1 set out to remove, reintroduced by the change that removed it.

Fixed: `detail` is empty on `missing_in_registry` rows, both UIs read the structured field, and a
test asserts the sentence appears exactly once and the raw edge name never reaches the screen.
**No test could have caught it** — each half was correct alone, and no assertion compared them.

## 8. Remaining Limits / Follow-ups

1. **Click "Add to registry" once** — needs either the local dashboard password entered by the
   operator in their own browser, or approval for a local token-minting command. Until then the
   import path is verified only by automated tests.
2. **Production frontend routing** — the stack plan declares the `web` service but stack membership
   contains only the api. A platform-side fix; `deploy_stack` could resurrect the deleted
   `extension` service and was not run.
3. **A BM-keyed workspace** remains possible and is not ruled out — it becomes buildable the moment
   the registry has rows, and nothing in this release stands in its way.
4. **Multi-Business-Manager in practice** still waits on `adsops-admin` being made a member of the
   second BM. Today a discovery against it honestly reports `0 · Unknown`.
