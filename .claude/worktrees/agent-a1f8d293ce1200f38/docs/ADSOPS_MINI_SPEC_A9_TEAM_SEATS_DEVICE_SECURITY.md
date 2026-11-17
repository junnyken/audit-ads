# AdsOps Control Center — MINI-SPEC A9

## Team Seats, BM/Ad-Account Assignment & Device Session Security

- **ID:** A9
- **Name:** Team Seats, BM/Ad-Account Assignment & Device Session Security
- **Parent phase:** Team Access & Security Foundation
- **Depends on:** A1 — Account Registry & Stability Readiness; A2 — Account Health; A3 — Alert
  Center; A4 Stage A — Deployment Readiness; A7 — BM & Ad Account Operations; A8 — Bulk Pixel
  Share
- **Author:** Product Owner + AI Implementation Partner
- **Date:** 2026-09-09
- **Status:** Ready for audit-before-build only
- **Estimated effort:** 4–7 implementation days, excluding email-provider configuration and
  production deployment/UAT

AdsOps Control Center is intentionally a compact BM/ad-account operations product. Its core
value is to manage Business Managers, advertising accounts, Pixel/Page assets, official-API-
gated bulk operations, and operator visibility — not to become a campaign-management platform.

A9 adds the smallest complete collaboration and security layer required to support team usage
safely:

```
Seat plan
  → Invite member
  → Member accepts invitation
  → Assign role
  → Assign Business Managers and/or ad accounts
  → Derive visibility for related assets
  → Track active devices/sessions
  → Revoke access quickly when necessary
  → Audit every security/access mutation
```

A9 does not add campaign management, advertising-platform automation, browser profile sharing,
antidetect functionality, proxy rotation, or credential sharing.

## 2. Context

### 2.1 Product baseline to audit

The implementation agent must verify actual repository state before coding. Previous reports
indicate the project may contain:

- A1: Workspace/account registry, BM/account/asset references, readiness, audit logs, soft
  archives, sensitive-field rejection/redaction, workspace membership authorization.
- A2: Account health signals/snapshots and data freshness.
- A3: Alert Center, Telegram notification outbox, safe delivery lifecycle.
- A4 Stage A: deployment/runbook/observability artifacts, without Stage B production deployment
  or real Telegram test send.
- A5: Chrome Extension context layer, potentially still requiring final real-browser UAT.
- A6: Campaign Draft/Preflight scope may be absent, partial, complete, or deferred; it is
  non-core and must not be expanded/deleted automatically.
- A7: Meta connection/capability and official-API-gated create/share ad-account operation
  framework, potentially fake-provider-only until real Meta setup exists.
- A8: Bulk Pixel Share operation reusing A7 operation engine, reportedly complete with fake
  provider and test coverage.

A9 must audit all actual models/services/routes/tests. It must not assume table counts, route
counts, auth behavior, email delivery capability, session model, or A7/A8 completion details
from prior reports.

### 2.2 Current product owner requirements

The product owner wants:

- Add employees via seats.
- Control access to BM/ad accounts rather than sharing owner credentials.
- Secure multi-device usage.
- Revoke sessions/devices quickly.
- Keep interface and workflows compact.
- Preserve existing operations logic for ad-account creation/sharing and Pixel sharing.

### 2.3 Security model premise

Access to AdsOps must be separate from access to Meta/Facebook itself.

A9 controls only the user's access to the **AdsOps application and its internally managed
operation workflows**. It must not:

- Share Meta passwords.
- Share Meta browser cookies/session material.
- Create/operate Meta user credentials.
- Manipulate browser fingerprints.
- Claim to secure a user's Meta account directly.

For access sharing on Meta assets, users must continue to use authorized official Meta
API/provider workflows supported by A7/A8 and actual platform permissions.

## 3. Goal

Allow a workspace owner to manage available team seats, invite and deactivate members, assign
role-scoped access to Business Managers and ad accounts, and revoke AdsOps device sessions
immediately with complete auditability — without shared credentials or exposure of unassigned
resources.

## 4. Non-goals

A9 must not implement:

- Paid subscription billing, payment collection, invoices, coupons, or automatic
  declining-seat pricing calculation. A9 tracks seat capacity and optional plan/pricing
  reference only.
- Automatic purchase of seats.
- Full enterprise SSO/SAML/SCIM.
- Real email-provider integration if an existing provider is not already configured. A9 may use
  an invitation-link preview/test delivery abstraction and document real email transport as a
  deployment/provider follow-up.
- Campaign/ad set/ad/creative/audience management.
- Meta account login, Meta user provisioning, Meta credential sharing, Meta cookie/session
  handling, or browser profile sharing.
- Browser fingerprinting/spoofing, antidetect, proxy rotation, checkpoint bypass, policy
  enforcement evasion, or automated appeals.
- Meta platform role management outside A7/A8 official provider operations.
- Automatic assignment of new BM/ad accounts to all users.
- Fine-grained Pixel/Page direct assignment model in A9. Asset visibility is derived from
  permitted BM/ad-account relationships; a future spec can add direct asset exceptions only if
  required.
- Deleting members, invitations, assignments, device sessions, security events, or audit logs
  permanently.
- Allowing a normal Admin/Operator/Viewer to escalate themself to Owner.
- Remote device control beyond revoking the AdsOps session/token.
- Sharing a single AdsOps password among staff.

## 5. Key Concepts and Controlled Vocabulary

### 5.1 Workspace roles

Use exactly these internal roles unless repository audit finds semantically equivalent existing
values that must be reused.

```
owner
admin
operator
viewer
```

- `owner`: full workspace control; manages seats, invites, members, assignments, sessions,
  connections, and operations.
- `admin`: operational management permitted only within assigned/global scope; cannot manage
  owner membership, change seat plan, access connection secrets, or elevate roles to owner.
- `operator`: performs allowed read/operation workflows only for assigned BM/ad-account scope;
  cannot manage team/security/global settings.
- `viewer`: read-only access to assigned scope; cannot create/update/archive/queue/cancel
  operations.

> **Audit finding (2026-09-09):** the repository already has a 5-value `WorkspaceRole` enum —
> `owner/admin/buyer/viewer/auditor` — not `owner/admin/operator/viewer`. Decision (confirmed
> with product owner): keep the existing enum as-is (no migration/rename), map `buyer` to this
> spec's `operator` semantics and `viewer`/`auditor` per their existing, already-implemented
> `AUDIT_READ_ROLES` distinction. See `docs/AUDIT_BEFORE_BUILD_A9.md` for the full writeup.

