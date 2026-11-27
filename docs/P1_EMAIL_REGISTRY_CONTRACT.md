# P1-D2 — Email registry contract (PROPOSED)

ID P1-D2 · Parent P1 · 2026-11-26 · documentation only. Main reviewed the critical vault/PIN/audit/error/role patterns; user confirmed the conservative role matrix below. This is the selected implementation contract, not schema/API/UI or release signoff.

## Context, goal and constraints

Audit and source evidence: [Audit Before Build](AUDIT_BEFORE_BUILD_P1_D2.md).
Goal: let workspace staff track independent email identities and manual operational evidence without
implying provider verification or introducing credential storage. This is the single chosen initial contract.
All tables, fields and endpoints below are PROPOSED additions, not existing capabilities.
Approved Gmail PERSONAL/Microsoft unknown type, reveal scope and masked/no-full-CSV policy are preserved.
No provider calls, attachments, mailbox automation, new secrets, guaranteed unlock days or reminders in I1.

## Scope A — domain and ownership

Proposed table `email_registry_entries`. UUID identifiers are server-generated; workspace comes only from
ApiContext. No client workspace/actor/timestamp/crypto/index fields. FK references use RESTRICT, never cascade
hard-delete. `responsible_member_id` denotes an operational assignee, not legal ownership of the mailbox;
workspace owner/admin are authorization roles, not another owner label on this entity.

Field table: N=not nullable, Y=nullable. C=create; P=metadata PATCH; R=dedicated reassignment;
S=server only. “Masked read” means list/detail DTO, never raw ORM serialization.
All lengths are characters unless bytes specified. No unlisted stored fields in I1.

| Field | Storage type / length | Null / default | Writable / source | Visibility |
|---|---|---|---|---|
| id | UUID PK | N / generated | S | scoped reads |
| workspace_id | UUID FK workspace | N / context | S, immutable | implicit context, omit DTO |
| provider | varchar(16), enum `gmail`,`microsoft` | N / required | C manual, immutable | masked read |
| account_kind | varchar(16), enum `personal`,`managed`,`unknown` | N / see rule | C,P manual | masked read |
| address_ciphertext | text, max 2048 bytes | N / none | S from contact intake via vault | never DTO/audit/log |
| address_hint | varchar(320) | N / derived mask | S | masked read |
| address_index | binary(32), HMAC-SHA-256 | N / derived | S, vault index API gap | never DTO/audit/log |
| index_key_version | smallint positive | N / configured key version | S | internal only |
| responsible_member_id | UUID FK workspace_members | Y / null | C,R by owner/admin | masked read, scoped UUID |
| state | varchar(16), enum below | N / `unknown` | S at create; P manual | masked read |
| evidence_source | varchar(24), `manual_attestation` only | Y / null | S on attestation | detail only |
| evidence_observed_at | timestamptz | Y / null | P attested operator time | detail only |
| evidence_recorded_at | timestamptz | Y / null | S transaction UTC clock | detail only |
| evidence_recorded_by | UUID FK users | Y / null | S current actor, immutable per evidence revision | detail only |
| review_due_at | timestamptz | Y / null | C,P operator-selected | masked read |
| review_timezone | varchar(64), IANA zone | Y / null | C,P operator-selected | detail only |
| next_action | varchar(240), plain text | Y / null | C,P manual | detail only |
| reason | varchar(500), plain text | Y / null | P manual | detail only |
| created_at / updated_at | timestamptz each | N / server now | S | detail; updated_at list |
| created_by / updated_by | UUID FK users each | N / current actor | S | detail only |
| version | bigint positive | N / 1 | S increments once per accepted write | masked read / ETag |
| archived_at | timestamptz | Y / null | S archive action | masked read |
| archived_by | UUID FK users | Y / null | S archive actor | detail only |

