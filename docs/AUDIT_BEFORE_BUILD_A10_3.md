# Audit Before Build — A10.3 (Multiple Business Managers)

Date: 2026-09-11 · Baseline: A10.1 shipped, A10.2 partially landed (write readiness, no real
write performed). Nothing deployed since `cb2654a`.

**This is the audit, not the build.** No implementation code for multi-BM has been written. The
playbook requires this document first, and in this case it earns its keep: the audit found that
the work is **blocked on a fact about Meta that only the operator can obtain**, and that the
thing the operator actually asked for today is a different slice entirely.

---

## 0. What prompted it

Two operator questions, a day apart:

1. *"nó có đang quản lý được nhiều BM không … và còn bao nhiêu slot quảng cáo cho BM đó"*
2. *"tôi vô lại không thấy Business Manager"* — after a discovery run that returned 8 ad accounts
   and 7 Pixels, both `/business-managers` and `/accounts` still read **0 records**.

They look like one question. They are not, and §6 is the reason.

## 1. Verified baseline

Every row below was read in the code today, not recalled.

| Fact | Where |
|---|---|
| `MetaConnection` has **no** Business Manager column | `models/meta_operations.py:23-51` |
| The BM read by a discovery is the global setting | `routers/meta_operations.py:187`, `services/meta_real_provider.py:360` |
| `META_ACCESS_TOKEN` is a single global setting, server-side only | `core/config.py:66` |
| Only six sites in the whole backend read either setting | `grep meta_business_id\|meta_access_token` — 6 hits outside `config.py` |
| A real provider is built only for `environment == production` **and** a configured token | `routers/meta_operations.py:59-62` |
| Registry `BusinessManager` is unique per `(workspace_id, external_id)` | `models/entities.py:84-89` |
| `AdAccount.business_manager_id` exists and is nullable | `models/entities.py:146` |
| A run stores the BM it read **and** the identity that read it | `models/meta_discovery.py`, migrations `0011`, `0013` |

## 2. The finding that decides the shape of the work

**There are two layers, and only one of them is multi-BM ready.**

The *semantic* layer already is. `reconcile_ad_accounts` compares each registry account's mapped
BM against `run.configured_business_manager_reference` and answers `out_of_scope` when they
differ, or when the account has no proven BM mapping at all
(`services/meta_discovery.py:299-312`). A registry account belonging to BM **B** can therefore
never be concluded missing by a run against BM **A**. That is the dangerous multi-BM failure, and
it is already closed — by A10.1's coverage work, before there was any second BM to test it on.

The *configuration* layer is not ready, and fails in a specific way worth stating plainly:

> Creating a second Meta connection today does **not** give you a second Business Manager. Both
> connections read `META_BUSINESS_ID`, so both discover the **same** BM. The new Overview table
> would render two rows, with two different labels, for one business — and nothing anywhere
> would say so.

That is a false statement rendered by the product, which is the category this codebase treats as
a defect rather than a limitation (hard rule 4).

**It is no longer hypothetical.** The Overview card, once it rendered, showed exactly this: two
rows, `Quảng Cáo Top` and `Fake Business Manager (local testing)`, both carrying reference
`1993884657458857`. Confirmed in the database — every run ever recorded, fake and real, carries
that same `configured_business_manager_reference`, because `_seeded_fake_provider` is seeded with
`META_BUSINESS_ID` (`routers/meta_operations.py:62`).

The second row is a `fake` connection, and it was rendered **unlabelled**: same `Complete`
badges, same columns, same visual weight as the real Business Manager next to it. Invented
numbers presented as an observation of Meta. Fixed the same day with an environment badge and two
tests; recorded here because the defect was invisible to 98 frontend tests and only appeared in a
screenshot.

## 3. Hard rule 1 eliminates the obvious design

The natural design — "each connection stores its own BM id and its own token" — is **forbidden**.
Rule 1 refuses to store access tokens in the database, and `StrictPayload` refuses them by field
name in a request body. That is not a preference to weigh; it is the rule the product is built
on. So the token axis has exactly three possible shapes:

