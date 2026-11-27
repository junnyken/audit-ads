# Runbook — Email & Recovery thao tác thủ công

Dành cho người phụ trách email và quản trị workspace. 2026-11-26. Runbook không tự thực hiện thao tác nhà cung cấp, không bảo đảm khôi phục/đăng nhập hoặc mở khóa.

## Dùng trong AdsOps P1

1. Đăng nhập AdsOps theo tài khoản được cấp. Owner/admin quản lý registry; buyer chỉ email được giao. Viewer/auditor không truy cập trong bản đầu.
2. Email mới tạo ở trạng thái unknown. Gán người phụ trách có quyền trước khi ghi attestation. Provider/kind là lời khai có căn cứ, không phải DNS/provider verification.
3. Nếu cần xem địa chỉ đầy đủ, dùng PIN của chính người xem; không nhập password email, OTP, recovery code hoặc TOTP seed vào AdsOps. Đóng hộp thoại khi xong. Không gửi địa chỉ đầy đủ/PIN qua chat/log/audit/export.
4. Người phụ trách tự mở trang quản lý tài khoản chính thức và làm theo yêu cầu của nhà cung cấp. Không dùng automation, xoay proxy, thay fingerprint hoặc tìm cách vượt kiểm tra thiết bị/CAPTCHA.
5. Chỉ ghi metadata tối thiểu: thời điểm quan sát, trạng thái manual, lý do/việc tiếp theo không chứa secret, hạn xem lại và múi giờ. Không dán toàn bộ thông báo có email/số điện thoại/OTP vào ghi chú.
6. pending = chờ thao tác thủ công, blocked = trở ngại được báo, recorded = đã ghi nhận thủ công, unknown = chưa có attestation hiện tại. Không trạng thái nào có nghĩa nhà cung cấp đã xác minh hay tài khoản an toàn.
7. Xem lại thay đổi trước lưu; sau lưu đọc lại giá trị và lịch sử. 409/428: tải lại bản ghi, không bấm lưu lặp hoặc ghi đè bản mới. Không rõ kết quả thì giữ chưa xác nhận.
8. Hạn xem lại là thời điểm người phụ trách chọn, không lịch bảo đảm mở khóa. Reminder tự động chưa thuộc I1, không hứa notification đã có.

## Gmail cá nhân — nguồn đã kiểm

Nguồn chính thức đã đọc 2026-11-26: https://support.google.com/accounts/answer/183723?hl=vi

Mở Tài khoản Google → Bảo mật và đăng nhập → Số điện thoại khôi phục/Email khôi phục, rồi làm theo hướng dẫn trên trang. Khi Google không cho sửa, tài liệu gợi ý dùng thiết bị/vị trí thường đăng nhập hoặc thử lại tuần sau trên thiết bị hiện tại. Đây là hướng dẫn có điều kiện, không bảo đảm ngày nào cũng mở được. Một số thay đổi số điện thoại có thể mất đến 7 ngày để có hiệu lực; không hardcode mốc này thành rule hoặc trạng thái success trong AdsOps.

Tài khoản đang mất quyền truy cập/đang khôi phục có thể không cho thêm thông tin. Không biến recorded trong AdsOps thành kết luận recovery thành công. Gmail cá nhân không có quyền quản trị Workspace áp dụng thay.

## Microsoft — giới hạn nguồn hiện tại

Phải xác định personal hay tài khoản tổ chức bằng thông tin hợp lệ; nếu chưa rõ giữ unknown. Tài khoản tổ chức cần người quản trị được cấp quyền của tổ chức, không suy rằng admin AdsOps là admin Microsoft.

Trong lượt này, hai URL tài liệu support được thử trả 404 và search không trả nguồn dùng được; vì vậy chưa ghi quy trình/chu kỳ chờ cụ thể. Người phụ trách truy cập cổng Microsoft quen thuộc của tài khoản và làm theo prompt chính thức, không theo link trong thông báo đáng ngờ. Trước khi phát hành hướng dẫn chi tiết Microsoft cần kiểm lại URL/tài liệu hiện hành và ghi ngày kiểm. Không dùng thời gian nhớ được làm chính sách.

## Escalation / bảo vệ dữ liệu

Không có quyền/không rõ provider/type → giữ unknown và nhờ chủ tài khoản/quản trị có thẩm quyền. Secret đã lộ → thu hồi/đổi qua nhà cung cấp/kênh bảo mật, không chỉ xóa screenshot. Khóa mã hóa/index của AdsOps mất/sai → dừng thao tác contact liên quan và làm theo runbook vận hành, không lưu plaintext hoặc thay khóa cũ tùy tiện.

## Tình trạng nghiệm thu

Runbook là phần tài liệu P1-I2 chuẩn bị, không phải reminder implementation hay UAT đã đạt. P1-I1 mới source-only, chưa release; staging/schema/backup/restore/live role workflow còn chưa xác minh. Không migration/production write/stack mới được thực hiện từ runbook này.
