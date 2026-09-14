# Audit Before Build — O1.1 (BM Discovery Workspace UX)

Date: 2026-09-14 · Baseline: `ca0754c` + the A10.2 write capability and the startup-logging fix.

**This is the audit, not the build.** O1.1 §9 and its guardrail 1 both forbid code before this
report. No production code was changed to produce it.

---

## 1. Verified baseline, and deviations from the spec

The spec's §2 is largely accurate. Four deviations matter, and the first one changes the shape of
the work.

### 1a. The route the spec is built around addresses an empty table

O1.1 asks for `/business-managers/{business_manager_id}/…`. In this codebase
`business_managers` is the **A1 registry** table — operator-entered records. Discovery does not
point at it:

```
BusinessManagerDiscoveryRun.meta_connection_id                 → FK to meta_connections
BusinessManagerDiscoveryRun.configured_business_manager_reference → a STRING, no foreign key
```

Counted in the development database today:

| Table | Rows |
|---|---|
| `business_managers` (registry) | **0** |
| `ad_accounts` (registry) | **0** |
| `meta_connections` | 4 |
| `business_manager_discovery_runs` | 7 |
| `discovered_ad_account_observations` | **20** |
| `discovered_pixel_observations` | **16** |

So 36 real observations exist and **there is no registry Business Manager to open a workspace
for**. A BM row appears only when someone uses A10.3's Add-to-Registry — which has never been
clicked. Built exactly as written, every BM workspace URL would 404 on day one.

This is not an argument against the spec's direction; it is the ordering. Either the workspace is
keyed by connection (where the data actually lives), or Add-to-Registry has to run first and the
spec's flow starts one step earlier than it says.

### 1b. The spec's declared source of truth does not exist

`FEATURES-AUDIT-DIS.md` is named as *Source of truth* in the header and first in §9.1's required
reading. **It is not in the repository**, and `git log` shows no commit ever adding it.
`docs/META_CONNECTION_SETUP.md` is also absent; the real file is
`docs/RUNBOOK_META_CONNECTION.md`. The other nine documents in §9.1 exist and were read.

### 1c. Discovery is owner-only, which contradicts §9.3 q4's premise

All 23 routes in `meta_operations.py` use `OwnerCtx`. That is deliberate and documented in
`ACCESS_SCOPE_MATRIX.md`: a batch item records an external id that may not correspond to any local
record, so membership scope cannot be proven for it, and A9's own rule for that case is to deny
rather than guess. O1.1 must either keep the whole workspace owner-only, or scope it by the
registry BM — which returns to 1a.

### 1d. Two spec facts are stale in our favour

- §2.2's "4 accounts split 2 owned + 2 client" was the 2026-09-10 measurement. The current
  connection returns **8 accounts, 5 owned + 3 client**, and 7 Pixels.
- §2.1 says A10.3 authority/import UI "may still need click-through confirmation". Authority
  **has** been click-through verified on real data: a connection pointed at a BM this token has no
  role in rendered `0 · Unknown` with "could not prove access to this Business Manager".
  **Add-to-Registry has still never been clicked.**

## 2. Documents and code inspected

Documents: `MINI_SPEC_PLAYBOOK.md`, `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`,
`docs/AUDIT_BEFORE_BUILD_A10.md`, `_A10_1.md`, `_A10_3.md`, `docs/META_READ_ONLY_DISCOVERY.md`,
`docs/ACCESS_SCOPE_MATRIX.md`. Absent: `FEATURES-AUDIT-DIS.md`, `docs/META_CONNECTION_SETUP.md`.

Code: `models/meta_discovery.py`, `models/meta_operations.py`, `models/entities.py`,
`services/meta_discovery.py`, `services/meta_provider.py`, `services/meta_real_provider.py`,
`services/registry.py`, `api/v1/routers/meta_operations.py`, `core/production_checks.py`,
`frontend/src/App.tsx`, `pages/BusinessManagers.tsx`, `pages/MetaConnections.tsx`,
`pages/Accounts.tsx`, `components/meta/DiscoverySection.tsx`,
`components/meta/DiscoveryOverview.tsx`, `components/ui.tsx`, `lib/readiness.ts`, `lib/types.ts`.

## 3. Regression baseline

