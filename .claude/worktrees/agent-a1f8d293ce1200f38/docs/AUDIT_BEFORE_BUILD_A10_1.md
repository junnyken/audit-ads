# Audit Before Build — A10.1 (Configured BM Validation & Read-Only Asset Discovery)

Date: 2026-09-10 · Baseline: A10 complete (configured-BM fix landed), nothing deployed.

**This is the audit, not the build.** MINI-SPEC A10.1 §8 requires this document before code
changes, and its guardrail 1 says not to trust reported behaviour without verifying it. That
guardrail immediately caught an error of ours — see §1.

---

## 1. Verified baseline and deviations from what the spec assumes

| Spec assumes | Verified reality |
|---|---|
| "A10 currently has 31 reported passing tests" | **30.** Counted with `pytest --collect-only -q`. The 31 was reported to the operator and written into `TEST_LOG.md` without being counted, then carried verbatim into the spec. Corrected in both places |
| `META_BUSINESS_ID` reads the BM node directly when configured | Confirmed in `services/meta_real_provider.py` |
| `_read_business_managers()` backs both capability and listing | Confirmed — one helper, both public readers call it |
| 200 + empty ⇒ `not_configured`, never confirmed | Confirmed, and pinned by a test |
| Runbook documents `META_BUSINESS_ID`, error states, call counts | Confirmed in `docs/RUNBOOK_META_CONNECTION.md` |

**Deviation the spec does not mention:** `.env.example` had **no** `META_*` variables at all — A7
and A10 added them to `config.py` and never to the deployment template. Fixed while auditing;
all five are now documented there.

**Not yet verified at the time of writing:** the full backend regression. It is running and this
document must not be treated as complete until its real count is recorded in `TEST_LOG.md`.
A10.1 Step 1 is a gate: implementation does not begin until it passes.

## 2. The A10 invariant, verified by name

Both tests the spec names by name exist and pass:

- `test_a_200_carrying_no_business_is_not_reported_as_capability`
- `test_the_capability_and_the_listing_it_gates_cannot_disagree`

The second is the structural one: capability and the listing it gates read through the same
helper, so they cannot disagree. That failure mode was not hypothetical — it was observed against
real Meta before the fix, and is recorded in `TEST_LOG.md`.

## 3. Official Meta API facts: verified vs unresolved

Spec §8.2 forbids inventing endpoints. Checked against Meta's own documentation:

| Edge | Status |
|---|---|
| `GET /{business-id}/owned_ad_accounts` | **Verified** — Business Asset Management guide |
| `GET /{business-id}/adspixels` | **Verified** — returns `data`, `paging`, `summary.total_count` |
| `GET /{business-id}/client_ad_accounts` | Reference page returned 404, so **verified live instead** on 2026-09-10: it answers, under the same permissions. See below — it turned out to carry half the ad accounts |

### The gap this opens, which the spec does not cover

Guardrail 12 forbids concluding `missing_from_latest_discovery` from a *failed or partial* scan.
It does not cover a scan that **completes successfully but reads too few edges**.

A Business Manager holds both owned ad accounts and accounts clients have shared into it. Read
only `owned_ad_accounts`, and a client-shared account that is legitimately in the registry gets
marked `missing_from_latest_discovery` by a scan that reports itself complete. Wrong conclusion,
no warning flag — the same shape of defect as A10's `True`-on-empty, which this project has just
finished repairing.

This is not theoretical here: the connected system user holds **four ad accounts at full
access**, and how they split between owned and client is unknown.

**Operator decision:** read both edges, and label every observation with the edge it came from.
If `client_ad_accounts` is refused, that branch records `not_supported` and the run is marked
**not complete**, which withholds `missing_from_latest_discovery` for that run entirely. Coverage
is part of what "complete" means, not just absence of errors.

