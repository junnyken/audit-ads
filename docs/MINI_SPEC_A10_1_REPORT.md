# MINI-SPEC A10.1 Report — Configured BM Validation & Read-Only Asset Discovery

Date: 2026-09-10 → 2026-09-11 · Baseline at start: A10 complete, 676 tests.

## 1. Summary

A10.1 validates one server-configured Business Manager and then reads its ad accounts and Pixels
**read-only**, comparing them with the A1 registry without changing anything in either system.

**Real provider read-only verification was executed**, by the operator, by hand: the configured
BM reads back, and so do its four ad accounts and five Pixels. Zero writes were issued and none
are possible. What was **not** executed is a human click-through of the new UI — see §7.

A10.1 deliberately did **not** add: any write path; a second BM discovery mechanism; automatic
archiving or overwriting of registry records; multi-BM configuration; scheduled discovery;
Telegram notification of discovery outcomes; or internal import/link (§2).

## 2. Audit Before Build

Full audit in `docs/AUDIT_BEFORE_BUILD_A10_1.md`.

**Verified A1–A10 baseline, with one correction.** The spec recorded "31 reported passing tests"
for A10; the real number was **30**, counted with `--collect-only`. That figure had been reported
by this agent, written into `TEST_LOG.md` unverified, and carried verbatim into the spec. The
spec's own guardrail 1 — do not trust reported behaviour — caught its author's error.

**Regression baseline:** 676 tests in 34 files, exit 0.

**A10 configured-BM invariant:** both named tests exist and pass. A gap in the claim was found
anyway — see §6 "Defects".

**Official Meta facts.** `owned_ad_accounts` and `adspixels` verified from Meta's documentation.
`client_ad_accounts` had no retrievable reference page, so it was verified **live** instead: it
answers, under the same permissions. That mattered more than expected (§3).

**Existing pieces reused:** `_read_business_managers()`, `MetaFailureCode`,
`canonical_external_id` (A5), `page_response`/`paginate`, `AuditLogService` and its redaction
denylist, `DataFreshness`, and the `_enum()` model helper.

**Optional import/link: deferred.** The spec asks it to reuse A7's preview/confirm primitives and
forbids a parallel confirmation framework. `services/meta_batch.py` is 40 lines holding
`compute_preview_hash` and `is_lease_expired`; the draft → preview → confirm → run state machine
is copy-implemented in three services. The primitive the spec hopes for does not exist, so the
deferral condition is met.

## 3. Design Choice

**Configured-BM-first**, because Meta will not name the business behind a system user token.
Established by asking three ways on a real BM: `business` as a field returned `invalid_request`
(no such field); `businesses` as an expanded field and as an edge both returned empty; reading
the BM by id worked.

**Coverage, not error-absence, licenses an absence conclusion.** The four ad accounts on the real
BM split two and two across `owned_ad_accounts` and `client_ad_accounts`. A run reading only the
documented edge succeeds at everything it attempts — so an error-based completeness rule calls it
complete while half the inventory is invisible, and reconciliation then reports the other two as
missing. A 50% false-missing rate on a scan calling itself complete, with no error to hint at it.

`AssetDiscovery.complete` is therefore **derived** from whether every `required_edge` answered,
and is not assignable. `required_edges` is stored per run so adding an edge later invalidates old
coverage rather than silently reinterpreting it.

**Reconciliation is computed at read time, not stored.** The spec calls it rebuildable from
observations plus registry state; something rebuildable is one less copy that can drift.

**`missing_from_latest_discovery` is last in the decision tree**, behind `unknown`, `matched`,
and two `out_of_scope` branches. Exact identity deliberately outranks scope: an account the run
demonstrably returned is present, whatever the internal mapping says.

**Pixels are asymmetric** — registry → Meta is always `out_of_scope`, because `Pixel` has no BM
relationship in A1. Reported in the payload as `registry_absence_evaluable: false`.

## 4. Changed Files

**Backend:** `core/enums.py` (`DiscoveryTrigger`, `DiscoveryRunStatus`, `CoverageStatus`,
`AssetReconciliationStatus`); `models/meta_discovery.py` (new); `models/__init__.py`;
`services/meta_provider.py` (`DiscoveredAsset`, `EdgeOutcome`, `AssetDiscovery`, fake-provider
discovery + call recording); `services/meta_real_provider.py` (two-edge discovery, pagination,
`probe()` fix); `services/meta_discovery.py` (new); `api/v1/routers/meta_operations.py`
(two endpoints, serialisers, fake seeding); `scripts/a10_live_probe.py` (`--assets`, `--bm`,
`--discover`, honest call counts).

