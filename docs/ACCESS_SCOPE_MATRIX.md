# Access scope matrix (A9)

Who can see and do what. Two independent gates decide every request, and both must pass:

1. **Role gate** — what this role may ever do, regardless of which record is involved.
2. **Resource scope** — which specific Business Managers and ad accounts this member is
   assigned. Only applies to non-owners.

They are genuinely separate. A `viewer` passes the audit-read role gate and can still get a
`404` on an account they are not assigned; an `operator` fails the audit-read gate with a `403`
before scope is ever consulted. Confusing the two is how permission systems end up leaking.

## Roles

This codebase's `WorkspaceRole` enum is `owner`/`admin`/`buyer`/`viewer`/`auditor`, and A9 kept
it rather than renaming to the mini-spec's own vocabulary. The one translation, applied at the
API boundary only (`A9_ROLE_TO_WORKSPACE_ROLE` in `app/services/workspace.py`):

| A9 vocabulary (API, UI, docs) | Stored enum | Notes |
|---|---|---|
| `owner` | `owner` | Global scope. Cannot be invited or assigned through A9 |
| `admin` | `admin` | |
| `operator` | `buyer` | Same role, older name — "buyer" predates A9 |
| `viewer` | `viewer` | |
| — | `auditor` | Pre-A9 role, kept as-is. Not offered by A9's invite or role-change |

## Role gate

| Capability | owner | admin | operator (buyer) | viewer | auditor |
|---|---|---|---|---|---|
| Read registry / readiness / health / alerts | Yes | Yes | Yes | Yes | Yes |
| Mutate registry, readiness, alerts | Yes | Yes | Yes | No | No |
| Read audit history | Yes | Yes | **No** | Yes | Yes |
| Meta connections, A7/A8 batches (read and write) | Yes | No | No | No | No |
| Everything under `/team/…` | Yes | No | No | No | No |
| Own device sessions (`/security/sessions/…`) | Yes | Yes | Yes | Yes | Yes |
| Another member's sessions | Yes | No | No | No | No |

`operator` being excluded from audit-read is a pre-A9 decision (`AUDIT_READ_ROLES`, since A1),
deliberately left alone: A9 must not quietly widen who may read audit history.

## Resource scope (non-owners only)

```
can_view_business_manager(member, bm):
  owner        → true
  otherwise    → an active, non-archived assignment to that BM exists

can_view_ad_account(member, account):
  owner        → true
  otherwise    → an active direct assignment to that account
                 OR an active assignment to the BM the account belongs to
```

Both sets are the **union** — a direct account assignment and a BM assignment add up, they do
not override each other. `visible_ad_account_ids()` returns `None` for an owner ("no filter",
and it costs zero queries) or a concrete set for everyone else, **empty included**: assigned
nothing means nothing is visible, never everything.

An assignment that is `revoked`, `expired` or archived grants nothing, from the next request.

## What inherits the scope, and how

The check lives in `AdAccountRegistryService.get()` — the single place every account-resolving
route already goes through — so these inherit it without their own check:

| Surface | Behaviour for a non-owner |
|---|---|
| `GET /ad-accounts` | Only assigned accounts; `total` counts only those |
| `GET /ad-accounts/{id}` and every `/ad-accounts/{id}/…` sub-route | `404` unless assigned |
| Readiness, health, events, per-account audit history | Same, inherited |
| `GET /alerts`, `GET /alerts/{id}` | Filtered by the alert's `ad_account_id`. An alert with **no** account link is not shown at all — its scope cannot be proven |
| `/meta-connections`, A7/A8 batch endpoints | `403` — owner-only, not scoped |
| `/team/…` | `403` — owner-only |

## Non-disclosure

Out of scope answers **`404`, never `403`**, and the body never names the record. `403` would
confirm the record exists; `404` is exactly what another workspace's record returns. The one
place `403` is correct is a *role* refusal, where nothing about any specific record is revealed.

## Deliberately not built

- **Scoped read-only operation history** for admin/operator/viewer on A7/A8 batches. A batch
  item stores a BM/ad-account *external id* — a string that may not correspond to any local
  record yet, since creating one is the point of a creation batch — so membership scope cannot
  be proven for it. The spec's own rule for that case is to deny the non-owner, so these
  endpoints are owner-only rather than half-scoped.
- **Direct Page/Pixel assignment.** Asset visibility is derived from the BM/ad-account
  relationship, per the mini-spec's non-goals.
- **A global-admin mode** that would let an admin see unassigned resources. The matrix leaves
  room for it; A9 does not introduce one.
