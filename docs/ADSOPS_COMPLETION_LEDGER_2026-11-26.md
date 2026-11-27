# AdsOps — completion ledger / phần còn lại

Dành cho chủ sản phẩm và người triển khai, 2026-11-26. Không thay thế bằng chứng test hoặc release signoff.

| Phần | Trạng thái hiện tại | Còn lại để đóng |
|---|---|---|
| P0 sửa source | Đã lên production f081c19 gồm P0+CSV theo checkpoint trước | Authenticated workflow, schema thực, backup/restore/rollback và credential rotation chưa xác minh |
| P1-D1 mockup | Offline artifact, 4 DOM tests + F1 regression; không production | Manual browser/viewport/keyboard/wording review |
| P1-D2 contract | Đã chốt field/state/RBAC/audit, user chọn limited roles | Retention/key lifecycle và operational policy trước release |
| P1-I1 source | Model/migration0027/service/API/UI local; backend79, frontend676/20skip từ lượt trước | PG migration/locks/races/staging/UAT; key provisioning; secure release |
| P1-I1 privacy follow-up | Review độc lập xác nhận 403/404 existence leak, main sửa lookup scope; backend79 pass30.17s | Production chưa chạy P1; cần PG/UAT sau khi có đích |
| P1-I2 runbook | Đã viết RUNBOOK_EMAIL_RECOVERY_MANUAL.md; Google source đọc lại | Microsoft nguồn chưa xác minh; reminder admin/engine chưa triển khai |
| P2 CSV | Đã deploy, tests Blob/precision/missing đã có | Live authenticated CSV và audit metadata/formula risk chưa hoàn tất |
| P2 attention/reporting | Có capability nguồn hiện hữu | Đo tác vụ thật và chọn gap, không rewrite/metric giả |
| P3 release P1 | Chưa thực hiện | Các gate staging/backup/schema/auth/keys/rollback đạt rồi mới deploy cùng URL |

## Đích/quyền đã kiểm trong lượt tiếp tục

Vibe Host list_stacks chỉ trả audit-ads hiện hữu, không có staging riêng được xác minh. Docker filter adsops/audit-ads không có container phù hợp. Workspace không có biến ADSOPS/STAGING/VIBE/DATABASE/PGHOST liên quan (chỉ in tên biến, không giá trị). Không suy toàn hệ thống không có staging từ phạm vi listing này. Main không dựng stack/DB khác để bù thiếu đích.

## Chuỗi thao tác khi có đúng đích

1. Quản trị hiện hữu xác định shared staging thật: endpoint, DB/schema/volume, owner và phương án backup. Không chỉ dựa domain/label.
2. Cấp tài khoản test role theo cấu hình an toàn, không chat. Xác minh credential/token lộ đã revoke/rotate.
3. Provision vault/index key an toàn; không tự đổi vault key đang dùng. Rehearse migration additive 0027 và PG concurrency/role/audit tests trên staging đúng đích.
4. UI authenticated/bundle và mockup wording/manual QA, provider runbook nguồn chính thức, cleanup dữ liệu test.
5. Chốt immutable commit nguồn sạch và backup restore/artifact rollback; main deploy app hiện hữu theo quyền. Không tự nâng scope quyền khi harness chặn.
6. P1-I2 reminder: audit engine/admin configuration hiện hữu, chốt từng slice; không hardcode unlock days hoặc bật gửi thật theo suy diễn.

Không gán thời hạn hoàn thành khi hạ tầng/quyền chưa có; không nhận test SQLite thay PG hoặc nguồn HTML thay test browser. Các phần source/docs có thể tiếp tục không cần production secret, nhưng không thể hoàn tất mọi gate vận hành từ workspace hiện tại.

## User-delegated source completion batch (no deploy)

User explicitly chose to handle deployment later while delegating source fixes and plan continuation. CSV formula protection/full-filter pagination and stale mutation callbacks are being completed with negative controls. P1-I2 selected minimal default-off in-app attention with admin DB configuration, no outbound engine/dispatcher/notifications. This replaces earlier ledger statement that reminder source was not started; final verification pending in AUTONOMOUS_SOURCE_COMPLETION_2026-11-26.md.

P2 existing attention/report/spend remains reuse-first. No new market-copy dashboard, automatic ads writes or fake time-saving metrics. After source batch, outstanding tasks are environment-dependent PG/staging/auth/backup/key/manual UI/provider-source gates; these cannot be marked done while user is away or replaced by deploy. P3 release is explicitly deferred to user, not permission for an agent to bypass production classifier.

## Final delegated source batch — 2026-11-26

User requested3fixes+continue plan and explicitly deploy later. Main final backend registry+reminder isolated suite100passed35.58s; ruff app+tests pass. Frontend full706passed/20unchanged skipped,50passed/1skipped files,74.32s; typecheck/build/lint chainexit0,0errors10existing Hooks warnings. Single Alembic head0028, offline0026:headSQL through0027/0028 generated; no PG migration. Focused60 not added to706. Lifecycle negative control2failed after guards removed then restored; actual Blob CSV tests cover formula/numerics/full pagination/errors/cancel/scope.

Three issues fixed source: spreadsheet text protection, all-filtered-page bounded export/no partial file, canceled request instance isolation+original-scope cache refresh. P1-I2 implemented defaultoff admin-configurable derived in-app attention using AlertPolicy; no dispatcher/outbound/Meta/Microsoft/Google automation, no new stack/DB. Reminder worker failed codex_turn_failed, main independently reviewed/tested; CSV worker completed, main final suite verified. Initial combined44pass2fail mock-policy shape corrected, assertions kept.

No commit/push/deploy/production migration. StagingPG/races/auth/backup/restore/key/retention/manual UI/wording/real spreadsheet/provider Microsoft source and measuredP2workflow remain unverified; P3deploy deferred by user. See FINAL_SOURCE_BATCH_HANDOFF_2026-11-26.md; do not mark full operational plan complete from local tests.

## Additional migration verification — 2026-11-27

Main added tests/test_p1_migration_parity_standalone.py: invokes actual Alembic upgrade functions in PostgreSQL offline context and compares DDL with SQLAlchemy model compilation (0027 full table and0028 column). No engine/DB connection. Initial3pass1fail exposed0028 no-op downgrade silently allowing revision marker to move while column retained. Changed downgrade to deliberate RuntimeError consistent with0027/application-only rollback; no destructive schema change. Runbook current head corrected to0028.

Combined isolated registry/reminder/parity104passed34.85s. Expanded lint initially found42trailing-whitespace issues in0027SQL, then formatting-only cleanup; final ruff app+3tests+0027/0028 passed, migration parity4passed0.67s after cleanup. Full frontend706/20skip belongs previous source batch, not rerun because no frontend logic changed here. No PostgreSQL migration/staging/UAT/production/write/deploy/new stack or DB. Key/auth/staging config still unset. This closes source DDL parity/rollback-guard checks, not operational rehearsal.
