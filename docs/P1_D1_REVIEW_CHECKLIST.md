# P1-D1 — checklist review từng luồng

Dành cho PO/BA và người kiểm thử mockup. Ngày 2026-11-26.

Không nhập dữ liệu thật. Dùng fixture minh họa; lưu chỉ trong bộ nhớ, không xem là provider xác minh.

| Mã | Thao tác | Kết quả cần thấy | Trạng thái |
|---|---|---|---|
| D1-01 | Mở index.html offline | Banner mockup/wording đề xuất, danh sách che địa chỉ | Chờ kiểm |
| D1-02 | Lọc provider/owner/state/hạn | Chỉ fixture phù hợp, bỏ lọc phục hồi dữ liệu | Chờ kiểm |
| D1-03 | Tìm không có kết quả | Thông báo riêng, không nói lỗi dữ liệu | Chờ kiểm |
| D1-04 | Chọn loading/error/empty/partial | Mỗi trạng thái khác nhau; retry giữ bộ lọc | Chờ kiểm |
| D1-05 | Chọn no-permission, mở detail deep link | Không render dữ liệu danh sách/chi tiết | Chờ kiểm |
| D1-06 | Detail → edit → nhập invalid | Error summary/inline, focus đúng ô | Chờ kiểm |
| D1-07 | Edit → review → back | So sánh trước/sau, giữ draft, chưa thay dữ liệu | Chờ kiểm |
| D1-08 | Hủy sửa | Không thay bản ghi và không thêm history | Chờ kiểm |
| D1-09 | Save fixture → detail | Đọc lại giá trị, history minh họa, không provider success | Chờ kiểm |
| D1-10 | Reset/refresh | Fixture gốc, không persistence | Chờ kiểm |
| D1-11 | Nhập markup vào lý do | Hiện text, không thực thi HTML/JS | Chờ kiểm |
| D1-12 | Sáng/tối, keyboard/skip link | Focus thấy được, route heading được focus | Chờ kiểm |
| D1-13 | 375/768/1280 và zoom | Không tràn/mất hành động, đọc được form/bảng | Chưa kiểm browser |
| D1-14 | Kiểm mã + spy network/storage | Không API/provider/fetch/XHR/cookie/storage | Chờ kiểm |

Kết quả tự động ghi riêng trong TEST_LOG.md; không tự đánh dấu các mục browser/contrast/manual từ jsdom. D1 không gồm auth/RBAC backend thật, migration hay production UAT.