Wire-only `contact_address`: required C string, 3–320, never stored under that name or echoed.
Intake accepts one ASCII addr-spec (local part max 64, domain labels valid, total max 320), trims outer
whitespace; rejects controls/CRLF, display names, lists, URLs, quoted local parts and embedded whitespace.
This deliberately minimal initial subset has no DNS/provider verification. Provider is manually asserted;
no tenant discovery or inference from domain. Gmail requires kind `personal` (default personal);
Microsoft defaults `unknown`; create accepts unknown/personal only. Setting managed is a later manual PATCH
with the required attestation; reject managed at create because create has no evidence fields.
A managed claim requires an attestation in the same write. Provider remains unchanged.

Identity normalization: lowercase ASCII local and domain after trim; encrypt that normalized address.
This deliberately treats local-part case variants as the same identity within a workspace.
Do not strip Gmail dots/plus suffixes or map domains/provider aliases. Record this case policy in UI intake help.
Compute HMAC over a versioned, length-delimited workspace UUID + normalized address, with a dedicated
server blind-index key (not a plaintext hash, not ciphertext uniqueness, not an exposed vault key).
Unique constraint `(workspace_id,address_index)` includes archived rows and all providers. Same normalized
address in different workspaces is allowed. Race losers return generic 409 without address/other row details.
No silent unarchive. Address/provider correction requires archive + create a distinct corrected identity;
re-entering the same archived identity returns 409; restore/replacement of that identical identity is a later audited slice.

Index generation/key configuration does not currently exist in inspected vault. Add it inside the audited
contact boundary with a separately provisioned key/version; missing/invalid encryption OR index key rejects create
with safe 503 `contact_protection_unavailable`, without any hint-only row or plaintext fallback.
Use only existing `encrypt_contact`/`decrypt_contact` for contact ciphertext. Expanding the documented decrypt
caller boundary must be reviewed and its regression assertions updated explicitly, never routed through decrypt_secret.
Initial index key is stable; rotation blocks writes during controlled decrypt/reindex/re-encrypt rehearsal,
checks duplicates and rebuilds the unique index atomically before resuming. No mixed-key uniqueness bypass.
Key provisioning/recovery and rotation are operational prerequisites, not capabilities this document implements.

## Scope B — manual state, evidence, lifecycle and concurrency

States: `unknown` = no current attestation; `pending` = awaiting manual work; `recorded` = manual setup
recorded; `blocked` = operator reports obstruction. None means Google/Microsoft verified, safe or unlocked.
Create always starts unknown without evidence. Every distinct state may transition to any other listed state
by an authorized manual PATCH; no scheduler/provider/due-time transition. Same-state attestation refresh is allowed.

Entering pending/recorded/blocked or refreshing evidence requires `evidence_observed_at`; blocked also requires
nonempty reason and next_action. Entering unknown clears the four evidence fields server-side, requires reason,
and keeps old evidence only as redacted audit metadata. Reverting to unknown is not deleting history.
The observation time is operator attestation, offset-required RFC3339, not future relative to server time;
recorded time/actor/source are always server set. A metadata-only PATCH preserves evidence.
A new observation replaces current evidence fields together; no user-supplied recorded timestamp/actor/source.
For PATCH, an observation cannot be supplied alone while the resulting state remains unknown. An explicit unknown transition cannot include evidence_observed_at; it clears current evidence instead. `recorded`, `pending` and `blocked` attestations require an active responsible member so the recorded setup has an accountable operator; owner/admin can assign and then attest in separate version-checked steps. Unassigning an attested entry is allowed as an administrative action but does not manufacture a new attestation or change the existing recorded actor.
Changing kind to managed requires observation even when state stays unknown; reject this inconsistent combination
unless state is also changed to pending/recorded/blocked. Other kind changes must include reason.

`review_due_at` and `review_timezone` are both null or both present. Require explicit RFC3339 offset plus
valid IANA zone whose offset matches that instant; persist UTC, return `Z` plus zone. Reject naive/date-only
values and nonexistent/mismatched local times; UI must choose an offset for DST ambiguity. Past due is allowed,
computed at response time as `overdue = due < server_now && not archived`, never a state or evidence mutation.
No default interval; admin reminder configuration belongs to I2 after separate scheduler audit.