### 5.2 Member status

```
invited
active
suspended
deactivated
archived
```

- `invited`: an invitation exists; member has not accepted and consumes no active seat.
- `active`: accepted, authenticated member; consumes one seat.
- `suspended`: temporarily blocked from application access; consumes one seat unless owner
  explicitly deactivates/removes it.
- `deactivated`: access removed; all sessions revoked; seat released.
- `archived`: historical/soft-archived membership record; no access; seat released.

Do not allow a member to authenticate or access workspace resources unless member status is
`active`.

### 5.3 Invitation status

```
draft
pending
accepted
expired
revoked
cancelled
archived
```

### 5.4 Seat state

```
available
reserved
active
released
```

A9 default behavior:

- `pending` invitation does not permanently consume a seat.
- A seat is checked/reserved atomically only at invitation acceptance.
- An accepted active member consumes one active seat.
- Deactivation/archive releases seat.
- If business policy later needs seat reservation at invite time, make it a separate
  settings/spec change; do not invent alternate behavior in A9.

### 5.5 Assignment scope types

```
business_manager
ad_account
```

A9 does not add direct Page/Pixel assignment records. Related asset visibility is derived from
source account/BM relationships.

### 5.6 Assignment status

```
active
revoked
expired
archived
```

### 5.7 Device/session state

```
active
revoked
expired
superseded
```

### 5.8 Session types

```
web
chrome_extension
api
```

`chrome_extension` is included only if A5 actually reuses the main auth/session registry. If
the A5 design uses separate extension installation/session artifacts, preserve that behavior
and create a safe bridge, not a forced migration without audit.

> **Audit finding (2026-09-09):** A5 already uses a fully separate, already-revocable
> installation registry (`ExtensionInstallation` + `ExtensionSessionService`, re-checked on
> every request). A9's new session registry is for **dashboard (`web`) sessions only** — it
> must not touch or migrate the extension's existing working model.

### 5.9 Access decision vocabulary

```
allowed
not_assigned
member_inactive
role_denied
resource_archived
unknown_resource
```

Do not tell unauthorized users whether a resource exists in another workspace or whether it
belongs to another member.

## 6. Permission Matrix

The final implementation must be aligned with existing authorization architecture, but the
following matrix is the A9 product-policy baseline.

| Capability | Owner | Admin | Operator | Viewer |
|---|---|---|---|---|
| View workspace overview | Yes | Yes, scoped/global per policy | Yes, assigned scope | Yes, assigned scope |
| View assigned BM/ad accounts | Yes | Yes, scoped/global per policy | Yes | Yes |
| View unassigned BM/ad accounts | Yes | Only if global-admin mode exists and owner grants it | No | No |
| View health/readiness/alerts for permitted resources | Yes | Yes | Yes | Yes |
| View audit logs for permitted resources | Yes | Yes, scoped | Read-only scoped if existing policy permits | No by default |
| Create/edit/archive BM/account registry record | Yes | Optional, only if owner enables existing role capability | No | No |
| Queue A7/A8 external operation | Yes | Only on assigned scope if role capability exists | No by default | No |
| View operation history | Yes | Scoped | Scoped read-only | Scoped read-only |
| Manage Meta connections/capabilities | Yes | No by default | No | No |
| Invite member | Yes | No by default | No | No |
| Change seat limit/plan reference | Yes | No | No | No |
| Change member role | Yes | No | No | No |
| Assign/revoke BM/account scope | Yes | No by default | No | No |
| Suspend/deactivate/reactivate member | Yes | No | No | No |
| View another user's sessions | Yes | No | No | No |
| Revoke another user's sessions | Yes | No | No | No |
| View own sessions | Yes | Yes | Yes | Yes |
| Revoke own other session | Yes | Yes | Yes | Yes |
| Logout own other devices | Yes | Yes | Yes | Yes |

A9 must not permit role escalation through direct API calls even if frontend control is hidden.
Backend authorization is authoritative.

### 6.1 Scope rules

Use this deterministic policy:

1. Owner has global workspace scope.
2. Admin has only scopes explicitly granted unless a future owner-controlled global-admin mode
   exists.
3. Operator and Viewer have only explicitly assigned scope.
4. Active BM assignment grants access to that BM and ad accounts linked to that BM.
5. Active ad-account assignment grants access only to that account and assets linked to it.
6. If both BM and ad-account assignments exist, access is the union of permitted scope.
7. Revoked/expired/archived assignment grants no access.
8. Asset visibility is derived from accessible BM/ad-account relation. It is not a separate
   permission grant.
9. Unmapped resources are not visible to non-owner users unless explicitly assigned as such
   relation exists.
10. A resource that is archived follows existing A1 archive visibility policy; archive status is
    independent of assignment status.

### 6.2 Non-disclosure rule

For any resource outside user workspace/scope:

- List endpoints exclude it.
- Detail endpoints return existing-project non-disclosing response, normally `404`.
- Mutation endpoints return non-disclosing `404` or project-standard equivalent before exposing
  role/scope details.
- Error messages must not reveal BM/account names, IDs, membership, seat information, or
  assignment existence.

## 7. Constraints and Guardrails

1. Audit actual A1–A8 repository, auth model, session model, RBAC implementation,
   email/provider configuration, Extension session model, A7/A8 authorization paths, and tests
   before code changes.
2. Run all existing regression tests before A9 changes. If a blocking security invariant fails,
   stop and report the smallest repair plan.
3. A9 must be additive-first and reuse workspace, user, membership, audit, soft-archive,
   redaction, request-ID, pagination, API error, and UI patterns already in the application.
4. Do not replace authentication system or issue a second competing login/session system
   without confirmed audit need.
5. True multi-device revoke requires server-side session/token registry or existing equivalent.
   Stateless JWT alone is insufficient for immediate invalidation; do not pretend that
   client-side token deletion revokes a stolen token.
6. All authenticated request paths must check both token/session validity and current member
   status (active) before resource authorization.
7. When a member is suspended, deactivated, archived, or loses active workspace access, all
   server-side active sessions for that member/workspace must be revoked or denied immediately
   according to chosen architecture.
8. Revoking a device session must invalidate it server-side immediately; UI removal alone is
   insufficient.
9. A user must not be able to revoke another user's session except an owner using owner-only
   flow.
10. A user must not accidentally revoke their own current session without an explicit
    confirm/re-auth behavior. Prefer blocking direct current-session revocation and offering
    sign-out separately through existing auth flow.
