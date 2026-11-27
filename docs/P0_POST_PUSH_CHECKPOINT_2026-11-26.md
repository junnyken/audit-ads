# AdsOps — checkpoint sau push main, 2026-11-26

Dành cho người vận hành và người tiếp tục triển khai.

## Phạm vi đã giao

Tiếp tục kế hoạch ADSOPS_UPGRADE_PLAN_2026-11-26.md, giữ nguyên hai app/URL/DB hiện hữu, không tạo stack mới. Người dùng đã tự push commit P0 lên main; xác minh bằng git ls-remote, không chỉ dựa vào ảnh terminal.

## Bằng chứng mới

- Remote main và fix/p0-hardening-20261126 cùng ở 98f68807ab37326a62f42876adf93d151611022c.
- Vibe Host metadata lúc kiểm sau push vẫn là backend v102 (deploy 2026-11-26 14:45 +07), frontend v106 (2026-11-23 19:27 +07). Backend v102 đã được kiểm log source trước đó: 3f886e69. Chưa có bằng chứng lượt dựng mới từ 98f6880.
- Backend /health/ready trả HTTP200, status ok, database reachable. Không chứng minh revision/schema hoặc backup.
- OPTIONS /api/v1/auth/login với Origin https://adsops-app.vibe.tinhgon.xyz trả HTTP200 và access-control-allow-origin đúng origin đó, đo 2026-11-26 07:59:47 UTC.
- Chưa có live-test credentials, không bỏ qua auth để kiểm thử.

## Việc tiếp theo theo thứ tự

1. Kiểm schema thực tế 0026_v52_security_and_verification, backup/restore và artifact rollback. Thiếu thì giữ NO-GO, không bấm redeploy chỉ để có phiên bản mới.
2. Sau khi các gate đạt, redeploy backend rồi frontend hiện hữu từ main. Không cần đổi nhánh nữa. Log source phải chỉ đúng 98f6880 hoặc SHA hậu duệ đã được review rõ.
3. Chạy đăng nhập/RBAC/đọc tài sản/audit theo tài khoản hợp lệ; không Meta write, không gửi Telegram thật, không pytest trỏ DB production.
4. P1 chỉ tiếp tục discovery mô hình metadata có sẵn trong lúc P0 bị chặn. Chưa migration/API/UI mới trước khi chốt scope, mockup và wording theo kế hoạch.

## Bảo mật / giới hạn

Ảnh terminal người dùng gửi có lộ token quản trị hosting. Đã cảnh báo thu hồi và cấp lại qua cấu hình bảo mật; không sao chép giá trị vào báo cáo. Chưa có bằng chứng token đã được thu hồi.

Không có production write, redeploy, migration hoặc stack/DB mới trong checkpoint này. Tài liệu là bằng chứng đo giới hạn, không chứng nhận P0/P1 hoàn tất. Những ghi chép trước lúc push nói main còn ở 3f886e69 là lịch sử; trạng thái remote mới được xác minh ở trên.