**Frontend:** `components/meta/DiscoverySection.tsx` (new); `pages/MetaConnections.tsx`;
`pages/Settings.tsx`; `pages/Operations.tsx`; `lib/types.ts`.

**Migrations:** `0011_a10_1_discovery` — three tables. Rewritten in place once (§6).

**Documentation:** `docs/META_READ_ONLY_DISCOVERY.md` (new), `docs/AUDIT_BEFORE_BUILD_A10_1.md`
(new), this report, `API.md`, `ARCH.md` (new §4f), `FEATURES.md`, `TEST_LOG.md`,
`docs/RUNBOOK_META_CONNECTION.md`.

**Infrastructure/config:** `core/config.py` (`meta_business_id`); `.env.example` — which had
**no** `META_*` variables at all until this session, despite A7 and A10 both adding settings a
deployment needs.

A separate `docs/META_CONNECTION_SETUP.md` was **not** created: `docs/RUNBOOK_META_CONNECTION.md`
already covers token and connection setup, and a second setup document would drift against it.

## 5. New API/DB/State

**Entities:** `business_manager_discovery_runs`, `discovered_ad_account_observations`,
`discovered_pixel_observations`. No reconciliation table, by design.

**States:** `CoverageStatus` (`complete`/`partial`/`incomplete`/`unknown`/`stale`/
`not_attempted`) and `AssetReconciliationStatus`. `DiscoveryRunStatus` was kept deliberately
small — `running`/`succeeded`/`succeeded_with_warnings`/`failed` — because the *reason* already
has a vocabulary in `MetaFailureCode`, and duplicating it would create a second copy that drifts.

**Endpoints:** `POST /meta-connections/{id}/discoveries` and
`GET /meta-connections/{id}/discoveries/latest`, both owner-only, both workspace-scoped and
non-disclosing (out-of-scope answers 404, never 403). The read endpoint makes no provider call.

**Provider-call limits:** ad accounts 2 edges, Pixels 1; each edge capped at 10 pages × 100
items; hitting the cap sets `truncated`, which makes coverage `partial`. No timer, no page-load
trigger, no automatic retry.

**Internal import/link:** not implemented (§2).

## 6. Tests

726 tests in 37 files, exit 0, ruff clean — against 676 in 34 at the gate, so **+50**, which
reconciles exactly: 29 asset-discovery, 7 BM-validation, 12 reconciliation, plus 2 added to the
A10 file. Frontend: 92 passed (86 + 6 new), `tsc` and `eslint` clean.

Covered: both-edges coverage matrix (complete / empty-complete / failed / permission-missing /
rate-limited / truncated / never-attempted); cross-edge de-duplication; `act_` canonicalisation;
allowlisted metadata only; the full reconciliation decision tree including all three
`out_of_scope` and `unknown` branches; migration up/down/up; owner-only and cross-workspace
non-disclosure; no token-shaped string in any response; and the fake provider asserting zero
write calls.

**Defects found and fixed:**

1. **`probe()` bypassed the shared helper.** After the "one reader" fix there were still three
   readers; the one outside was the operator's live verification tool, which reported zero BMs
   while capability could see one. Found by a real run, not by 46 offline tests. A test now
   exercises each public reader in isolation.
2. **`AdAccount.name` does not exist** — it is `display_name`. The reconciliation service used it
   in six places and would have raised on the first registry row. Written against a field name
   assumed rather than read.
3. **A test that depended on the developer's `.env`.** It hoped `META_BUSINESS_ID` was unset;
   it went red the moment a real BM was configured. Now set explicitly by a fixture.
4. **A test that could not fail.** `assert provider.calls == []` "proved" no provider call while
   the fake recorded neither `check_capability` nor `list_business_managers`. Both are now
   recorded, and a companion assertion names the exact call sequence instead of bounding it.
5. **The fake environment could not exercise the flow.** With `META_BUSINESS_ID` set, an unseeded
   fake never returns the configured BM, so discovery always refused — leaving a live BM as the
   only way to try the feature, the opposite of the point. The fake now seeds plainly-labelled
   fake assets.
6. **UI claimed A9 was unbuilt.** The Operations page still offered "Team seats — Coming later
   (A9)" with a dead button. Found by the operator clicking, not by 726 tests.