11. `logout other devices` must retain the currently authenticated session and revoke only
    other active sessions in the same workspace/user scope.
12. Deactivating a member must require a reason, revoke all their sessions, remove effective
    resource access immediately, release seat, and write audit records. Historical
    assignments/invitations/operations/audit records must remain.
13. Changing a member's role must require explicit confirmation and audit before/after role.
    Owner role must not be assignable through A9 normal UI/API.
14. The workspace must never end with zero active owners. Prevent deactivation, archive, or
    role downgrade of the last active owner.
15. The initial creator/owner may not self-deactivate, self-archive, or remove their last owner
    access through A9.
16. Invitations must use cryptographically secure, single-use, time-limited tokens. Store only
    a token hash; never store raw invitation token after creation.
17. Invitation acceptance must atomically recheck email, invitation status/expiry, workspace
    membership state, and seat availability to prevent race conditions/overbooking.
18. A pending invitation does not reserve an active seat under A9 policy. Seat availability must
    be rechecked at acceptance; if no seat is available, invitation remains pending/blocked with
    safe explanation.
19. Invitation email/link preview must never include workspace secrets, Meta connection
    details, API tokens, browser profile details, account credentials, payment details, or raw
    internal audit information.
20. A9 must not expose full user IP address unless existing privacy/security policy explicitly
    allows it. Prefer masked IP or privacy-preserving IP hash for session metadata.
21. Do not collect browser fingerprint, browsing history, Meta/Facebook session material,
    browser cookies, proxy credentials, or extension page content in device registry.
22. Device label must be generated from coarse browser/OS metadata and user-editable only under
    safe length/character validation. It must not be treated as a security identity.
23. No hard DELETE endpoints/tables for members, invitations, assignments, sessions, revocation
    events, or audit records.
24. All invite, accept, revoke, role, assignment, suspension/deactivation/reactivation, seat,
    session, and security mutations must generate A1-compatible redacted audit records.
25. Audit payloads must never contain raw invitation token, password, cookie, session token,
    access token, refresh token, secret, full IP, user agent full string if policy disallows it,
    or Meta credential.
26. A9 must not expose employee-seat pricing calculation or payment collection. Optional
    `plan_reference` is descriptive only.
27. Do not alter A1 readiness, A2 health, A3 alerts, A4 deployment boundaries, A5 extension
    context security, A7/A8 operation semantics, or A6 data in A9.
28. Resource assignment affects internal AdsOps authorization only; it must not call Meta APIs
    or change Meta access grants.
29. A9 must not send real email or Telegram during automated tests. Use fake invitation delivery
    and existing fake notification transport.
30. Real invitation email sending, if added later, is a separate external communication action
    requiring explicit user confirmation with resolved recipient/content/provider.
31. Do not deploy Docker Compose, change production environment, or send external
    communications as part of A9 implementation unless separately authorized after target
    resolution.
32. Keep UI compact: Team & Seats and Security & Devices are settings-level modules, not a large
    enterprise administration suite.

## 8. Scope

### A. Domain model

Audit existing `Workspace`, `User`, `WorkspaceMember`, authentication/session structures, A5
extension installation/session structures, and audit schemas first. Reuse existing
names/entities where equivalent.

Create only missing additive entities.

#### 1. WorkspaceSeatPlan

Purpose: stores workspace capacity and descriptive plan information. It is not a billing engine.

```
id
workspace_id
seat_limit
plan_reference nullable
plan_status
created_by nullable
updated_by nullable
created_at
updated_at
archived_at nullable
```

Rules:

- One active seat plan per workspace.
- `seat_limit` is a non-negative integer.
- `seat_used` must be computed from active members; do not persist a mutable counter without
  reconciliation logic.
- Pending invitations do not count toward `seat_used` in A9.
- If no plan is configured, workspace may default to one seat for existing owner only, or use
  existing project plan policy discovered in audit. Document decision.

#### 2. WorkspaceInvitation

Purpose: durable, auditable invitation lifecycle.

```
id
workspace_id
email_normalized
invited_role
status
token_hash
token_last_four nullable
expires_at
sent_at nullable
accepted_at nullable
accepted_by_user_id nullable
revoked_at nullable
revoked_by nullable
revoke_reason nullable
created_by
created_at
updated_at
archived_at nullable
```

Rules:

- `invited_role` only permits `admin`, `operator`, `viewer`; `owner` cannot be invited via A9.
- Store normalized email; use canonicalization strategy consistent with auth provider and
  document it.
- Token must be cryptographically random, one-time, hash-at-rest, expire by default after 7
  days unless existing security policy differs.
- Raw token appears only once immediately after generation in controlled invitation
  delivery/preview response, never in persistence/audit/logs.
- Do not allow multiple active pending invitations for same normalized email/workspace unless
  project policy explicitly supports replace/revoke behavior. Default: revoke/supersede old
  pending invitation when owner creates a new one, with audit.

#### 3. MemberBusinessManagerAssignment

```
id
workspace_id
member_id
business_manager_id
status
assigned_by
assigned_at
expires_at nullable
revoked_at nullable
revoked_by nullable
revoke_reason nullable
created_at
updated_at
archived_at nullable
```

#### 4. MemberAdAccountAssignment

```
id
workspace_id
member_id
ad_account_id
status
assigned_by
assigned_at
expires_at nullable
revoked_at nullable
revoked_by nullable
revoke_reason nullable
created_at
updated_at
archived_at nullable
```

Rules for assignments:

- Only active non-owner members receive assignments in A9; owner has global access and does not
  need records.
- Assignment must target resource in same workspace.
- Assignment must reject inactive/suspended/deactivated/archived member.
- Duplicate active assignment for same member/resource is prohibited.
- Revoke/expiry retains historical row; no hard delete.
- `expires_at`, if used, must be future timestamp and expire automatically in access evaluation.

#### 5. DeviceSession or AuthSessionRegistry

Use existing session registry if present. Otherwise add server-side session registry capable of
immediate revoke.

```
id
workspace_id
user_id
member_id nullable
session_type
token_family_id nullable
session_hash or opaque_session_reference
browser_family nullable
browser_version_major nullable
os_family nullable
device_label
ip_hash nullable
ip_masked nullable
created_at
last_seen_at
expires_at
revoked_at nullable
revoked_by nullable
revoke_reason nullable
replaced_by_session_id nullable
created_from_request_id nullable
```

Rules:

- Never store raw session token/JWT/access token.
- If using JWT, store `jti`/token-family or opaque token hash server-side and check
  revocation/session validity on each request.