| Shape | How a second BM is reached | Cost |
|---|---|---|
| **A. One token, many BMs** | Each connection stores a BM id in a new column; the same system-user token reads all of them | One migration, one column, no secret handling. **Depends on §4 being true** |
| **B. Many tokens, named in server config** | `META_ACCESS_TOKEN_<key>`, selected by a non-secret key stored on the connection | No secret in the DB, but every new BM becomes a redeploy, and configuration validation must refuse a connection naming a key that is not set |
| **C. OAuth per BM** | A real Meta App, App Review, per-BM authorisation | Out of scope. Requires a published app and a review cycle this project has never begun |

Shape B is the fallback, not the default: it is the only one that survives if §4 turns out false.

## 4. The blocking fact — unresolved, and the experiment that resolves it

**Question:** can one system-user token read a *second* Business Manager?

**Verified:** a system user is created inside one business, and this project has already measured
that Meta will not name the business behind such a token — `business` as a field returned
`invalid_request`, and `businesses` as both field and edge came back empty
(`docs/AUDIT_BEFORE_BUILD_A10_1.md` §3, live, 2026-09-10). That is why `META_BUSINESS_ID` exists
at all.

**Not verified, and not guessable:** whether adding that same system user to a second BM as a
member grants it read access to `GET /{bm2}` and `GET /{bm2}/owned_ad_accounts`. The
documentation does not settle it, and this project's own history on `client_ad_accounts` — a
reference page that 404s while the edge answers fine — is the reason we do not settle it from
documentation.

**The experiment.** Prerequisite: a second Business Manager exists, and the `adsops-admin` system
user has been added to it in its Business Settings. A refusal measured before that step measures
nothing.

```bash
cd backend && .venv/bin/python scripts/a10_live_probe.py --bm <second-bm-id> --assets
```

Read-only; the transport underneath has no method that can write. `--bm` reads the BM node,
`--assets` reads its `owned_ad_accounts`, `client_ad_accounts` and `adspixels` edges — about 8
GETs. The script prints a verdict naming Shape A or Shape B.

**Node access is necessary but not sufficient.** Discovery reads edges, so a readable BM node
whose asset edges refuse is still Shape B. That distinction is why the experiment reads both, and
why `--assets` now targets `--bm` when it is given rather than the configured BM.

### Run 1 — 2026-09-11, against BM `3068234753290929`

| Call | Result |
|---|---|
| `GET me` | `id=122096577267477740  name=adsops-admin` |
| `GET 3068234753290929?fields=id,name` | **OK** — `Tax Bánh Tráng - Nem` |
| `owned_ad_accounts` | ok, 1 page, **0 items** |
| `client_ad_accounts` | ok, 1 page, **0 items** |
| `adspixels` | ok, 1 page, **0 items** |

**Verdict: inconclusive — and the first version of this script said "Shape A confirmed".**

The node read proves the token reaches a second Business Manager, which is real progress. The
edges prove nothing: every one returned an empty 200, and an empty 200 does not distinguish *this
BM holds no assets* from *this token may not see the assets it holds*. That is the **exact**
defect A10 was repaired for — `check_capability` once reported `True` on a 200 carrying no
business — reproduced one level up, in a script written to answer this very question. Guardrail
written into the script instead: an all-empty result now prints `INCONCLUSIVE` by construction.

**What settles it:** whether `Tax Bánh Tráng - Nem` demonstrably holds at least one ad account in
Business Settings. If it does, the empty edges are a permission gap and the design question stays
open. If it is genuinely empty, the run is consistent with Shape A but still has not demonstrated
it — re-run against a BM that holds assets.

**Building before this is answered would be building the wrong one of two designs.**

## 4b. STOP — the experiment found a defect in shipped code

Run 2 against BM `109796697343603` repeated Run 1's pattern: node readable (`Triều Shop`), every
edge `ok`, every edge empty. Two BMs behaving identically made "both are genuinely empty"
implausible, so the question was put to Meta directly, with the configured BM as a control.

| BM | `owned_ad_accounts` | `{bm}/system_users` |
|---|---|---|
| `1993884657458857` (control) | `data=5`, `summary.total_count=5` | 2 rows — **adsops-admin, ADMIN** |
| `3068234753290929` | `data=0`, `total_count=0` | **`permission_missing`** |
| `109796697343603` | `data=0`, `total_count=0` | **`permission_missing`** |

