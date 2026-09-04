# MINI-SPEC A5 Report — Chrome Context Extension & Account Workspace Guard

Date: 2026-09-05 · Status: **Complete** · Baseline audited: `ce3328b` (A4 Stage A)

## 1. Summary

A5 adds a Manifest V3 Chrome extension that answers one question while you work in Meta Ads
Manager: **which account is this, and what does AdsOps already know about it?** It identifies
the account by exact account id, shows readiness, health and open alerts as three separate
values, and lets an operator record notes, manual reviews and a change intent — each of which
becomes an ordinary A1 account event with an audit row.

The extension is deliberately incapable of more. It reads the account id in the URL, the route
path and the tab title, and nothing else. It writes nothing to the page it runs on. It performs,
automates and blocks nothing on any advertising platform, and no permission it holds would let
it.

A5 deliberately did **not** add: any Ads Manager action, automation or blocking; cookie,
storage, session or network-traffic access; fingerprinting, antidetect behaviour or proxy
handling; auto-login, auto-appeal or checkpoint bypass; fuzzy or name-based matching; a second
health, readiness or alert engine; a broad host permission; deployment; a Chrome Web Store
listing; or any real Telegram message.

## 2. Audit Before Build

**Verified A1–A4 baseline (measured):** 117 routes, `{GET, PATCH, POST}`, **zero DELETE**, 25 ORM
tables, head `0004_a4_operational_runs`, 344 backend tests, 60 hermetic and 19 live-API frontend
tests, no browser-automation dependency, one outbound HTTP module, no `<all_urls>` anywhere.
Lint, typecheck and build clean. **No deviation from the A4 report was found.**

**Exact files inspected:** the playbook, `CLAUDE.md`, `README.md`, `FEATURES.md`, `ARCH.md`,
`API.md`, `TEST_LOG.md`, the four prior audits and reports, `HEALTH_RULES_V1.md`,
`ALERT_POLICY_V1.md`, `PRODUCTION_ENVIRONMENT.md` and the five runbooks; backend `core/security`,
`core/config`, `core/enums`, `core/redaction`, `api/deps`, `api/middleware`, `main`,
`models/entities` (`AdAccount`, `AccountEvent`, `AuditLog`), `models/health`, `models/alerts`,
`models/operations`, `schemas/common`, `schemas/events`, `services/registry`, `services/events`,
`services/rollup`, `services/readiness`, `services/health_presenter`, `services/health_service`,
`services/alert_service`, `services/workspace`, `services/audit`, routers `auth`, `ad_accounts`,
`events`, `health`, `alerts`, `operations`, `system`, migrations `0001–0004`; frontend
`package.json`, the Vite/Vitest/TS configs, `lib/api.ts`, `lib/types.ts`, the four presentation
maps, `AppShell`, `App`. **No extension of any kind existed.**

**Regression baseline:** all of the above green before a line of A5 was written.

**Confirmed A5 gaps:** N1 no extension at all (`frontend_UX`, `deployment`); N2 no token type, so
a leaked extension token would be a full dashboard token (`security`); N3 no installation record,
so a session could not be listed or revoked (`data_model`, `security`); N4 `AccountEvent` had
nowhere to record page type, context status, path or client version (`data_model`); N5 no
canonical form for `external_account_id` (`vocabulary`); N6 no context-resolution concept
(`vocabulary`, `state_machine`); N7 no single bounded read of identity + readiness + health +
alerts (`API`); N8 no URL sanitisation helper (`security`); N9 no extension event vocabulary or
guard (`API`, `state_machine`); N10 no CORS entry for a `chrome-extension://` origin
(`deployment`); N11 no test harness for MV3 code (`testing`); N12 still no rate limiting
(`security`, follow-up).

**Existing patterns reused:** `AccountEventService` (event + audit + readiness recalculation in
one transaction), `ReadinessRollupService.evaluate(persist=False)`, `present_snapshot`, the A3
alert queries, `StrictPayload` and the credential guard, `WorkspaceAccessService`, the request
context and error envelope, and the dashboard's Vite/Vitest/TypeScript versions.

**Out-of-scope findings:** no rate limiting anywhere (A4 follow-up, unchanged); the pytest
harness still assumes a single runner; the workspace disk sits at 89%.

## 3. Design Choice

**A scope-limited second token.** The extension exchanges a dashboard login for a token carrying
`token_use: "extension"` and an `installation_id`, then forgets the password. Three dependencies
keep the two apart: `Ctx` (dashboard only), `ExtCtx` (extension only, and only while the
installation is live) and `AnyCtx` (either, for one read-only summary). A token that lives in
browser storage therefore cannot create an account, change readiness, resolve an alert, edit
notification policy, trigger a test send, or mint another session. Revocation is a **row**,
re-checked every request, so cutting off a browser is immediate rather than expiry-bound. Tokens
minted before A5 carry no claim and still work, so nobody was signed out.