- Use coarse metadata only, not full fingerprint.
- `ip_hash`/masked IP is optional and must use a server secret/salt strategy if hash is used; do
  not expose raw IP in UI.
- Session belongs to user and workspace context. If app supports multi-workspace membership,
  enforce appropriate scope.
- `last_seen_at` update must be throttled (for example no more than once per 5 minutes) to avoid
  write on every request.

#### 6. SessionRevocationEvent (only if AuditLog is insufficient)

Prefer existing `AuditLog`. Add only if necessary for efficient security timeline:

```
id
workspace_id
device_session_id
subject_user_id
actor_user_id nullable
action
reason
created_at
```

#### 7. Optional MemberAccessSnapshot

Create only if performance measurement shows list authorization needs a materialized/cache
snapshot. Default: do not create; evaluate scope through indexed assignment queries/service.

### B. Seat service and lifecycle

Expected service names, adapted to repository convention:

```
SeatPlanService
SeatAvailabilityService
InvitationService
InvitationTokenService
MembershipLifecycleService
AssignmentService
ScopeAuthorizationService
SessionRegistryService
SessionRevocationService
DeviceMetadataService
```

Required seat behavior:

```
seat_used = count(active WorkspaceMember records)
seat_available = max(seat_limit - seat_used, 0)
pending invitations = count(pending unexpired WorkspaceInvitation records)
```

Lifecycle:

```
Owner creates invitation
  → invitation status = pending
  → seat is not consumed

User accepts valid invitation
  → transaction locks/checks plan and active membership count
  → if seat available: create/activate member, mark invitation accepted, consume seat
  → if no seat: keep invitation pending or mark acceptance blocked according to selected policy

Owner deactivates member
  → member status = deactivated
  → revoke all active sessions
  → active seat count reduces

Owner reactivates member
  → check available seat atomically
  → if available: member status = active
  → if unavailable: return seat-limit conflict
```

### C. Invitation flow

**Create invitation** — Inputs: `email`, `role`, optional initial BM assignments, optional
initial ad-account assignments, optional note.

Validation:

- Owner-only.
- Email valid and normalized.
- Role limited to `admin`, `operator`, `viewer`.
- Cannot invite an existing active member for same workspace.
- Seat availability shown as forecast but checked again at acceptance.
- Initial assignments must be same workspace and valid.
- No raw secrets accepted.

Output: pending invitation record; one-time invitation URL/token returned only to authorized
owner in a controlled preview/delivery context, if no email provider exists; safe invitation
delivery artifact/status; audit record.

**Accept invitation** — Inputs: raw invitation token, account registration/authentication proof
according to existing auth model.

Behavior: hash token and look up pending unexpired invitation; validate exact invited email
against authenticated/registered user email; atomically check seat availability; create or
activate membership; apply initial assignments transactionally; mark invitation
accepted/single-use; create/reuse server-side device session through existing login/session
flow; write audit records; never return raw invitation token after acceptance.

**Revoke/expire invitation** — Owner-only revoke requires reason. Expiry is automatic at
read/acceptance and optionally scheduled cleanup; historical record stays. Revoked/expired token
cannot be accepted. Invitation never consumes seat once expired/revoked.

### D. Assignment and scope authorization

Assignment input rules:

- Owner-only in A9.
- Member must be active.
- Target BM/account must be same workspace and not inaccessible/archived according to project
  policy.
- Additive assignment allowed.
- Revoke requires reason; historical row retained.
- Assignment expiry supported only if existing scheduling/access evaluation can reliably enforce
  it; otherwise schema may include `expires_at` but UI leaves it unset in A9. Do not expose
  half-working expiry control.

Resource visibility derivation:

```
can_view_business_manager(member, bm):
  owner → true
  otherwise → active BM assignment for bm

can_view_ad_account(member, account):
  owner → true
  otherwise → active direct account assignment
            OR active BM assignment where account.business_manager_id is assigned

can_view_page_or_pixel(member, asset):
  owner → true
  otherwise → true only if asset is linked to a permitted BM/ad account through A1 asset links
              and project data can prove relationship
  unknown/unlinked asset → false for non-owner

can_view_operation_batch(member, batch):
  owner → true
  otherwise → access only if all resource targets/history references fall inside permitted scope
              if safe aggregate scoping cannot be proven, deny non-owner by default
```

Mutation policy:

- Viewer: no mutation.
- Operator: no team/security/assignment mutation; A7/A8 external operation execution remains
  off by default.
- Admin: operational mutation only if existing/product policy grants it and only inside assigned
  scope; A9 does not introduce global Admin by default.
- Owner: all A9 mutation rights.

### E. Device session security

**Session creation** — reuse existing login/session mechanism; create/update `DeviceSession` on
authenticated login or extension session exchange if compatible; derive coarse browser/OS
family from user agent server-side where possible; generate a generic label such as `Chrome on
Windows` or `Unknown browser`; do not use a device label as security proof; session token
reference is opaque/hashed and never returned except existing safe session identifier for the
current session, if needed.

**Session validation** — every authenticated request must verify: (1) authentication
token/session is valid and not expired; (2) corresponding server-side `DeviceSession` is active
and not revoked; (3) workspace member is active; (4) requested resource is inside role/scope
authorization. If any check fails, deny according to existing auth/non-disclosure policy.

**Session views** — all active users may view their own sessions: current device, other active
devices, session type, coarse browser/OS, masked IP or location-free equivalent (only if policy
allows), created at, last seen, expires at, status. Owner can view member session list only
after selecting a specific active/deactivated member, with audit-friendly context.

**Revoke one session** — user may revoke own non-current active session; owner may revoke any
member session, requiring reason; current session revoke is blocked in API/UI by default (use
existing sign-out flow for self logout); revoke immediately invalidates server-side registry
entry; add audit record and security timeline entry.

**Logout other devices** — any active user can revoke all their own active sessions except
current session; owner can revoke all sessions of another member, requiring reason;
deactivation automatically invokes owner-equivalent all-session revoke.

### F. API contract

Use existing API prefix, error format, pagination, auth dependencies, workspace resolution,
audit, and no-delete conventions.

**Team and seats**
```
GET   /api/v1/team/summary
GET   /api/v1/team/seat-plan
PATCH /api/v1/team/seat-plan
GET   /api/v1/team/members
GET   /api/v1/team/members/{member_id}
PATCH /api/v1/team/members/{member_id}/role
POST  /api/v1/team/members/{member_id}/suspend
POST  /api/v1/team/members/{member_id}/unsuspend
POST  /api/v1/team/members/{member_id}/deactivate
POST  /api/v1/team/members/{member_id}/reactivate
POST  /api/v1/team/members/{member_id}/archive
```

