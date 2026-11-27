# AdsOps — phát hiện bổ sung có tái hiện, 2026-11-26

Dành cho chủ sản phẩm và người triển khai. Review giới hạn CSV và email async UI, không chứng nhận toàn hệ thống. Không sửa logic app/DB/production trong lượt này.

## 1. Ưu tiên cao — CSV có thể được hiểu thành công thức

Hiện tượng: display_name '=1+1' đi nguyên vào ô đầu của CSV qua nút tải thật.
Nguyên nhân: frontend/src/pages/Accounts.tsx exportCsv khoảng661 chỉ quote delimiter/quote/newline, không phân biệt spreadsheet formula prefix.
Bằng chứng: test component gọi exportAccounts với fixture formula, đọc Blob và xác nhận ô CSV bằng '=1+1'. Không mở Excel/LibreOffice; chưa khẳng định mọi spreadsheet thực thi mọi prefix hoặc khả năng thực thi lệnh. Đây là rủi ro formula injection, không demo tấn công ra ngoài.
Sửa đề xuất: serializer CSV trung hòa text bắt đầu =,+,-,@ và control/whitespace nguy hiểm theo policy được chốt; phân biệt text và numeric raw để không làm hỏng số âm/precision. Kiểm quote/newline/BOM và các ứng dụng bảng tính mục tiêu. Không đơn giản quote CSV rồi gọi an toàn.
Ảnh hưởng: prefix bảo vệ có thể hiện khác khi import và ảnh hưởng công thức; cần chốt contract export và regression riêng.

## 2. Ưu tiên vừa — Xuất thiếu dữ liệu khi nhiều trang

Hiện tượng: API total26,total_pages2,page_size25; click export trang1 chỉ có25 dòng dữ liệu, không lấy trang2. UI tooltip khoảng874 hứa 'đối soát toàn bộ'.
Nguyên nhân: export duyệt rows từ query trang hiện tại (Accounts.tsx khoảng118,199,691); không có vòng pagination/snapshot.
Bằng chứng: test export Blob có26 dòng gồm header+25 dữ liệu, không request page2. Tên file không cảnh báo partial.
Sửa đề xuất: quyết định rõ export trang hiện tại hay toàn bộ phạm vi lọc. Nếu toàn bộ: tải tuần tự có giới hạn, cùng quyền/filter, phát hiện lỗi/thay đổi số lượng/trùng ID, không xuất file 'toàn bộ' nếu partial. Nếu chỉ trang: ghi nhãn/scope/count rõ và đổi tooltip, không giả toàn bộ. Không tự chọn từ nhu cầu chưa đo.
Ảnh hưởng: export toàn bộ tăng request/RAM/thời gian; cần giới hạn và xử lý hủy/lỗi, không thêm backend mass export ngoài scope tự phát.

## 3. Ưu tiên vừa — Request cũ đóng form mới, mất bản nháp

Hiện tượng: tạo A → POST pending → Hủy → mở form B nhập second@example.com → response A resolve → form B bị đóng và mất draft.
Nguyên nhân: EntryForm.tsx khoảng47 gọi onSaved sau await mà không kiểm instance còn mounted; Emails.tsx callback setCreate(false) đóng instance mới. Cancel/close vẫn dùng được trong lúc pending. Hủy UI không đồng nghĩa server request bị hủy.
Bằng chứng: deferred promise mocked API, userEvent click/type trên UI thật, xác nhận draftB tồn tại trước resolveA và không còn sau resolveA. Không HTTP/provider/production write.
Sửa đề xuất: instance/request-generation guard cho callback sau unmount, đồng thời invalidate đúng cache khi mutation server hoàn tất; hoặc thiết kế pending/close rõ. Không chỉ disable Cancel rồi bỏ đường close/navigation. Test cancel/reopen, auth/route change, late success/failure và duplicate submit; không hứa undo mutation đã gửi.
Ảnh hưởng: guard sai có thể để list stale; đóng form không được che việc request server có thể đã thành công. Cần feedback đọc lại phù hợp.

## Phép đo public read-only

Ngày 2026-11-26 khoảng10:09UTC: live200,ready200/database reachable; health có nosniff, X-Frame-Options DENY và CSP; system/status401 khi không auth; openapi.json404; origin frontend thật preflight200 allow-origin đúng, origin untrusted.example400 không allow-origin. Không suy uptime/schema/backup/RBAC live từ các probe này.

## Cách kiểm và giới hạn

Native review run854e52482ec54e96a4a3259ed78bbc90 read-only đưa3 findings; main kiểm source rồi chạy2 file điều tra với test UI/Blob thật. Kết quả33 passed trong8.58s gồm30 ca nền được copy và3 ca characterization lỗi; không cộng33 thành coverage độc lập hoặc báo fix. Không existing assertion weakened. Test điều tra được lưu dưới docs/investigation/ dạng .txt sau chạy để không thêm green tests 'pin lỗi' hoặc copy suite vào regression chính. Khi sửa phải chuyển3 ca mới thành regression assert hành vi đúng và chứng minh fail trước/pass sau.

Chưa kiểm Excel/LibreOffice/browser thật, authenticated live, PG/schema/backup. Không commit/push/deploy hoặc tạo stack mới. Lượt này phát hiện/báo cáo; chưa sửa3 logic trên. Bước ưu tiên đề xuất: khóa policy CSV formula + phạm vi export, sửa stale callback trong lát cắt UI nhỏ; mỗi patch ghi test/rollback riêng.