Archive sets archived_at/by, bumps version and audits; preserves contact and history, no DELETE or restore API.
Archived rows permit masked detail/history to authorized roles but no updates/reassignment/reveal. Default list
excludes archived. No cross-asset link table or linking payload/DTO in I1; mockup links remain illustrations,
not proof an independent contact is linked to Facebook/BM/ads. Any later link needs scope and authorization audit.

Each accepted PATCH/reassign/archive must carry `If-Match: "<version>"`. Missing => 428 `precondition_required`;
stale => 409 `conflict`. Use atomic update WHERE workspace/id/version and active predicates; increment version,
update server timestamps and write audit within one transaction. Revalidate actor/assignee seat and entity under
transaction locks (including reveal) so reassignment/archive/revocation cannot race a reveal into stale authority.
Lock ordering must be consistent with existing user PIN row locking; exercise deadlock/retry tests.
No-op/empty PATCH rejects 422; no version bump or audit mutation. Idempotency is not promised for POST create.

## Scope C — PROPOSED API, payloads and errors

Prefix `/api/v1/email-registry`. These routes do not exist as a result of D2.

| Method / path | Body / result |
|---|---|
| POST prefix | create allowlist below; 201 masked detail + ETag |
| GET prefix | Page of list DTOs; 200 |
| GET `/{id}` | masked detail + ETag; 200 |
| PATCH `/{id}` | metadata allowlist, If-Match; 200 masked detail + ETag |
| POST `/{id}/reassign` | `{responsible_member_id: UUID or null}`, required key, If-Match; 200 detail |
| POST `/{id}/archive` | StrictPayload empty object, If-Match; 200 archived detail |
| POST `/{id}/reveal-address` | reuse existing RevealEmailRequest (PIN only); 200 full address only here |
| GET `/{id}/history` | bounded Page of redacted P1 events; 200 |

Create allowlist: contact_address, provider, account_kind, responsible_member_id, review_due_at,
review_timezone, next_action. PATCH allowlist: account_kind, state, evidence_observed_at,
review_due_at, review_timezone, next_action, reason. Unknown/nested/extra keys reject with 422;
provider/contact_address/id/workspace/version/crypto/actors cannot be patched. Reassignment never via PATCH.
All non-PIN bodies inherit StrictPayload; `contact_address` is not forbidden by current sensitive-name list,
so no intake exception is needed. If guards later reject it, stop for deliberate documented exception review;
do not rename a secret field or silently swap base class. Reusing F1 PIN shape is explicit; no new PIN setup shortcut.

PATCH omission preserves a field (`model_dump(exclude_unset=True)`); null clears only next_action, reason,
and the due pair. Null state/kind/observation rejects; unknown state is the sole evidence-reset operation.
Cannot clear reason/next_action while state remains blocked. Empty strings reject, use null for clearable fields.
Reassign null explicitly unassigns; omission rejects. Field limits apply after trim, reject control characters and
credential-like/login-secret values in reason/next_action using existing guards plus contact-address rejection.
No full email in free text; heuristic guards do not prove arbitrary text contains no secret, so UI warns and
validation fails safely on known patterns. Escape all plain text on rendering, never HTML/Markdown execution.

List parameters: page >=1 default1, page_size 1–100 default25; exact provider/kind/state enums,
responsible_member_id UUID, archived=exclude|only|all default exclude, overdue boolean; unknown params reject.
No raw-address query/search in I1. AND filters within actor scope; deterministic created_at DESC,id DESC.
History page_size same bounds; created_at DESC,id DESC. Standard Page has items,page,page_size,total,total_pages.
Authorization precedes counts; page beyond end returns empty items. No counts/existence oracle across workspace.
List DTO: id,address_hint,provider,account_kind,responsible_member_id,state,review_due_at,overdue,
updated_at,version,archived_at. Detail adds only public fields marked detail above and can_reveal_address;
no ciphertext/index/key version. History DTO: event id/action/entity id/actor id/server time/request id plus
whitelisted audit fields. No arbitrary JSON passthrough from general audit logs.

