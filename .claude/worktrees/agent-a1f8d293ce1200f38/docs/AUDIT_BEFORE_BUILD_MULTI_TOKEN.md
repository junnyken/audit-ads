# Audit Before Build — a reader credential per Business Manager ("đường B")

Date: 2026-09-14 · Baseline: `6fb4759` (O1.1 shipped, first real import done)

**This is the audit, not the build.** No production code was changed to produce it.

---

## 1. The question this slice answers

Today one system-user token reads every Business Manager. A connection pointed at
`109796697343603` honestly reports `0 · Unknown`, because that token has no role in that business.
The A10.3 audit recorded the token axis as unanswered and said so plainly; partner sharing (the
"đường A" tried on 2026-09-14) does not answer it either, for a reason that is now measured rather
than assumed — see §3.

## 2. Verified baseline

```
app/core/config.py:66   meta_access_token: str = ""      # one token, server config only
app/core/config.py:85   meta_business_id: str = ""       # one default BM
Settings.model_config    env_file=".env", extra="ignore", case_sensitive=False
```

Three places read the token, and only one builds a provider:

| Place | What it does |
|---|---|
| `meta_real_provider.build_real_provider()` | the only construction of a real transport |
| `meta_operations._provider_for()` (line 75) | the only caller of the above |
| `meta_operations._serialize_connection()` | `token_configured` — a boolean, never the value |

`MetaConnection.business_manager_reference` already stores which BM a connection reads, set at
creation and never updated. **No new column is needed for this slice.**

Blast radius of changing token resolution: four test files mention `build_real_provider` or
`token_configured` (`test_a10_meta_real_provider.py`, `test_a7_meta_operations_api.py`,
`test_a4_api.py`, `test_a4_operations.py`).

## 3. Why "đường A" cannot answer the question — measured, not assumed

Every read discovery makes is on the **BM node itself**:

```
meta_real_provider.py:307   transport.get(f"{business_id}/system_users", …)   # authority
meta_real_provider.py:328   transport.get(f"{business_id}/{edge}", …)         # owned_ad_accounts,
                                                                              # client_ad_accounts,
                                                                              # adspixels
```

Partner sharing grants access to *assets*, not membership of the *business*. A token holding
shared assets from BM 2 still cannot read `109796697343603/owned_ad_accounts` or
`109796697343603/system_users`; those accounts instead appear under BM 1's `client_ad_accounts`.
So a connection pointed at BM 2 would keep reporting `0 · Unknown` even if partner sharing
succeeded — which is the honest answer, not a defect.

## 4. Constraint discovered: the obvious field name is illegal here

`SENSITIVE_NAME_FRAGMENTS` in `core/redaction.py` forbids any request field whose **name**
contains `token`, `secret`, `credential`, `api_key`, `access_key`, `authorization`, `session`,
`password`, `cookie`, or the proxy fragments. `StrictPayload` rejects the whole request if one
appears.

So `credential_alias`, `token_ref` and `access_key` are all refused by construction. Any design
that puts a *name for a credential* in a request body has to pick a word outside that list —
which is a smell worth heeding rather than a rule worth routing around.

## 5. Designs considered

| # | Design | Verdict |
|---|---|---|
| 1 | `META_ACCESS_TOKEN__<alias>` read via `os.environ` | **Rejected.** Pydantic loads `.env` itself; `os.environ` would not see it, so local dev and production would resolve differently — the worst class of configuration bug |
| 2 | Numbered slots `META_READER_1_ALIAS` / `_TOKEN` | **Rejected.** Bounded and explicit, but two variables per reader and an alias column in the database, for no gain over #4 |
| 3 | Alias column on `meta_connections`, resolved at call time | **Rejected.** Needs a migration, a new API field, and a field name chosen to dodge §4. The database would learn a fact it does not need |
| 4 | **Map keyed by Business Manager id, in server configuration** | **Chosen** |

## 6. The chosen design

One new setting, parsed by pydantic from a JSON environment variable:

```python
meta_access_tokens_by_business: dict[str, str] = {}
# META_ACCESS_TOKENS_BY_BUSINESS={"109796697343603":"<token>"}
```

Resolution, in `build_real_provider`:

1. An entry for this connection's Business Manager id → use it.
2. Otherwise → `META_ACCESS_TOKEN`, exactly as today.

**Additive by construction.** Nothing changes for any existing connection until a key is
configured. A workspace that configures nothing behaves bit-for-bit as it does now.

**No fallback in the other direction, and no cross-use.** A BM's own entry always wins; the
default is never preferred over it. What the design deliberately does *not* do is refuse the
default token for an unmapped BM: a system user can legitimately hold assets across businesses,
and refusing to try would remove access that works today.

**The response says which reader answered**, never the token:
`"reader_source": "business_specific" | "server_default" | "none"`. `token_configured` becomes
per-Business-Manager accurate instead of one global boolean — today it answers "the server has *a*
token", which is not the question the operator is asking on a connection card.

Rule 1 holds unchanged: the value lives only in server configuration. It never reaches the
database, an API response, an audit row, a log line or the frontend bundle. The setting's own name
contains `token`, so the existing redaction catches it if it ever reaches a log — a property worth
keeping rather than renaming away.

## 7. Expected changed files

`app/core/config.py`, `app/services/meta_real_provider.py` (resolution + `reader_source`),
`app/api/v1/routers/meta_operations.py` (`token_configured`, `reader_source`),
`app/core/production_checks.py` (a placeholder or empty mapped value is a finding),
`frontend/src/lib/types.ts`, the connection card and the workspace Overview, plus tests and docs.
**No migration.**

## 8. Risks

- **A JSON blob in one variable.** Rotating one Business Manager's token means rewriting the whole
  value, and a hosting panel's env editor can mangle quoting. Documented in the runbook; the
  production check catches an empty or placeholder entry rather than letting it start silently.
- **A wrong key is invisible.** A token filed under the wrong BM id would be used to read that BM
  and would simply fail the authority gate — honestly, but confusingly. `reader_source` on the
  response is what makes it diagnosable.
- **This slice grants no access by itself.** It only lets a credential that already has access be
  used for the right business. Someone still has to create a system user inside BM 2 and generate
  its token in Business Settings.

## 9. Explicit confirmations

No token is accepted through the API, stored in the database, logged, or returned. No new write
capability. No migration. No change to discovery, coverage, authority or reconciliation logic. No
deployment, ingress change, Telegram send or secret configuration performed by this slice.
