# AdsOps — MINI-SPEC A7 (v3): BM + Ad Account Creation & Sharing (official Meta API only)

**Status:** received 2026-09-08, supersedes both the earlier "A7 — Account Operations
Intelligence" (spend/activity dashboard) and "A7 — Core Simplification & BM Workspace" framing
documents. Those remain saved at `docs/ADSOPS_MINI_SPEC_A7_CORE_SIMPLIFICATION.md` and in
`backend/app/services/account_operations.py` (deferred, not deleted) for reference — this
document is the current authoritative A7 scope.

**One-line scope:** A7 does exactly two operations against the real Meta Marketing API, both
gated behind an explicit capability check and an explicit operator confirmation: **create ad
accounts**, and **share/grant access on an ad account**. No campaign manager, no Auto Rules, no
Preflight/landing-page work in A7.

## 1. Create ad accounts via the official Meta API

```
Connect a valid Meta API credential
        ↓
Scan the BM/token's capability
        ↓
Choose a BM
        ↓
Enter TKQC name(s) + currency + required fields
        ↓
Validate every item
        ↓
Preview exactly which ad accounts are about to be created
        ↓
Confirm the batch
        ↓
Queue runs sequentially
        ↓
Per-account result
        ↓
Sync the successful account ID back into the Registry
```

The tool must always show: which BM will be used; each account's name; currency;
timezone/country if the real API requires it; batch item count; whether the current capability
allows `create`; and the specific reason when it cannot — missing permission, missing
billing/payment, expired token, unsupported by the API, platform rejected, rate limit, etc.

## 2. Share / grant access on an ad account via the official Meta API

```
Choose the source ad account
        ↓
Choose the person/BM/system user receiving access
        ↓
Choose a role the official API actually permits
        ↓
Preview the exact account + exact recipient + exact role
        ↓
Confirm
        ↓
Queue runs sequentially
        ↓
Store the result + an access-grant reference
```

**Explicitly excluded, always:** pasting a cookie/token; sharing via a Chrome session; browser
automation; self-granting a role above what is actually authorized; blind retry when a create
request's result is ambiguous.

## "Unlimited" policy

Internal registry records may be unlimited, but the UI must say so honestly:

> Unlimited internal records. Meta creation, sharing, rate, billing, and permission limits still
> apply.

I.e. the *software* imposes no artificial cap — Meta's own limits are never promised away.

## Screens

Core nav after A7:
```
Overview
Business Managers
Ad Accounts
Assets
Operations
Alerts
Settings
```

**Operations** — 4 simple cards:
```
Create ad accounts          → built in A7
Share ad-account access     → built in A7
Bulk Pixel share            → Coming later (A8)
Team seats                  → Coming later (A9)
```

**Meta Connection** page shows: connection label; environment (Fake / Sandbox / Production);
status; last capability check; `list_business_managers` capability; `create_ad_account`
capability; `share_ad_account_access` capability; which BMs the API actually allows to see;
"Token configured: Yes/No" (**never** the token itself); safe error codes
(`permission_missing`, `token_expired`, `not_supported`, ...).

**Create Account Wizard:**
```
Step 1: Choose Meta Connection + BM
Step 2: Enter one or more ad accounts
Step 3: Validate + Preview
Step 4: Confirm batch
Step 5: Per-item result
```

**Share Access Wizard** — the same 5 steps, input is Source Ad Account / Recipient / Role
instead.

## Guardrails (hard requirements)

1. The Meta API is only ever called after capability has been confirmed.
2. If the batch's target name/BM/currency/recipient/role changes after confirm, the
   confirmation becomes invalid — preview/confirm must happen again.
3. `preview_hash` prevents the UI from showing one thing while the request that actually runs
   is different.
4. Every batch item carries an `idempotency_key`.
5. If a timeout leaves it unknown whether Meta actually created the account:
   - status is `unknown`;
   - **no automatic retry**;
   - run reconciliation if the real API supports it;
   - if reconciliation is not possible, the operator checks manually.
6. Retry is allowed **only** for timeout / rate-limit / a safely-retryable 5xx.
   Permission / billing / policy / invalid-request errors are **never** retried automatically.
7. A newly created account syncs into the Registry, but its `readiness_status` and
   `health_status` both start at `unknown` — never fabricated as green, never assumed from the
   fact that creation succeeded.

## Build before real Meta access exists

A7 requires building a `FakeMetaBusinessProvider` so the entire flow is testable locally before
any real Meta App/permissions/token exist:
- capability available / unavailable
- create success
- permission missing
- billing required
- rate-limit → retry → success
- timeout → unknown
- share success
- unsupported role
- queue crash → lease recovery
- preview mismatch → 409

Only once code and tests are complete, and a real Meta App + approved permissions + token/server
secret + a real target BM exist, does a separate audit/external test happen. **A7 never calls
the real Meta API automatically before the operator has confirmed a batch.**

## Roadmap after A7

```
A8 — Bulk Pixel Share via Official API
A9 — Team Seats, BM/Account Assignment & Device Session Security
```

A8 adds exactly one new operation type, `share_pixel_access`, reusing A7's batch engine,
preview hash, confirmation, queue, retry, and result log as-is. A9 builds staff/seats/roles,
BM/account visibility assignment, device list, session revoke, and audit — not part of A7.
