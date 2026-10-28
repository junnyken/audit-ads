# Audit Before Build — Slice C1 & C2: Kiểm soát tiền (Ngân sách cam kết & Cảnh báo tiến độ chi tiêu)

Date: 2026-10-28

## 1. Context & Problem

Agency quản lý nhiều tài khoản quảng cáo cho nhiều khách hàng khác nhau. Ngoài việc đọc số chi tiêu thô từ Meta (S1) và trạng thái tài khoản trên Meta (S2), người vận hành cần:
1. **C1 — Ngân sách cam kết & Tiến độ chi tiêu (`budget_pacing`)**:
   - Ghi nhận tên khách hàng/dự án (`client_name`), ngân sách ngày cam kết (`planned_daily_budget_raw`) và ngân sách tháng cam kết (`planned_monthly_budget_raw`) ngay trên từng tài khoản quảng cáo.
   - Tự động đối chiếu chi tiêu ngày hoàn chỉnh gần nhất (`latest_complete_day`) và chi tiêu lũy kế trong tháng (`mtd_spend_raw`) với ngân sách đã cam kết theo đúng tiền tệ của tài khoản.
2. **C2 — Cảnh báo tiến độ ngân sách (`spend_budget_pacing_drift`)**:
   - Tự động mở cảnh báo (`Alert`) và gửi thông báo Telegram (kèm hồ sơ Facebook đăng nhập `facebook_identities` và checklist xử lý) khi tài khoản:
     - **Vượt ngân sách (`overspending`)**: chi tiêu ngày hoàn chỉnh gần nhất > 120% ngân sách ngày cam kết, hoặc chi tiêu lũy kế tháng > 100% ngân sách tháng cam kết (`WARNING`).
     - **Sắp chạm trần ngân sách tháng (`approaching_monthly_budget`)**: chi tiêu lũy kế tháng đạt từ 90% đến 100% ngân sách tháng cam kết (`WARNING`).
     - **Chi tiêu thấp bất thường so với cam kết (`underspending`)**: chi tiêu ngày hoàn chỉnh gần nhất < 50% ngân sách ngày cam kết (`INFO`).
   - Tự động đóng (`resolved`) cảnh báo khi chi tiêu quay về ngưỡng ổn định (`on_track`) hoặc khi ngân sách được điều chỉnh phù hợp.

## 2. Guardrails & Hard Rules

- **Rule 1 (Không lưu bí mật)**: `client_name` đi qua bộ lọc `_refuse_login_secret` và `StrictPayload` từ chối mọi trường nhạy cảm.
- **Rule 4 (Không đoán dữ liệu thiếu)**: Ngày không có dòng insights (`has_row=False`) không bao giờ được coi là `0`. Không bao giờ quy đổi tỷ giá hoặc cộng gộp khác loại tiền tệ.
- **Rule 5 (Không tô màu xanh/thành công cho trạng thái chưa rõ)**: `unconfigured`, `insufficient_data` và `on_track` dùng tone `neutral`, không bao giờ dùng tone `positive` / màu xanh lá.
- **Rule 6 (Không hứa hẹn an toàn/duyệt)**: Không dùng các từ cấm trong cảnh báo và giao diện.
