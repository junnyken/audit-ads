# Checkpoint triển khai CSV — 2026-11-26

Dành cho người vận hành AdsOps.

## Bằng chứng đã đọc lại

- GitHub main: f081c19a9931e0eea0497ae4340f3e4ad4818d58 (git ls-remote).
- Frontend adsops-frontend: v108, triển khai 15:48 +07 ngày 2026-11-26. Build log Source Validation: f081c19a.
- Backend audit-ads-backend: v104, triển khai 15:51 +07 cùng ngày. Build log Source Validation: f081c19a.
- UI https://adsops-app.vibe.tinhgon.xyz/ HTTP200.
- config.js HTTP200, API base https://audit-ads-backend.vibe1.tinhgon.xyz.
- Backend /health/ready HTTP200, status ok và database reachable.
- /api/v1/system/status không đăng nhập HTTP401, kiểm lúc 08:55:58 UTC.

Nguồn production đã có commit vá CSV; không có bằng chứng authenticated CSV download trên bản đang chạy. Không diễn giải readiness thành schema/backup/workflow đều đúng.

## Trạng thái kế hoạch

P0/P2 CSV: bản mã đã deploy, local tests trước commit 643 passed/20 skipped, chưa có live export smoke.
P0 vận hành: schema thực, backup restore drill, rollback artifact và login/RBAC còn chưa xác minh.
P1: người dùng chọn email độc lập, Gmail cá nhân và Microsoft; Microsoft personal/managed chưa được suy đoán. Brief có trong P1_EMAIL_SCOPE_DESIGN_2026-11-26.md. Chưa có schema/API/UI/mailbox integration P1 mới.

Người dùng tự thực hiện push main và redeploy; lượt kiểm này của main chỉ đọc metadata/log/probes và chuẩn bị kế hoạch. Không tạo stack/DB mới, không ghi production, không gọi provider hoặc gửi Telegram.
