# FINAL_IDENTITY_CSV — exact Page identity and evidence-preserving CSV

Date: 2026-11-28. Author: Codex, delegated fix scope supplied by main.
Parent: final read/sync hardening. Governing context: CLAUDE.md,
MINI_SPEC_PLAYBOOK.md, FEATURES.md, ARCH.md, API.md, TEST_LOG.md.

## Context and audit before build
The separate `_sync_workspace_pages_from_meta` path scopes its Page inventory
by authenticated workspace and includes archived rows, but then attaches a
name-only draft to a provider ID and clears `archived_at` on exact matches.
This violates exact identity and explicit archive lifecycle (state_machine,
data_model). The CSV `bm_verified` truthiness branch converts null/absent
observations to a negative claim (frontend_UX). Existing translation
`pf.evidence.unknown` supplies “Chưa xác định”.

## Goal and approved scope
Main explicitly authorizes only these two confirmed remaining defects, tests
and governing-document evidence. No provider/network/DB calls, stack, dependencies,
migration, CI queries, commit/push/deploy or edits to main-owned `.vibe` files.
Preserve original dirty files. No new UI layout or security exception.

## Design choice and constraints
Reuse the existing workspace-filtered external-ID Page index, including archived
IDs as tombstones. Remove name attachment entirely. Return before any business
metadata mutation for archived matches; exclude archived node refresh and guard
link creation. Preserve all four count keys and existing counting semantics for
active observations; skipped archived observations count zero and create no audit,
link, duplicate or restoration. Active exact-ID updates remain supported.
CSV uses strict true/false checks, with unknown mapped to existing i18n wording.
No model, schema, endpoint or state additions.

Card fallback inspection: CSV uses provider display, then non-placeholder linked
payment profile labels, then the Accounts surface's existing “Chưa gắn thẻ”.
The backend assembles the same fallback and does not expose a distinct card
observation completeness state. Whether an empty card inventory proves absence
is not sufficiently specified: explicit follow-up, no card behavior change here.
The backend's separate default `bm_verified=False` is outside this narrowly
approved serializer fix; follow up on upstream evidence semantics.

## Test plan and success criteria
Exercise the actual production sync function with an in-memory session double
(no SQL execution or provider network), checking same-name distinct IDs, untouched
drafts, archive tombstones on all edges/no links/no auto-claim, workspace filter,
and active exact-ID updates. Exercise the actual downloaded CSV Blob for null,
undefined, false and true. Run existing standalone regressions with --noconftest
and dummy DB URL; frontend existing deps with timeouts and remove only symlink
created for this task. Attempt targeted lint/typecheck/build within time budget.
No claim of PostgreSQL integration or live verification. Record measured results
in TEST_LOG.md and summarize contracts in FEATURES.md, ARCH.md, API.md.
