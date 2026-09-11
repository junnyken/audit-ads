# Read-only asset discovery (A10.1)

What a discovery run reads, what each result means, and — the part that matters most — when the
product is allowed to say an asset is missing.

Setup for the connection and the token lives in `docs/RUNBOOK_META_CONNECTION.md`; this document
does not repeat it.

## Scope

A run reads, for one **configured** Business Manager:

| Asset | Graph edges read | Verified |
|---|---|---|
| Ad accounts | `owned_ad_accounts`, `client_ad_accounts` | Documentation for the first; the second live, on a real BM |
| Pixels | `adspixels` | Documentation, and live |

It never creates, shares, edits or removes anything on Meta. The provider's write methods raise,
and the transport beneath has no method that can POST — two independent reasons, neither of them
a setting.

## Coverage: why a count is not an answer on its own

**A run is only allowed to conclude something is absent when it saw everywhere it was required
to look.** Not when nothing errored — those are different claims, and the difference is not
academic.

Measured on a real Business Manager on 2026-09-10: four ad accounts, split exactly two and two
between `owned_ad_accounts` and `client_ad_accounts`. A run reading only the edge the official
guide documents succeeds at everything it attempts. An error-based notion of completeness calls
that run complete — and reconciliation then reports the two client-shared accounts as missing.
Half the inventory invisible, a scan calling itself complete, and no error anywhere to hint at
it.

So each asset type carries `required_edges` and a `coverage_status`:

| Status | Meaning | May conclude "missing"? |
|---|---|---|
| `complete` | Every required edge answered, nothing truncated | **Yes** |
| `partial` | An edge was cut short — page cap, rate limit, server error | No |
| `incomplete` | An edge could not be read, or was never attempted | No |
| `unknown` | An edge failed in a way this product cannot categorise | No |
| `stale` | The observation is older than the freshness policy | No |
| `not_attempted` | The asset type was never asked for | No |

Per-edge detail is stored with the run, including edges that were **never attempted** — a
boolean cannot express that, and it is exactly what someone reviewing a `missing` conclusion
weeks later needs to see:

```json
{"edges": {
   "owned_ad_accounts":  {"required": true, "status": "completed",     "pages": 1, "items": 2},
   "client_ad_accounts": {"required": true, "status": "not_attempted", "pages": 0, "items": 0}},
 "total_unique_assets": 2}
```

An edge appearing on both lists is counted once; the union is de-duplicated by exact id.

**Adding an edge later invalidates old coverage** rather than silently reinterpreting it. That is
why `required_edges` is stored per run instead of read from today's constant.

## Identity

Matching is by exact canonical external id, never by display name — duplicate and renamed assets
make name matching unsafe.

Ad account ids go through A5's `canonical_external_id`: Meta writes an account as `act_123` on
the `id` field and `123` on `account_id`, and the registry stores whichever form an operator
typed. Comparing the raw strings would report the same account as both missing from the registry
*and* missing from discovery — two false conclusions from one formatting difference.

## Reconciliation statuses

| Status | Means |
|---|---|
| `matched` | Exact id present in both the discovery union and the registry |
| `missing_in_registry` | Meta returned it; no active registry record has that id |
| `missing_from_latest_discovery` | A registry record, provably under the configured BM, was not returned by a **complete** scan |
| `metadata_mismatch` | Same id, differing safe metadata; never overwritten automatically |
| `out_of_scope` | The record cannot be shown to belong to the configured BM |
| `unknown` | No usable id, or coverage was not complete |

The order is deliberate. `missing_from_latest_discovery` is the strongest claim available, so it
sits last and every earlier branch is a reason not to reach it:

```
no usable external id                  → unknown
exact id present in the union          → matched
no proven Business Manager mapping     → out_of_scope
mapped to a different Business Manager → out_of_scope
coverage is not complete               → unknown
otherwise                              → missing_from_latest_discovery
```

Exact identity outranks scope reasoning on purpose: an account this run demonstrably returned is
present, whatever the internal mapping says. Calling it out-of-scope would contradict direct
evidence.

### What `missing_from_latest_discovery` does not mean

It means **"not returned by the latest completed discovery"**. Nothing more. It is not evidence
that Meta deleted, disabled, restricted or removed anything, and it never archives, de-links or
changes the state of an internal record. The UI must use that wording and no other.

The reasonable next step is manual: check ownership, assignment and permissions for that account
in Business Settings, then run discovery again.

## Pixels are asymmetric, and this is a schema limit

| Direction | Ad account | Pixel |
|---|---|---|
| Meta → registry | `matched` / `missing_in_registry` | `matched` / `missing_in_registry` |
| Registry → Meta | can reach `missing_from_latest_discovery` | **always** `out_of_scope` |

`AdAccount` carries `business_manager_id`. `Pixel` carries no Business Manager relationship at
all — its columns are `workspace_id`, `external_pixel_id`, `name`, `status`, `notes`. A registry
Pixel therefore cannot be proven to belong to the configured BM, so its absence from that BM's
discovery says nothing about it. The response states this in
`pixels.registry_absence_evaluable: false`, rather than leaving the UI to remember.

No foreign key was added to close this. Doing so would silently decide questions A10.1 has no
authority over: whether a Pixel belongs to exactly one BM or many; where existing mappings would
be backfilled from; whether a mapping records ownership, access or use; and whether an operator's
manual assertion counts as provider truth. That is a separate mini-spec.

## Bounds

Every call is explicit — a person pressed a button. There is no timer, no page-load trigger and
no automatic retry. Reading the latest run makes no provider call at all.

Each edge is capped at 10 pages of 100 items. Hitting the cap sets `truncated`, which makes
coverage `partial`: a bounded read is not a full inventory. Pagination follows Meta's
`paging.next`, not the trailing `cursors.after` — that cursor is present on the last page too,
and following it would re-request until the cap and then wrongly report a complete read as
truncated.