Reuse `core/errors.py` envelope: `{"error":{"code":"conflict","message":"Entry changed; reload.","details":{},"request_id":"example-request"}}`.
401 inactive user/bad session; 403 inactive seat/suspended workspace or known in-scope forbidden action;
404 absent/out-of-workspace entity, including history/reveal; role checks must not expose entity existence.
403 must be based on workspace capability before lookup or on an already visible entity. 409 archived write,
duplicate or stale version; 422 malformed/forbidden fields; 503 unavailable contact protection/audit persistence.
Reuse PIN errors: 409 pin_not_set, 403 pin_rejected, 423 pin_locked; do not echo submitted values in errors.
Precondition and 503 codes are proposed extensions inside the existing envelope.

Illustrative request templates (placeholders are intentionally not executable intake/PIN values):

```json
{"contact_address":"<contact address supplied privately at intake>","provider":"microsoft","account_kind":"unknown"}
```

```json
{"state":"pending","evidence_observed_at":"2026-11-26T02:00:00Z","review_due_at":"2026-11-27T09:00:00+07:00","review_timezone":"Asia/Ho_Chi_Minh","next_action":"Review official recovery instructions"}
```

Masked response fragment: `{"address_hint":"de***@example.com","provider":"microsoft","account_kind":"unknown","state":"unknown","version":1}`.
Reveal request template: `{"pin":"<current user's existing PIN>"}`; actual success shape is `{address: string}`,
with full value omitted from examples. No real PIN/full address is documented. Use Cache-Control:no-store for all
registry responses; no reveal caching, URLs, browser persistence, analytics, error reporting or clipboard automation.

## Permissions and audit

Chosen mapping confirmed by the user in this contract step: responsible operator means assigned active `buyer` in the current enum, never a new role. Viewer/auditor assignments and registry access are denied in I1. No automatic role promotions/self-grants; owner/admin remain eligible assignees under their existing authority.

| Action | active owner/admin | assigned active buyer | other buyer | viewer/auditor |
|---|---|---|---|---|
| list/detail masked | all workspace | assigned only | no | no |
| create | yes | no | no | no |
| update metadata | yes | own assigned only | no | no |
| reassign/unassign | yes | no | no | no |
| archive | yes | no | no | no |
| reveal active address | own PIN required | own PIN required | no | no |
| P1 entity history | yes | assigned only, redacted | no | no |
| export | absent | absent | absent | absent |

For every action, require authenticated active user, valid existing session, unarchived/not-suspended workspace,
unarchived ACTIVE membership; owner is not exempt. Mutations also require existing writable/license gate.
Assigned target must be same-workspace ACTIVE unarchived seat linked to active User, eligible buyer/owner/admin.
Do not derive permission from a UUID supplied by caller. Revoked/inactive assignee loses reveal immediately;
keep attribution and historical assignee id, do not automatically assign someone else.
P1 history is a scoped domain projection allowing the assigned buyer only their entity events; it does not
open generic AuditCtx (currently excludes buyer). This is an explicit new narrow permission helper to review.
Export is out of scope: no route/button; future masked metadata export needs its own audit/authorization;
full-address CSV remains prohibited. Existing generic asset export must not pick up this model automatically.

Reuse RevealPinService.verify on current ctx.user, never assignee's PIN or password/session-only bypass.
Check visibility, current role/seat, archive and assignment under lock before verify/decrypt. Reuse current PIN
setup/settings flow; no secret field in normal forms. Contact decryption only after those checks.
Commit successful reveal audit before sending plaintext; audit/commit failure => no plaintext response.

