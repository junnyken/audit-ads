# P1-I2 contract addendum — in-app attention only

2026-11-26. User delegates continuing approved plan source while away, no deployment. Audit: AUDIT_BEFORE_BUILD_P1_I2.md.

## Selected implementation

AlertPolicy.email_registry_in_app_reminders_enabled boolean default false, additive0028. Existing outbound enabled/reminder_enabled/Telegram fields retain meaning; no dispatcher integration or delivery rows.

GET/PATCH /api/v1/email-registry/reminder-policy returns/accepts {email_registry_in_app_reminders_enabled:boolean}. Active owner/admin only; PATCH writable/license gate; strict extra/null/string/number rejection. GET missing policy returns false without creating. Same-session audit metadata before_enabled/enabled only, no email/free text. no-store all responses. Generic notification-policy routes remain owner-only.

GET registry list attention=true uses same scope/filters with due<requestUTC, nonarchived, sorted due/id. Off -> empty Page; ordinary overdue remains true independent of toggle. One entry at most once, no persistent reminder objects, no auto state/evidence/health mutation. Due moved/cleared, archive or assignment change alters next read visibility. Buyer only own assigned active role, viewer/auditor denied, owner/admin all current workspace. Pagination/count applied server side. Unknown provider account kind not inferred.

UI admin toggle reads back server state; failure not replaced with false/success. Allowed users can select attention filter; config scope and query caches isolate user/workspace/role. Explicit in-app/manual meaning; no email full address/CSV/PIN or first outbound send. No ack/snooze/quiet-hours counters in read-derived view. Browser/system push and recurring external reminders intentionally absent.

## Acceptance and limits

Standalone tests cover defaultoff/role/validation/audit rollback/workspace/UTC cutoff/pagination/idempotency/reschedule/archive/no outbound mutation. UI tests owner/admin readback, deny others config, error vs false, filter query/page reset, authscope. PG migration/locks/UAT/manual browser remain pending. Migration must be applied before app code reads new AlertPolicy column, including existing alert-policy paths. Defaultoff is not safe to deploy without schema. App rollback retains column; no data purge/down-v/production write in this source step.
