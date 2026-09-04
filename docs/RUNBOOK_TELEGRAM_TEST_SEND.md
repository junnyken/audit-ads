# Runbook — Controlled Telegram test send

**Purpose.** Send exactly one clearly-labelled verification message to one owner-approved chat,
to prove the delivery path works — and nothing else.

**Scope.** Stage B of MINI-SPEC A4, and a separate approval from the deployment approval. One
does not authorise the other.

> **No real Telegram message has ever been sent by this codebase.** The default transport is
> `disabled`, `ALLOW_TEST_SEND` defaults to `false`, no bot token exists in this repository or
> its environment, and every test and pilot to date used the fake transport.

## Why this is not just "click send"

A first outbound message is irreversible: it reaches a real person, in a real chat, from an
account that will keep existing. So four independent gates stand in front of it, and all four
must be open at once:

1. **Workspace owner** — the endpoints are owner-only.
2. **Server switch** — `ALLOW_TEST_SEND=true`, set deliberately for one verification.
3. **Explicit confirmation** — `confirm: true` in the request, and typing `SEND` in the UI.
4. **Approval code** — proof that this exact destination, environment and message were
   previewed. A mismatch refuses.

The caller supplies **no recipient and no message body**. Both come from server-side
configuration and a fixed template. The request schema has no field for either, so this is a
structural guarantee rather than a check that could be skipped.

## Prerequisites

- [ ] A deployment exists and is healthy (`RUNBOOK_DEPLOY.md` completed).
- [ ] `TELEGRAM_BOT_TOKEN` is set **server-side only** in the env file. It must not appear in
      the database, an API response, an audit row, a log line, this runbook, or a chat message
      to anyone.
- [ ] `NOTIFICATION_TRANSPORT=telegram`.
- [ ] The bot has been added to the target chat by a person, and the chat is one the owner
      controls. A bot cannot message a chat it was never added to.
- [ ] The chat reference is set in **Settings → Notification policy** (owner-only). It is stored
      masked in every response.
- [ ] `PUBLIC_APP_URL` is a public HTTPS origin, or the message will deliberately omit the link.
- [ ] The product owner has approved **this specific chat** and **this exact message text**.

## Pre-send checks

The preview endpoint returns all of them; every one must pass before the flow reports
`ready_to_send`.

| Code | Meaning |
|---|---|
| `environment_resolved` | The environment label is set |
| `transport_is_telegram` | Real transport is selected |
| `bot_token_configured` | A token exists server-side |
| `recipient_resolved` | One owner-controlled chat is configured |
| `timezone_resolved` | The policy timezone resolves |
| `dashboard_link_safe` | A public HTTPS link, or no link at all |
| `message_contains_no_sensitive_data` | No token, credential, private URL or account data |
| `send_explicitly_enabled` | `ALLOW_TEST_SEND` is on |

## Steps

### 1. Arm the server for one verification

```bash
# In <ENV_FILE>, for this verification only:
NOTIFICATION_TRANSPORT=telegram
ALLOW_TEST_SEND=true
TELEGRAM_BOT_TOKEN=<REDACTED — server-side only>

docker compose --env-file <ENV_FILE> -f docker-compose.yml -f docker-compose.production.yml \
  up -d api dispatcher
```

### 2. Render the preview — this sends nothing

**System Status → Controlled delivery verification → Render preview**, or:

```bash
curl -s -X POST https://<PUBLIC_DOMAIN>/api/v1/operations/test-send/preview \
  -H "Authorization: Bearer <OWNER_TOKEN>" -H 'Content-Type: application/json' -d '{}'
```

The response carries the exact message, the **masked** recipient, every pre-send check, and an
`approval_code`. It never returns the bot token or the raw chat id.

### 3. Show the owner exactly what will be sent

The message is fixed by the `a4-test-v1` template:

```
[AdsOps] TEST NOTIFICATION

This is a controlled delivery verification for AdsOps Control Center.

Environment: <ENVIRONMENT_LABEL>
Time: <TIMESTAMP IN THE POLICY TIMEZONE>
Transport: Telegram
Result expected: one message only

<PUBLIC DASHBOARD LINK, only when a public HTTPS URL is configured>
```

It carries no account name, no account id, no health signal, no readiness state, no payment or
proxy data, no cookie, no token and no stack trace.

**Get explicit approval of this text and this masked recipient before continuing.**

### 4. Send exactly one message

In the UI: type `SEND`, then **Send one test message**. Or:

```bash
curl -s -X POST https://<PUBLIC_DOMAIN>/api/v1/operations/test-send/execute \
  -H "Authorization: Bearer <OWNER_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"approval_code":"<FROM STEP 2>","confirm":true}'
```

Expected: `{"sent": true, "message_id": "<PROVIDER MESSAGE ID>", …}`.

A second call with the same approval code returns `already_sent_for_this_preview` and sends
nothing. The dedupe key is an operational-run record, entirely separate from the alert outbox,
so a test send can never collide with, suppress or duplicate a real alert delivery.

### 5. Verify

- [ ] Exactly **one** message arrived in the chat.
- [ ] Its text matches the approved preview exactly.
- [ ] System Status → run history shows one `test_send` run, `succeeded`, `message_count=1`.
- [ ] No secret anywhere:
  ```bash
  docker compose --env-file <ENV_FILE> -f ... logs api | grep -ciE '[0-9]{6,}:[A-Za-z0-9_-]{20,}'
  # expect 0
  ```
- [ ] No A1/A2/A3 record changed: account, alert and health-signal counts are unchanged, and no
      new alert appeared. A test send creates no alert by design.
- [ ] No duplicate arrived after a dispatcher restart.

### 6. Disarm

```bash
# In <ENV_FILE>:
ALLOW_TEST_SEND=false
# Leave NOTIFICATION_TRANSPORT=telegram only if real alert delivery has been approved.
# Otherwise set it back to disabled.

docker compose --env-file <ENV_FILE> -f ... up -d api dispatcher
```

Confirm System Status shows **Test send is switched off**.

The run record stays. It is the evidence that exactly one message went out; nothing deletes it.

## Failure handling

| Result | Meaning | Action |
|---|---|---|
| `pre_send_checks_failed:<codes>` | A gate is closed | Fix the named check; nothing was sent |
| HTTP 422 "disabled on this server" | `ALLOW_TEST_SEND` is off | Arm it deliberately, or stop |
| `approval_code_mismatch` | The destination or environment changed after the preview | Re-preview and get approval again |
| `already_sent_for_this_preview` | It already worked | Do not force a second message |
| `transport_failed` + `unauthorized` | The bot token is wrong or revoked | Rotate it server-side; never paste it into a message or a ticket |
| `transport_failed` + `invalid_recipient` | The bot is not in that chat, or the id is wrong | A person must add the bot; do not retry blindly |
| Message arrives twice | Two dispatchers, or a send outside this flow | Stop the dispatcher, check run history, report it |

## Escalation

Stop and raise it with the product owner if a message reaches an unexpected chat, if any
message contains data the template does not allow, or if a token appears anywhere outside the
env file. Set `NOTIFICATION_TRANSPORT=disabled` first, then investigate.