Events: `email_registry.created`, `.updated`, `.reassigned`, `.archived`, `.address_revealed`,
`.list_read`, `.detail_read`, `.history_read`; entity_type `email_registry_entry` (collection id `collection`
for list). Audit event and mutation share ctx.session and one commit. Authorized reads also explicitly
commit read event before returning; this is new P1 read policy, not a claim generic reads already audit.
Audit failure fails the operation. GET history reads a fixed snapshot then adds its history_read event;
that event appears on subsequent reads. No recursive “audit the audit write” mechanism.

Before/after whitelist: provider,account_kind,state,responsible_member_id,review_due_at,review_timezone,
version,archived_at,archived_by,evidence_source,evidence_observed_at,evidence_recorded_at,evidence_recorded_by.
For reason/next_action use changed-field names and present/absent booleans only, never text values.
Metadata whitelist: safe outcome code, returned_count, changed_fields, entry version; list filters only enum/UUID
values from the allowlist. Never include full address, hint, ciphertext, index, key/version material, PIN, raw
request/response, free text, request headers or arbitrary exception text in logs/audit. Keep request_id/actor/workspace
from existing AuditLogService. Whitelist first, existing redaction second; it does not automatically mask email.

Wrong PIN/lock path follows existing router: commit failure count/lock and redacted `user.reveal_pin_failed`
event in a transaction containing no registry mutation, then raise. If that commit fails, return safe failure;
never claim a durable denied event. Other denied/rolled-back operations do not claim persisted failure audits.
After rollback, any future security-event sink needs its own reviewed transaction/policy; not invented here.
Retain archive/audit and encrypted contact by default under existing no-hard-delete rule. Exact legal retention,
key destruction, erasure requests and backup retention need privacy/operations policy; no arbitrary number of days,
no scheduler purge. This is an operational default, not a legal retention determination.

## Scope D/E — UI, test plan and success criteria

Future UI reuses Assets list/detail/edit/history and D1 neutral state wording after review; mask remains default,
explicit PIN reveal clears on close/navigation. No asset-link editing or reminder buttons in initial slice.
Required tests below are implementation acceptance criteria, NOT tests run or results claimed by D2.