**Invitations**
```
GET  /api/v1/team/invitations
POST /api/v1/team/invitations
GET  /api/v1/team/invitations/{invitation_id}
POST /api/v1/team/invitations/{invitation_id}/revoke
POST /api/v1/team/invitations/{invitation_id}/resend
POST /api/v1/team/invitations/accept
```

`resend` must invalidate/supersede old token and create a new safe token/delivery artifact;
never resend the same raw token from storage.

**Assignments**
```
GET  /api/v1/team/members/{member_id}/assignments
POST /api/v1/team/members/{member_id}/business-manager-assignments
POST /api/v1/team/members/{member_id}/ad-account-assignments
POST /api/v1/team/assignments/{assignment_id}/revoke
```

**Sessions/security**
```
GET  /api/v1/security/sessions/me
POST /api/v1/security/sessions/{session_id}/revoke
POST /api/v1/security/sessions/logout-other-devices
GET  /api/v1/team/members/{member_id}/sessions
POST /api/v1/team/members/{member_id}/sessions/revoke-all
```

**Access preview**
```
GET /api/v1/team/members/{member_id}/access-preview
```

This endpoint must be owner-only and return a bounded, paginated/summary representation of
effective scope. It must not leak unrelated global resources to non-owner callers.

**Required API validation**

- Owner-only enforcement for all team-seat/invite/role/assignment/member lifecycle mutations.
- `PATCH /role` rejects `owner` assignment through normal API.
- Changing/downgrading/deactivating last active owner returns conflict.
- Revoke/suspend/deactivate/archive actions require a bounded reason.
- Invite requires role/email validation.
- Accept requires token + matching authenticated user email.
- Seat plan update requires non-negative integer and cannot reduce below active member count.
- Assignment requires active member/resource in same workspace and no active duplicate.
- Session revoke enforces actor ownership/current-session restrictions.
- Responses never include raw invitation token, token hash, session token/hash, secrets, full
  IP, raw user agent, or Meta credentials.

### G. Frontend UX/UI surfaces

Keep these features inside Settings-level UX. Do not create an enterprise-style sprawling admin
console.

**1. Settings navigation**
```
Settings
  - Team & Seats
  - Security & Devices
  - Existing notification/connection settings remain separate
```

**2. Team & Seats page** — top summary: seat limit, active members, available seats, pending
invitations, plan reference (optional). Main member table: member, email, role, status, assigned
BMs, assigned accounts, last active, active sessions, actions. Owner actions: invite member,
edit role, manage assignments, suspend, deactivate, reactivate, view sessions. Use explicit
status labels. Do not call deactivated staff "deleted."

**3. Invite member drawer** — inputs: email, role (Admin/Operator/Viewer), optional initial BM
assignment, optional initial ad-account assignment, optional note. Preview before create: seat
availability current state, role, selected scopes, invitation expiry, delivery method/status.
If no email provider is configured: invitation link generated for secure manual delivery, copy
action with one-time warning, no raw token is stored after dialog closes. The frontend must not
place raw invitation token in persistent browser storage, route URL history, audit event,
console log, or analytics.

**4. Member detail / assignment drawer** — sections: role and member status, Business Manager
assignments, ad-account assignments, effective access preview, recent session summary (owner
only), recent audit activity. Actions: add BM assignment, add ad-account assignment, revoke
assignment, suspend/deactivate/reactivate. Assignment revoke confirmation must show exact
member + resource + reason input.

**5. Role-change confirmation** — display: member name/email, current role, new role, scope
effect warning, explicit confirmation. Never offer Owner in select control. Backend must reject
it anyway.

**6. Deactivate member confirmation** — display: member name/email, current role, number of
active sessions to revoke, seat effect (one seat becomes available), scope effect (loses access
immediately), reason required.

**7. Security & Devices page** — for the current user: current device, other devices, session
type, browser/OS, masked IP if available, last seen, created, expires, status. Actions: rename
device label (optional, current-user own session only), revoke another device, log out other
devices. For owner viewing a member: member session list, revoke specific session, revoke all
sessions. No raw IP, full UA, token, browser fingerprint, or Meta session information displayed.

**8. Resource-scope UX** — non-owner user navigation/list pages show only permitted
BMs/accounts/assets/operations. If a bookmarked link becomes inaccessible after assignment
revoke, show normal non-disclosing Not found page or project equivalent. Use a small scope chip
in header, for example `Scoped access`, rather than listing all inaccessible resources.

**9. Compact mobile/responsive behavior** — tables collapse to cards/summary rows on narrow
screens. Destructive actions remain accessible but require confirmation and reason. No critical
action depends on hover only.

### H. Audit and observability

Required audit actions, using existing A1-compatible audit log:

```
seat_plan_created
seat_plan_updated
invitation_created
invitation_resent
invitation_accepted
invitation_revoked
invitation_expired
member_role_changed
member_suspended
member_unsuspended
member_deactivated
member_reactivated
member_archived
bm_assignment_created
ad_account_assignment_created
assignment_revoked
session_created
session_last_seen_updated (optional/throttled; avoid noisy audit)
session_revoked
sessions_logout_other_devices
member_sessions_revoked_all
access_denied_scope (security log/metric only; avoid noisy full audit by default)
```

Safe system status indicators: active members / seat limit, pending invitations, expired
pending invitations, active sessions, revoked sessions last 24 hours, failed invitation
delivery attempts if a provider exists.

Do not add automatic Telegram notifications for team/security actions in A9 unless a separate
explicit policy extension is approved. In-app audit and Alert Center integration may be
considered later.

## 9. Audit Before Build

Before implementation, the agent must complete and report the audit below.

### 9.1 Repository and baseline audit

Inspect actual: current git commit/branch, uncommitted changes, repository structure; A1–A8
models, migrations, routes, services, tests, docs; existing `User`, `Workspace`,
`WorkspaceMember`, role enum, membership status, auth providers, login flow, password handling,
session/token models, refresh-token model if any; whether sessions are stateless JWT,
server-side opaque tokens, cookies, or hybrid; existing token revocation/blacklist/session
registry behavior; A5 Chrome Extension auth/session and revoke behavior; existing resource
authorization checks for BM, ad account, assets, A7/A8 operation batches/items/history; A1
audit/redaction implementation and secret-key denylist; existing email/notification provider
abstractions and fake transports; existing frontend Settings/navigation/forms/tables/drawers/
modals/confirmation patterns; existing migration/fixture/test reset pattern; existing production
configuration from A4 and whether environment values can support invitation delivery later.

