# Audit Before Build — A10 (Real Meta Provider Connection & Read-Only Capability Discovery)

Date: 2026-09-10 · Baseline: A9 complete, 640 backend tests green, nothing deployed.

**This is the audit, not the build.** A10 is the first mini-spec that would make this product
talk to Meta for real, so it stops here until the things in §6 exist and the decisions in §5 are
made. Nothing in A10 should write anything on Meta — read-only discovery only.

## 1. What already exists (verified in code, not assumed)

The provider seam was built in A7 and has been waiting for this:

- **`MetaBusinessProvider`** (`app/services/meta_provider.py`) — the interface, with
  `check_capability`, `list_business_managers`, `create_ad_account`,
  `share_ad_account_access`, `share_pixel_access`, `reconcile_create`.
- **`FakeMetaBusinessProvider`** — the only implementation, and the only one any code path can
  reach today.
- **`_provider_for(connection)`** (`app/api/v1/routers/meta_operations.py`) returns the fake
  provider unconditionally. Its docstring says so plainly: `environment` on a connection records
  operator *intent*, it does not unlock a network call.
- **`MetaConnection.environment`** — `fake` / `sandbox` / `production` already in the schema.
- **`settings.meta_access_token`** — already exists, server-config-only, defaults to empty. It
  is read for one purpose today: computing the `token_configured` boolean in API responses.
- **Typed failure vocabulary** — `MetaFailureCode` with `RETRYABLE_FAILURE_CODES`
  (`rate_limited`, `provider_server_error`), plus the `unknown`-on-timeout rule and
  `reconcile_create`. A real provider maps HTTP/Graph errors onto this; it does not invent a
  parallel scheme.

So A10 is genuinely "implement one interface and let `_provider_for` return it" — the batch
engine, retry policy, idempotency keys, preview/confirm and audit trail all already exist and
do not change.

## 2. The hard constraints A10 must not break

| Constraint | Where it is enforced today | What A10 must do |
|---|---|---|
| Only named modules may make an outbound request | `test_alert_security.py::test_only_named_modules_may_make_an_outbound_request` + CLAUDE.md rule 20 | Add the new provider module to the allowlist **by name**, and widen rule 20 with the same discipline A6 used. Never loosen the regex |
| No browser drivers, anywhere | Same test | Unchanged — a Graph API client is HTTP, not a browser |
| Tokens never reach the database, an API response, an audit row, a log line or the frontend bundle | CLAUDE.md rule 18 (extended to Meta in A7) | The token stays in `settings.meta_access_token`. `token_configured` stays a computed boolean |
| No real external call in automated tests | CLAUDE.md rule 22 / A9 guardrail 29 | Every test keeps using `FakeMetaBusinessProvider`. The real provider gets its own tests against a stubbed transport, never the network |
| A real call needs the operator's explicit, separate approval | CLAUDE.md rule 22 | Even after A10 ships, the first live call is its own decision with a named target |
| Missing evidence degrades to `unknown` | CLAUDE.md rule 4 | A capability that cannot be confirmed is `unknown`/`false`, never assumed `true` |

**The existing HTTP precedent to copy:** `services/telegram_transport.py` — stdlib
`urllib.request` only (no new dependency), a fixed API base from configuration, an explicit
timeout, and errors mapped onto a typed result rather than raised as raw exceptions. A10's
provider should look like that, not like a generic SDK wrapper.

## 3. What A10 would actually build

1. `services/meta_graph_transport.py` (name TBD) — the *only* new module allowed to make an
   outbound request. Fixed Graph base URL from config, explicit timeout, no redirects to
   arbitrary hosts, typed results.
2. `RealMetaBusinessProvider` implementing `MetaBusinessProvider`, **read-only for now**:
   `check_capability()` and `list_business_managers()` return real answers; every *write*
   method (`create_ad_account`, `share_*`) raises a clear "not enabled in this build" rather
   than silently doing nothing or, worse, calling Meta.
3. `_provider_for(connection)` gains one branch: `environment == production` (and a configured
   token) → real provider; everything else → fake. The default stays fake.
4. Token-expiry handling and rate-limit observability mapped onto the existing
   `MetaFailureCode` vocabulary — `token_expired` and `rate_limited` already exist.
5. Tests: the real provider against a stubbed transport (success, expired token, rate limited,
   5xx, timeout), plus a security test proving the write methods refuse.
6. One live, **non-mutating** verification — run once, by hand, with the operator present, and
   recorded in `TEST_LOG.md` with the real response shape.

## 4. Risks worth naming now

- **A read-only claim is only as good as the code.** The safest shape is that the real provider
  physically cannot write: the write methods raise, rather than being guarded by a flag someone
  could flip. That is the version this audit recommends.
- **Rate limits are real money and real lockouts.** Discovery calls must be bounded and
  explicitly triggered — never on a page load, never on a timer.
- **Token expiry is normal, not exceptional.** A long-lived system-user token still expires; the
  UI must show `token_configured` + last successful check, and degrade to `unknown` rather than
  showing a stale `true`.
- **The fake provider must stay the test default forever.** If a test ever picks up the real
  provider by accident, the failure mode is a live API call from CI.

## 5. Decisions

**Decided with the product owner (2026-09-10):**

1. **Auth model: a long-lived system user token.** No interactive refresh flow, no OAuth
   round-trip — the token lives in server configuration and nowhere else, exactly like the
   Telegram bot token.
2. **Environment: a real Business Manager, read-only.** Not Meta's sandbox. This raises the bar
   on the read-only guarantee rather than lowering it: the write methods must be *incapable* of
   writing, not merely switched off, because the target is a live BM.

**Still open, and blocking the live step only (not the build):**

3. **Which BM is the target** for the first live read.
4. **Who is present** for that first call, and when. Rule 22 makes it a deliberate, witnessed
   action rather than something that happens because a test ran.

## 6. What you need to prepare on the Meta side

Nothing in A10 can be finished without these. None of them are code, and none of them should be
guessed at:

- [ ] **A Meta App** (Business type) in developers.facebook.com, with its App ID and App Secret.
- [ ] **A Business Manager** you actually control, to be the target of the first read.
- [ ] **A System User** inside that BM, with a generated access token.
- [ ] **Permissions approved for that token** — for read-only discovery: `business_management`
      (read) and `ads_read`. Creating or sharing later needs more, and needs App Review; that is
      A11's problem, not A10's.
- [ ] **The token itself**, delivered somewhere safe. **Do not paste it into this chat.** It
      belongs in the server environment as `META_ACCESS_TOKEN`, the same way the Telegram bot
      token is handled — this product refuses to store it anywhere else, and so should you.
- [ ] **Confirmation of which Graph API version** you want pinned (a version is required in the
      URL; leaving it floating means Meta changes behaviour under you).
- [ ] **Whether the BM has billing set up**, if you ever intend to go past read-only. Account
      creation fails without it, and that failure is worth knowing about before it happens in a
      batch.

## 7. Explicit confirmation

Nothing in this audit called Meta, sent an email or a Telegram message, deployed anything, or
changed any A1–A9 behaviour. The only provider any code path can reach right now is still
`FakeMetaBusinessProvider`, and it stays that way until the items above exist and A10 is
explicitly approved to start.
