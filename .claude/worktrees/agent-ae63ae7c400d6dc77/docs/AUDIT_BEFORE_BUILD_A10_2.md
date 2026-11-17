# Audit Before Build — A10.2 (Real Provider Write Readiness & Single Ad-Account Creation Pilot)

Date: 2026-09-11 · Baseline: A10.1 built (726 backend / 92 frontend tests), UI not yet
click-through verified.

**This is the audit, not the build, and A10.2 is different in kind from everything before it.**
Every mini-spec up to here has been reversible: a wrong row is soft-archived, a wrong reading is
re-read. A10.2 creates an ad account on someone's real Business Manager. That artifact cannot be
un-created.

Nothing in this document authorises a write. No code has been changed for A10.2.

---

## 1. What already exists — A10.2 is a connection, not a framework

A7 built the entire write pipeline against the fake provider, and it is still there:

| Piece | Where | State |
|---|---|---|
| `CreateAccountRequest` / `CreateAccountResult` | `services/meta_provider.py` | Done — `status` is `succeeded` / `failed` / `unknown`, nothing else |
| Draft → preview → confirm → run | `services/meta_account_creation.py` | Done, with `preview_hash` binding and a confirm gate |
| Idempotency key per item, unique per workspace | `models/meta_operations.py` | Done |
| Lease + bounded retry (`LEASE_TIMEOUT`, `MAX_RETRIES`) | `services/meta_batch.py` | Done |
| `unknown` on timeout, never auto-retried | A7 policy, enforced by `RETRYABLE_FAILURE_CODES` | Done |
| `BILLING_REQUIRED` failure code | `services/meta_provider.py` | Exists, never yet returned by anything real |
| `reconcile_create(idempotency_key)` | Interface + fake implementation | Interface done, **real implementation unsolved — see §4** |

So the work is narrow: give the real provider a way to write, and decide what happens when the
answer is ambiguous. The scaffolding is not the risk.

## 2. The two barriers A10.2 must deliberately remove

A10 made the read-only guarantee structural on purpose — *two independent* reasons, so that
neither could be defeated by a config change:

1. **`RealMetaBusinessProvider.create_ad_account` raises `MetaWriteNotEnabled`.**
2. **`MetaGraphTransport` has no method that can POST**, pinned by
   `test_the_transport_is_get_only_by_construction`, whose docstring says plainly: *"If a later
   change adds one, this test is the thing that should have to be deleted first."*

That sentence was written as a tripwire, and A10.2 is the change it was waiting for. Removing it
is legitimate — but it must be an argued, visible act, not a quiet edit inside a larger diff. The
same applies to `test_only_named_modules_may_make_an_outbound_request`, which currently describes
`meta_graph_transport.py` as GET-only.

**Recommendation:** do not widen `MetaGraphTransport`. Add a separate `post()` that is used by
exactly one provider method, and keep a test asserting that no other module and no other method
can reach it. A transport that can POST *anywhere* is a much larger surface than a transport that
can create *one kind of thing*.

## 3. What must exist on Meta before any of this matters

These are long-lead and outside anyone's control here. Starting them now is the highest-value
thing that can happen today:

- [ ] **`ads_management` permission**, approved through **App Review**. The read-only work needed
      only `ads_read` + `business_management`, which a system user in your own BM gets without
      review. Write is a different category and review takes real calendar time.
- [ ] **Billing configured on the target Business Manager.** Account creation fails without it —
      that is what `BILLING_REQUIRED` is for. Worth confirming *before* a batch discovers it.
- [ ] **Confirmation that `1993884657458857` ("Quảng Cáo Top") is the intended target**, and that
      creating accounts in it is acceptable.
- [ ] **The system user's role.** Reading worked at *Employee* access. Creation may require
      *Admin*; unverified.
- [ ] **The BM's ad-account quota and current usage.** Meta limits how many ad accounts a BM may
      hold, and the limit depends on spend history. A pilot that consumes the last slot is a
      different decision from one that consumes the fifth of fifty.

## 4. The unsolved design problem: what "did it happen?" means on a real API

A7's design assumes `reconcile_create(idempotency_key)` can resolve a timed-out create. Against
the fake provider it can, because the fake remembers the key.

**Meta's Graph API has no idempotency key for ad account creation.** So a real
`reconcile_create` has only two options, and both are bad in a way this product has already
ruled on:

