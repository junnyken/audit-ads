# Audit Before Build — turning a health rule off

Date: 2026-09-15 · Baseline `9dd851c` · **This is the audit, not the build.**

---

## 1. This is not a missing UI

`FEATURES.md` recorded it as "Rule enable/disable is supported by the schema and engine but has no
UI." The schema does support it — `HealthRuleDefinition.enabled` exists and
`GET /account-health/rules` lists it. The **engine does not**.

```python
def enabled_definitions(self) -> dict[str, HealthRuleDefinition]:
    """Highest enabled version per rule key. A rule with no enabled row stops generating."""
    for row in self.list_definitions():          # global + workspace, version ascending
        if not row.enabled or row.rule_key not in HEALTH_RULES_BY_KEY:
            continue                             # a disabled row is discarded here
        current = chosen.get(row.rule_key)
        if current is None or row.version > current.version:
            chosen[row.rule_key] = row
```

A disabled row never reaches the version comparison. So a workspace that adds an override row
(`v2, enabled=False`) has it discarded, and the **global `v1, enabled=True` still wins** — the rule
keeps running. The docstring's promise, "a rule with no enabled row stops generating", is only true
when no enabled row exists anywhere, and one always does.

Measured 2026-09-15: all **10** definitions in the development database are global
(`workspace_id IS NULL`), `enabled=True`, `version=1`. There is no workspace-scoped row anywhere,
so the override path has never been exercised.

The only other way to turn a rule off is editing the global row — which would change health for
**every workspace**, against rule 8's principle that scope comes from the membership.

## 2. What is already right, and must stay right

Disabling is **not** resolving, and the engine already knows it:

```python
if signal.rule_key not in enabled_rule_keys:
    # A disabled rule stops generating but never erases history (A2 Guardrail 22).
    self._close(signal, status=SignalStatus.EXPIRED, ...
                reason="The rule that produced this signal is no longer enabled.")
```

An open signal from a rule that gets switched off is **expired**, never **resolved**, and says why.
Turning a check off must never look like the problem went away (rules 12 and 16 in spirit). History
is kept. None of that changes.

Rule 13's mandated wording — "No current issues found by **configured** checks" — already
anticipates a workspace whose set of checks is not the full set. Nothing to reword.

## 3. Design

**Engine.** Choose the highest version per rule key **first**, then honour that row's `enabled`.
A workspace override at a higher version then decides, whichever way it points, and a global row
remains the default when no override exists. This is a four-line change with one behavioural
consequence, tested explicitly.

**Write path.** `PATCH /account-health/rules/{rule_key}` with `{"enabled": bool}`:

- **Owner only**, following `POST /account-health/backfill`'s precedent — this changes what every
  member of the workspace is shown, not one account.
- It **never touches the global row.** It upserts a workspace-scoped row for that key at
  `max(version) + 1`, copying the global row's definition. The default stays where it was for
  every other workspace.
- One audit row in the same transaction (rule 3).
- An unknown `rule_key` is a 404, and a key the engine does not implement is refused rather than
  stored — a definition nothing reads would be a setting that silently does nothing.

**Frontend.** The existing rules list gains a toggle per rule, owner-only, with the consequence
stated in words: disabling stops the check from generating and expires its open signals, and does
not mean the underlying problem is gone.

## 4. Out of scope

No new rule types, no per-account overrides, no severity or threshold editing, no rule versioning
UI, no change to how signals are opened, acknowledged or resolved, no readiness change. No
migration — `health_rule_definitions` already has every column this needs.

## 5. Expected changed files

`app/services/health_service.py` (selection), `app/api/v1/routers/health.py` (the PATCH),
`app/schemas/health.py` (request model), tests; `frontend/src/lib/types.ts`, the health rules view,
frontend tests; `FEATURES.md`, `TEST_LOG.md`.

## 6. Risks

- **The engine change alters what an existing deployment evaluates** — but only where a
  workspace-scoped row exists, and none does anywhere today (measured). For every current
  workspace the selection result is identical, and a test pins that.
- **A disabled rule hides a real problem.** That is the point of the feature and the reason the
  wording must stay blunt: the signal expires, it is not resolved, and the history keeps it.
