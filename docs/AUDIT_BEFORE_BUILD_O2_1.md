# Audit Before Build — O2.1 (Discovery Authority/Coverage UAT Hardening)

Date: 2026-09-14 · Baseline: `c98d36c` · **This is the audit, not the build.** No product code was
changed to produce it. Guardrail 1 requires §2's facts to be re-measured rather than trusted; they
were, and three of them are wrong.

---

## 1. §2's ground truth, re-measured

| Spec says | Measured now | Verdict |
|---|---|---|
| `business_managers` = 1 (Quảng Cáo Top, `1993884657458857`, UNKNOWN) | 1 row, exactly that | ✅ |
| `ad_accounts` = 2, both mapped to that BM, status/readiness UNKNOWN | 2 rows, exactly that | ✅ |
| `discovered_ad_account_observations` = 20 | 20 | ✅ |
| `business_manager_discovery_runs` = 7 | 7 | ✅ |
| `business_managers` has no link to a connection or run | confirmed: columns are workspace_id, external_id, name, status, country, currency, notes, id, created_at, updated_at, archived_at | ✅ |
| Three audit rows for the import, `read_as: null` faithful to the run | confirmed | ✅ |
| **"6 still `missing_in_registry`"** | see §2 — **this is an assumption, not a measurement** | ⚠️ |
| Discovery routes owner-only | confirmed, all routes use `OwnerCtx` | ✅ |
| CI green on its first-ever run | run `34819289771`, `total_count: 1`, 2 jobs, every step success, 341s | ✅ |

## 2. Deviation 1 — "6 still missing_in_registry" is arithmetic, not a reading

8 observed − 2 imported = 6 is the spec's reasoning, and it is probably right. But reconciliation is
**recomputed on request against the registry as it stands**, and no endpoint has been called since
the import. The count of `missing_in_registry` rows has therefore never actually been observed. B1
must read it, not assume it.

## 3. Deviation 2 — the established live-verify pattern cannot log in

This is the blocking finding.

`scripts/a9_live_verify.py`, the pattern §5.A names, signs in as:

```
EMAIL    = "trieunt@matbao.com"
PASSWORD = "dev-password-6779"
```

The dev database holds **exactly one user**, `uxui.matbao@gmail.com`, created 2026-09-10. The
account those scripts use **no longer exists**, so every prior live-verify script in this repo is
currently unrunnable, not just a new one. Playwright itself is fine
(`/home/coder/workspace/projects/Translation/.venv/bin/python -c "import playwright"` succeeds).

The one existing account's password is not in the repository and not held by the agent. Guardrail 5
forbids minting a session, and that refusal is correct — the same refusal is what forced the real
"Add to registry" click that produced O1.1's most valuable finding. **So B1–B6's browser half cannot
be executed by the agent. It needs the operator to supply the credential in their own shell, or to
run the script themselves.** Nothing about that is worked around here.

## 4. Deviation 3 — three of B3/B4/B6's states are not covered by *any* test

The spec assumes these are "verified in code but never seen on screen". Measured against the test
suites, that is too generous for three of them — they are not verified in code either:

| State | Rendered by | Asserted in a test? |
|---|---|---|
| `complete` | `CoverageBadge` → "Complete" | ✅ |
| `incomplete` | → "Incomplete" | ✅ |
| `stale` | → "Stale" | ✅ (Overview table only) |
| **`partial`** | → "Partial" | ❌ **never asserted** |
| **`not_attempted`** | → "Not attempted" | ❌ **never asserted as rendered output** |
| **`unknown`** | → "Unknown" | ❌ **never asserted** |
| **Pixel reverse-absence text** (`registry_absence_evaluable`) | `AssetInventory` / `AssetResult` `emptyNote` | ❌ **zero test references** |
| authority `not_established` caveat | `InlineNote` | ✅ (2 references) |

Four real gaps, closable without a browser. This is the cheapest genuine value in O2.1 and it does
not depend on the credential.

## 5. B7 needs no browser either

`tests/test_a9_scope_enforcement.py` already has the pattern: a real signed-in **BUYER** member of
the *same* workspace (`member_headers`). O1.1's existing test only covers a *different workspace*
(`test_another_workspaces_history_is_not_disclosed`). A non-owner **member of the owning workspace**
hitting the discovery endpoints has never been tested. Real gap, closable as a backend test.

## 6. What can and cannot be done in this slice

| Scenario | Executable now | Why |
|---|---|---|
| B1 registry-linked state on screen | ❌ | needs a real login |
| B2 edge filter on screen | ❌ browser / ✅ logic | filter logic already tested; the *rendered* split is not |
| B3 coverage states | ✅ (fixtures) | four labels currently unasserted |
| B4 authority | ✅ (fixtures) | caveat already covered; empty-inventory-plus-unknown is not |
| B5 discovery history | ✅ (fixtures) | per-run isolation already covered by `connection.workspace.test.tsx` |
| B6 Pixel asymmetry | ✅ (fixtures) | wording has no test at all |
| B7 non-owner refusal | ✅ | reuse A9's member fixture |
| B8 re-measure registry | ✅ | a query |

## 7. Expected changed files

`frontend/src/test/connection.workspace.test.tsx` (B3/B4/B6 rendering),
`backend/tests/test_o1_1_discovery_workspace.py` (B7),
`backend/scripts/o2_1_live_verify.py` (new; runnable by the operator),
plus `TEST_LOG.md` and the report. **No product code unless a scenario shows a real defect.**
No migration.

## 8. Risks

- **The headline risk is reporting O2.1 as "verified on screen" when the screen was never opened.**
  Every browser scenario stays explicitly unexecuted until someone signs in.
- Extending fixtures for rare coverage states must not drift into a parallel simulation mechanism
  (guardrail 4). The existing `result()` helper already takes a `coverage_status`; nothing new is
  needed.
- `a9_live_verify.py`'s stale credential is a pre-existing defect in a verification tool, outside
  O2.1's stated scope. It is recorded here as a follow-up rather than quietly repaired.

## 9. Explicit confirmations

No Meta write. No new provider method, discovery engine, coverage algorithm or authority algorithm.
No Pixel→BM mapping. No scope or authorization change — discovery stays owner-only. No production
routing work. No session minted. No new endpoint or UI capability.
