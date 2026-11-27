# P1-D1 · Email độc lập (đề xuất chờ duyệt)

Mở `index.html` trực tiếp bằng `file://`. Không cần server hoặc cài dependency. Classic scripts nạp `screens.js` rồi `app.js`; không fetch fragment.

Sau khi sửa `screens/*.html`, chạy tại repo root:

```sh
node docs/mockups/p1-email/build.mjs
cd frontend
npm test -- src/test/p1-email-mockup.test.ts --maxWorkers=2 --minWorkers=1
```

Giữ `screens.js` được sinh cùng fragments trong gói bàn giao. Test đọc artifact có sẵn, so sánh với fragments và chạy script thực qua jsdom; không ghi file trong test.

Bố cục kế thừa Assets: header, nhóm lọc, bảng dày dữ liệu, card chi tiết và form. `tokens.css` là snapshot nguyên giá trị từ `frontend/src/tokens.css`; `design-system.css` dùng semantic RGB tokens, tất cả selector được giới hạn `.ds-*`. Font `Be Vietnam Pro` dùng nếu máy đã cài, fallback system; không tải font. CSS chuyển bảng sang card ở màn nhỏ và hỗ trợ reduced motion. Unknown/recorded dùng neutral, không biểu đạt provider success.

Dữ liệu example.com và người phụ trách A/B đều hư cấu. Mốc hạn là **2026-11-26 giả lập**, không phải đồng hồ thực. Tìm kiếm/lọc/phân trang, retry, metadata owner/state/due/reason, review/back/cancel/save/history/reset và theme chỉ dùng bộ nhớ; tải lại trang phục hồi fixture. Chọn demo đọc lại lỗi ở review để kiểm thử saving/readback/retry. Không thêm email, không reveal, CSV, API, auth, secrets hoặc persistence. Chính sách reveal dự kiến owner/admin + assignee chỉ được giải thích, không giả lập bảo mật. Không hardcode thời gian mở khóa.

Đã thiết kế skip link, focus route/visible, label và error summary liên kết inline, bảng semantic. jsdom kiểm chứng DOM và tương tác, không phải trình duyệt thực. **Chưa kiểm** viewport 375/768/1280, keyboard thực, screen reader, tương phản hoặc khả năng tương thích `file://` trên từng trình duyệt; không có Chromium/Playwright/Selenium QA. Đây chưa phải phê duyệt wording, schema/API/RBAC hoặc production.