**Exact matching, with canonicalisation stated.** `act_123456789`, `ACT-123456789` and
`123456789` canonicalise to one value and are then compared for **equality** against a closed
candidate set resolved in SQL. Names are display-only; there is no similarity function anywhere
in A5. Four honest outcomes — `confirmed`, `ambiguous`, `unknown`, `unsupported_page` — with
duplicates reported as ambiguous rather than resolved by a coin flip, and an archived account
reported as archived rather than as unregistered.

**Nothing leaves the browser that we would not want stored.** The account id is extracted from
the query string; the query string is discarded before the request is built. Routes are reduced
to an allowlist in the extension **and again on the server**. Stored event context passes a
third allowlist.

**Events go through A1, not around it.** Event types are an allowlist, the server decides
severity, decisions require a reason, and `occurred_at` cannot be moved into the future — then
`AccountEventService` does the rest, so an extension event is an ordinary event with an ordinary
audit row.

**Minimal permissions.** `storage`, `sidePanel`, `activeTab`, and three path-scoped hosts. The
API origin is **not** a host permission — that would let the extension bypass CORS — so it is
reached through ordinary CORS and the server's exact-origin allowlist.

**Its own build.** MV3 needs three HTML entries, an ES-module worker and an IIFE content script;
the extension is a separate package so the two bundles cannot contaminate each other.

**Why:** it directly addresses acting on the wrong account across many browser profiles, without
depending on anything fragile or invasive, and without giving a browser extension power it
should not have.

## 4. Changed Files

**Backend (new):** `models/extension.py`, `services/extension_context.py`,
`services/extension_session.py`, `services/extension_summary.py`, `services/extension_events.py`,
`schemas/extension.py`, `api/v1/routers/extension.py`,
`alembic/versions/0005_a5_extension.py`.

**Backend (extended):** `core/security.py` (token type, custom expiry, extra claims),
`core/enums.py` (`EventSource`, `ExtensionContextStatus`, `ExtensionPageType`,
`ExtensionEventType`, the severity map), `core/config.py` (token lifetime, minimum client
version), `api/deps.py` (`ExtCtx`, `AnyCtx`, and `Ctx` refusing extension tokens),
`models/entities.py` (`AccountEvent.source_context_json`), `models/__init__.py`,
`api/v1/__init__.py`.

**Extension (new):** `extension/` — `package.json`, `vite.config.ts`,
`vite.content.config.ts`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.js`,
`PERMISSIONS.md`; `src/manifest.json`; `src/background/{service-worker,auth-session,api-client}.ts`;
`src/content/{page-bridge,context-detector,dom-observer}.ts`;
`src/shared/{types,validation,storage,messaging,presentation,useExtension}.ts`;
`src/popup/{PopupApp.tsx,ContextView.tsx,main.tsx,popup.html}`;
`src/sidepanel/{SidePanelApp.tsx,main.tsx,sidepanel.html}`;
`src/options/{OptionsApp.tsx,main.tsx,options.html}`; `src/styles/extension.css`;
`tests/{setup,validation,detector,storage,manifest}.ts` and `tests/ui.test.tsx`.

**Frontend (extended):** `lib/types.ts`, `pages/Settings.tsx` (connected browsers),
`src/test/live.app.test.tsx`.

**Documentation:** `docs/AUDIT_BEFORE_BUILD_A5.md`, `docs/MINI_SPEC_A5_REPORT.md`,
`FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `README.md`, `CLAUDE.md`.

## 5. New API/DB/State

**Tables:** `extension_installations` (workspace, user, instance id, label, version, last seen,
revoked at/reason). It stores **no** fingerprint, user agent, browsing history or Meta
identifier. `account_events` gains a nullable `source_context_json`.

**Vocabulary:** `EventSource` (`manual`/`chrome_extension`/`system`), `ExtensionContextStatus`
(4), `ExtensionPageType` (7), `ExtensionEventType` (10) with a server-side severity map.

**Endpoints (8):** `POST /extension/connect`, `GET /extension/session/current`,
`GET /extension/installations`, `POST /extension/installations/revoke`,
`POST /extension/context/resolve`, `GET /extension/accounts/{id}/summary`,
`POST /extension/events`, `GET /ad-accounts/{id}/extension-summary`. Routes rose 117 → **125**,
still **no DELETE**, extension surface `GET`/`POST` only.

