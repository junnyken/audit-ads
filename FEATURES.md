# FEATURES

Current release: **MINI-SPEC A1 — Account Registry & Stability Readiness** (2026-09-04).

## Shipped in A1

### Registry
- Central ad-account registry with workspace scoping, search, filter, sort and server-side
  pagination.
- Ownership mapping to a Business Manager **or** a personal-account reference, or an explicit
  `unknown`.
- Reference records: Business Managers, personal-account references, Pages, Pixels,
  payment-profile references, browser-profile references, proxy references.
- Time-bounded account↔asset links (`linked_at` / `unlinked_at` / `linked_by`). Unlinking closes
  a link and keeps the row, so historical mappings stay answerable.
- At most one active browser-profile reference and one active proxy reference per account;
  re-assigning closes the previous mapping and audits both halves.
- Soft archive and restore for every entity. No hard delete exists anywhere in the API.
- Tags, notes, owner label, country, currency, timezone.

### Readiness
- 14-item default checklist, initialised idempotently when an account is created.
- Deterministic, explainable rollup with four states: `unknown`, `not_ready`,
  `ready_with_warnings`, `operationally_ready`. No numeric score.
- Every result carries item-level reasons, required/completed counts and a data-freshness block.
- Conditional items state *why* they are required (account type, workflow needs a Page/Pixel,
  a landing page is assigned).
- Derived items (`business_manager_confirmed`, `page_linked`, `pixel_linked`,
  `browser_reference_assigned`, `last_manual_review_completed`, …) are computed from recorded
  facts and cannot be hand-marked.
- Evidence records with `provided` / `verified` / `expired` / `rejected` states and expiry;
  item evidence status is derived worst-first from live evidence rows.
- Waivers require a written reason and never satisfy a required item.
- Manual review recording, with an expiry interval (default 30 days).
- Cross-account readiness board grouped by blocking reason. Read-only: no bulk "mark complete".

### Events
- Operator-recorded account events with `info` / `warning` / `critical` severity.
- Unresolved warnings downgrade to `ready_with_warnings`; unresolved critical events force
  `not_ready`.
- Resolution requires a written note.

### Audit and observability
- Append-only audit log for every mutation: actor, action, entity type/id, before/after diff of
  only the changed fields, metadata, request id, timestamp.
- Per-account audit timeline that also covers its checklist items, evidence, events and links.
- Structured JSON logs with recursive redaction and a request/correlation id on every response.
- `GET /health/live`, `GET /health/ready`, `GET /api/v1/system/status`.

### Security
- JWT authentication; workspace scope resolved from the membership, never from the request body.
- Roles (`owner`/`admin`/`buyer`/`viewer`/`auditor`) exist in the data model; only `owner` is
  provisioned in A1, and permission checks are already role-based.
- Requests carrying secret-named fields are **refused** (`forbidden_field`), not silently dropped.
- Values shaped like connection strings or credentials are refused for reference fields.
- Recursive redaction before anything reaches a log line or an audit row.
- CORS allowlist, security headers, no secret in the browser bundle.

### Frontend
- Overview with the six required summary cards, accounts needing review, recently changed
  accounts, checklist-completion distribution, latest audit activity, data-freshness notice.
- Registry table with the required columns, URL-encoded filters, and display-only bulk selection.
- Create/edit drawer grouped into Identity / Ownership / Operational metadata / Assets /
  Browser and proxy references / Notes.
- Account detail with Overview, Assets & References, Readiness, Events and Audit History tabs.
- Ownership references, Assets, Readiness, Audit Log, System Status and Settings pages.
- Empty, loading (skeleton), and error states; errors surface the correlation id.
- `unknown` and `not_ready` are never rendered with success styling — enforced by a single
  colour map and covered by a test.

## Deliberately excluded from A1

| Excluded | Why |
|---|---|
| Platform API integration / sync | A1 is a registry; an authorised integration belongs to a later phase |
| Campaign publish, pause, edit, duplicate, delete | Out of scope; A1 has no mutation path to any platform |
| Bulk operations | A1 §Non-goals — data and audit foundations first |
| Telegram or any notification delivery | Belongs to MINI-SPEC A3 |
| Browser automation, antidetect, proxy rotation, cookie handling, fingerprinting | Prohibited by the product charter |
| Credential/session storage, payment changes | Prohibited; the API refuses such fields |
| Numeric risk score, restriction prediction | Rejected design — hides uncertainty and implies safety claims |
| Team assignment UX, full RBAC | Data model supports it; UX belongs to MINI-SPEC F1 |

## Known limits (follow-ups)

- No rate-limiting middleware yet (no existing middleware to extend in A1).
- No CI pipeline configured for this repository.
- Evidence is metadata plus an optional external link; there is no file upload/storage layer.
- Roles cannot be assigned through the UI yet.
- `last_synced_at` is always empty because nothing syncs; readiness reports data freshness as
  `unknown` rather than pretending otherwise.
