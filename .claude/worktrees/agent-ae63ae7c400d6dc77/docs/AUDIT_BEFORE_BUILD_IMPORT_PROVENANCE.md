# Audit Before Build — import provenance on the account page

Date: 2026-09-15 · Baseline `0e21b69` · **This is the audit, not the build.**

---

## 1. The gap I described was wrong, and the real one is worse

I said the account page does not show where an imported account came from. Checked: it **does** —
`pages/account/AuditTab.tsx` lists every audit row for the account, including
`meta_discovery.ad_account_imported` with its metadata (run id, Business Manager reference,
source edge). The provenance is there, behind a raw action name and a JSON blob.

What is actually wrong is a **sentence that is now false**. `pages/account/OverviewTab.tsx` renders,
for `freshness: unknown`:

> "This account has never been synced with an advertising platform. A1 stores operator-entered
> records only — nothing here was fetched from a platform."

For the two accounts imported on 2026-09-14, the second half is untrue: their `display_name` and
`external_account_id` came from Meta's `owned_ad_accounts` edge through discovery. The first half
is still true — no figures or platform status have ever been synced — which is exactly why the
defect survived: half the sentence is right.

It was true when A1 shipped and became false when A10.3's import shipped. Nothing caught it because
it is a constant keyed only on freshness, with no knowledge of how the record was created. The
operator's own screenshot on 2026-09-14 shows it rendered under an imported account.

## 2. Where provenance actually lives

`ad_accounts` has **no origin column** — measured: workspace, external id, name, type, BM, owner,
country, currency, timezone, status, readiness, timestamps, tags, notes. Nothing about origin.

The only record is the audit row, which is permanent by rule 2/3 and already carries
`discovery_run_id`, `business_manager_reference` and `source_edge`.

## 3. Design

Derive, do not store. `GET /ad-accounts/{id}` gains

```
"imported_from_discovery": {discovery_run_id, business_manager_reference, source_edge, imported_at} | null
```

read from the newest `meta_discovery.ad_account_imported` audit row for that account.

- **Detail only, never the list** — one lookup per row would be N+1 on a page of 200 accounts.
- **No migration, no column.** The audit log is the system of record for how a row came to exist,
  and rule 3 guarantees it was written in the same transaction as the account.
- Nothing here is secret: a run id, a Business Manager id (public in Business Settings) and an
  edge name.

The wording then stops asserting something false, and says what is true for each case instead of
softening into something vague enough to be true for both.

## 4. Out of scope

No origin column, no backfill, no change to how imports work, no change to A1 readiness or A2
health, no list-endpoint change. The Audit History tab is left exactly as it is.

## 5. Expected changed files

`app/api/v1/routers/ad_accounts.py`, `app/schemas/*` if the response model needs the field,
`frontend/src/lib/types.ts`, `frontend/src/pages/account/OverviewTab.tsx`, tests both sides,
`FEATURES.md`, `TEST_LOG.md`. **No migration.**
