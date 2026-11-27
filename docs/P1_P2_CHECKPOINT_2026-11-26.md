# P1 check / P2 audit checkpoint — 2026-11-26

Dành cho chủ sản phẩm và người triển khai AdsOps.

## Deployment đã xác minh lại

Vibe Host metadata: backend v103 (15:10 +07), frontend v107 (15:18 +07), cùng ngày 2026-11-26. Source Validation của cả hai phiên bản ghi 98f68807, đúng commit P0. Hai app/URL/DB hiện hữu được dùng lại; không tạo stack mới. API readiness HTTP200/database reachable, config.js frontend trỏ https://audit-ads-backend.vibe1.tinhgon.xyz.

Bằng chứng này thay thế checkpoint trước push/deploy về revision; không chứng minh schema đúng, backup restore được hay đăng nhập/RBAC live đạt. Các phần đó vẫn chưa xác minh.

## Kiểm tra P1 hiện hữu

P1 Email & Recovery mới chưa được triển khai. Đã đọc PersonalAccountReference và luồng F1 có owner, encrypted/masked email, PIN reveal và recovery_note. Chưa chốt provider/personal/managed hoặc email độc lập với hồ sơ Facebook. Không coi test F1 là nghiệm thu tính năng P1 mới. Chưa thêm schema/API/UI hoặc state recovery.

## Test thực chạy

Từ frontend:

    npm test -- --maxWorkers=2 --minWorkers=1 src/test/f1.facebook-identities.test.tsx src/test/accounts-spend.test.tsx src/test/spend.test.tsx src/test/u1b.overview-accounts.test.tsx

Kết quả: 4 files passed, 67 tests passed, exit0, 12.51s. Có React Router future flag warnings. Đây là component/unit regression local, không phải login production, API/DB integration hoặc test bundle đang chạy.

## P2 audit — CSV đang có lỗi biểu diễn dữ liệu thiếu

Capability đã có: Accounts exportCsv, spend summary theo currency, freshness never/stale/current. Không cần dựng engine song song.

Hiện tượng: frontend/src/pages/Accounts.tsx, exportCsv (khoảng 659–733), balance/today/latest complete day/last7d/MTD/lifetime dùng ?? '0', currency dùng observed_currency || currency || 'VND'; thiếu dữ liệu có thể thành 0/VND giả. Một số metadata khác cũng ánh xạ thiếu thành trạng thái phủ định, cần review riêng nếu mở rộng slice; không tự gộp mọi cột.

Main chạy kiểm tra biểu thức Node: undefined ?? '0' và '0' ?? '0' đều cho '0'. Đọc nguyên hàm xác nhận fallback nằm trong đường tạo CSV thật. Chưa tái hiện tải CSV bằng browser/blob, chưa có regression CSV riêng; 67 tests xanh không phủ định finding này.

Đề xuất lát cắt hẹp: giữ số 0 và raw precision thật; dùng marker thiếu dữ liệu đã có ('—') cho sáu cột số và currency khi không có bằng chứng. Không thêm cột, wording UI, service, endpoint hoặc migration. Kiểm escaping CSV, null/undefined, zero, raw decimal lớn, nhiều tiền tệ và compatibility bảng tính. Ảnh hưởng: công thức bảng tính từng coi thiếu là số 0 cần xử lý marker rõ ràng. Không schema/data migration; rollback bằng code artifact trước.

Theo stop rule phát hiện lỗi mới: đã báo hiện tượng/nguyên nhân/sửa đề xuất/ảnh hưởng trước khi code. Chưa sửa CSV hoặc mở nhiều MINI-SPEC trong lượt. Chờ quyết định lát cắt cụ thể; audit P2 không phải P2 hoàn tất.

Không deploy/write DB/provider call/Telegram send hoặc tiến trình app nền trong lượt này.