`system_users` refuses outright, which is Meta saying this token has no role in those businesses.
The asset edge, for the same token and the same BM, answers **`200` with an empty list and no
error**. Same token, same business, two edges, two completely different failure languages.

**What the product does with that, measured rather than reasoned** — a provider pointed at a BM
this token has no role in:

```
check_capability()        -> list_business_managers: True
list_business_managers()  -> [{'external_id': '109796697343603', 'name': 'Triều Shop'}]
discover_ad_accounts()    -> assets=0  complete=True  coverage=complete
     edge owned_ad_accounts    ok=True  failure=None
     edge client_ad_accounts   ok=True  failure=None
```

A **confident, complete, empty** inventory of a Business Manager the token cannot actually read.
And `complete=True` is precisely the gate that licenses `missing_from_latest_discovery`
(`meta_discovery.py:313-321`). Point a connection at the wrong BM id — a typo, a copied id, a
system user later removed from a BM — and every registry account mapped to it is reported as not
returned by the latest completed discovery.

This is the A10 `True`-on-empty defect a third time. A10 fixed it for the capability check; A10.1
added coverage so an unread edge could not pass as complete. **Both miss this case, because
coverage tracks errors per edge and no error occurs.** Absence of authority is not absence of
assets, and nothing currently distinguishes them.

**It is not yet reachable in production** only because the registry is empty (§6). The import
slice is what fills the registry — so this must be fixed **before or with** it, not after.

**Fix — built the same day, on the operator's instruction.** An empty inventory may only be
called `complete` when the token's authority over that BM is positively established; otherwise
coverage degrades to `unknown` (hard rule 4, which this path violated).

- `BusinessAuthority` (`core/enums.py`): `not_checked` / `established` / `not_established`. The
  default is `not_checked` deliberately — a provider that forgets to establish authority must not
  inherit a positive. That default is what made the three pre-existing tests fail on first run,
  which is the design working: each site now has to state its premise.
- `AssetDiscovery.coverage_status` gained one clause: empty **and** not established ⇒ `unknown`.
  One derivation site, as before — a second place deciding coverage is how two readers come to
  disagree.
- `RealMetaBusinessProvider.check_business_authority` reads `{bm}/system_users`, memoised per BM
  per instance so ad accounts and Pixels of the same empty BM do not each pay for the same fact.
  Called **only** when the inventory is empty: a non-empty result proves its own authority, so
  the common case costs nothing.
- A refusal records `not_established`, never "proven not a member": reading that edge can itself
  require admin, so a narrow-but-real member is refused too. Both readings forbid the same
  conclusion, which is all the gate decides.
- Stored per run (migration `0014_a10_3_authority`, up/down/up verified against the dev
  database), returned as `business_authority`, and said in words in both the Overview table and
  the detail view — `0 · Unknown` alone reads as "this Business Manager is empty".

**Deliberately not gated: emptiness.** A readable BM that genuinely holds nothing still reports
`complete` and can still license a `missing` conclusion. Gating on emptiness would suppress every
legitimate absence conclusion for a Business Manager that was emptied on purpose — a test pins
both halves.

## 5. Constraints A10.3 must respect

- No token in the database, in a payload, in an audit row, in a log, or in a response (rule 1).
- A run against BM A concludes nothing about BM B. Already true (§2) — A10.3 adds the test that
  keeps it true, which cannot be written today because a second BM does not exist in any fixture.
- No fan-out. N Business Managers discovered in one request multiplies a bounded operation into
  an unbounded one; discovery stays one connection per request, operator-initiated.
- `environment == production` plus a configured token remains the only path to a real call.

### Call cost, counted rather than estimated

Per run, per BM: `check_capability` 1 GET (`meta_real_provider.py:177`) + `list_business_managers`
1 GET + `identify` 1 GET + ad accounts 2 edges + Pixels 1 edge = **6 GETs minimum**. With
`PAGE_SIZE = 100` and `MAX_PAGES = 10`, the worst case is **33**. Multiply by the number of BMs,
and note that rate limit budget is per app, not per BM.

