# Read-only sync separation — audit before build

2026-11-27. User explicitly requests safe-read-sync → web acceptance → extension → Windows parity → signing/release. This slice separates provider reads from publication/outbound actions, not a promise to bypass provider verification.

Confirmed automation_cron cycle dispatches outbox/Telegram and publishes warmup posts; run-now defaults both flags true, configuration defaults auto sync/warmup true. UI claims sync OK from attempted flag even skipped_no_token. Existing config saved in workspace audit, owner-only write. Need preserve historical records but no automatic external writes in the read-sync path.

Selected contract: cycle read-only at provider boundary, no warmup/publish/outbox/Telegram in cycle. Existing warmup flags retained response false/unsupported; true requests rejected422, no silent success. Fresh sync defaultoff; existing declared sync choice preserved. Owner-only run-now/config, strict allowlist/body bool/int; no config env. Bounded non-overlap by existing advisory locking reused. Last attempt separate last success, partial/notoken/error notsuccess. No new scheduler/DB table. Existing notification dispatcher remains separate, never newly enabled. UI read-sync controls only, load/error disables actions, version-safe existing patterns, i18n.

Tests isolated fake transports/in-memory metadata, no live Meta/provider/productionconfig/run-now. Scope source patch backend service/router and Settings section only; no unrelated key/proxy/AI routes. No migration/deploy in this slice. Signing requires actual certificate; no purchase or fake signature. Full UAT unavailable without securely configured credentials, do not mint tokens/bypass login. Client candidate stays review-only.
