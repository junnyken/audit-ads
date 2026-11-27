# P1 Email — điều kiện bàn giao mockup

Dành cho BA/người thiết kế và người triển khai AdsOps, 2026-11-26.

## Đã chốt

Email độc lập; Gmail cá nhân và Microsoft; Microsoft loại cá nhân/managed chưa mặc định. Dữ liệu chỉ metadata/manual evidence. Không secret, không OAuth/mailbox read/provider automation. Không production UI/schema trước review mockup/wording. Không tạo stack beta mới.

## Bộ màn cần bàn giao

1. Danh sách email: bộ lọc owner/provider/state/review deadline, pagination, email che; không dashboard/chart mới.
2. Panel chi tiết: nguồn/thời gian xác nhận, hành động tiếp theo, liên kết tài sản, lịch sử thay đổi; không lộ email đầy đủ ngoài cơ chế quyền được chốt.
3. Form thêm/sửa metadata: kiểm đầu vào, label/error summary, hủy, review thay đổi trước lưu. Không có ô password/OTP/token/recovery code.
4. Các trạng thái: loading, zero records, no filtered results, read failure + retry, no permission, partial/unknown, validation failure, saving, readback failure.

## Hệ thống thiết kế

Kế thừa frontend/src/tokens.css và index.css; dùng Assets.tsx làm tham chiếu cấu trúc, không copy bộ component mới. Các biến có thật đã đọc: --bg, --surface, --surface-2, --border, --fg, --fg-muted, --fg-faint, --brand, --tone-neutral-*, --tone-caution-*, --tone-attention-*, --tone-info-*. Giá trị RGB space-separated; dùng rgb(var(--token)), không dùng trực tiếp var(--token) như màu CSS hoàn chỉnh. Có .dark. Unknown không dùng positive tone. Không khẳng định WCAG đạt chỉ từ comment trong token file.

## Câu từ và dữ liệu

Mọi wording mới gắn [ĐỀ XUẤT — chờ duyệt], dùng khóa i18n trong implementation. Fixture chỉ dùng trong mockup, gắn nhãn minh họa, không số liệu production. Ví dụ email dùng miền example.com, không email/tên thật. Không gọi trạng thái manual evidence là nhà cung cấp đã xác minh hoặc tài khoản an toàn.

## Kiểm nghiệm thu trước implementation

- Mockup clickable, một màn một file, không chỉ ảnh hoặc mô tả văn bản.
- Kiểm 375/768/1280, keyboard/focus, label/error association và đọc trạng thái.
- Không tiết lộ dữ liệu ở no-permission hoặc lưu fixture thành dữ liệu thật.
- Chốt quyền xem email đầy đủ/export và managed/personal trước schema/API.
- Không bật server preview vô hạn: nếu cần chạy, TTL tối đa 4h, có lệnh dừng, không stack mới. Mockup offline không tự trở thành route production.

Trạng thái: checklist chuẩn bị đã viết; chưa dựng mockup và chưa kiểm UI. Bản kế hoạch tổng thể là ADSOPS_MASTER_PLAN_2026-11-26.md khi hoàn tất review, không coi checklist này là gói handoff đã đạt.