**Confirmed on real data, 2026-09-10.** The configured BM returned four ad accounts, split two
and two: `Tbsupellex` and `Thanh Công` from `owned_ad_accounts`, `Quàng Chính` and `Vũ Hiếu`
from `client_ad_accounts`. Reading only the documented edge would have found **two of four** and
still reported a complete run, because the one edge it read succeeded. The gap above was not
hypothetical, and it would have produced a 50% false-missing rate with nothing in the output to
suggest anything was wrong.

## 4. Reuse map (verified in code, not reported)

| Need | What exists | Where |
|---|---|---|
| Reconciliation identity | `BusinessManager.external_id` (**not** `external_business_id`), `AdAccount.external_account_id`, `Pixel.external_pixel_id` | `models/entities.py` |
| Safe exact matching | All three carry `UNIQUE(workspace_id, external_*)` | same |
| Provider seam | `RealMetaBusinessProvider`, `_read_business_managers()`, `MetaGraphTransport.get()` (GET-only) | `services/meta_real_provider.py`, `meta_graph_transport.py` |
| Failure vocabulary | `MetaFailureCode` incl. `NOT_CONFIGURED`; `RETRYABLE_FAILURE_CODES` | `services/meta_provider.py` |
| Internal pagination | `page_response()`, `paginate()` — page/page_size offset | `schemas/common.py`, `services/base.py` |
| Audit + redaction | `AuditLogService.record()`; `SENSITIVE_NAME_FRAGMENTS` substring match | `services/audit.py`, `core/redaction.py` |
| Freshness precedent | `DataFreshness` (`current`/`stale`/`unknown`), `data_freshness_stale_after_days` | `core/enums.py`, `core/config.py` |
| Migration head | `0010_a9_seat_invite_assign` → next is `0011_a10_*` | `alembic/versions/` |

Two pagination concepts must not be conflated: this product's internal page/page_size offset
paging for its own list endpoints, and Graph API's cursor paging for provider reads.

## 5. Optional internal import/link — **deferred**, on the spec's own terms

The spec says to prefer reusing A7 preview/confirmation primitives, not to build a parallel
confirmation framework, and to omit the feature if the pattern cannot be reused cleanly.

Verified: `services/meta_batch.py` is **40 lines** and holds exactly two functions —
`compute_preview_hash()` and `is_lease_expired()`. The draft → preview → confirm → run state
machine is **copy-reimplemented in three services** (`meta_account_creation.py`,
`meta_access_share.py`, `meta_pixel_share.py`), each with its own `confirm`.

So the reusable primitive the spec hopes for does not exist; only the hash helper does.
Implementing import/link in A10.1 would mean writing that state machine a fourth time — exactly
what the spec forbids. The deferral condition is met, so it is deferred, and the read-only
reconciliation view ships without it.

## 6. Scope for this slice (operator decision)

The full spec is ~6 tables, ~14 endpoints and new UI, self-estimated at 2–4 days. The operator
chose the core slice. It is smaller because of a sentence in the spec itself: a reconciliation
result is "derived/internal and rebuildable from discovery observations plus registry state" —
if it can be rebuilt, it does not have to be stored.

**In scope:** provider `discover_ad_accounts` (both edges) and `discover_pixels` with bounded
pagination; fake-provider scenario matrix; one discovery-run table plus ad-account and Pixel
observation tables; reconciliation **computed at read time**, not persisted; two endpoints; one
compact section on the existing Meta connections page.

**Deferred:** import/link and `DiscoveryImportDecision`; `asset_reconciliation_results` as a
table; the separate BM reconciliation tab; scheduled reconciliation; the wider endpoint surface.

## 7. Standing confirmations

- No Meta write is implemented or invoked. The transport has no method that can write.
- No browser automation, cookie/session handling, fingerprinting or proxy rotation.
- No token in any UI field, request body, database column, log line, audit row or response.
  `META_BUSINESS_ID` is server configuration only — it is not a secret, but it is also never
  accepted from a request.
- No real provider call in automated tests; the fake provider is mandatory there.
- No deployment. A real read-only discovery remains a separate, operator-approved action.