7. **Two orphaned pages.** `/system` had zero links anywhere; `/meta-connections` had exactly one,
   buried inside a wizard — which is why the operator could not find the new feature. Both now
   reachable from Settings.
8. **Per-edge counts always rendered zero.** The page showed `Ad accounts returned: 2` above
   `Completed: Owned accounts (0), Client accounts (0)`: total right, breakdown nonsense. The
   fake provider built its `EdgeOutcome`s without `items`, so they took the default. No test
   caught it because every coverage test constructs `EdgeOutcome`s by hand with explicit counts,
   exercising the *rules* applied to numbers the test supplied and never the fake's own
   arithmetic. That breakdown is the evidence behind every coverage claim, so a fake that always
   reports zero defeats the purpose of having a fake environment at all. Found on the first
   click-through, three minutes in.

**Migration rewrite.** `0011` was downgraded, deleted, regenerated and re-applied rather than
superseded by an `0012`. Legitimate only because of facts that were checked: the revision had
never reached staging, shared or production; the tables were empty; no user data existed. On a
revision that has reached any shared environment this is not available — someone else's database
has already run the old one and will never run it again.

## 7. Live Verification

**Fake provider pilots:** the full scenario matrix runs offline on every test run.

**Real provider read-only validation: executed** (2026-09-10), by the operator, via
`scripts/a10_live_probe.py`.

```
Business ID : 1993884657458857        RESULT : OK — the token read a Business Manager
visible now : 1   - 1993884657458857  Quảng Cáo Top

ad accounts: 4 returned, complete=True
    owned_ad_accounts   ok=True pages=1   — Tbsupellex, Thanh Công
    client_ad_accounts  ok=True pages=1   — Quàng Chính, Vũ Hiếu
pixels: 5 returned, complete=True
    adspixels           ok=True pages=1
```

Provider writes: **0**. Secrets in output: **0** — the probe prints the token's length, never the
token. The four ids match the four ad accounts the system user is assigned in Business Settings.

**Click-through: executed** (2026-09-11), in a real Chromium via Playwright, signed in as the
workspace owner — login → `/meta-connections` → **Run read-only discovery**, against the fake
provider. Five properties were asserted rather than eyeballed: the count is never rendered bare
without coverage; a coverage label is shown; the per-edge breakdown is shown; the Pixel
BM-mapping limit is stated; and no deletion language appears anywhere. All five pass. It found
defect 8 immediately (§6).

Getting there cost several hours to environment problems that were this agent's doing, none of
them A10.1's: the API on port 8000 was a container serving a **baked image with no volume
mount**, so nothing had ever served the new code; a replacement server was then started with a
foreground `sleep` the harness blocks, killing it mid-restart; and the bind address was flipped
between `127.0.0.1`, `::` and `0.0.0.0` while Chrome resolved `localhost` to `::1`, twice landing
on the half Chrome does not use and producing `net::ERR_CONNECTION_REFUSED` with no request
reaching the server at all. Each was diagnosed from evidence — server logs, socket probes, a
`curl` preflight — rather than guessed, but two of the guesses in between were wrong and cost the
operator time.

**Resource observations:** discovery is bounded by construction; the heaviest test run
(reconciliation, 12 tests) took 108s against real PostgreSQL, dominated by per-test schema
truncation rather than by discovery.

## 8. Remaining Limits / Follow-ups

- **Click-through verification of the A10.1 UI** — the one outstanding item, and the one that
  found three of the seven defects above.
- **Unresolved API facts:** `client_ad_accounts` is verified to answer but its documented
  permission requirements were never retrievable. Whether further Pixel edges exist is unknown;
  `required_edges` is stored per run precisely so that discovering one invalidates old coverage.
- **Multi-BM configuration:** out of scope. One BM verified end to end first.
- **Internal import/link:** deferred, with the reason recorded in §2.
- **Pixel absence conclusions:** blocked on a Pixel↔BM ownership model — recommended as
  `A10.1a`, which must decide ownership-vs-access, backfill evidence, and whether an operator's
  assertion counts as provider truth. Not a foreign key.
- **A7/A8 real write prerequisites:** unchanged. App Review, billing, a named target BM and a
  separate approval. Discovery working is not evidence that writing will.
- **A4 Stage B / Telegram:** unchanged; no real message has ever been sent.
- **Recommended next mini-spec:** `A10.2 — Real Provider Write Readiness & Single Ad-Account
  Creation Pilot`, which must verify create capability, permissions, billing and idempotency
  before preparing exactly one account-create batch for explicit confirmation.
