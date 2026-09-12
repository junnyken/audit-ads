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

## Who read it is part of the result

**The same Business Manager returns different assets to different system users.** Measured on
2026-09-11, not reasoned about: an *Employee* system user saw 4 ad accounts and 5 Pixels; an
*Admin* one saw **8 and 7** on the same BM, minutes apart, with nothing created in between.

So a discovery is evidence about **what one identity could read**, never about what the Business
Manager holds. Every run records `provider_actor_external_id` and `provider_actor_name`, and the
API returns them as `read_as`.

This matters because of one specific wrong conclusion. A later run by a narrower token sees fewer
assets and reports `coverage: complete` — **truthfully**, because every required edge answered —
and would then license `missing_from_latest_discovery` for registry records that a broader token
had just confirmed exist.

It is the same shape as the two-edge problem below, and neither shows up as an error: a scan that
succeeded at everything it attempted, while not having attempted enough. There the shortfall came
from an unread edge; here it comes from the token's own permissions.

The UI states it in place rather than leaving it to be inferred — "as seen by *X*; a different
system user may see a different set". A count with no reader attached invites exactly the reading
that is wrong.

**Consequence for anything that compares runs or Business Managers:** two results gathered by
identities with different access are not comparable, and presenting them side by side without
saying so invites a false comparison.

## An empty result has to prove it may read at all

Measured against real Meta on 2026-09-11, across three Business Managers with one system-user
token:

| Business Manager | asset edges | `{bm}/system_users` |
|---|---|---|
| the one this token administers | 5 accounts, `summary.total_count=5` | 2 rows, including this token as ADMIN |
| two it has no role in | `200`, `[]`, `total_count=0`, **no error** | **`permission_missing`** |

Same token, same business, two edges, two different failure languages. The BM **node** — `id`,
`name` — reads fine in all three cases, so "the Business Manager answered" proves nothing about
whether its assets did.

That is a third instance of this product's oldest defect: A10 reported a capability as `True`
from a `200` carrying no business; A10.1 added coverage so an unread edge could not pass as
complete. **Both miss this case, because coverage tracks errors per edge and here no edge
errors.** Left alone, a run against a BM the token cannot read reports `coverage: complete` with
zero assets — and `complete` is the single gate on `missing_from_latest_discovery`. A mistyped BM
id, or a system user removed from a BM later, would report every registry account mapped to it as
no longer returned by Meta.

So an inventory that came back **empty** must establish authority before it may be called
complete:

- A **non-empty** result proves its own authority; no extra call is spent.
- An **empty** result asks `{business-id}/system_users` — something only a member can read —
  once per Business Manager per run, memoised across asset types.
- A refusal records `not_established`, never "proven not a member": reading that edge can itself
  require an admin role, so a narrow-but-real member would also be refused. Both readings forbid
  concluding an asset is missing, which is all this gate has to decide.
- Without established authority, an empty inventory is `coverage: unknown`, never `complete`.

`BusinessAuthority` is stored per run and returned as `business_authority`. The UI says it in
words — "could not prove access to this Business Manager" — because `0 · Unknown` on its own
reads as "this Business Manager is empty", which is the conclusion being prevented.

Note what is deliberately **not** gated: a Business Manager the token can read that genuinely
holds nothing still reports `complete`, and still licenses a `missing` conclusion. The gate is
authority, not emptiness — gating on emptiness would suppress every legitimate absence conclusion
for a BM that was emptied on purpose.

## Importing into the registry

A10.1 shipped with no path from discovery to the registry at all: `missing_in_registry` was a
label, and nothing acted on it. The effect was a product that read 8 ad accounts from Meta while
its own Business Managers and Accounts pages showed zero — correct by design, and indistinguishable
from broken.

A10.3 adds one: an explicit, per-row import. Never automatic, never in bulk. Discovery reads Meta;
the registry is what this workspace has decided to track and is answerable for, and collapsing the
two would make every scan a silent writer.

What it does **not** do is as important:

- It does not gate on coverage or authority. Those gate conclusions about *absence*. An account
  that was returned was observed, whatever else the run failed to read.
- It does not fabricate readiness. An imported account starts `unknown`, exactly like one typed by
  hand. Meta having returned it is not evidence this workspace is ready to run ads on it.
- It does not accept an arbitrary id. Only an account the named run actually returned can be
  imported, or the endpoint becomes account creation wearing discovery's evidence.
- It does not re-read Meta. The observations are already stored, so a click costs no rate-limit
  budget and cannot disagree with what is on screen.
- It offers nothing for Pixels. A registry Pixel has no Business Manager relationship in the A1
  schema, so there is nothing to import one into — the same schema limit that makes Pixel
  reconciliation one-directional.

The Business Manager row is created from the reference the run recorded, and reused by external id
afterwards. Requiring an operator to retype an id the run already proved is the friction that left
that page empty in the first place.

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