## 6. The gap the operator actually hit — and it is not multi-BM

`/business-managers` and `/accounts` read 0 records after a successful discovery of 8 accounts.
Verified cause: **no import path exists**. Nothing in the codebase constructs a `BusinessManager`
or an `AdAccount` from a discovered asset; `missing_in_registry` is a label on a reconciliation
row (`enums.py:559`, `DiscoverySection.tsx:26`) and nothing acts on it.

This is A10.1 working as specified — discovery is read-only, and the registry is operator-entered
evidence — but from the outside it reads as a broken product. Mitigated today with wording on the
Overview card ("Discovery reads Meta; it does not create records here"); wording is not the fix.

The fix is its own slice: an **operator-initiated import**, per row, confirmed, writing an audit
record in the same transaction (rule 3), never automatic. It needs no new Meta call — the
observations are already stored — and it does not depend on §4.

## 7. Recommendation

**Revised after §4b.** The order is now: **authority gate → import slice → multi-BM config.**

The authority gate goes first because it is a correctness defect in shipped code, and because the
import slice is exactly what makes it reachable. Building the import first would be building the
thing that arms a known false conclusion.

Multi-BM config stays last, and is now **partly answered**: the token reads a second BM's node
but has no role in it, so nothing here demonstrates Shape A. The honest experiment is a BM where
`adsops-admin` has actually been added as a member — and §4b gives a cheap way to check that
before spending a discovery: `{bm}/system_users` answering is the signal.

The original argument for import-before-multi-BM still holds and is unchanged:

1. It is what the operator asked for twice, in the words they used both times.
2. It is not blocked. Multi-BM is blocked on §4, which needs a second BM and a Business Settings
   change only the operator can make.
3. It makes multi-BM testable: once accounts carry a real `business_manager_id`, the `out_of_scope`
   branch in §2 can finally be exercised against real data instead of a fixture.

The counter-argument, stated fairly: importing while only one BM exists means every imported
account maps to that one BM, and a later multi-BM world may need remapping. This is small — the
column already exists, the mapping is per row, and reconciliation already reports
`out_of_scope` rather than guessing when a mapping is absent.

## 8. Test and tooling debt found while auditing

Three items, all found today, all now closed except where noted:

| Found | Status |
|---|---|
| `GET /meta-connections/discovery-summary` shipped with **zero** tests; the 749-test regression never touched it | 6 tests added, including one that asserts the literal path is not captured by `/{connection_id}` |
| The endpoint answered **422** in the browser for an hour — the route ordering was correct, but the running backend predated the code and was started without `--reload` | Restarted with `--reload`; the test above now fails loudly if the ordering ever regresses |
| The Overview card `return null`ed on a query error, so the 422 rendered as "nothing discovered" | Now renders `ErrorState` |
| **`npx tsc --noEmit` is a no-op in this project** — the root `tsconfig.json` is `{"files": [], "references": [...]}`, so it compiles zero files. Every green reported from that command proved nothing | `npm run typecheck` changed to `tsc -b`, which immediately caught two real type errors in a test written minutes earlier |
| A `fake` connection's row was rendered indistinguishably from a real Business Manager (§2) | Environment badge + 2 tests, one asserting exactly one row is labelled so a real row can never inherit it |
| Every stored run has `provider_actor_*` NULL, so the card reads `unknown identity` on both rows | Correct, not a defect: those runs predate identity recording. It stays `unknown identity` until a new discovery runs — which is the honest answer, and is what the column is for |
| The multi-BM verdict added to `a10_live_probe.py` concluded **Shape A** from three edges that all returned empty 200s — absence of evidence read as evidence of access, the A10 defect reproduced in the tool built to detect it | Verdict now requires at least one asset before claiming access; all-empty prints `INCONCLUSIVE`. Found by reading the first real output, not by writing the script |

The last one is the serious one: it means frontend type-checking was reported as passing on
several occasions when it had not run. `npm run build` was always a real check — `tsc -b && vite
build` — so anything verified through a build stands.
