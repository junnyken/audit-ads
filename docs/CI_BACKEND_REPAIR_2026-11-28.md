# Priority 1 backend CI repair — 2026-11-28

Scope: exact failures from CI 163 at 2cf9e60, supplied local log and failed-name list. No network, credentials, provider calls, API writes, dependency install, commit, push or deployment. Main-owned .vibe changes were present initially and untouched.

## Audit and decision

Email fixtures predate disposable-domain and local-part policy. A9 module-local owner fixtures and invitation addresses now use deterministic adsops-fixture.vn addresses with local parts >=3; no email transport is invoked. Production validation is unchanged. Three unit cases and one API case preserve denied-domain policy.

Legacy migrations pinned stale revision tuples and attempted destructive round trips through intentional 0027/0028 refusal. Tests now compare the DB revision to Alembic's actual single head and assert refused downgrade retains revision, tables and columns; F1/F3 feature shape assertions remain. Two isolated unit cases verify both 0027 and 0028 refusal. Migration code is unchanged. Existing session clean-schema upgrade remains CI-only; no local DB fixture was run.

License read-only test now requests force_sync only; a separate unit test proves force_warmup=True rejects before DB access.

## Remaining blockers (security assertions unchanged)

Six DELETE guards detect two routes in meta_operations.py. discard_unsynced_page_draft (around line 5211) hard-deletes AccountAssetLink, permanent AuditLog rows and Page. This is a real domain/audit invariant violation. delete_client_retainer (around line 6411) records a deleted audit event and reconstructs the view; it is not an archived_at-backed entity. Safe remediation requires an agreed archive contract and consistent frontend callers outside this backend-only patch. Neither route is allowlisted.

One request guard detects 21 extra opt-outs listed in CI: CommunityPolicyPutRequest, PlaybookRateInput, WorkspaceGovernancePatchRequest, GoogleAdsScriptReportIn, PlaybookRecordRunInput, ForgotPasswordRequest, VerifyCanaryRequest, ExtensionPackageBundleRequest, PrecheckSignupRequest, AllowlistRemoveRequest, PlaybookPatchInput, InviteCodeCreateRequest, QuickSyncRequest, AllowlistEmailRequest, PlaybookCreateInput, RedeemCodeRequest, ChangePasswordRequest, InviteCodePatchRequest, RegisterRequest, ResetPasswordRequest, VerifyEmailRequest. Some auth bodies deliberately need secrets, while others require StrictPayload review. No blanket conversion or exception expansion performed; this cross-feature contract review remains blocked.

## Validation

- `/tmp/adsops-verify-20261128/bin/ruff check backend`: passed.
- Clean env, cwd /tmp, PYTHONPATH backend, unreachable DB 127.0.0.1:1; `timeout 60 python -m pytest --noconftest -q` selected A9 normalize + denied-policy units, warmup rejection and 0027/0028 refusal: **7 passed**.
- No local PostgreSQL integration claim. All patched integration cases and full backend CI remain to run in CI. Seven original security failures intentionally remain unresolved.

## Changed paths

- `backend/tests/test_a9_team_api.py`
- `backend/tests/test_f3_business_users.py`
- `backend/tests/test_o3_migration.py`
- `backend/tests/test_f1_facebook_identities.py`
- `backend/tests/test_s1_spend_migration.py`
- `backend/tests/test_o4_migration.py`
- `backend/tests/test_commercial_auth_and_license.py`
- `backend/tests/test_a9_team_services.py`
- `docs/CI_BACKEND_REPAIR_2026-11-28.md`
- `TEST_LOG.md` (append only)

## All 46 original failures

Counts: {'DELETE security': 5, 'Email fixture': 32, 'Read sync': 1, 'Migration': 7, 'Request security': 1}. 39 failure cases patched (not all locally verified); 7 explicit blockers.

