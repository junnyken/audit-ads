# CI-P1-GUARDS — invariant repair

Date: 2026-11-28. Author: current Codex task (no identity inferred).
Parent: priority 1 CI repair. Governing context read: CLAUDE.md,
MINI_SPEC_PLAYBOOK.md, FEATURES.md, ARCH.md, API.md, TEST_LOG.md.

## Goal / constraints
Repair confirmed DELETE and ordinary request-body gaps without weakening security
assertions. Preserve existing changes, authorization and audit history. No live
calls, DB/stack/dependency creation, migration, commit, push or release execution.
User explicitly authorized this scoped repair and requires reporting unfinished work.

## Audit before build
- data_model/security/API: Page draft deletion removes Page, AccountAssetLink and
  permanent AuditLog. Page already has archived_at and summary excludes archives.
- state_machine/API: retainer is reconstructed from immutable audit events;
  overview already excludes status ARCHIVED. Historical deleted events must remain
  readable. Existing mutation uses WriteCtx and scoped audit records.
- security: all 21 unapproved BaseModel request opt-outs inspected. Ordinary
  community, playbook, bundle, Google report, precheck and quick-sync bodies need
  StrictPayload, including nested ordinary models. QuickSync additionally declares
  a human-posted access_token and passes it to the sync engine, contrary to rules
  1/40: remove that request field and argument, keep configured reader resolution.
- auth: ForgotPasswordRequest (turnstile_token), ResetPasswordRequest (token,
  new_password), VerifyEmailRequest (token), ChangePasswordRequest
  (current_password/new_password), RegisterRequest (password/challenge_token/
  turnstile_token) need secrets for existing authentication flows. Converting them
  blindly breaks auth; adding them to a name allowlist violates the four-exception
  guard. No additional auth exception is approved by this patch.

## Chosen design / scope
A. Domain: Page archived_at; retain links/history. Retainer uses existing ARCHIVED
status via client_retainer.updated with archived_at metadata; no physical entity,
new table, enum or migration.
B. Engine: existing summary/reconstruction and WriteCtx audit/commit. Validate
retainer ID exists in workspace overview before appending archive event.
C. API: POST /facebook-pages/{id}/archive (draft only, synced-resource denial kept)
and POST /client-retainers/{id}/archive. Remove unsafe DELETE routes; deliberately
no DELETE alias. Page response keeps discarded keys for current UI compatibility.
D. UI: only callers switch to POST archive, existing archive wording pattern.
E. Requests: StrictPayload for ordinary/nested inputs; four-exception guard stays
unchanged. Five auth opt-outs remain an explicit unresolved security decision.

## Tests / success criteria
Isolated no-conftest tests with unreachable dummy DB: original static DELETE guards,
ordinary/nested rejection, draft archive audit/commit and synced denial, retainer
archive event and existing reconstruction. Existing four auth exceptions: positive
accepted fields and negative unknown secrets; redaction/hash checks only where
provable without DB. Lint and frontend typecheck with existing dependencies.
Full PostgreSQL integration and release belong to later CI/main action.

## Decision required / limits
Owner must explicitly justify each of the five additional auth request exceptions
under CLAUDE rule 1 (allowed fields, verification/hash lifecycle, no plaintext
persistence/logging) before an explicit structural auth protocol and positive /
negative contract tests may replace the exact-four assertion. This patch refuses
that unsafe policy change; the request opt-out guard is expected to remain red.

## Deliberate main decision — 2026-11-28 auth protocol review
Supersedes the unresolved exact-four decision above. User/main explicitly approved
formalizing these five existing auth flows, preserving legitimate authentication.
No global StrictPayload relaxation; all nine exact model identities, routes,
methods and complete fieldsets are pinned in the original F1 guard. All use
extra=forbid; schema docstrings explain each exception. No DB/schema change.

| Body / POST /api/v1/auth route | Exact allowed fields | Purpose and lifecycle |
|---|---|---|
| ForgotPasswordRequest /forgot-password | email, turnstile_token | Turnstile check before lookup; generic non-enumerating response; per-user/IP rate bounds. Generated random reset token persists only as SHA-256 token_hash, expires in 30 minutes; raw link goes only to configured SMTP. Incoming Turnstile proof is not persisted. |
| ResetPasswordRequest /reset-password | token, new_password | Strong-password policy; SHA-256 lookup plus compare_digest; reject missing/used/expired token and inactive user. Store PBKDF2 password_hash only, consume sibling tokens, revoke all device sessions; audit counts only. |
| VerifyEmailRequest /verify-email | token | SHA-256 lookup plus compare_digest, unused/24-hour expiry and active-user checks; consume siblings, mark email verified; audit email only. No raw token storage/response. |
| ChangePasswordRequest /change-password | current_password, new_password | Authenticated Ctx; verify current PBKDF2 hash first, strong new password and difference check; store new hash only, revoke other sessions, audit count only. |
| RegisterRequest /register | full_name, workspace_name, email, password, challenge_token, captcha_code, math_answer, human_confirmed, website_honeypot, invite_code, turnstile_token | Optional Turnstile then signed HMAC challenge, constant-time signature/answer-hash checks, expiry/minimum timing/honeypot/human and process-local nonce replay check, all before account writes. Password complexity and email policy precede creation; only password_hash persists. Names/email/workspace and normalized invite attribution are ordinary intentional stored business data. Challenge/proof/answers are not persisted. |

Evidence: app/api/v1/routers/auth.py handlers, _hash_reset_token,
_issue_email_verification and _verify_turnstile_if_enabled; core/security.py
PBKDF2; core/email_and_bot_guard.py verify_bot_challenge; services/turnstile_verifier.py
fixed HTTPS transport (proof transmitted only for verification); services/email_sender.py
SMTP failure logs error type only, never link/content. No provider call was made.
AuditLogService redacts recursively; auth handlers never audit payload.model_dump().
RequestContextMiddleware logs method/path/status/duration, not body/query;
RequestValidationError handler drops input/context; JsonFormatter redacts extras.
Formatter messages/tracebacks are not a general secret scrubber: these handlers do
not interpolate proofs into messages. Bot replay cache is process-local, not a
claim of distributed replay protection. Existing invite codes intentionally retain
business attribution; that is not a stored authentication password/token.

Offline tests cover exact positive fieldsets, unknown secret/ordinary rejection,
real hash verification, actual redaction/validation handler, invalid token states,
valid token consumption, password reset session revocation, current-password denial,
reset issuance hash, registration challenge failure before DB. These mocked-session
tests are not PostgreSQL persistence, SMTP or production verification. CI must run
real auth transaction/session/token integration and the full original suite.