- **Match by name** — forbidden. A10.1 guardrail 14 and A5 rule 31 both require exact immutable
  external identity and explicitly reject name matching, because duplicates and renames make it
  unsafe. A create-by-name reconciliation would reintroduce exactly that.
- **Return `None`** — "the provider cannot resolve this", which the interface already allows and
  which degrades to a human checking Business Settings.

`None` is the honest answer, and it is already a supported path. But it means **a timed-out
create leaves an item `unknown` until a person looks**, and A10.2's UI and runbook must say so
without softening it. An `unknown` that quietly resolves itself to `succeeded` would be the worst
possible bug in this product: a silently duplicated real ad account.

This is the decision A10.2 must make before writing code, not during.

## 5. Scope, per the A10.1 spec's own recommendation

> *"prepare exactly one account-create batch for explicit operator preview/confirmation. No bulk
> create/share is enabled until that one pilot is verified against Meta Business Settings."*

One account. One batch. Verified by opening Business Settings and looking at it.

Explicitly **not** in A10.2: bulk creation; enabling A7's share or A8's Pixel-share write paths;
any automatic retry of a `unknown` item; any scheduled or triggered write.

## 6. Prerequisite from A10.1, unchanged

A10.1's UI has still never been click-through verified. Three of its seven defects were found by
a person clicking, including a card that told the operator a shipped feature did not exist.
A10.2's whole safety story rests on preview and confirm screens behaving as described — which is
the same class of thing, on a path where the mistake is permanent.

**Recommendation: click-through A10.1 first.** It is an hour, and it is the cheapest evidence
available before the first irreversible write.

## 8. Built — 2026-09-12

§2's recommendation was followed exactly: `MetaGraphTransport` was not widened. It gained one
`post()`, refusing every path but `{business-id}/adaccount`, anchored at both ends; PATCH and
DELETE remain absent. `test_the_transport_is_get_only_by_construction` was replaced by
`test_the_transport_can_create_but_can_never_modify_or_delete` plus a path-refusal test — visibly,
with the reason in the new docstring, because the old one had named itself as the tripwire.

§4's decision was taken as written: `reconcile_create` returns `None`, and the cost is stated
rather than softened — a timed-out create stays `unknown` until a person looks. The provider maps
a timeout, and also a dropped connection, to `unknown` rather than `failed`, because neither can
prove the request never arrived.

Meta's three required-but-unchosen fields are derived from the batch's own Business Manager id, so
everything sent is derivable from what was previewed. **They are an unverified assumption about
Meta's API** — `end_advertiser` set to the Business Manager itself, `media_agency` and `partner`
`NONE` — because this path has never run against the real endpoint. A wrong assumption returns
`invalid_request` and creates nothing, which is the correct way for it to fail.

### §3's prerequisites, re-checked

| Prerequisite | Status on 2026-09-12 |
|---|---|
| `ads_management` permission | **Met** — confirmed on the token via `debug_token` |
| System user's role | **Met, and measured today**: `{bm}/system_users` returns `adsops-admin` as **ADMIN** on `1993884657458857`. §3 had this as "unverified; creation may require Admin" |
| Target Business Manager confirmed | **Met** in practice — it is the BM every session has worked against |
| **Billing configured** | **Still unverified.** `billing_required` now has its own failure code so this is named rather than reported as a generic rejection |
| **Ad-account quota and usage** | **Still unknown.** Meta does not expose it; §3's own words apply — "a pilot that consumes the last slot is a different decision from one that consumes the fifth of fifty" |

Two of five remain, and both are the ones only the operator can close. §7 stands unchanged: the
capability exists, and no real create has been issued.

### §6's prerequisite, partly met

A10.1 has now been click-through verified in a real browser — discovery, the Overview card, the
per-connection Business Manager, and the authority gate returning `0 · Unknown` on a Business
Manager the token has no role in. Four defects were found that way and none by tests, which is
what §6 predicted. **The import action is still unclicked**, and the production frontend is
unreachable at its edge, so the click-through has to happen locally.

## 7. Standing confirmations

- No write has been implemented or invoked. The two barriers in §2 are intact.
- No code was changed to produce this audit.
- Executing a real create — even one — requires the operator's explicit, separate approval for
  that specific action, naming the BM. Building the capability is not approval to use it
  (CLAUDE.md rule 22). **Still true after §8: the capability is built and has never been used.**
