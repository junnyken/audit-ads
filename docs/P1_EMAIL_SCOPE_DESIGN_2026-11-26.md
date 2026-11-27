# P1 độc lập — quyết định phạm vi và brief thiết kế

Dành cho chủ sản phẩm, BA và người triển khai. Ngày 2026-11-26.

## Quyết định trực tiếp của người dùng

- Email được quản lý độc lập, không chỉ là thuộc tính tài khoản Facebook.
- Nhà cung cấp trong phạm vi: Gmail cá nhân và Microsoft.
- Microsoft chưa được mặc định là Microsoft 365 managed: thiết kế phải phân biệt tài khoản cá nhân và tổ chức quản lý; chưa biết thì giữ unknown.
- Quyền đã chốt sau brief: owner/admin và người được giao phụ trách trong workspace được xem địa chỉ đầy đủ qua cơ chế xác nhận được thiết kế ở D2; list che, CSV không chứa email đầy đủ. Mockup D1 không giả lập authentication hoặc chứa địa chỉ thực.

## Brief

Sản phẩm: công cụ vận hành AdsOps hiện hữu. Người dùng: người phụ trách tài sản và quản trị workspace.
Ba việc chính: tìm email cần xử lý; biết nguồn/thời điểm xác nhận; ghi nhận kết quả thao tác thủ công.
Dữ liệu: bảng email + panel chi tiết/form; không chart/KPI mới.
Stack: React/TypeScript/Tailwind/Radix/Lucide hiện có; tiếng Việt; kế thừa theme sáng/tối; mật độ dày dữ liệu.
Giới hạn: không password/token/cookie/OTP/TOTP seed/backup code, không tự đăng nhập Google/Microsoft, không Gmail OAuth/mailbox integration, không tạo beta/DB mới.

## Hướng thiết kế được chọn

Tái sử dụng bố cục Assets, thành phần bảng/form/dialog và token AdsOps; thêm nhóm Email độc lập, không biến PersonalAccountReference thành mailbox giả và không tạo trùng luồng F1 reveal-email. Dùng repo làm nguồn component/font/icon chính; không nhập thư viện/tài nguyên bên ngoài trong brief này.

Token: dùng semantic background/surface/text/border/status/focus đang có, font Be Vietnam Pro và mono hiện có, spacing theo thang dự án; không chốt mã màu tùy ý. Unknown không mang styling thành công.

Danh sách: email được che, provider, loại tài khoản, owner, trạng thái ghi nhận, nguồn/thời điểm xác nhận, hạn xem lại, hành động tiếp theo. Panel cho chi tiết, lịch sử và liên kết tài sản. Địa chỉ đầy đủ phải theo quyết định bảo vệ dữ liệu tương đương luồng vault/PIN hiện hữu; chưa mở thêm đường reveal hoặc export email đầy đủ.

## Wording/state đề xuất — chờ duyệt

Các nhãn và trạng thái dưới đây là đề xuất, không phải enum đã triển khai:
- Chưa xác minh; Chờ người phụ trách; Đã ghi nhận thiết lập; Bị chặn.
- Nguồn: người phụ trách tự xác nhận. Không gọi là xác minh bởi Google/Microsoft.
- Đã ghi nhận thiết lập không đồng nghĩa tài khoản an toàn, đăng nhập được hoặc nhà cung cấp chấp nhận khôi phục.
- Nhắc việc dựa trên hạn người dùng chọn/cấu hình quản trị, không hardcode ngày bảo đảm mở khóa.

## Trạng thái mockup phải có

- Đang tải: skeleton cùng cấu trúc bảng.
- Rỗng: không email và không kết quả lọc là hai trạng thái riêng.
- Lỗi: giữ bộ lọc, nút thử lại, không đổi thành bảng rỗng.
- Không quyền: không lộ email/owner ngoài phạm vi; backend là lớp bảo vệ chính.
- Một phần: chỉ rõ trường chưa biết, không tự suy provider/loại/account state.
- Form: label, validation inline/error summary, hủy không ghi, xem lại thay đổi trước lưu; đọc lại kết quả và lịch sử sau lưu.

## Prompt cho bước mockup tiếp theo

Dựng mockup clickable riêng cho Email registry/panel bằng component/token hiện hữu, đủ sáu trạng thái ở trên. Không gọi backend/provider, không dữ liệu cá nhân thật, mọi fixture gắn nhãn minh họa. Không chứa secret hoặc form nhập secret. Không thay đổi navigation production trước khi review. Hạn chế một màn mỗi file, không server sống nền vô hạn, không tạo stack mới.

## Kiểm thử và giới hạn

Mockup cần review 375/768/1280px, bàn phím/focus/label, unknown không xanh, lỗi/rỗng/partial/no-permission. Sau khi chốt mockup và wording mới viết MINI-SPEC schema/API/RBAC/audit/secret guard và test migration trên đích staging được xác minh. Không tự reset DB production.

Brief này chưa phải mockup hoàn thành, chưa thiết kế schema/API endpoint, chưa chạy QA UI và chưa triển khai P1. P0 schema/backup/restore/login còn thiếu bằng chứng độc lập; không bị miễn bởi brief này.