| Original CI node | Category | Disposition |
|---|---|---|
| `tests/test_a4_api.py::test_no_delete_route_was_introduced` | DELETE security | BLOCKED: preserve failing guard; product/caller repair needed |
| `tests/test_a5_extension_api.py::test_the_extension_surface_adds_no_delete_route` | DELETE security | BLOCKED: preserve failing guard; product/caller repair needed |
| `tests/test_a9_team_api.py::test_invite_returns_a_one_time_token_and_lists_as_pending` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_accept_with_a_new_email_signs_the_member_straight_in` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_accepting_an_existing_accounts_invitation_anonymously_is_refused` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_an_existing_account_can_accept_while_authenticated` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_a_used_token_cannot_be_used_twice` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_revoked_invitation_token_is_refused` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_resend_invalidates_the_previous_token` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_a_member_cannot_reach_any_team_endpoint` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_member_list_shows_scoped_counts` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_role_change_rejects_owner_and_accepts_a_valid_role` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_suspending_a_member_denies_their_live_session_immediately` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_deactivate_then_reactivate_moves_the_seat_back_and_forth` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_assign_and_revoke_scope_through_the_api` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_owner_can_list_and_revoke_a_members_sessions` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_a_member_cannot_revoke_the_owners_session` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_revoke_all_member_sessions` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_api.py::test_team_endpoints_are_non_disclosing_across_workspaces` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_create_invitation_returns_a_raw_token_never_persisted` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_create_invitation_rejects_an_existing_active_member` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_a_second_invitation_to_the_same_email_supersedes_the_first` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_revoke_requires_pending_status` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_resend_invalidates_the_old_token_and_issues_a_fresh_one` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_expired_invitation_is_lazily_marked_on_read` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_normalize_email_strips_and_lowercases` | Email fixture | Patched; local unit passed |
| `tests/test_a9_team_services.py::test_accept_with_a_brand_new_email_registers_and_joins` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_with_a_new_email_requires_a_real_password` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_for_an_existing_account_email_without_authentication_is_refused` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_as_an_authenticated_existing_user_joins_a_second_workspace` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_as_the_wrong_authenticated_user_is_refused` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_requires_an_available_seat` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accept_rejects_an_already_accepted_token` | Email fixture | Patched; DB integration pending CI |
| `tests/test_a9_team_services.py::test_accepting_reactivates_a_previously_deactivated_member_instead_of_duplicating` | Email fixture | Patched; DB integration pending CI |
| `tests/test_alert_security.py::test_a3_adds_no_delete_endpoint` | DELETE security | BLOCKED: preserve failing guard; product/caller repair needed |
| `tests/test_commercial_auth_and_license.py::test_license_grace_readonly_and_code_recovery` | Read sync | Patched; license integration pending CI; rejection unit passed |
| `tests/test_f1_facebook_identities.py::test_head_is_0019_and_downgrade_round_trips` | Migration | Patched actual-head/retained-schema invariant; DB pending CI; renamed `test_f1_shape_at_actual_head_survives_refused_downgrade` |
| `tests/test_f1_facebook_identities.py::test_only_the_documented_request_bodies_opt_out_of_strict_payload` | Request security | BLOCKED: 21 unreviewed opt-outs; preserve failing guard |
| `tests/test_f3_business_users.py::test_0020_migration_round_trips_and_startup_migration_accepts_off` | Migration | Patched actual-head/retained-schema invariant; DB pending CI; renamed `test_0020_shape_at_actual_head_and_refused_downgrade_and_startup_off` |
| `tests/test_health_security.py::test_a2_adds_no_delete_endpoint` | DELETE security | BLOCKED: preserve failing guard; product/caller repair needed |
| `tests/test_o3_migration.py::test_head_includes_0017_with_four_columns_defaulting_off` | Migration | Patched actual-head/retained-schema invariant; DB pending CI |
| `tests/test_o3_migration.py::test_downgrade_removes_only_the_four_columns_and_upgrade_restores_them` | Migration | Patched actual-head/retained-schema invariant; DB pending CI; renamed `test_refused_downgrade_preserves_o3_schema_and_head` |
| `tests/test_o4_migration.py::test_head_includes_0019_and_only_one_column_carries_a_credential` | Migration | Patched actual-head/retained-schema invariant; DB pending CI |
| `tests/test_o4_migration.py::test_downgrade_removes_the_table_and_column_and_upgrade_restores_them` | Migration | Patched actual-head/retained-schema invariant; DB pending CI; renamed `test_refused_downgrade_preserves_o4_schema_and_head` |
| `tests/test_registry_api.py::test_no_hard_delete_endpoint_exists` | DELETE security | BLOCKED: preserve failing guard; product/caller repair needed |
| `tests/test_s1_spend_migration.py::test_downgrade_removes_only_the_new_table_and_upgrade_restores_it` | Migration | Patched actual-head/retained-schema invariant; DB pending CI; renamed `test_refused_downgrade_preserves_spend_schema_and_head` |

## Follow-up: remaining guards, scoped patch
Pre-edit audit/design: `docs/AUDIT_BEFORE_BUILD_CI_P1_GUARDS.md`.
Six DELETE guards now pass statically: Page uses archived_at + page.archived audit
before commit and retains Page/link/history; retainer uses the reader's existing
ARCHIVED state via immutable updated event. Both callers use POST archive. Old
DELETE paths intentionally have no alias; Page response compatibility retained.
16 ordinary opt-outs and nested ordinary models now use StrictPayload. QuickSync's
human-posted access_token removed from schema and route dispatch. Existing metadata
with sensitive names (including auto_vault_cookie_refresh) is refused by the same
recursive rule; no special secret-key exception was introduced.
Five auth bodies remain unchanged, not silently added to a name allowlist. Exact
owner decision required: justify each secret field/lifecycle of ForgotPassword,
ResetPassword, VerifyEmail, ChangePassword and Register under CLAUDE rule 1 before
any structural auth-body exception contract may be introduced. No full CI pass.

Exact verification: existing venv, clean env, unreachable dummy DB, cwd /tmp,
`python -m pytest --noconftest -o addopts= -q /tmp/adsops-read-sync-20261128/backend/tests/test_ci_p1_guards.py`:
**74 passed, 1 failed**, 8.39s. Failure is the original exact-four assertion executed
verbatim; original assertion also strengthened to require extra=forbid. Positive
login/hash/audit-redaction tests are unit evidence only; real auth persistence and
logging integration requires PostgreSQL CI and remains unfinished.
`/tmp/adsops-verify-20261128/bin/ruff check backend`: passed.
Frontend `npm run typecheck` attempted with removable existing dependency link:
failed on missing @testing-library/jest-dom and @vitejs/plugin-react, incompatible
Vite ESBuildOptions; no dependencies installed. Link/build-info changes cleaned.

Changed in this follow-up: backend routers community, extension, google_ads_sync,
meta_operations, playbooks; schemas auth, meta_operations; test_ci_p1_guards.py;
existing test_f1 guard; frontend FanpageControlCenter.tsx and ClientRetainers.tsx;
API.md, ARCH.md, FEATURES.md, TEST_LOG.md and this report plus pre-edit audit.
No .vibe changes by this task, commit/push, provider/API call, DB, stack or release.
Frontend scoped ESLint attempted with existing ads-manager dependencies: **failed,
8 errors / 5 warnings**, including FanpageControlCenter.tsx:313 render-time ref
assignment outside the edited caller lines. No lint rules disabled or unrelated
UI rewritten. Dependency versions are from that available tree, not a validated
lockfile installation. Temporary symlink removed. `git diff --check`: passed.

## Final scoped auth decision and validation (supersedes blockers above)
Main explicitly approved the five existing authentication protocol exceptions after
lifecycle review. CLAUDE rule 1 now says nine; each new exception has a narrow
schema docstring and extra=forbid. F1's original guard now pins exact model identity,
route/method and full fieldset, including optional/union-wrapped body models;
no broad name allowlist or StrictPayload relaxation. Detailed allowed fields,
verification, hashing, consumption, redaction and logging evidence is in the audit.

46-failure mapping update (the original 46-node table remains the source list):
- 32 email fixture failures: patched by initial worker; DB cases pending CI.
- 7 migration failures: actual-head/refused-downgrade patch; DB cases pending CI.
- 1 read-sync failure: force_sync-only patch; license integration pending CI.
- 5 original DELETE failures: archive patch; all six original/static DELETE guards
  (including additional preflight guard) verified without DB; HTTP/DB pending CI.
- 1 request-body failure: reviewed nine-model route/fieldset contract now passes
  offline; ordinary and unknown secret rejection stays enforced.
Thus all 46 have a scoped remediation, NOT 46 reproduced integration passes.

Frontend checks use an isolated source copy at /tmp/p1-frontend, existing dependency
packages from /home/coder/workspace/projects/audit-ads-import-20261126/audit-ads/frontend/node_modules,
with available fallback packages; no install/network. Final `tsc -b`: exit 0.
Full ESLint: exit 0, 0 errors / 7 existing hook warnings (scoped callers: 5 warnings).
Vite 6.4.3 production build: exit 0, built in 14.39s; output /tmp/p1-build.
Earlier missing-package/type and newer-plugin ref errors do not reproduce with
this product's available dependencies; no UI rewrite or lint suppression made.
This is not a fresh lockfile-install claim. Generated build info/output remains
outside the proposal; no dependency link was added in the real repository.

Remaining CI: lockfile-pinned frontend install/check/build; complete PostgreSQL
suite including patched migrations, archive HTTP/scoping and real auth transaction,
replay/session revocation/persistence tests. No local conftest/PG, database reset,
provider/SMTP request or production verification was performed.
Handoff: needs_main_action for reviewing cumulative dirty patch, running CI, then
commit/push and separately authorized manual Vibe Host release. This task performed
none of those release actions and did not modify main-owned .vibe files.

Final combined offline run (guard + prior seven unit cases): **132 passed,
46 deselected**, 11.95s. Backend ruff and git diff --check passed after final edits.
Standalone final guard run: **125 passed**, 10.90s (--noconftest, same clean env).


## CI 164 follow-up at 8a43aab — 2026-11-28

Read `/tmp/adsops-ci164-backend.log`, including ERRORS and the complete short summary.
This run reports **2 FAILED and 23 ERROR setup**; the supplied log does not print a
passed-count footer, so no total passing count is inferred. Frontend is green per
main's handoff; frontend was not rerun here.

Audit/decision:
- All 23 team ERRORs are the same inherited auth fixture failure: conftest creates
  and commits owner@example.com, module override changes it to the corporate fixture
  address but only flushes. Inherited auth sends the changed address to real login
  using a separate session, which cannot see the uncommitted update. Commit both
  module-local owner overrides before real login; retain all existing 401/403,
  session revocation, cross-workspace and disposable-domain assertions.
- License enforcement is **present**, not a missing product check:
  automation_cron._run_read_cycle evaluates the real license before due calculation
  and credential/provider collection. The public wrapper acquires a PostgreSQL
  advisory lock first, unsupported by SQLite. The SQLite commercial test now calls
  this actual shared policy directly. No fake PG lock, SQLite SQL-function shim,
  auth change, product-policy change or provider call. Four regression combinations
  (force on/off × configured sync on/off) use the real expired-workspace evaluator
  and assert no credential collector, part transaction or execution audit.
  PostgreSQL lock contention/integration remains a CI responsibility.
- O4's only unexpected inventory entry is email_verification_tokens.token_hash.
  auth._issue_email_verification stores _hash_reset_token(raw_token), a SHA-256
  digest; auth.verify_email compares that digest, expiry and used_at. Add exactly
  this documented column, retaining encrypted_secret as the only usable credential
  column. No generic token/hash allowance. New standalone cases run the actual O4
  assertion over model metadata and reject added users.access_token and
  users.unknown_token_hash. Physical migration inventory still requires CI PG.

Validation: clean env, cwd /tmp, PYTHONPATH backend, unreachable dummy PostgreSQL
127.0.0.1:1, existing /tmp/adsops-verify-20261128 venv; --noconftest -o addopts= -q.
Commercial auth/license + read-sync standalone + existing P1 guards: **170 passed
in 20.58s** (70s timeout). Initial run had 169 passed/1 NameError due to a removed
warmup-test import; corrected the import and reran all three files successfully.
No root conftest fixture or PostgreSQL operation executed. Commercial fixture uses
its existing in-memory SQLite schema; no stack or external database created.
O4 metadata inventory standalone: **3 passed in 1.45s** (35s timeout), including
negative raw-token and unknown-hash controls; **173 total passing isolated cases**
across these disjoint runs. Ruff backend and git diff --check passed. Full PG team API and physical migration
checks remain unrun locally; main must run CI before claiming full backend green.

All CI 164 failures/errors mapped (nothing omitted from ERROR summary):

| CI outcome/node | Repair / verification boundary |
|---|---|
| FAILED `tests/test_commercial_auth_and_license.py::test_license_grace_readonly_and_code_recovery` | Actual license policy test; isolated SQLite passed |
| FAILED `tests/test_o4_migration.py::test_head_includes_0019_and_only_one_column_carries_a_credential` | Exact documented email-verification digest; metadata assertion + physical PG CI pending |
| ERROR `tests/test_a9_team_api.py::test_summary_reports_unknown_capacity_until_a_plan_is_configured` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_seat_plan_can_be_set_and_is_reflected_in_the_summary` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_seat_limit_below_active_member_count_is_refused` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_invite_returns_a_one_time_token_and_lists_as_pending` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_accept_with_a_new_email_signs_the_member_straight_in` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_accepting_an_existing_accounts_invitation_anonymously_is_refused` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_an_existing_account_can_accept_while_authenticated` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_a_used_token_cannot_be_used_twice` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_revoked_invitation_token_is_refused` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_resend_invalidates_the_previous_token` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_a_member_cannot_reach_any_team_endpoint` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_member_list_shows_scoped_counts` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_role_change_rejects_owner_and_accepts_a_valid_role` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_the_last_owner_cannot_be_deactivated` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_suspending_a_member_denies_their_live_session_immediately` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_deactivate_then_reactivate_moves_the_seat_back_and_forth` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_assign_and_revoke_scope_through_the_api` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_access_preview_for_the_owner_says_owner` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_owner_can_list_and_revoke_a_members_sessions` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_a_member_cannot_revoke_the_owners_session` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_revoke_all_member_sessions` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_team_endpoints_are_non_disclosing_across_workspaces` | Owner fixture commit visibility; real PG auth/API rerun in CI |
| ERROR `tests/test_a9_team_api.py::test_invitation_api_keeps_disposable_email_denied` | Owner fixture commit visibility; real PG auth/API rerun in CI |

No commit/push/deploy/network/dependency install/provider call. Original dirty
.vibe files untouched. Page/CSV feature bugs excluded from this batch. No new
API, product behavior, schema, migration or state; commit/push remains main-owned.
