# MOCKUP — A6 Preflight Compliance Gate

> Phần A6 bên dưới là ghi chép lịch sử ngày 2026-09-08; URL/QA cũ chưa được kiểm lại trong lượt P1. Không dùng chúng làm bằng chứng P1 đã publish.

## P1-D1 — Email registry độc lập (2026-11-26)

- Artifact đã dựng: [mở mockup offline](mockups/p1-email/index.html), không cần server, không route production.
- Phạm vi: Gmail cá nhân và Microsoft; email độc lập, danh sách che; owner/admin + người phụ trách được reveal theo cơ chế tương lai, CSV không full address.
- Mỗi màn registry/detail/edit/review là một tệp riêng; luồng chỉ sửa fixture trong bộ nhớ, tải lại/reset phục hồi dữ liệu minh họa.
- Không API/DB/provider, không secret, không persistence; toàn bộ wording mới là đề xuất chờ duyệt.
- Main verification: typecheck/lint test đạt; 4 mockup + 6 F1 = 10 tests passed. Kiểm DOM/script thực, không phải real-browser/viewport/contrast/manual QA. Wording chưa duyệt, P1 schema/API chưa triển khai; xem TEST_LOG.md và P1_D1_REVIEW_CHECKLIST.md.
- Không chạy publish.sh/always-on: giữ phạm vi offline và quy định một beta/TTL mới của tổ chức.


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