### 9.2 Security-invariant verification

Run current regression suite and verify at minimum: workspace scope derives from authenticated
identity, not body/query; cross-workspace resource access is non-disclosing; sensitive fields
are rejected/redacted; no hard delete exists for core domain entities; A1 readiness and A2
health are separate; A3 notifications cannot mutate source state; A7/A8 operations require
preview/confirmation and use fake provider in tests; A5 revoke behavior, if present, works or is
documented as incomplete.

If existing auth is stateless with no server-side session registry: report exact limitation;
propose smallest additive server-side registry/token-family strategy; do not claim immediate
session revoke works until it is implemented and tested.

### 9.3 Authorization-scope audit

Identify all list/detail/mutation paths that expose BMs, ad accounts, Pages, Pixels, account
health, readiness, alerts, audit logs, operations, connections, and system/security settings.
Identify which existing paths are owner-only/global/workspace-only and which need scope
filtering. Identify whether A7/A8 operation history has enough resource linkage for scoped
filtering. Identify behavior for unmapped assets and archived resources. List all paths that
need centralized scope-authorization dependency/service rather than scattered checks.

### 9.4 Invitation/session audit

Determine whether real email delivery exists; determine secure invitation delivery fallback
when email is absent; determine password/account creation or identity-linking flow needed for
invitation acceptance; determine whether same email can belong to multiple workspaces under
current auth model; determine session token creation/expiry/refresh behavior; determine how
extension sessions should be tied to/revoked with main session model.

### 9.5 Audit output required before code

Return all of the following before implementation:

1. Verified A1–A8 baseline and deviations from prior reports.
2. Exact files/docs inspected.
3. Regression results and test counts.
4. Existing auth/session model and immediate-revoke gap assessment.
5. Existing member/role/workspace model and reuse plan.
6. Existing A5 extension session relationship and chosen treatment.
7. Current resource authorization map and confirmed scope-filtering gaps.
8. Invitation delivery architecture decision: existing provider / fake transport / secure
   manual-link preview.
9. Seat lifecycle/atomicity implementation plan.
10. Device-session data-minimization design.
11. Expected changed files.
12. Migration compatibility/rollback risks.
13. Explicit confirmation that no real email/Telegram message, production deployment, Meta
    operation, credential sharing, browser automation, or platform mutation will occur in A9
    implementation/testing.

## 10. Design Choice

**Chosen design:** implement a workspace-scoped RBAC + assignment authorization layer with an
atomic seat/invitation lifecycle and a server-side session registry for immediate multi-device
revocation.

A9 will:

1. Reuse the existing user/workspace/membership model if it exists.
2. Add `owner`, `admin`, `operator`, and `viewer` role policy only if equivalent vocabulary is
   not already present.
3. Add a single centralized `ScopeAuthorizationService` used by BM/account/asset/operation data
   access paths.
4. Model only BM and ad-account direct assignments; derive Page/Pixel visibility from A1
   relationships.
5. Maintain an active-seat count derived from active membership records, not a mutable counter.
6. Use cryptographically random, hash-at-rest, single-use invitation tokens with 7-day expiry
   default.
7. Use fake invitation transport or one-time secure owner link preview until a real email
   provider is deliberately configured.
8. Add/reuse server-side session registry/token-family validation so device revoke is effective
   immediately.
9. Keep Team & Seats and Security & Devices as compact Settings pages.
10. Preserve A7/A8 external Meta operation authorization; A9 only restricts internal visibility
    and eligibility by member scope, it does not grant Meta permissions.

**Why this design:** it solves the operator's actual collaboration need without requiring shared
credentials; it makes "multi-device security" real through server-side invalidation rather than
cosmetic client logout; it avoids a complex per-asset permission matrix while still protecting
Pages/Pixels through existing BM/account links; it keeps seat logic simple and auditable; it
keeps invitation delivery testable without prematurely adding an email provider; it creates a
safe foundation for paid seat plans and more sophisticated team policies later without adding
billing complexity now.

**Rejected alternatives:**

- *Shared owner password or shared browser profile* — rejected because it destroys
  attribution/auditability, makes access revocation difficult, and increases account-security
  risk.
- *Stateless JWT-only "revoke"* — rejected because deleting a token in one browser does not
  invalidate a stolen/other-device token. A server-side registry/revocation check is required.
- *Direct Pixel/Page permissions in A9* — rejected because it creates a broad permission model
  before BM/account scope is proven. Derive access from existing mappings first.
- *Seat consumed at invitation creation* — rejected under A9 default policy because pending
  invitations can waste capacity. Seat is atomically checked/consumed at acceptance.
- *Full email-provider integration as a prerequisite* — rejected because it would delay
  team/security value. A fake/manual secure-link delivery abstraction lets the workflow be
  implemented and tested first.
- *Admin can make anyone owner* — rejected because owner role changes are high-risk and require
  a separate ownership-transfer process/spec.

## 11. Implementation Plan

**Step 1 — Audit and regression baseline** — complete Section 9; run all existing tests; repair
only blocking baseline defects before A9 expansion.

**Step 2 — Session architecture first** — audit actual auth/session flow; add/reuse server-side
session registry and request validation; add session revoke behavior and tests before exposing
Team UI; ensure member status is validated on every authenticated request; decide
extension-session integration based on A5 actual model, defer complex migration if needed but
document exact revocation behavior.

**Step 3 — Membership/seat/invitation schema** — add/extend seat plan, invitation, membership
status, role vocabulary, and assignment tables; add indexes, unique constraints, foreign keys,
soft archive fields; implement migration clean-db and upgrade-path verification.

**Step 4 — Core services and authorization** — implement seat availability and atomic
acceptance; implement invitation token generation/hash/validation/single-use/expiry/
revoke/resend; implement member lifecycle service; implement centralized scope authorization for
BMs/ad accounts/assets/operations; update existing query/service paths to apply scope filtering
consistently; implement assignment service.

**Step 5 — API** — add team, invitation, assignment, and security session endpoints; enforce
owner-only/member-self boundaries; implement reason/confirmation contract where required; add
access-preview endpoint bounded/paginated.

**Step 6 — Frontend** — add Team & Seats settings page; add Security & Devices page; add
invitation, member, role, assignment, suspend/deactivate/reactivate, and session revoke
workflows; add confirmation modals and required-reason fields; update resource
navigation/list/detail behavior for scoped users.