**Authorization:** workspace from the membership as always; `Ctx` refuses extension tokens,
`ExtCtx` requires one plus a live installation, `AnyCtx` accepts either for the read-only
summary. A foreign account is reported as missing, never as forbidden.

## 6. Tests

| Layer | Result |
|---|---|
| A1–A4 regression | **344 passed, unchanged** |
| A5 backend | 44 new (19 unit + 25 integration) |
| **Backend total** | **388 passed** |
| Extension | **50 passed** across 5 files, plus eslint, tsc and a production build |
| Frontend | 60 hermetic + 20 live-API (one new A5 scenario) |
| Manifest/bundle audit | MV3, permission set, path-scoped hosts, CSP, no token-shaped value, no `document.cookie`/`localStorage`/`indexedDB`, no `chrome.cookies`/`webRequest`/`debugger`/`proxy`, content script free of `import` |
| Migration | Clean (27 tables), upgrade on live A1–A4 data (14 accounts, 4 events intact), downgrade drops only the new objects |
| Lint/typecheck/build | ruff, eslint and tsc clean in both packages; dashboard 362.04 kB (+2.2 kB over A4) |

**Defects found and fixed:** six, listed in `TEST_LOG.md` §7. The substantive ones: the content
script was built as an ES module importing a chunk and would have failed silently on every Ads
Manager page; extension pages used absolute asset paths; `optional_host_permissions:
["https://*/*"]` would have allowed requesting any origin; the brief's
`https://www.facebook.com/*` would have run the content script on the feed and Messenger; and
context resolution loaded every account and filtered in Python instead of matching in SQL.

## 7. Live Verification

**30/30 checks passed** against the running API, sending exactly what the content script produces
from a real Ads Manager URL including `access_token` and `business_id` query parameters.

Verified live: the extension token is refused by every dashboard route and cannot create an
account or mint another session; a real account id confirms the right account and returns
readiness, health and alerts as three separate values with no score; an unregistered id returns
`unknown` with no account; a page with no id returns `ambiguous`; a non-Ads-Manager page returns
`unsupported_page`; a full URL sent by mistake comes back stripped; **an account with an
identical display name but a different id is not matched**; a change intent lands in the A1
timeline with an audit row; an unlisted event type, a decision without a reason, a workspace id,
a cookie, an access token, a password and a self-chosen severity are all refused; the stored
context contains no URL, query or secret; and revoking from the dashboard stops the session
**immediately**, including its ability to write events.

**Not verified:** the extension has never been loaded in Chrome, never run against a real Ads
Manager page, and never published. Nothing was deployed and no Telegram message was sent.

**Resource observations:** extension bundle — content script 3.76 kB, service worker 10.5 kB,
pages 4–9 kB each plus a 233 kB shared React chunk; the content script polls the URL once a
second and re-resolves only when the account or route changes, cached 30 s per tab.

## 8. Remaining Limits / Follow-ups

**Intentionally excluded:** every Ads Manager action, automation or blocking; cookie, storage,
session and network-traffic access; fingerprinting, antidetect and proxy handling; auto-login,
auto-appeal, checkpoint bypass; bulk operations; fuzzy or name matching; a second health, alert
or notification engine; broad host permissions; Chrome Web Store publishing; deployment; real
Telegram sends.

**Production gaps not accepted:**

1. **The extension has never run in a browser.** Loading it unpacked against real Ads Manager
   pages is the first thing to do, and it is the only way to confirm the route allowlist matches
   what Meta actually serves today.
2. **Meta's URL shapes are an assumption.** The extension degrades safely when they change, but
   the allowlist needs maintenance and there is no alert when it stops matching.
3. **A deployment must add `chrome-extension://<id>` to `CORS_ORIGINS`**, and the id only exists
   once the extension is packed.
4. **No store listing, signing or update channel.**
5. **A4 Stage B remains unstarted**: nothing deployed, no real Telegram message.

**CI / rate-limit / role-management follow-ups:** still no CI; still no rate limiting (the
extension is well-behaved by construction, but that is politeness, not enforcement); workspace
roles still have no management UI; the pytest harness still assumes a single runner.

**Recommended next MINI-SPEC:** load the extension unpacked and run a real-browser session
against Ads Manager first — a short verification pass, not a new spec — and complete **A4 Stage B**
when a target and an approved chat exist. After that, the natural next capability is
**A6 — Operator Workload & Review Scheduling**: turning "manual review is overdue" from a health
signal into a plan of what to review next, using the events A5 now produces.

**A4 Stage B is still not started, and no next MINI-SPEC has begun.**
