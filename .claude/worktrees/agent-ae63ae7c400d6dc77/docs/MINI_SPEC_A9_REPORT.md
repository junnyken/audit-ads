# MINI-SPEC A9 Report — Team Seats, BM/Ad-Account Assignment & Device Session Security

**Project:** AdsOps Control Center · **Date:** 2026-09-09 · **Built on:** A1–A8
**Status:** Steps 1–8 complete. Not deployed; no real email, Telegram or Meta call was made.

## 1. Summary

**What A9 added.** A workspace owner can now set seat capacity, invite people by one-time link,
manage their lifecycle (role, suspend, deactivate, reactivate, archive), assign them specific
Business Managers and ad accounts, and end any session on any device — server-side, effective on
the next request. A non-owner now sees only what they are assigned; before A9, every active
member of every role could read every BM and ad account in the workspace.

**What A9 deliberately did not add.** No billing, pricing or seat purchasing (`plan_reference`
is a descriptive string nothing reads). No SSO/SAML/SCIM. No email provider — invitations are
one-time links, and adding real email is a separate, approval-gated deployment decision. No
direct Page/Pixel assignment; asset visibility is derived from BM/ad-account relationships. No
ownership transfer. No global-admin mode. And nothing that touches Meta itself: no passwords, no
cookies or session material, no browser profiles, no fingerprinting, no proxies.

## 2. Audit Before Build

Full writeup: `docs/AUDIT_BEFORE_BUILD_A9.md`. The findings that changed the plan:

- **Verified A1–A8 baseline** by reading the code, not the prior reports. A6 exists but is
  hidden from nav; A7/A8 were feature-complete but entirely uncommitted in git.
- **Regression baseline before any A9 code:** 546 tests, all green.
- **Auth/session model:** dashboard sessions were pure stateless JWT with *no* server-side
  revocation of any kind. A5's extension already had exactly the right pattern, applied only to
  itself. This became Step 2.
- **Role vocabulary mismatch:** the enum is `owner/admin/buyer/viewer/auditor`, not the spec's
  `owner/admin/operator/viewer`. Confirmed with the product owner: keep the enum, map
  `operator`≈`buyer` at the API boundary, leave `auditor` alone.
- **Authorization map:** `READ_ROLES = frozenset(WorkspaceRole)` — no per-resource scope check
  existed anywhere. `ScopeAuthorizationService` was net-new, not a tightening.
- **Invitation delivery:** no email provider exists anywhere in the codebase → one-time secure
  link, documented as such.
- **Out-of-scope findings:** the A6/A7/A8 reports' claim that browser tooling was unavailable
  was wrong — a missing `libnspr4.so`. Fixing it unblocked real-browser verification for the
  first time.

## 3. Design Choice

**Membership/seat lifecycle.** `seat_used` is computed live from active members, never a stored
counter. A pending invitation holds no seat; capacity is checked atomically at acceptance.
`archived` is `archived_at`, not a fifth status value — one fact, one place.

**Invitation token.** Cryptographically random, hash-at-rest, single-use, 7-day expiry. The raw
token exists for exactly one response and is never persisted, logged or audited; only its last
four characters are kept for display.

**Accept flow** (the one genuinely open question in the spec, resolved with the product owner):
an email that already has an account must accept while authenticated as that account; a
brand-new email registers as part of accepting. Anything else would let someone who merely knows
a colleague's address try a password against their account.

**Scope authorization.** One chokepoint, not thirty checks: the scope test lives in
`AdAccountRegistryService.get()`, which every account-resolving route already calls, so
readiness, health, events and audit history inherit it and a route added later cannot forget it.
Out-of-scope answers `404`, never `403`.

**Session registry.** Mirrors A5's `ExtensionInstallation` pattern for dashboard sessions rather
than migrating or merging it — a forced migration of a working security mechanism is risk with
no benefit. Coarse browser/OS only, salted IP hash, throttled `last_seen_at`.

**Why this design.** It solves the actual need — several people working on shared assets — with
no shared credentials, makes "revoke a device" a real server-side fact rather than a cosmetic
client logout, and avoids a per-asset permission matrix by deriving asset visibility from
relationships that already exist.

## 4. Changed Files

**Backend (new):** `models/team.py`, `services/{seat_plan,invitation,membership_lifecycle,
assignment,scope_authorization,session_registry}.py`, `schemas/team.py`,
`api/v1/routers/{team,security_sessions}.py`, migrations `0009_a9_device_session` and
`0010_a9_seat_invite_assign`, `scripts/{a9_live_verify,a7_a8_live_verify}.py`.

**Backend (touched):** `core/enums.py`, `models/entities.py` (`WorkspaceMember.status`),
`models/__init__.py`, `api/deps.py` (`OwnerCtx`, `OptionalUser`, session validation, lazy scope),
`api/v1/routers/auth.py` (session on login), `services/workspace.py` (role mapping),
`services/registry.py` (scope chokepoint), and the routers that resolve accounts
(`ad_accounts`, `readiness`, `health`, `events`, `audit`, `alerts`, `account_operations`,
`meta_operations`).

