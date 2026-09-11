# Invitation runbook (A9)

Inviting someone, and what to do when it goes sideways.

## Before you start

**No email is sent.** This product has no email provider configured, and A9 deliberately did not
add one — that is a deployment decision with its own credentials and its own approval, not
something a feature should quietly switch on. What you get instead is a **one-time link**, shown
once, that you pass on through a channel you already trust.

You also need a **seat plan**. Without one, capacity is unknown, and an invitation cannot be
accepted (`409`, saying exactly that). Settings → Team & Seats → Seat plan → set a limit.

## Invite someone

1. Settings → **Team & Seats** → **Invite member**.
2. Email, and a role: Admin, Operator or Viewer. Owner is not offered, and the API rejects it
   even if a request is crafted by hand.
3. The drawer shows how many seats are free right now — a forecast, not a reservation. The seat
   is checked again when they accept.
4. **Create invitation** → the link appears once. Copy it and send it. Closing the panel loses
   it for good: only a hash is stored, so nobody, including an owner, can retrieve it later.

The invitation expires in **7 days**.

## What the recipient does

**They have never used this product:** open the link, choose a password (8+ characters),
accepted — they are signed in immediately, no separate login step.

**They already have an account here** (for example they are already in another workspace): they
must **sign in first**, then open the link. Accepting anonymously is refused with a `401`
telling them to sign in. This is on purpose: without it, anyone who knew a colleague's email
address and got hold of an invitation could try a password against their existing account.

Either way the email must match the invitation exactly. A different signed-in user opening the
link is refused.

## Common situations

**"They never got it / lost the link."**
→ Team & Seats → Invitations → **Resend**. This issues a genuinely new token and kills the old
one immediately, rather than re-sending the same secret. Copy and send the new link.

**"I invited the wrong person / wrong role."**
→ **Revoke** (a reason is required), then invite again with the right details. A revoked link
stops working at once.
Inviting the same email again also supersedes any still-pending invitation automatically, with
an audit record, so you cannot end up with two live links for one person.

**"The link says the invitation is expired / revoked / already accepted."**
→ That is the token being single-use and time-limited, working as intended. Resend or create a
new invitation.

**"Acceptance is blocked, no seat available."**
→ Raise the seat limit, or deactivate someone who has left. The check happens at acceptance
precisely so a stack of pending invitations cannot quietly consume your capacity.

**"They accepted but see nothing."**
→ Expected. A new member has no assignments, and a non-owner sees only what they are assigned.
Open their row → Manage → add the Business Managers or ad accounts they need. The effective
access summary in that same drawer shows the result. See `ACCESS_SCOPE_MATRIX.md`.

**"Someone who used to be here is coming back."**
→ Invite them again. Accepting reactivates their original membership row rather than creating a
duplicate, so their history stays attached to them.

## What is never in the invitation

The link carries a random one-time token and nothing else. No workspace secrets, no Meta
connection details, no API tokens, no account credentials, no payment details, no internal audit
data. The stored row keeps only a hash of the token plus its last four characters, which is what
the invitations table shows so you can tell two of them apart.

Audit records for invitations record the email, the role and those last four characters —
never the token itself or its hash.

## If you later add real email

Sending an invitation by email is an external communication, which this project treats as its
own deliberate action: it needs a configured provider, a resolved recipient, and explicit
approval — not a config flag flipped in passing. Until then, the one-time link is the delivery
mechanism, and it is honest about being one.
