# P1 Email & Recovery — audit trước triển khai, 2026-11-26

Dành cho chủ sản phẩm và người triển khai. Đây là discovery giới hạn, không phải signoff P0 hoặc đặc tả đã duyệt.

## Tái sử dụng đã đọc trong mã

- backend/app/models/entities.py: PersonalAccountReference hiện là hồ sơ tài khoản Facebook, có workspace_id, owner_member_id, two_factor_method, vault_reference, recovery_note, email_hint và email_ciphertext. Email đầy đủ được bảo vệ bằng vault/PIN theo luồng F1; không phải entity mailbox độc lập.
- backend/app/api/v1/routers/facebook_identities.py: profile, cập nhật email cho owner/admin, reveal-email sau PIN, business links và quản lý PIN đã có. Không tạo route reveal thứ hai hoặc trả email đầy đủ trong list/export.
- backend/app/schemas/registry.py: recovery_note đã có trong create/update/output, giới hạn đầu vào 2000 ký tự. Không dùng free text này thay cho state machine có nguồn/thời gian xác nhận.
- frontend/src/components/facebook/FacebookAccountFormSheet.tsx và frontend/src/pages/FacebookAccountDetail.tsx: form và màn chi tiết đã ghi/hiện recovery_note. Cần audit khả năng dùng lại panel này trước khi thêm màn hình.

Đây là đọc mã có mục tiêu, chưa chứng minh toàn repo không có capability khác; service/RBAC/audit/reminder cần đọc tiếp trước implementation.

## Khoảng thiếu so với P1 trong kế hoạch

Trong model đã đọc chưa có trường chuyên biệt cho nhà cung cấp mailbox, personal/managed, trạng thái recovery cấu trúc, nguồn xác nhận, confirmed_at, review_due_at và lý do pending/blocked. Chưa xác định email recovery cần tồn tại độc lập tài khoản Facebook hay chỉ là thuộc tính profile. Không suy đoán Gmail từ ví dụ trong kế hoạch hoặc email của tài khoản đăng nhập AdsOps.

## Lát cắt kế tiếp đề xuất

Chốt phạm vi metadata và mockup panel trong Assets/identity hiện hữu: owner, provider, personal/managed, unknown/pending/configured/blocked dưới dạng đề xuất chờ nghiệp vụ duyệt; nguồn lời khai thủ công, thời điểm ghi nhận, hạn xem lại và lý do. Các tên state chưa phải enum đã được duyệt. Không hứa chờ một số ngày sẽ mở khóa; lịch nhắc cấu hình qua quản trị. Không migration/API/UI mới ở checkpoint này.

Trước khi chốt mockup cần xác định provider, loại tài khoản, người chịu trách nhiệm và việc quản lý độc lập hay gắn hồ sơ Facebook. Không yêu cầu password/OTP/recovery code; thông báo lỗi dùng bản đã che thông tin cá nhân.

P0 còn thiếu bằng chứng schema/backup/restore/rollback/login và bản deploy từ main mới. Chỉ discovery P1 trong lúc chờ, không vượt gate để release tính năng mới.

## Thực thi và kiểm chứng

Worker native Sol đọc mã kết thúc codex_turn_failed (run e9a60b06ff154be194731328eb55dbc0), không có kết quả được nhận là thành công. Main tiếp tục đọc trực tiếp model, router, các tham chiếu recovery_note/schema/UI nêu trên. Không chạy test, không đổi code/schema/hosting, không tạo stack hoặc gửi dữ liệu ra provider trong audit này.