Run before any O1.1 change, per §9.2. Results recorded in `TEST_LOG.md`; the last completed full
run on this tree was **797 backend passed, exit 0**, with frontend **110 passed**, `tsc -b` 0,
eslint 0, ruff clean.

## 4. Current API and frontend map

| Need | Exists today |
|---|---|
| BM registry CRUD | `GET/POST /business-managers`, `GET/PATCH /business-managers/{entity_id}`, archive/restore |
| Discovery run | `POST /meta-connections/{id}/discoveries` |
| Latest run + reconciliation | `GET /meta-connections/{id}/discoveries/latest` |
| Cross-connection summary | `GET /meta-connections/discovery-summary` |
| Add to Registry | `POST /meta-connections/{id}/discoveries/{run_id}/imports` |
| **Discovery history** | **none — only `latest`** |
| **Per-BM anything** | **none — everything is keyed by connection** |

Frontend routes: `business-managers` (list only, no `:id` detail), `accounts/:accountId`,
`meta-connections` (where all discovery UI lives today).

## 5. Reusable pieces

TanStack Query v5 throughout; `useSearchParams` is the URL-filter convention (`Accounts.tsx`).
`Badge`/`Card`/`Field`/`InlineNote`/`ErrorState` in `components/ui.tsx`, tones centralised in
`lib/readiness.ts` (`TONE_CLASS`/`TONE_DOT`). `AssetResult` in `DiscoverySection.tsx` already
renders per-edge coverage, the not-attempted state, the per-status reason sentence and the
per-row Add-to-Registry button. `DiscoveryOverviewTable` already renders coverage, reader
identity, the environment badge and the duplicate-BM warning. **Most of §5.2 and §11.3's BM-list
requirements already exist** — on the Overview page rather than a BM page.

## 6. Confirmed gaps

| Gap | Class |
|---|---|
| No registry BM exists to open a workspace for (§1a) | **data_model** |
| Reconciliation rows carry no structured `source_edge`; the edge is only prose inside `detail` | **API** |
| No discovery-history endpoint | **API** |
| No `business-managers/:id` route or workspace page; no tabs | **frontend_UX** |
| Discovery is owner-only vs the spec's scoped-access expectation | **security** |
| Add-to-Registry never click-through verified | **testing** |
| Production frontend unreachable, so O1.1 cannot be verified there | **deployment** |

`source_edge` is the cheapest of these: the column already exists on both observation tables, so
exposing it is a DTO addition, not new logic.

## 7. Decision — existing APIs are not sufficient

Two minimal, read-only additions are needed, and no more:

1. `source_edge` added to each ad-account reconciliation row (and the Pixel equivalent).
2. A discovery-history list endpoint, paginated, per connection.

**Not** the five endpoints in §7B. Four of them are keyed by `business_manager_id`, which §1a
shows has nothing to address yet. Adding them now would mean building a read model for rows that
do not exist.

## 8. Add-to-Registry plan

Reuse unchanged. It already satisfies §E's requirements: per-row, internal-only, confirmed by the
operator, one audit row naming the run and edge, zero provider calls (pinned by a test). The only
work is presenting it inside the new workspace and finally clicking it.

## 9. Expected changed files

Backend: `api/v1/routers/meta_operations.py`, `services/meta_discovery.py` (DTO only),
`schemas/meta_operations.py`, plus tests. Frontend: `App.tsx`, a new BM workspace page and tab
components, `lib/types.ts`, `components/meta/*`, plus tests. **No migration** — every field O1.1
needs is already stored.

## 10. Risks

**The biggest risk is building the spec literally.** §1a means a BM-keyed workspace has no rows;
the honest reading is that O1.1's workspace should be keyed by **connection**, with the registry BM
shown as an attribute, until imports populate the registry.

Wording risk is low: the coverage, authority and absence vocabulary O1.1 mandates is already
implemented and tested — including the per-status reason sentence and the `Fake data` badge.

Verification risk is real: **production frontend is unreachable** (platform-side routing, three
hostnames tried). O1.1 can only be verified locally, and this report will not claim otherwise.

## 11. Explicit confirmations

No Meta write is added or executed. No new discovery engine, provider transport, coverage
calculator, authority evaluator or reconciliation engine. No auto-import, no bulk import. No fuzzy
matching. No hard delete. No Pixel→BM mapping. No deployment, ingress change, Telegram send or
secret configuration. A6 Preflight untouched.
