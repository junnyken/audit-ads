# MOCKUP — A6 Preflight Compliance Gate

## Live mockup
- URL: https://audit-ads-mockup.b.matbao.ai
- Responsive: https://audit-ads-mockup.b.matbao.ai/__device/
- Nguồn sửa: `~/workspace/factory/audit-ads/mockup/` (sửa file → refresh, không cần build)
- Cập nhật: 2026-09-08

## Màn hình
| Màn | Đường dẫn | Ghi chú |
|---|---|---|
| Danh sách Draft | `#/preflight-list` | Bảng + bộ lọc (search/trạng thái/account/has_blocking_findings/archived), stats theo verdict |
| Soạn thảo Draft | `#/preflight-editor` | Identity, Copy, Landing page, Creative reference (link ngoài), Budget, Targeting |
| Chi tiết Draft | `#/preflight-detail` | Tabs Overview/Findings/Landing Page Evidence/Evaluation History/Audit History + nút "Chạy đánh giá" thủ công |

## Luồng chính đã click thử
1. Tạo draft → Lưu & chạy đánh giá → chuyển sang màn chi tiết, tab Overview hiện verdict bằng ngôn ngữ không khẳng định thay Meta.
2. Tab Findings → Ghi nhận 1 finding (bắt buộc nhập lý do) → không tự đổi trạng thái draft.
3. Lưu trữ draft từ bảng danh sách → modal nêu rõ có thể khôi phục, không có "xóa vĩnh viễn" (đúng rule không hard-delete của A1–A6).

## Có chủ đích chưa đưa vào mockup này
- Tích hợp side panel Extension (A6 §6.G) — quyết định có làm đợt này hay để riêng nằm ở bước audit-before-build, chưa mockup.
- Màn Account Detail (đã có từ A1) thêm tab "Preflight drafts liên kết" — chỉnh sửa nhỏ trên màn có sẵn, không mockup lại toàn bộ Account Detail ở đây.

## Câu hỏi mở cho BA
- Ngưỡng % thay đổi ngân sách mặc định 50% có cần cấu hình theo workspace không, hay cố định trong code?
