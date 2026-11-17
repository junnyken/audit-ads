# Team and seats (A9)

How people get access to this product, and how that access is taken away. This grants nothing
on Meta — see "What this is not" at the bottom.

## Seats

A seat is capacity, not a bill. This product tracks how many active members a workspace may
have and refuses to exceed it; it does not price, charge, or collect anything.

- `seat_used` is **computed live** from the count of active members. It is never a stored
  counter, so it cannot drift out of sync with reality.
- `seat_available = max(seat_limit - seat_used, 0)`.
- **No seat plan configured is a real state, not zero.** `seat_limit` and `seat_available` come
  back as `null`, the UI says so plainly, and invitations cannot be accepted until an owner sets
  a limit. A missing capacity is never guessed at.
- A **pending invitation holds no seat.** The seat is checked at the moment of acceptance, in
  the same transaction that creates the membership, so two people accepting the last seat at
  once cannot both get in.
- The seat limit cannot be lowered below the current active-member count (`409`). Deactivate
  someone first.

## Roles

`owner` · `admin` · `operator` · `viewer` — see `ACCESS_SCOPE_MATRIX.md` for exactly what each
one may do, and for the `operator`↔`buyer` naming note.

`owner` can never be invited or assigned through A9. The invite drawer does not offer it, the
role-change select does not offer it, and the request schema rejects it outright — three layers,
because a UI-only restriction is not a restriction. Ownership transfer needs its own deliberate
process, which this mini-spec does not provide.

## Member lifecycle

```
invited ──accept──▶ active ──suspend──▶ suspended ──unsuspend──▶ active
                      │                     │
                      ├──deactivate─────────┴──▶ deactivated ──reactivate──▶ active
                      │                                          (needs a free seat)
                      └──archive──▶ archived (archived_at set; history kept)
```

| State | Can sign in | Holds a seat |
|---|---|---|
| `invited` | no | no |
| `active` | yes | yes |
| `suspended` | **no** | yes — until you deactivate them |
| `deactivated` | no | no |
| archived (`archived_at`) | no | no |

`archived` is not a fifth status value: it is `archived_at`, the same soft-archive column every
other entity in this codebase uses since A1. One fact, one place.

**Suspending and deactivating both revoke every live dashboard session immediately** — not at
the next token expiry. The person's open tab stops working on its very next request. Both
require a reason, which goes into the audit trail.

**The last active owner is protected.** Downgrading, suspending, deactivating or archiving them
returns `409`. This holds even if they are doing it to themselves.

Nothing here deletes anything. A deactivated member keeps their assignments, invitations,
operation history and audit rows, and the UI never calls them "deleted".

## Assignments

An owner assigns a member to Business Managers and/or ad accounts. The member then sees only
those — plus every ad account under an assigned BM. A direct account assignment and a BM
assignment add up rather than replacing each other.

- Only an **active, non-owner** member can receive one. The owner already has global access, so
  assigning them is refused as meaningless rather than silently accepted.
- A duplicate *active* assignment to the same resource is `409`. A previously revoked one can be
  re-created — that is a new grant, and both rows stay in history.
- Revoking requires a reason and keeps the row. Access disappears from the next request: a
  bookmarked link to a now-unassigned account starts returning the same non-disclosing `404` an
  unrelated workspace's record would.

## Day-to-day

**Add someone:** Settings → Team & Seats → Invite member. Pick a role, create, copy the
one-time link, send it through a channel you trust. See `INVITATION_RUNBOOK.md` — this product
has no email provider, and the link is shown exactly once.

**Someone leaves:** open their row → Manage → Deactivate, with a reason. Their sessions die
immediately, their seat frees up, their history stays.

**Someone lost a laptop:** Manage → Sign out all devices (or revoke the one session from
Security & Devices). Server-side, effective at once — see `SESSION_SECURITY.md`.

**Someone changed team:** Manage → adjust the BM/ad-account assignments. Revoke needs a reason;
the effective-access summary in the same drawer shows the result immediately.

## What this is not

A9 controls access to **AdsOps only**. It does not create, share or manage anything on Meta: no
Meta passwords, no Meta users, no cookies or session material, no browser profiles, no
fingerprinting, no proxy anything. Assigning someone a Business Manager here lets them *see it
in this product*; it grants them nothing on the platform. Meta-side access is a separate,
official-API operation (A7/A8), and those are owner-only.

It is also not billing. `plan_reference` is a descriptive string an operator can use to note
which plan they are on elsewhere. Nothing in this product reads it, prices it, or charges for it.
