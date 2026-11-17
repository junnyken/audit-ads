# Audit Before Build — scheduled health evaluation

Date: 2026-09-15 · Baseline `2497cb3` · **This is the audit, not the build.** No product code was
changed to produce it.

---

## 1. The gap, stated precisely

`FEATURES.md` records it as: health is recalculated on mutation and on request, so an untouched
account's evaluation ages and is then reported as `unknown`/stale — correct, but staleness is
*surfaced* rather than *prevented*. Nothing sweeps.

Measured in the development database on 2026-09-15: two snapshots exist, both last evaluated
**2026-09-14 06:15–06:16Z**, when the accounts were imported. Nothing has re-evaluated them since,
and nothing will. With `health_evaluation_stale_after_hours = 24` they have now crossed that line
with no process that would notice.

## 2. What already exists

| Piece | State |
|---|---|
| `app/commands/evaluate_health.py` | works; bounded batch; orders by `AdAccount.updated_at ASC`; run by hand |
| `app/commands/run_dispatcher.py` | a bounded loop container, already deployed in `docker-compose.production.yml` |
| `OperationalRunService.record()` | every dispatcher pass is recorded, so "it stopped" is visible rather than silent |
| `AccountHealthEvaluationService.evaluate_account_safe()` | the SAVEPOINT-wrapped path (rule 15) |
| `EvaluationTrigger.SCHEDULED_RECALCULATE` | the trigger value already exists |
| `operational_runs.kind` | `varchar(32)`, **no check constraint** — a new kind needs no migration |

So the mechanism is almost entirely present. What is missing is the part that decides *which*
accounts are due, and something that calls it on a clock.

## 3. Deviation — `next_evaluation_due_at` is a column nothing writes

`AccountHealthSnapshot` declares `next_evaluation_due_at`. Grepped: **zero references** in
`health_service.py` or `health_engine.py`. Measured: `None` on both real snapshots.

It looks like the obvious field to schedule from, and it is not usable — using it would mean first
building the thing that populates it, which is new behaviour in the health engine and outside a
"wire up a sweep" slice (guardrails: no new health algorithm). Recorded as a follow-up, not fixed
here.

**The sweep will therefore select on `last_evaluated_at` against
`health_evaluation_stale_after_hours`**, which is the same threshold the read path already uses —
so the sweep and the display agree by construction rather than by coincidence.

## 4. Rule 28 applies directly

"Never run" is a distinct state from "stale" everywhere it is reported. An account with **no
snapshot at all** has never been evaluated; an account whose snapshot has aged is stale. Both are
due, for different reasons, and the run summary must count them separately rather than adding them
together — otherwise the first sweep of a fresh workspace reports a large "stale" number that is
not stale at all.

## 5. Design

One new pass inside the existing dispatcher loop, on its own cadence — **not** a second container.
The dispatcher's own docstring gives the reason: the deployment targets available here run
containers and give no host-unit access, and "one mechanism that works everywhere beats three that
each work somewhere."

- `OperationalRunKind.HEALTH_SWEEP` — new enum member, no migration (§2).
- `health_sweep_every_n_passes` — a setting, following `dispatcher_recovery_every_n_passes`
  exactly; `0` disables the sweep, which is the default, so **an existing deployment gains nothing
  it did not ask for**.
- `health_sweep_batch` — bounded per workspace, like every other pass here.
- Selection: accounts with no snapshot, or `last_evaluated_at` older than the configured threshold,
  oldest first, bounded.
- Each pass recorded through `OperationalRunService.record()` with
  `{never_evaluated, stale, evaluated, failed, due_remaining, workspaces}`.
- Failure of one account must not end the pass; failure of the pass must not end the loop — both
  patterns already exist in `one_pass()` and are reused rather than reinvented.

## 6. What this must not do

Rule 11: health must not write a readiness state — `evaluate_account_safe()` is the existing path
and is not modified. Rule 15: evaluation stays inside its SAVEPOINT. Rule 21: alert derivation stays
nested inside that. Rule 12/16: a sweep acknowledges nothing and resolves nothing. No advertising
platform is contacted — this re-reads stored records only.

## 7. Expected changed files

`app/core/enums.py` (one member), `app/core/config.py` (two settings),
`app/commands/run_dispatcher.py` (the pass and its cadence),
`app/services/health_service.py` **only if** a selection helper belongs there rather than in the
command, plus tests, `.env.example`, `ARCH.md`, `FEATURES.md`, `TEST_LOG.md`.
**No migration.**

## 8. Risks

- **A sweep that runs everywhere by default would change a deployed system silently.** Hence
  default `0` (off), and a release note rather than a surprise.
- **A large workspace could be swept repeatedly without finishing.** The batch is bounded and the
  summary reports `due_remaining`, so "the sweep is not keeping up" is visible instead of silent.
- **The threshold is shared with the display.** If someone lowers
  `health_evaluation_stale_after_hours`, both the sweep and the badge move together — intended, and
  worth stating so it is not later "fixed" into two settings.

## 9. Explicit confirmations

No new health algorithm, no readiness change, no Meta call, no Telegram send, no deployment, no
migration, no schema change, no scope/authorization change, no O3.1 work.
