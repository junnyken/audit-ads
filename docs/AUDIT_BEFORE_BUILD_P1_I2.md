# P1-I2 — in-app review attention / audit before build

2026-11-26. User requests remaining plan source work autonomously, no deploy (user deploys later). Scope: configurable IN-APP overdue email attention, no outbound scheduler/messages/provider integration.

## Context / goal

Reuse EmailRegistryService listing/RBAC/UTC overdue and existing AlertPolicy workspace DB storage. Existing reminder_enabled is outbound and must not change meaning. Alert Center ad-account visibility does not model registry assignment; do not force email alerts into it or create another engine/outbox.

## Chosen contract amendment

- Add AlertPolicy.email_registry_in_app_reminders_enabled Boolean default/server_default false, additive0028 after0027. No env feature config.
- Registry-only GET/PATCH /email-registry/reminder-policy, owner/admin active only. GET absence reports false without creating row; PATCH strict single boolean, lock+write/license+atomic audit. Admin cannot alter outbound settings. Reuse AlertPolicy storage/service create defaults, not generic team/policy RBAC widening. Version precondition for policy use registry workspace lock serializes setting; no claims full multi-client policy version feature.
- Registry list supports attention=true. If policy off -> empty scoped Page; if on -> due<same request UTC instant, active nonarchived entries, assigned-buyer scope or owner/admin all. Other filters apply, count before pagination, order due asc/id asc. No extra event rows or deliveries per item; repeated reads never duplicate attention. Badge overdue still independent of config.
- Return page attention metadata only via existing masked ListOut; no full address/free text/provider or PIN. Existing list_read audit plus safe config update/read audit (no plaintext).
- Registry UI has admin-only config toggle/readback and attention-only filter for allowed users; explanatory wording proposal i18n. No alert bell/unseen count pretending notification was sent. On/off/refetch updates list; changing due/archive/resassign updates visibility at next read, never changes manual state/evidence or health. No ack/snooze/quiet hours/interval in this slice.
- Use existing emailRegistry i18n module, no new libraries/charts. UI errors do not default on/off false after read failure. Default off explicit and admin action required.

## Tests / limits / rollback

Standalone SQLite/API extends fixture with AlertPolicy table: default off, owner/admin toggle vs buyer/viewer/auditor deny, strict extras, inactive workspace/seat, audit rollback, no outbound changes. attention cutoff null/boundary/UTC/pagination/duplicate refresh/scope, reschedule/archive/reassign clear without state mutation. UI mocks toggle/readback failures/no unauthorized requests/attention params. PG migration/locking/UI browser remain unverified. No production/DB reset/new stack. Rollback app, additive column remains, no destructive downgrade.
