/** Wording proposal; preserves manual review and provider verification boundaries. */
export const safeGuideVi = {
 'guideSafe.title': 'Hướng dẫn vận hành có kiểm chứng',
 'guideSafe.description': 'Kiểm tra nguồn dữ liệu, quyền và kết quả thực tế trước mỗi thao tác.',
 'guideSafe.retired': 'Các hướng dẫn cũ về thời gian ngâm, tăng độ tin cậy, đổi môi trường hoặc tự xử lý xác minh không còn được dùng làm tiêu chí vận hành. Dữ liệu lịch sử không bị xóa.',
 'guideSafe.access.title': '1. Kiểm tra tài khoản và quyền',
 'guideSafe.access.body': 'Dùng tài khoản được tổ chức cấp quyền, kiểm tra đúng workspace và tài sản. Chỉ cấp quyền cần thiết qua quy trình chính thức. Không lưu mật khẩu, cookie, khóa xác thực hoặc mã khôi phục trong ghi chú hay gói tiện ích.',
 'guideSafe.review.title': '2. Đọc dữ liệu và giới hạn',
 'guideSafe.review.body': 'Phân biệt dữ liệu nhà cung cấp với thông tin tự ghi nhận; xem thời điểm cập nhật, tiền tệ, phạm vi tải và lỗi đọc. Chưa có bằng chứng phải giữ chưa xác định, không thay bằng số 0 hoặc trạng thái thành công.',
 'guideSafe.changes.title': '3. Xem trước và xác nhận thay đổi',
 'guideSafe.changes.body': 'Dùng API được cho phép hoặc tự thao tác trên trang chính thức. Kiểm tra đối tượng, quyền và nội dung thay đổi trước khi xác nhận; đọc lại kết quả và lịch sử. Không coi mở trang, gửi yêu cầu hay tăng bộ đếm là bằng chứng thao tác đã hoàn tất.',
 'guideSafe.recovery.title': '4. Khi gặp lỗi hoặc yêu cầu xác minh',
 'guideSafe.recovery.body': 'Dừng tác vụ liên quan, lưu mã lỗi đã che thông tin nhạy cảm và làm theo hướng dẫn chính thức. Không lặp đăng nhập, đổi dấu vân tay hay thay mạng để né kiểm tra. Việc xem lại theo lịch chỉ là nhắc việc, không bảo đảm truy cập hoặc khôi phục.',
 'guideSafe.links': 'Đi tới quy trình liên quan',
} as const
export const safeGuideEn: Record<keyof typeof safeGuideVi, string> = {
 'guideSafe.title': 'Evidence-based operations guide',
 'guideSafe.description': 'Check data provenance, permissions and actual outcomes before acting.',
 'guideSafe.retired': 'Legacy instructions about warmup periods, trust increases, environment changes or automated verification handling are no longer operational criteria. Historical records are not deleted.',
 'guideSafe.access.title': '1. Verify account and permissions',
 'guideSafe.access.body': 'Use organizationally authorized accounts and verify the workspace and asset. Grant only required permissions through official workflows. Never store passwords, cookies, authentication keys or recovery codes in notes or extension packages.',
 'guideSafe.review.title': '2. Inspect data and limits',
 'guideSafe.review.body': 'Separate provider data from manual records; check observation time, currency, loaded scope and read errors. Missing evidence stays unknown, not zero or success.',
 'guideSafe.changes.title': '3. Preview and confirm changes',
 'guideSafe.changes.body': 'Use authorized APIs or manually operate the official website. Verify the target, permissions and change before confirming; read back the result and history. Opening a page, sending a request or incrementing a counter does not prove execution.',
 'guideSafe.recovery.title': '4. Handle errors and verification requests',
 'guideSafe.recovery.body': 'Stop affected tasks, retain redacted error references and follow official guidance. Do not repeat logins or change fingerprints or networks to evade checks. A scheduled review is a reminder, not a promise of access or recovery.',
 'guideSafe.links': 'Related workflows',
}
