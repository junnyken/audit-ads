# P2 CSV missing-value hardening — audit before build

Ngày 2026-11-26. Dành cho người triển khai và chủ sản phẩm.

## Context / Goal

Playbook v2; FEATURES/ARCH/API/TEST_LOG đã được đọc ở lượt kiểm tra P1/P2. Hàm exportCsv trong frontend/src/pages/Accounts.tsx dùng 0 cho sáu cột tiền thiếu và VND cho currency thiếu. Mục tiêu: phân biệt chưa có bằng chứng với số 0 thật trong CSV hiện hữu.

## Quyết định người dùng

Người dùng xác nhận “tiến hành sửa lỗi giúp tôi” sau báo cáo hiện tượng, nguyên nhân, đề xuất sửa và ảnh hưởng bảng tính. Phạm vi là lỗi CSV đã nêu, không mở capability P1 mới hoặc rewrite/export engine mới.

## Constraints

Không đổi DB/API/quyền/cột/tiêu đề/luồng tải file. Giữ raw precision, zero thật, thứ tự fallback balance và currency có sẵn; chỉ thay fallback cuối. Không đổi các fallback hiển thị ngoài CSV. Không deploy production trong lượt sửa. Giữ BOM UTF-8 và CRLF, quoting hiện hữu. Không gom metadata hoặc CSV formula hardening thành scope mới.

## Scope A–E

A Domain: không thay đổi.
B Service: không backend mới.
C API: không thay đổi contract.
D UI/export: sáu cột balance/today/latest-complete-day/last7d/MTD/lifetime thiếu -> —; currency thiếu -> —; không đổi layout/wording.
E Tests: chạy đường export thực qua click/Blob nếu khả thi; missing/null/zero/precision/currency fallback/quoting/BOM/CRLF; regression Accounts/spend, typecheck/build/lint.

## Audit Before Build

Gap data_model/frontend_UX/testing: exportCsv khoảng 659–733 tạo dữ liệu tưởng là đã đo. Main đã chạy biểu thức Node xác nhận undefined và zero cùng thành 0. 67 component tests nền đạt nhưng không chứng minh CSV đúng. Kiểm trạng thái khác như bm_verified không thuộc slice này.

## Design Choice

Sửa fallback cuối tại chỗ trong exportCsv; tái dùng esc và marker —. Không chuyển toàn bộ export thành subsystem mới. Test cần phủ đường được UI dùng, không chỉ bản sao biểu thức.

## Test Plan / Success Criteria

CSV missing không có số 0/VND giả; zero thật vẫn 0; giá trị raw decimal lớn không Number/parseFloat; observed currency ưu tiên configured currency và marker khi cả hai thiếu. Giữ header, số cột, quoting, BOM/CRLF. Test hồi quy và build/typecheck đạt; các giới hạn chưa test phải báo rõ.

Rollback: hoàn nguyên code patch, không dữ liệu cần dọn; chưa deploy/DB migration. Công thức bảng tính phải xử lý marker khi dữ liệu thiếu.