**Frontend (new):** `pages/{TeamSeats,SecurityDevices}.tsx`,
`components/team/{InviteMemberDrawer,MemberDrawer}.tsx`, `lib/team.ts`, `test/team.test.ts`.
**Frontend (touched):** `App.tsx`, `pages/Settings.tsx`, `lib/types.ts`, and the three A7/A8
wizards (real bug — see §6).

**Docs:** `FEATURES.md`, `API.md`, `TEST_LOG.md`, `CLAUDE.md` (rule 1),
`docs/{AUDIT_BEFORE_BUILD_A9,TEAM_AND_SEATS,SESSION_SECURITY,INVITATION_RUNBOOK,
ACCESS_SCOPE_MATRIX}.md`, evidence under `docs/evidence/{A9-LIVE,A7-A8-LIVE}/`.

## 5. New API/DB/State

**Entities:** `DeviceSession`, `WorkspaceSeatPlan`, `WorkspaceInvitation`,
`MemberBusinessManagerAssignment`, `MemberAdAccountAssignment`, plus `WorkspaceMember.status`.

**States:** member `invited/active/suspended/deactivated` (+ `archived_at`); invitation
`draft/pending/accepted/expired/revoked/cancelled/archived`; assignment
`active/revoked/expired`.

**Endpoints:** 25 under `/team/…` plus 3 under `/security/sessions/…` — full table in `API.md`.
All owner-only except `POST /team/invitations/accept` (the invitee) and the self-service session
routes.

**Seat atomicity:** capacity is re-checked inside the acceptance transaction, so two people
racing for the last seat cannot both get it.

**Revoke behaviour:** suspend, deactivate and archive each revoke every live session
immediately; `logout-other-devices` keeps the caller's own session; revoking your current
session through the device endpoint is blocked by design.

## 6. Tests

- **A1–A8 regression:** unchanged and green throughout — 546 at baseline, 640 at the end.
- **Unit/service:** 40 (`test_a9_team_services.py`) + 13 (`test_a9_session_registry.py`).
- **Integration/API:** 22 (`test_a9_team_api.py`) + 12 (`test_a9_scope_enforcement.py`) + 6
  (`test_a9_team_schema.py`).
- **Frontend:** 9 new presentation tests (86 total).
- **Migration:** both migrations verified upgrade → downgrade → upgrade against real Postgres.

**Defects found and fixed:**

1. **Three wizards were a dead end** (A7 create, A7 share, A8 pixel share): the confirm
   mutation set the step it was already on, leaving the Run step unreachable. A batch could be
   drafted, previewed and confirmed and then never run from the UI. Found by the first real
   click-through; invisible to 1176 backend tests, 86 frontend tests, tsc and eslint.
2. **Migration missing a `server_default`** on `WorkspaceMember.status` — safe on an empty dev
   database, would have failed on any table with rows.
3. **Enum comparison by raw string** in the first draft of `invitation.py` — this codebase
   stores enum *names* (`"ACTIVE"`), so `== "active"` would have silently matched nothing.
4. Three pre-existing tests whose assumptions the new behaviour legitimately changed (a
   token-shape test, an audit-count test, a redaction key-name collision on `session_type`).

**Security/redaction:** `StrictPayload` correctly refused the accept endpoint's `token` and
`password` fields on the first run. Handled by following the existing `LoginRequest` precedent
and **naming both exceptions in CLAUDE.md rule 1** rather than quietly swapping a base class.

## 7. Live Verification

**Real Chromium, real backend, real database** — the first dashboard UI verification in this
project's history, and the reason it was possible: `libnspr4.so` was missing, not the tooling.

- `scripts/a9_live_verify.py` — **20/20**, evidence in `docs/evidence/A9-LIVE/`. Covers the
  unconfigured-capacity state, seat plan save, the invite flow and its one-time link, last-owner
  protection, the devices page's own privacy statement, and no horizontal overflow at 375/768px.
- `scripts/a7_a8_live_verify.py` — **20/20** after fixing the wizard bug, evidence in
  `docs/evidence/A7-A8-LIVE/`. Drives connection → capability check → draft → preview → confirm
  → run → per-item result for all three wizards.
- **Real email delivery:** not executed. No provider is configured.
- **Production deployment:** not executed.
- **Meta API:** not called. `FakeMetaBusinessProvider` remains the only provider wired anywhere.

## 8. Remaining Limits / Follow-ups

- **Email provider:** none. Invitations are one-time links; adding real delivery is a separate
  change needing a provider, a resolved recipient and explicit approval.
- **Stage B deployment:** unchanged — still not done, still needs its own approval.
- **Extension sessions:** intentionally separate from dashboard sessions. Revoking one does not
  revoke the other; both are visible on Security & Devices, labelled as distinct.
- **Direct asset assignment:** not built. Page/Pixel visibility is derived from BM/ad-account
  relationships.
- **Scoped operation history:** A7/A8 batch endpoints are owner-only rather than scoped for
  admin/operator/viewer, because a batch item stores an *external id* whose local scope cannot
  be proven. Deliberate, and documented in the router itself.
- **Seat billing:** out of scope by design.
- **A6's Preflight pages** remain the last never-clicked-through surface — now unblocked and
  cheap to close.
- **Recommended next MINI-SPEC:** A10 — real Meta provider connection and **read-only**
  capability discovery, as the spec itself recommends. No real create/share writes until A10
  confirms capability, target BM, permissions, billing prerequisites and secure token handling.
