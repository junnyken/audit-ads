# Audit before build — MINI-SPEC A5

Chrome Context Extension & Account Workspace Guard.
Audited against the actual repository at `ce3328b` on 2026-09-05, before any A5 code was written.

## 1. Verified A1–A4 baseline

Measured, not taken from the previous reports.

| Claim | Measured | Verdict |
|---|---|---|
| 117 routes, only GET/PATCH/POST, no `DELETE` | 117 routes, `{GET, PATCH, POST}`, zero DELETE | **confirmed** |
| 25 ORM tables, migration head `0004_a4_operational_runs` | 25 tables, head `0004` | **confirmed** |
| 344 backend tests | 344 collected and passing | **confirmed** |
| 60 frontend hermetic + 19 live-API | 60 passed / 19 skipped without the live flag; 19 passed with it | **confirmed** |
| No browser automation dependency anywhere | zero matches for playwright/selenium/puppeteer/webdriver in either manifest | **confirmed** |
| One outbound HTTP module | `services/telegram_transport.py` only | **confirmed** |
| No `<all_urls>` or broad host permission anywhere | none — no extension exists yet | **confirmed** |
| Nothing deployed, no real Telegram message | unchanged | **confirmed** |

Lint, typecheck and the production build are all clean at the baseline commit. **No deviation
from the A4 report was found.**

## 2. Files and documents inspected

`MINI_SPEC_PLAYBOOK.md`, `CLAUDE.md`, `README.md`, `FEATURES.md`, `ARCH.md`, `API.md`,
`TEST_LOG.md`; the four prior audits and reports; `HEALTH_RULES_V1.md`, `ALERT_POLICY_V1.md`,
`PRODUCTION_ENVIRONMENT.md` and the five runbooks.

Backend: `core/security.py`, `core/config.py`, `core/enums.py`, `core/redaction.py`,
`core/errors.py`, `api/deps.py`, `api/middleware.py`, `app/main.py`, `models/entities.py`
(`AdAccount`, `AccountEvent`, `AuditLog`), `models/health.py`, `models/alerts.py`,
`models/operations.py`, `schemas/common.py`, `schemas/events.py`, `services/registry.py`,
`services/events.py`, `services/rollup.py`, `services/readiness.py`,
`services/health_presenter.py`, `services/health_service.py`, `services/alert_service.py`,
`services/workspace.py`, `services/audit.py`, routers `auth`, `ad_accounts`, `events`, `health`,
`alerts`, `operations`, `system`; `alembic/versions/0001–0004`.

