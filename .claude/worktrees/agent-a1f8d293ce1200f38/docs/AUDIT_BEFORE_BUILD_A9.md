# Audit Before Build — MINI-SPEC A9 (Team Seats, BM/Ad-Account Assignment & Device Session Security)

Date: 2026-09-09 · Baseline: uncommitted working tree on `main`, HEAD `f022a8b`
(A6/A7/A8 domain model, services, API, frontend, docs all uncommitted — see `git status`).

## 1. Verified A1–A8 baseline and deviations from prior reports

All of A1–A8 exist in the working tree and match the "may contain" list in the spec's §2.1,
with these deviations from what a prior report might assume:

- **A6 (Preflight)** exists, fully built and tested (89 tests), but is **hidden from main nav**
  — routes still registered, reachable by URL. Deliberately deferred, not deleted, per this
  session's own product-direction pivot toward A7/A8.
- **A7/A8** are feature-complete (domain model, `FakeMetaBusinessProvider`, batch engine, API,
  frontend) but **entirely uncommitted** in git — this matters for A9 because any migration
  numbering/ordering decision has to account for `0006`–`0008` not yet being on `main`.
- **No real Meta provider exists anywhere.** `FakeMetaBusinessProvider` is the only one wired.
- **A5** extension has had real-browser UAT (see `TEST_LOG.md`), including one real allowlist
  gap found and fixed.

## 2. Exact files/docs inspected