| # | Level / case | Expected result |
|---|---|---|
| 1 | Unit create minimal Gmail | personal/unknown state, no evidence, masked DTO |
| 2 | Unit Microsoft omitted kind | unknown; no managed inference |
| 3 | Unit invalid enum/Gmail managed | 422, no row/event |
| 4 | Unit contact syntax/control/list/display name | reject, no rejected value echoed |
| 5 | Unit case/trim duplicate | same workspace conflict; Gmail dot/plus stay distinct |
| 6 | HTTP same address two workspaces | independent identities, no cross-tenant conflict |
| 7 | HTTP simultaneous duplicate create | one row/event; loser 409, no ciphertext uniqueness |
| 8 | Migration clean + populated staging | additive schema/index valid; no F1 auto-import |
| 9 | Migration duplicate reindex rehearsal | abort safely before index switch; preserve rows/history |
| 10 | Unit missing/malformed encryption/index key | 503; zero row/hint/plaintext fallback |
| 11 | HTTP wrong decryption key/corrupt ciphertext | no plaintext; safe failure, no success event |
| 12 | HTTP every action cross-workspace/missing UUID | same 404; list/count/history don't enumerate |
| 13 | HTTP inactive user/seat/owner/workspace | deny even owner with valid old session/PIN |
| 14 | HTTP assigned buyer vs other buyer | own scoped operations only, no self-assign/create/archive |
| 15 | HTTP viewer/auditor injected assignment | reject assignment; no reveal despite forged id |
| 16 | HTTP target seat foreign/inactive/user inactive | reject without target details, no mutation |
| 17 | HTTP PIN unset/wrong/locked/concurrent guesses | existing codes, counters/lock durable; no plaintext |
| 18 | HTTP reassignment/archive vs reveal race | locks serialize; revoked authority never decrypts |
| 19 | HTTP strict extras/nested secret/crypto/actor/version | 422; no field mass assignment or secret echo |
| 20 | Unit omitted/null/empty PATCH | preserve vs allowed clear; immutable/null-required reject |
| 21 | Unit all 12 distinct state transitions + refresh | manual preconditions; unknown clears current evidence |
| 22 | Unit forged recorded time/actor/source, future observation | reject; server owns receipt provenance |
| 23 | Unit timezone offset/DST/naive/past due | UTC round-trip; ambiguity explicit; no auto state |
| 24 | HTTP missing/stale If-Match, simultaneous PATCH | 428/409; one accepted version/event |
| 25 | HTTP archive then duplicate/reveal/update | duplicate 409, no unarchive; reveal/update denied |
| 26 | HTTP audit insert/commit failure on mutation | rollback row/version + audit together |
| 27 | HTTP audit failure on list/detail/history/reveal | fail before data/full address returned |
| 28 | HTTP PIN failure commit failure | no false durable-event claim; no registry mutation |
| 29 | Unit/HTTP audit/log whitelist and validation errors | no contact/ciphertext/index/PIN/free text leaks |
| 30 | UI XSS/secret/full email pasted in text | reject guarded values; escape all displayed text |
| 31 | HTTP page bounds/filter/sort/archived combinations | deterministic scoped results; reject unknown params |
| 32 | Regression F1 + vault caller invariants | existing behavior intact; reviewed contact caller expansion only |
| 33 | UI/manual 375/768/1280, keyboard, error/unknown/history | D1 review recorded; no fake success/provider claim |
| 34 | HTTP export/link/import payload probing | no new routes/capability; extras rejected; no generic export leak |

Unit validates guards/state/normalization; HTTP+real DB staging validates locks/RBAC/audit and migration;
regression protects F1/Meta; UI manual checks close D1 gaps. Live verification only on verified shared staging
with test identities and authorized key provisioning, followed by cleanup/archive and evidence report.
Success means matrix passes, source/API docs match actual implementation, P0/D1 gates close and main signs review.
D2 does not assert any of these implementation results. Ordered files, dependencies and additive rollback are in audit.

## Selected decisions and remaining narrow decisions

Selected technical design: immutable address/provider; lowercase identity; workspace HMAC uniqueness including archive;
contact-only StrictPayload intake; fail-closed audited vault; manual server-vs-attested timestamps; UTC due+IANA zone;
version/If-Match; archive-only; scoped redacted history/read audit; no export/link/reminder in I1.

PO/BA still needed: D1 wording/manual acceptance. Role mapping and viewer/auditor deny policy were confirmed in this step and must not be reopened as blanket approval. Privacy/operations still needed: legal retention/erasure/backup policy and key provisioning/recovery/rotation procedure. Main reviewed the documented standalone contact decrypt/PIN reuse boundary; actual implementation and caller-regression changes still require code review. P0 backup/schema/login evidence remains required before deployment.
`needs_main_action`: these reviews and evidence collection; no request to reapprove the already approved scope.

## P1-I1 integration amendment — eligible assignee projection

To implement the already-approved owner/admin reassignment UI without broadening owner-only /team/members, add GET /api/v1/email-registry/eligible-members BEFORE the dynamic id route. Owner/admin only; active same-workspace eligible owner/admin/buyer seats linked to active users; response [{id,full_name}] only, no email/role/session/team-management fields. No query params, no-store, redacted eligible_members_read audit committed before response. Bound at 1000; refuse with safe validation error rather than silently truncate larger workspaces. UI query cache scoped by workspace/user/role. Backend assignment still revalidates eligibility under lock; picker is not authorization. No generic team RBAC changes. Tests cover all roles, foreign/inactive/read-only members, DTO whitelist and unknown query rejection. This is an integration completion of approved assignment capability, not team administration expansion.