Frontend: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.*`, `src/lib/api.ts`,
`src/lib/types.ts`, the four presentation maps, `AppShell.tsx`, `App.tsx`.

**No extension of any kind exists in this repository.** A5 is greenfield on that side.

## 3. Existing patterns A5 must reuse

**Authentication.** `python-jwt` HS256, claims `sub` / `workspace_id` / `role` / `exp` / `iat`,
issued only by `POST /auth/login`, default lifetime 720 minutes. There is **no refresh token and
no token-type claim**. `get_context` decodes the bearer token, loads the user and workspace, and
resolves the membership through `WorkspaceAccessService` — the workspace **never** comes from a
request body. That property is what A5 must not weaken.

**Events.** `AccountEvent` already carries `event_type: str(120)`, `severity`, `source: str(80)`
(default `manual`), `occurred_at`, `summary`, `evidence_reference`, `status`, plus archive and
audit behaviour. `AccountEventService.create()` writes the event *and* an audit row and
recalculates readiness in the same transaction. **A5 reuses this wholesale** — no second event
model, no second audit path.

What `AccountEvent` lacks for A5: somewhere to keep `page_type`, `context_status`,
`safe_path` and `extension_version`.

**Registry.** `AdAccount.external_account_id` is `String(120)`, nullable, unique per workspace,
stored trimmed with case preserved. There is no canonical form, so the same account could be
registered as `act_123456789` while a page reports `123456789`.

**Readiness / health / alerts.** `ReadinessRollupService.evaluate(account, persist=False)`,
`_account_health_payload` (via `present_snapshot`) and the A3 alert queries are all reusable
read paths. A5 needs no new evaluation logic of any kind.

**Payload safety.** `StrictPayload` forbids unknown fields and rejects any field whose name
contains `password`, `cookie`, `session`, `token`, `secret`, `credential`, `authorization`,
`proxy_*`, `private_key`, `api_key` or `access_key`, plus values that look like connection
strings or bearer headers. **`session` and `token` being on that list constrains A5's own field
naming** — the same trap that A4 hit with `preview_token`.

**Security headers and CORS.** `SecurityHeadersMiddleware` sets nosniff, `DENY`, `no-referrer`
and COOP. CORS is an exact-origin allowlist with `allow_credentials=False`; production
validation refuses a wildcard.

**Rate limiting.** Still absent, and A4 recorded it as a follow-up. The A5 brief says to
rate-limit the extension endpoints *if a layer exists*; it does not, so A5 will not invent one —
it will instead make the extension itself well-behaved (debounce + cache) and record the gap.

## 4. Confirmed A5 gaps

| # | Gap | Class |
|---|---|---|
| N1 | No extension exists: no MV3 manifest, no build target, no bundle | frontend_UX, deployment |
| N2 | No token type: a leaked extension token would be a full dashboard token | security |
| N3 | No installation record, so an extension session cannot be listed or revoked | data_model, security |
| N4 | `AccountEvent` has nowhere to record page type, context status, safe path or extension version | data_model |
| N5 | No canonical form for `external_account_id`, so `act_123` and `123` cannot be matched exactly | vocabulary |
| N6 | No context-resolution concept at all (`confirmed` / `ambiguous` / `unknown` / `unsupported_page`) | vocabulary, state_machine |
| N7 | No endpoint returns account identity + readiness + health + alerts in one bounded read | API |
| N8 | No URL sanitisation helper: the account id lives in a query string that must not be stored whole | security |
| N9 | No extension event vocabulary, and no guard restricting which event types an extension may write | API, state_machine |
| N10 | No CORS entry for a `chrome-extension://` origin, and A4 refuses wildcards | deployment |
| N11 | No test harness for extension code (MV3 globals, `chrome.*`, manifest validation) | testing |
| N12 | No rate limiting on any endpoint | security (follow-up, per A4 §3 and A5 scope) |

## 5. Design choices

### 5.1 Extension session: a **scope-limited** token, not the dashboard token

`POST /extension/session/exchange` takes a normal dashboard token and returns a **new JWT with
`token_use: "extension"`**, an `installation_id`, and a short lifetime (default 12 hours,
configurable). Three dependencies enforce the split:

| Dependency | Accepts |
|---|---|
| `Ctx` (existing) | dashboard tokens **only** — an extension token is now refused |
| `ExtCtx` (new) | extension tokens only, and only while the installation is live |
| `AnyCtx` (new) | either, for the one read-only summary route |

So a token stolen from browser storage cannot create accounts, change readiness, resolve alerts,
edit notification policy or trigger a test send. It can read a summary and write allowlisted
events. That is a real reduction in blast radius, and it is the reason A5 issues a second token
instead of reusing the first.

Revocation is a row, not a claim: `extension_installations.revoked_at`. Every extension request
checks it, so revoking takes effect immediately rather than at token expiry.

### 5.2 Exact ID matching, with canonicalisation stated explicitly

Meta's Ads Manager carries the account in the query string as `act=123456789`, while the registry
may hold `act_123456789`. A5 canonicalises both sides — trim, lowercase, drop a leading `act_` —
and then requires **equality**. This is a *format* equivalence, not similarity:

- exactly one match → `confirmed`
- zero matches → `unknown` (`account_not_registered`)
- more than one → `ambiguous` (`multiple_registered_matches`, a data-integrity problem)
- no id on the page at all → `ambiguous` (`no_account_id_on_page`)
- not an Ads Manager page → `unsupported_page`

**Names are never matched.** They are display-only, and there is no fuzzy path in the code for a
future change to accidentally reach.

### 5.3 Event metadata: one additive column, not a second event model

