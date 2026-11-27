# P1-I1 — release prerequisites (not executed)

2026-11-26. Dành cho người vận hành AdsOps.

Không deploy/migrate từ tài liệu này khi implementation/test còn in progress. Không tạo stack/DB mới. Dùng hai app/URL hiện hữu sau khi đủ gate.

## Trước release

1. Immutable commit đã review gồm cả backend/frontend, cây nguồn sạch và dependency tương thích. Không push main từ working tree cũ còn edits hoặc chạy deploy để test schema.
2. Xác minh DB/schema head thực, volume và artifact rollback; backup mới đã restore drill trên đích cô lập được phép. Chưa có công cụ/đích thì báo blocker, không bỏ gate.
3. Provision contact encryption key theo vault hiện hữu và dedicated email blind-index key/version qua kênh cấu hình bảo mật. Không ghi key ở docs/chat/frontend; không tự lấy JWT key hay plaintext hash làm fallback. Cách config/format cụ thể phải đối chiếu implementation cuối cùng, chưa ghi giá trị ở đây.
4. Khóa đang dùng cho contact/F1 không được tự xoay để làm P1 hoạt động; key mất có thể khiến dữ liệu cũ không giải mã được. Index rotation là thủ tục riêng, không tự thay key/version trên DB có dữ liệu.
5. Rehearse migration additive trên staging chuẩn và kiểm F1 vẫn hoạt động; DB mới/đã có dữ liệu đều cần test. Offline SQL hoặc SQLite không thay PostgreSQL index/lock rehearsal.
6. Đóng D1 review wording/manual UI; contract chốt không có nghĩa mọi copy/viewport đã duyệt.

## Lúc phát hành sau này

Main thực hiện đúng quyền đã có, schema additive trước backend/frontend tương thích; nếu MIGRATE_ON_START được dùng phải tên head đúng, theo dõi migration log và đọc schema lại, không coi readiness xanh là migration pass. Không thực hiện migration trong lượt build nguồn hiện tại.

## Smoke sau release

Đăng nhập thật theo role; owner/admin tạo contact test đúng phạm vi, buyer được giao scoped metadata/reveal, other buyer/viewer/auditor và cross-workspace deny; kiểm audit không lộ contact/ciphertext/index/PIN, If-Match conflict, archive, cache-control/no-store. Các thao tác ghi nghiệm thu chạy staging; production read-only smoke theo phạm vi được giao. Không gửi provider/Telegram hoặc thử email password/OTP.

## Rollback

Rollback artifact tương thích, không downgrade schema/drop bảng hoặc restore đè DB. Giữ dữ liệu và audit. Cả revision 0027 và 0028 từ chối downgrade tự động bằng lỗi có chủ đích, tránh hạ revision marker khi schema vẫn được giữ lại; không dùng `alembic stamp` để bỏ qua chốt này. Nếu key/index sai, chặn các thao tác contact mới thay vì lưu hint/plaintext hoặc chuyển khóa âm thầm. Ghi commit/phiên bản trước/sau và lỗi thực, không khẳng định rollback <1 phút khi chưa đo.

Trạng thái: kế hoạch vận hành chưa được thực thi. App hiện hữu không thay đổi bởi tài liệu này.

## Tên cấu hình đã triển khai ở source

- CREDENTIAL_VAULT_KEY: vault contact/F1 hiện hữu; không tự thay khóa cũ.
- EMAIL_REGISTRY_INDEX_KEY: URL-safe base64 biểu diễn đúng 32 byte, độc lập với vault key; không tự sinh khi thiếu và không dùng JWT fallback.
- EMAIL_REGISTRY_INDEX_KEY_VERSION: số nguyên dương 1..32767; mặc định 1 cho dữ liệu mới. Không tự đổi version/key khi đã có registry data; mixed index version bị chặn lúc create.
- Alembic head source: `0028_email_registry_reminders` (sau `0027_p1_email_registry`). Đây không phải xác nhận schema production.

Các tên trên là cấu hình backend-only, không VITE_/public vars. Không ghi giá trị khóa thật vào repo/chat/log.

## Source batch update: P1-I2

New final head is expected0028_email_registry_reminders after0027 (verify alembic heads before release). Apply both additive migrations before code reading AlertPolicy new column, even when in-app feature defaults off. No production migration executed. Registry policy toggle does not enable Telegram/outbound; owner/admin must choose in-app enabled explicitly after rollout. CSV/lifecycle fixes have no additional DB changes.