**Step 7 — Tests and fake UAT** — execute unit/integration/frontend/security/regression tests;
use fake invitation delivery only; execute multi-user/multi-workspace scope pilots; execute
multi-device session revoke pilots.

**Step 8 — Documentation and report** — update `FEATURES.md`, `ARCH.md`, `API.md`,
`TEST_LOG.md`; add `docs/TEAM_AND_SEATS.md`; add `docs/SESSION_SECURITY.md`; add
`docs/INVITATION_RUNBOOK.md`. Stop after A9. Do not deploy or send real invitations without
separate approval.

## 12. Test Plan

### 12.1 Unit tests

**Seats and membership** — seat availability is derived from active member count; pending
invitation does not consume active seat; accepting invitation consumes exactly one seat;
concurrent acceptance with one available seat permits only one active membership; seat plan
cannot be reduced below active member count; deactivate releases a seat; reactivate with
available seat succeeds, without seat fails with conflict; suspend preserves/release seat
behavior exactly as selected, default preserves seat; last active owner cannot be deactivated,
archived, or downgraded; owner role cannot be invited/assigned through normal A9 role endpoint.

**Invitations** — generated invitation token is cryptographically random/long enough and only
token hash is stored; raw token is absent from audit/log/persistence DTOs; token acceptance
works once only; expired/revoked/accepted token is rejected; invitation email must match
authenticated user email; duplicate active pending invitation handling follows selected policy;
resend invalidates/supersedes old token and creates new hash; initial assignments apply
transactionally only after valid acceptance.

**Scope authorization** — owner has global access; scoped admin/operator/viewer sees only
assigned BM/account records; BM assignment grants linked ad-account access; direct account
assignment grants only that account; union of BM/account assignments works;
revoked/expired assignment removes access; non-owner cannot see unlinked/unmapped asset unless
direct relationship proves scope; operation history outside scope is excluded/non-disclosing;
viewer mutations denied server-side; admin cannot manage team/seat/role/owner operations.

**Sessions** — new login creates/reuses server-side session registry record; revoked session
immediately fails authorization; expired session fails authorization; deactivated/suspended
member fails authorization even with previously valid token; `logout-other-devices` revokes
every active session except current session; current session remains active after
logout-other-devices; user cannot revoke own current session through device-revoke endpoint;
owner can revoke a member session/all member sessions with reason; deactivation revokes all
member sessions; no raw token/JWT/cookie is persisted in session table/audit/log; last-seen
update is throttled.

**Redaction/audit** — invitation/session mutation emits audit record with allowed fields; audit
record excludes invitation raw token/token hash/session hash/raw IP/user agent/token/secret;
reasons are bounded and sanitized.

### 12.2 Integration tests

Use real PostgreSQL/migrations, real auth/session middleware or equivalent test harness. Do not
mock database or authorization logic being tested.

Owner creates seat plan and invitation; invited matching user accepts (membership/initial
assignments/session created atomically, seat usage correct); different email tries invitation
token (rejected without membership creation); two users accept invitations simultaneously with
one seat (only one succeeds); owner assigns BM and account scope to member (list/detail
endpoints expose only allowed resources); member loses assignment (bookmarked/detail endpoint
becomes non-disclosing); Pixel/Page visibility derived from permitted BM/account mapping;
scoped member cannot access unassigned A7/A8 operations/history; owner changes member role
(audit before/after correct); owner suspends/deactivates member (member's live session
immediately denied, all sessions revoked, seat state correct); owner reactivates member with/
without seat availability; member revokes own other device (old token/request denied
immediately); member executes logout-other-devices (current remains valid); owner revokes all
member sessions (all old session tokens denied); cross-workspace invitation/assignment/
session/member endpoint access returns non-disclosing behavior; archive history remains
accessible to owner under existing policy (no hard delete); existing A7/A8 operation
preview/confirmation behavior still passes for owner and is scoped/denied correctly for
members; clean migration and upgrade path pass.

### 12.3 Frontend tests

Team & Seats summary counts/render states correct; invite drawer validates email/role/seat
forecast and does not display/store raw token persistently; member role selector excludes
Owner; member table shows scoped counts/status; assignment drawer shows only workspace
resources and prevents duplicate assignment; role/deactivate/revoke-assignment/session revoke
dialogs require confirmation/reason as specified; Security & Devices displays current vs other
sessions correctly; revoke current session action unavailable/disabled with clear explanation;
logout-other-devices keeps current session in UI after refresh; non-owner UI hides/disables
owner-only controls, while backend tests enforce it; scoped member navigation and list pages do
not reveal unassigned records; team/security pages are responsive/accessibility compliant;
existing frontend regression suite passes.

### 12.4 Security and regression tests

All A1–A8 tests pass unchanged; no Meta API write/capability behavior changes due to A9; no
email/Telegram real network call in automated tests; no browser automation/fingerprint/
proxy/cookie handling introduced; no hard delete endpoints added; no raw invitation
token/session token/access token/password/cookie/Meta secret/full IP/raw UA in database, logs,
audit responses, frontend bundle, or fake transport captures; cross-workspace and out-of-scope
access is non-disclosing; last owner invariants always hold; revoke/deactivation actually
invalidates old auth access server-side; seat acceptance race condition test passes.

### 12.5 Performance/resource tests

One workspace with 1 owner, 10 members, 30+ BM/ad-account resources, and mixed assignments.
Verify scoped list queries are indexed/paginated and do not perform N+1 permission checks.
Verify logout-other-devices/revoke-all completes in bounded transaction/time. Verify session
last-seen throttling prevents write storm. Record query count/duration/RSS/CPU impact if
instrumentation exists. Confirm no new browser process, heavy queue, or polling service
introduced.

### 12.6 Live verification

Use fake/manual invitation delivery only unless the user separately approves a real email
delivery to a resolved recipient.

| Scenario | Expected result |
|---|---|
| Owner with 2 seats invites Operator | Pending invite, seat used remains 1, safe one-time link preview available |
| Matching user accepts invite | Active member created, seat used becomes 2, initial scope applied |
| Another user accepts after seats full | Blocked safely, no active member, no overbooking |
| Operator assigned BM A | Sees BM A and linked accounts/assets only |
| Operator direct-assigned Account B outside BM A | Sees Account B as union scope without unrelated resources |
| Assignment revoked | Resource disappears from list and detail returns non-disclosing result |
| Viewer attempts mutation | Backend denies; UI has no enabled mutation action |
| Member logs in on two test devices/sessions | Both appear in own session list with coarse metadata |
| Member logs out other devices | Current remains active, other session token denied immediately |
| Owner deactivates member | Member loses access immediately, sessions revoked, seat released, audit complete |
| Owner attempts deactivate last owner | Conflict; owner remains active |
| Owner revokes invitation | Token cannot be accepted; invite history remains |

