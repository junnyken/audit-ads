# Session security (A9)

How a signed-in session is tracked, and how it is actually ended.

## The problem A9 fixed

Before A9 the dashboard used **stateless JWTs and nothing else**: a token was valid until its
`exp` and there was no way to end it early. Signing out cleared the browser's copy — which does
nothing to a token someone else already has. A lost laptop stayed signed in for the rest of the
token's life, and the product had no honest way to say otherwise.

A5's Chrome extension had already solved this for itself (`ExtensionInstallation` — a row,
re-checked on every request, revoked by setting `revoked_at`). A9 gives the dashboard the same
thing rather than inventing a second mechanism, and deliberately leaves the extension's model
untouched.

## How it works now

Every login creates a `DeviceSession` row and embeds its id in the token as a `session_id`
claim. Every dashboard request then re-loads that row and refuses the request unless it is
active. So:

- **Revoking is effective on the very next request**, not at token expiry.
- A token whose session was revoked is refused with the same "sign in again" as an expired
  signature — not a special case a client could distinguish.
- A token with **no** `session_id` claim is refused too. Unlike A5's `token_use`, this claim is
  not optional-for-backwards-compatibility: nothing has ever issued a dashboard token without
  it since the registry shipped, so accepting one would only ever mean accepting a forgery.

Member status is checked on the same path: suspending, deactivating or archiving someone
revokes all their sessions immediately *and* the membership check would refuse them anyway.
Two independent reasons, on purpose.

## What is stored about a device

Deliberately almost nothing:

| Stored | Not stored |
|---|---|
| Coarse browser family (`Chrome`, `Firefox`, …) | The full user-agent string |
| Coarse OS family (`Windows`, `macOS`, …) | Any fingerprint, canvas hash, font list, screen size |
| A generated label like `Chrome on Windows` | Anything the user did not see us derive |
| A salted SHA-256 of the IP | The IP itself — never persisted, never shown |
| `created_at`, `last_seen_at`, `expires_at` | Location, ISP, anything geo |

`last_seen_at` is throttled to at most once every 5 minutes, so "who is online" does not turn
into a write on every request.

The device label is **not a security identity**. It exists so a human can tell two rows apart,
nothing more. Never use it to make an authorization decision.

The IP hash exists only for a later abuse investigation and is not returned by any endpoint.
The Security & Devices page says all of this on the page itself, so the person whose sessions
they are does not have to take it on faith.

## Who can do what

| Action | Who |
|---|---|
| See my own sessions | Anyone signed in (`GET /security/sessions/me`) |
| Revoke one of *my other* sessions | Anyone signed in |
| Revoke **my current** session | **Nobody** — blocked by design (`409`). Sign out instead |
| Sign out all my other devices | Anyone signed in (current session survives) |
| See another member's sessions | Owner only |
| Revoke another member's session | Owner only, and a reason is required (`422` without) |
| Revoke all of a member's sessions | Owner only, reason required |

Blocking self-revoke of the current session is deliberate: it is one misclick away from ending
your own session mid-task, and the sign-out button already does that intentionally. Being unable
to lock yourself out by accident is worth one extra concept.

## Emergency access removal

Someone lost a device, or left abruptly:

1. **Settings → Team & Seats → their row → Manage → Sign out all devices**, with a reason. Every
   session of theirs dies on its next request.
2. If they should not come back: **Deactivate** in the same drawer. That revokes sessions, frees
   the seat, removes resource access, and keeps every historical record.
3. If it is your *own* device that was lost: **Settings → Security & Devices → Revoke** on that
   row. You stay signed in on the device you are using.

There is no step 4. There is no "remote wipe", no device control beyond ending the AdsOps
session — this product has no such reach and should not claim to.

## Extension sessions

A5's `ExtensionInstallation` registry is separate and unchanged: its own rows, its own
`Check capability`-style revoke from Settings, its own scope-limited token that every dashboard
route already refuses. A9 built a parallel registry for dashboard sessions rather than migrating
the extension's, because a forced migration of a working security mechanism is risk with no
benefit. The Security & Devices page shows both, clearly labelled as separate.

## Limits worth knowing

- Sessions expire on their own at `expires_at` (the token's own lifetime). There is no sliding
  renewal and no refresh token; a long session ends by expiring.
- Revocation is a database fact, so it is as available as the database is. There is no
  in-memory blocklist to get out of sync — and no cache to be stale, either.
- The registry is per workspace. A user who belongs to two workspaces has separate sessions in
  each, and revoking in one does not touch the other.