Backend: `app/models/entities.py` (`User`, `Workspace`, `WorkspaceMember`, `BusinessManager`,
`AdAccount`), `app/models/extension.py` (`ExtensionInstallation`), `app/core/enums.py`
(`WorkspaceRole`), `app/core/security.py` (JWT issuing/verification, password hashing),
`app/core/config.py` (settings — confirmed no email provider config), `app/core/errors.py`
(error envelope, `AuthenticationError`/`AuthorizationError`/`NotFoundError`/`ConflictError`),
`app/api/deps.py` (`Ctx`/`WriteCtx`/`ExtCtx`/`AuditCtx`, `ApiContext`, token-use gating),
`app/api/v1/routers/auth.py` (login/me), `app/api/v1/routers/meta_operations.py` (A7/A8 auth
usage pattern), `app/api/v1/routers/ad_accounts.py` (`get_or_404` non-disclosure pattern),
`app/services/workspace.py` (`WorkspaceAccessService`, role→capability policy — **already
written anticipating this exact mini-spec**, see §4 below), `app/services/audit.py`
(`AuditLogService.record`), `app/services/extension_session.py` +
`ExtensionInstallationService` (A5's own session/device revocation model), `app/services/base.py`
(`get_or_404`, `snapshot`, `diff` — shared service helpers), `app/schemas/common.py`
(`Page[T]` pagination, `page_response`), `app/schemas/alerts.py` (existing `reason` field
convention). Frontend: `frontend/src/pages/Settings.tsx` (existing `ConnectedBrowsersSection` —
the exact revoke-device UI pattern A9's Security & Devices page should mirror),
`frontend/src/components/AppShell.tsx` (nav — single `/settings` entry, confirms Team & Seats/
Security & Devices belong as sub-sections, not new top-level nav items). Migrations: all of
`backend/alembic/versions/0001`–`0008` (listed, not each read line-by-line — table shapes
confirmed via model files instead). `CLAUDE.md` (hard rules 1–39), `MINI_SPEC_PLAYBOOK.md`
convention, `docs/AUDIT_BEFORE_BUILD_A{2..5}.md` (report-format precedent).

## 3. Regression baseline results

Backend: full suite (`.venv/bin/python -m pytest -q`) — **546 tests collected
(`--collect-only` count), all passing, exit code 0.** Run alone against the shared local
Postgres (started 2026-09-09 13:36, finished ~13:49, ~13 minutes — this is the full A1–A8
suite including A6/A7/A8's uncommitted work).

Frontend: `npx tsc -b` clean, `npx eslint .` clean (ran before this report; vitest/build not
re-run since no frontend code changed yet in this audit pass).

No blocking security invariant failed pre-existing to A9 (see §4 for what A9 itself must add,
which is different from a baseline failure).

## 4. Existing auth/session model and immediate-revoke gap

**Dashboard sessions are pure stateless JWT — zero server-side revocation exists today.**
`create_access_token()` (`app/core/security.py`) signs `{sub, workspace_id, role, token_use,
exp, iat}` with no `jti`, no session row, nothing checked against a registry.
`app/api/deps.get_context()` decodes and trusts the token until `exp` — there is currently
**no way to invalidate a dashboard token before its natural expiry**. This is exactly the
gap CLAUDE.md's hard rules never had to address before (no prior mini-spec needed
mid-session revocation) and exactly what A9 guardrail 5 anticipates: *"Stateless JWT alone is
insufficient for immediate invalidation; do not pretend that client-side token deletion revokes
a stolen token."* Confirmed — this needs a genuinely new server-side `DeviceSession` registry,
checked on every request, not a cosmetic addition.

**A5's extension sessions already solved this correctly, separately.**
`ExtensionInstallation` (`app/models/extension.py`) + `ExtensionSessionService` /
`ExtensionInstallationService` (`app/services/extension_session.py`) already implement exactly
the pattern A9 needs for dashboard sessions: a DB row per installation
(`label`, `extension_version`, `last_seen_at`, `revoked_at`, `revoked_reason`), re-loaded and
re-checked (`installation.is_active`) on every extension request via
`get_extension_context()` in `app/api/deps.py`. Revoking is "delete a row" (well — set
`revoked_at`), not "wait for expiry." The frontend already has a working revoke UI for this
(`ConnectedBrowsersSection` in `Settings.tsx`) — table of installations, "Revoke" button,
reason hardcoded to a UI-supplied string, `Badge` for Connected/Revoked.

**Decision:** A9's `DeviceSession`/session-registry work is for **dashboard (`web`) JWTs only**.
Do not touch, migrate, or unify with `ExtensionInstallation` — they are legitimately separate
per the spec's own §5.8 note ("if the A5 design uses separate extension installation/session
artifacts, preserve that behavior and create a safe bridge, not a forced migration"). A9 should
mirror the *pattern* (row + `revoked_at` + re-check-every-request) for dashboard sessions, not
merge the *tables*.

## 5. Existing member/role/workspace model and reuse plan

`WorkspaceMember` (`app/models/entities.py`) exists with `workspace_id`, `user_id`, `role`
(enum), `Archivable` (i.e. `archived_at` — no separate `status` field). It is currently created
**only** by `app/bootstrap.py`'s one-time seed script — **there is no invite/create-member API
endpoint at all today.** A9's `WorkspaceInvitation` + accept flow is genuinely new, not an
extension of a partial one.

**Role mismatch — the one real design decision this audit surfaces.** `WorkspaceRole`
(`app/core/enums.py`) is:

```python
class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    BUYER = "buyer"
    VIEWER = "viewer"
    AUDITOR = "auditor"
```

— not `owner/admin/operator/viewer` as the spec assumes. And `app/services/workspace.py`
already has role→capability policy, with a comment that reads like it was written *for* this
exact moment:

> "Roles exist in data from the first release even though only `owner` is provisioned, so a
> later RBAC MINI-SPEC changes this module rather than hunting for a hard-coded user id in
> services (A1 Guardrail 12)."

```python
MUTATION_ROLES = frozenset({WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUYER})
READ_ROLES = frozenset(WorkspaceRole)  # everyone can read everything — no scoping at all today
AUDIT_READ_ROLES = frozenset({OWNER, ADMIN, AUDITOR, VIEWER})  # BUYER excluded from audit read
```

**Decision (confirmed with product owner 2026-09-09):** keep the existing 5-value enum as-is —
no migration, no rename, nothing in A7/A8's already-shipped `WriteCtx` gates changes. Map
semantically for A9's new scope policy: `BUYER` ≈ this spec's `operator` (does the operational
work — creates/shares accounts, would run scoped A7/A8 operations); `AUDITOR` keeps its
existing, already-correct distinct meaning (read + audit-read, not general mutation) rather than
being forced into the spec's `viewer` bucket; `VIEWER` stays `viewer`. `ADMIN`/`OWNER` map
directly. A9's new `ScopeAuthorizationService` and permission-matrix implementation will use
`WorkspaceRole.BUYER` wherever the spec's document says `operator`, and keep `AUDITOR` as its
own case in the matrix (closest to spec's `viewer` row, but retaining audit-log read).

**Real, currently-open gap this creates:** `READ_ROLES = frozenset(WorkspaceRole)` means **any**
active member of **any** role can read **any** BM/ad account/asset in the workspace today — A7's
and A8's routers gate mutation only through `WriteCtx` (`MUTATION_ROLES`), with **zero**
per-BM/per-account scoping anywhere in the codebase. A9's `ScopeAuthorizationService` is not
tightening an existing partial scope check — it is adding the first one that has ever existed
beyond "any role in the workspace."

## 6. Existing A5 extension-session relationship and chosen treatment

Covered in §4 — A9 builds a parallel, independent `DeviceSession` registry for dashboard (`web`)
sessions; `ExtensionInstallation` stays exactly as-is, no forced migration, no shared table.

## 7. Current resource authorization map and confirmed scope-filtering gaps

| Path family | Current gate | Scope-filtering gap A9 must close |
|---|---|---|
| `/ad-accounts`, `/business-managers`, `/references` (A1) | `Ctx` (any role) read, `WriteCtx` (owner/admin/buyer) mutate | List/detail return workspace-wide, no BM/account assignment check |
| `/health`, `/readiness` (A2) | `Ctx`/`WriteCtx` | Same — reads the same unscoped account set |
| `/alerts` (A3) | `Ctx`/`WriteCtx` | Same |
| `/account-creation-batches`, `/access-share-batches`, `/pixel-share-batches` (A7/A8) | `Ctx`/`WriteCtx` | No linkage check between a batch's target BM/account and the caller's assignment — A9 needs `can_view_operation_batch` per spec §D, and the batch item rows already carry `business_manager_external_id`/`target_ad_account_external_id` so scope IS derivable, just not derived today |
| `/audit-log` | `AuditCtx` (owner/admin/auditor/viewer) | Same unscoped-by-resource read |
| `/meta-connections` | `Ctx`/`WriteCtx` | Spec says owner-only by default (§6 matrix) — currently any mutation-role member can create/check-capability a connection |
| `/extension/installations` | `Ctx` (dashboard) | Out of scope for A9 — this is the A5 registry, not touched |

No path today does resource-level scope filtering of any kind. `ScopeAuthorizationService`
(spec §D) is a wholly new centralized dependency, not a refactor of scattered checks — because
there is nothing scattered to refactor; the check has never existed.

## 8. Invitation-delivery decision

**No email provider exists** — `app/core/config.py` has no SMTP/SendGrid/Mailgun-shaped setting
of any kind, only `bootstrap_owner_email` (the one-time seed user's address, unrelated to
sending mail). Per spec §4 non-goals and §C, A9 will use the **secure manual-link preview**
delivery mode: the raw invitation URL/token is returned once, in the create-invitation API
response, for the owner to copy and send through whatever channel they choose — mirroring this
project's existing `FakeNotificationTransport` pattern (A3) for the *fake-transport-in-tests*
half, with no fake email transport needed since there's no real one to fake.

## 9. Seat lifecycle/atomicity design

`seat_used` computed live from `count(active WorkspaceMember)` at read time — no persisted
mutable counter (matches spec §5.4 and §B exactly, and matches this project's existing
`AccountCreationBatchService`/`AccessShareBatchService` pattern of deriving state from rows
rather than a cached counter). Acceptance path: `SELECT ... FOR UPDATE` (or equivalent
row-lock) on the `WorkspaceSeatPlan` row inside the same transaction that checks
`seat_used < seat_limit` and creates/activates the `WorkspaceMember`, so two concurrent
acceptances against the last seat serialize correctly — same transactional-lock shape already
used by A7/A8's batch-item lease reclaim.

## 10. Device-session data-minimization design

Mirrors `ExtensionInstallation`'s existing shape (coarse `browser_family`/`os_family` parsed
server-side from `User-Agent`, never the raw string persisted; no fingerprinting). `ip_hash`
only, salted server-side (reusing the same "never expose raw IP" boundary already established
for the rate limiter's `X-Forwarded-For` handling per CLAUDE.md rule 37). `last_seen_at`
throttled to once per 5 minutes, matching the spec's explicit requirement and avoiding the
write-storm this project already had to guard against once (A2's health-evaluation query-count
resource checks, visible in this very regression run's `[A2 resource check]` line).

## 11. Expected changed files (draft — confirmed once implementation actually starts)

**Backend (new):** `app/models/team.py` (`WorkspaceSeatPlan`, `WorkspaceInvitation`,
`MemberBusinessManagerAssignment`, `MemberAdAccountAssignment`, `DeviceSession`),
`app/services/seat_plan.py`, `app/services/invitation.py`, `app/services/membership_lifecycle.py`,
`app/services/assignment.py`, `app/services/scope_authorization.py`, `app/services/session_registry.py`,
`app/schemas/team.py`, `app/api/v1/routers/team.py`, `app/api/v1/routers/security_sessions.py`,
`alembic/versions/0009_a9_team_seats.py`. **Backend (touched):** `app/core/enums.py` (new
status/state enums only — `WorkspaceRole` unchanged per §5), `app/api/deps.py` (session-registry
check added to `get_context`), `app/services/workspace.py`
(`ScopeAuthorizationService` calls added to `WorkspaceAccessService` or a new adjacent module —
decide at Step 4), `app/api/v1/__init__.py` (register new routers), existing A1/A2/A3/A7/A8
list/detail endpoints (scope filtering applied). **Frontend (new):**
`frontend/src/pages/team/TeamAndSeats.tsx`, `frontend/src/pages/team/SecurityDevices.tsx`,
invite/assignment/role-change/deactivate drawer components. **Frontend (touched):**
`Settings.tsx` (nav into the two new sub-pages), `App.tsx`/`AppShell.tsx` (routes),
`lib/types.ts`. **Docs:** `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`,
`docs/TEAM_AND_SEATS.md`, `docs/SESSION_SECURITY.md`, `docs/INVITATION_RUNBOOK.md`,
`docs/ACCESS_SCOPE_MATRIX.md`.

## 12. Migration/security risks

- **Alembic revision id length**: this session hit the `alembic_version.version_num`
  `varchar(32)` limit twice already (A6, near-miss on A7). Will name the new revision short
  (`0009_a9_team_seats`, 20 chars) up front.
- **A6/A7/A8 migrations (`0006`–`0008`) are uncommitted.** A9's migration (`0009`) will be
  written to depend on `0008` as its `down_revision`, consistent with the working tree today —
  but if A6/A7/A8 get reordered or squashed before commit, A9's migration chain needs updating
  too. Flagging this now rather than discovering it at commit time.
- **Retrofitting scope filtering onto A1/A2/A3/A7/A8 read paths is the highest-regression-risk
  part of A9** — every existing test that asserts "member X sees resource Y" implicitly assumes
  today's unscoped-read behavior. Expect to touch existing A1–A3 test fixtures once
  `ScopeAuthorizationService` is wired into those routers (Step 4), not just add new A9 tests.

## 13. Explicit confirmation

No real email is sent, no real Telegram message is sent, no production deployment occurs, no
real Meta API call is made, no credential/cookie/session material is shared, and no browser
automation beyond this project's existing test tooling is introduced, in A9's implementation or
its automated tests. A9 stops at the point defined in the spec's §16 Definition of Done —
Chrome-extension real-browser click-through (now unblocked this session — see
`/home/coder/.claude/projects/-home-coder-workspace/memory/reference_chrome_headless_libnspr4_missing.md`)
is available if the user wants live UI verification of A9's new pages once built, but that is a
separate, later step, not part of this audit.