`account_events` gains a nullable `source_context_json`. It is written only through an allowlist
(`page_type`, `context_status`, `safe_path`, `extension_version`, `external_account_id`), so a
raw URL, a query string or a credential cannot land in it even if the extension sent one. A5
adds **no second event table and no second audit path**.

### 5.4 URL handling: path only, allowlisted

The content script never sends `location.href`. It extracts the `act` parameter as a separate
field, then reduces the path to an allowlisted route shape (`/adsmanager/manage/campaigns` and
friends). Query, hash, fragment and any unrecognised path are dropped before the request leaves
the browser, and the backend sanitises again — the browser side is a convenience, the server
side is the guarantee.

### 5.5 Host permissions: narrower than the brief proposed

The brief suggested `https://www.facebook.com/*`. That is broader than needed and would give the
content script every Facebook page including the user's personal feed and messages. A5 ships:

```
https://adsmanager.facebook.com/*
https://business.facebook.com/*
https://www.facebook.com/adsmanager/*
```

The dashboard API origin is **not** in `host_permissions`: it is user-configured in Options, so
it goes in `optional_host_permissions` and is requested at runtime for the exact origin entered.
Permissions `storage`, `sidePanel`, `activeTab`. No `<all_urls>`, no `tabs`, no `webRequest`, no
`cookies`, no `scripting`.

### 5.6 Build: a separate `extension/` package

MV3 needs three HTML entry points, an ES-module service worker and an IIFE content script — a
different build shape from the dashboard SPA. A5 gives the extension its own `package.json`,
Vite config and Vitest config, so the dashboard bundle and the extension bundle can never
contaminate each other and the extension can be built and shipped on its own. It reuses the same
React 18 / TypeScript 5.7 / Vite 6 / Vitest 2 versions as the dashboard, and a plain CSS file
instead of pulling Tailwind into a second toolchain.

## 6. Expected changed files

**Backend (new):** `models/extension.py`, `services/extension_session.py`,
`services/extension_context.py`, `services/extension_summary.py`, `services/extension_events.py`,
`schemas/extension.py`, `api/v1/routers/extension.py`, `alembic/versions/0005_a5_extension.py`.

**Backend (extended):** `core/security.py` (token type), `core/enums.py` (context status, page
type, event source, extension event types), `core/config.py` (extension token lifetime),
`api/deps.py` (`ExtCtx`, `AnyCtx`, and refusing extension tokens on `Ctx`),
`models/entities.py` + migration (`source_context_json`), `api/v1/__init__.py`.

**Extension (new):** the whole `extension/` tree — manifest, service worker, session and API
client, content script with detector and sanitiser, popup, side panel, options, shared types and
validation, styles, tests.

**Docs:** `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `README.md`, `CLAUDE.md`,
`docs/AUDIT_BEFORE_BUILD_A5.md`, `docs/MINI_SPEC_A5_REPORT.md`.

## 7. Risks and gaps carried into A5

1. **Meta's DOM and URL shapes change without notice.** The detector must degrade to
   `ambiguous`/`unsupported_page` rather than guess, and a detector failure must never alter the
   loaded page. This is why the content script reads and never writes to the host DOM.
2. **A `chrome-extension://` origin must be added to `CORS_ORIGINS`** for a real deployment, and
   the extension id is only known after packing. Documented as a deployment prerequisite; it is
   not a wildcard and does not weaken A4's check.
3. **No rate limiting exists.** The extension debounces and caches per tab, but a compromised
   client could still poll. Recorded as a follow-up, unchanged from A4.
4. **No Chrome Web Store publishing, and no deployment.** A5 stops at a loadable unpacked build.
5. **A5 cannot be exercised in a real browser from this workspace** — the same limitation that
   has stood since A1. Verification is unit tests, a manifest and bundle validation, and live
   API calls that mimic exactly what the extension sends.

## 8. Declared behaviour change

`get_context` now **rejects** a token carrying `token_use: "extension"`. Tokens issued before A5
have no `token_use` claim and continue to work as dashboard tokens, so no operator is signed out.
Declared here before implementation; tests cover both directions.