Record all commands, actual outcomes, defects, fixes, and fake-vs-real delivery status in
`TEST_LOG.md`.

## 13. Acceptance Criteria

A9 is complete only when all criteria below are met.

**Functional:** owner can view seat limit, active seats, available seats, and pending
invitations; owner can create, revoke, resend, and view invitations through a secure
hash-at-rest/single-use/expiry lifecycle; invitation acceptance atomically checks seat
availability, matching email, status, expiry, and initial assignments; owner can manage member
lifecycle (role — non-owner roles only, suspend, unsuspend, deactivate, reactivate, archive);
owner can assign/revoke Business Manager and ad-account scopes; non-owner resource visibility is
derived from active assignments and related A1 mappings; assets are visible only when their
relationship to permitted BM/account can be proven; all users can view own active sessions and
revoke own other sessions; owner can view/revoke member sessions and revoke all sessions for a
member; session/device revocation is effective server-side immediately; deactivation revokes
sessions, removes access, releases seat, and preserves history; A7/A8 operation views/actions
are correctly scoped/denied for non-owner roles without changing their preview/confirmation
semantics.

**Safety and integrity:** no shared credentials/cookies/tokens/browser profiles/fingerprints are
introduced; no raw invitation/session/token/password/secret/full IP/raw UA data leaks in
database/API/audit/log/frontend; cross-workspace and out-of-scope access is non-disclosing; no
hard deletes; last active owner cannot be removed/downgraded/deactivated; Admin/Operator/Viewer
cannot self-escalate or assign Owner; pending invitations do not consume active seats,
acceptance is race-safe; no real email/Telegram/Meta call is made in automated tests or A9
implementation without separate approval; A1 readiness/A2 health/A3 alerts/A4 runtime/A5
extension/A7-A8 operation semantics remain intact.

**Quality:** full existing regression suite passes unchanged; new unit/integration/
frontend/security/performance tests pass; migration passes on clean database and upgrade path;
real-browser manual UAT is documented for Team & Seats and Security & Devices in local/staging
environment; documentation/runbooks are updated; MINI-SPEC A9 report is complete.

## 14. Documentation Updates

Update: `FEATURES.md` (team seats, invitations, scoped access, session security, boundaries);
`ARCH.md` (membership/seat/invitation/session/scope-authorization model and data flow); `API.md`
(full A9 endpoints, roles, error cases, request/response rules, non-disclosure behavior);
`TEST_LOG.md` (baseline tests, new tests, migration results, live verification, defects/fixes).
Add `docs/TEAM_AND_SEATS.md` (roles, seat lifecycle, assignment semantics, owner
responsibilities); `docs/SESSION_SECURITY.md` (session registry, device metadata policy, revoke
behavior, emergency access removal); `docs/INVITATION_RUNBOOK.md` (invite, secure manual-link
delivery, resend, revoke, expiry, acceptance troubleshooting); `docs/ACCESS_SCOPE_MATRIX.md`
(BM/account/asset/operation visibility rules and role matrix).

## 15. MINI-SPEC Report Format

After A9 is complete, the implementation agent must report exactly in this structure:

```
# MINI-SPEC A9 Report — Team Seats, BM/Ad-Account Assignment & Device Session Security

## 1. Summary
- What A9 added.
- What A9 intentionally did not add.

## 2. Audit Before Build
- Verified A1–A8 baseline:
- Exact files/docs inspected:
- Regression baseline results:
- Existing auth/session model:
- Existing authorization map:
- Invitation-delivery decision:
- Confirmed gaps:
- Out-of-scope findings:

## 3. Design Choice
- Membership/seat lifecycle:
- Invitation-token design:
- Scope-authorization design:
- Session registry/revoke design:
- A5 extension-session treatment:
- Why this design:

## 4. Changed Files
- Backend:
- Frontend:
- Migrations:
- Documentation:
- Infrastructure/config:

## 5. New API/DB/State
- New/extended entities:
- Role/member/invitation/session/assignment states:
- Endpoints:
- Authorization/non-disclosure behavior:
- Seat atomicity:
- Revoke behavior:

## 6. Tests
- A1–A8 regression:
- Unit:
- Integration:
- Frontend:
- Security/redaction:
- Race/concurrency:
- Performance/resource:
- Migration verification:
- Defects found and fixed:

## 7. Live Verification
- Fake/manual invitation flow:
- Multi-user scope scenarios:
- Multi-device session revoke scenarios:
- Real email delivery: executed/not executed
- Production deployment: executed/not executed
- Browser UAT results:

## 8. Remaining Limits / Follow-ups
- Email provider/setup:
- Stage B deployment status:
- Extension-session limitations:
- Direct asset assignment limitations:
- Team billing/seat purchase limitations:
- Recommended next MINI-SPEC:
```

## 16. Definition of Done

A9 is complete when: audit-before-build verifies actual A1–A8 baseline and reports all required
gaps; existing regression suite passes before and after changes; seat plan, invitation
lifecycle, member lifecycle, role policy, assignment scope, and session registry/revoke
behavior are implemented and tested; server-side session invalidation is proven by test (client-
only logout is not presented as revoke); scope authorization is centralized and applied to BM,
account, related asset, and applicable operation data paths; Team & Seats and Security & Devices
UI workflows are implemented with confirmation/reason safeguards; sensitive-data
redaction/non-disclosure/no-hard-delete/last-owner invariants are proven by tests; fake/manual
invitation delivery flow and multi-device UAT are documented; documentation is updated and A9
report is produced; agent stops after A9 without deployment, real email, Telegram send, or Meta
operation unless separately approved.

## 17. Recommended Next Step After A9

After A9 is completed, tested, manually UAT-tested in a real browser, and accepted, choose one
focused follow-up:

**A10 — Real Meta Provider Connection & Read-Only Capability Discovery**

A10 should cover only official Meta App setup, secure server-side secret injection,
OAuth/system-user authorization, confirmed read-only Business Manager/capability discovery,
token expiry handling, rate-limit observability, and one explicitly approved non-mutating live
API verification.

Do not begin real Meta create/share writes until A10 confirms official capability, target BM,
required permissions, billing prerequisites, and secure connection behavior.
