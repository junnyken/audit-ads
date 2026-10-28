# Audit Before Build — F2: Cảnh báo chỉ thẳng chỗ sửa

Ngày: 2026-10-28. Theo `MINI_SPEC_PLAYBOOK.md` v2. Kế hoạch mẹ: `docs/PLAN_AGENCY_V2.md`.

## Context

Sau đợt F1, mỗi tài khoản quảng cáo đã biết những hồ sơ tài khoản Facebook nào quản lý nó (trực tiếp hoặc đi qua
Business Manager). Tuy nhiên khi có sự cố (tài khoản bị hạn chế/vô hiệu hoá, chi tiêu tăng/giảm bất thường, sắp chạm
giới hạn chi tiêu...), người vận hành nhận tin nhắn Telegram hoặc mở Trung tâm cảnh báo (`/alerts`) vẫn phải tự bấm
sang trang tài khoản quảng cáo để tra xem ai giữ tài khoản Facebook nào và cần làm những bước gì.

Đợt F2 giải quyết dứt điểm câu hỏi đó ngay trên mỗi dòng cảnh báo, trong ngăn kéo chi tiết cảnh báo, và trong tin
nhắn Telegram gửi ra.

## Audit — đã có gì (đọc code ngày 2026-10-28)

| Thành phần | Đã có | Còn thiếu cho F2 |
|---|---|---|
| `FacebookIdentityService.identities_for_accounts` (`services/facebook_identities.py`) | Suy ra danh sách hồ sơ FB (`id`, `label`, `owner_member_name`, `two_factor_method`, `vault_reference`, `email_hint`, `via`, `role`) cho một tập `AdAccount` chỉ với tối đa 3 câu truy vấn cố định | Chưa được gọi ở `GET /api/v1/alerts`, `GET /api/v1/alerts/{id}` hay `NotificationPlannerService` |
| `AlertRow` & `alert_detail` (`routers/alerts.py`, `schemas/alerts.py`) | Trả thông tin tài khoản quảng cáo, mức độ, trạng thái, lịch sử gửi thông báo và `recommended_next_step` (1 câu ngắn) | Chưa có `facebook_identities[]` và chưa có `remediation_checklist[]` (các bước xử lý cụ thể theo từng loại sự cố) |
| `MessageInputs` & `render` (`services/notification_templates.py`) | Allowlist строг cho tin nhắn Telegram `a3-v1`, chống chèn dòng mới (newline injection), cắt độ dài ≤ 3500 ký tự | Chưa có dòng `Login to fix:` chỉ rõ hồ sơ FB, người giữ, 2FA, chỗ cất mật khẩu và dòng `Checklist:` |
| Giao diện `Alerts.tsx` & `AlertDrawer.tsx` | Bảng danh sách cảnh báo và ngăn kéo chi tiết 4 thao tác (Ghi nhận, Tạm tắt, Bật lại, Xử lý) | Bảng chưa có cột *Tài khoản FB* (bấm 1 bước mở hồ sơ FB); ngăn kéo chưa có khối *Đăng nhập để xử lý* (`LoginToFixPanel`) và *Checklist xử lý sự cố* |

## Design Choice

### A. Domain & Data

- Không cần tạo bảng hay migration mới: dùng trực tiếp quan hệ F1 (`PersonalAccountReference` và
  `PersonalAccountBusinessLink`) thông qua `FacebookIdentityService.identities_for_accounts`.
- Checklist xử lý sự cố (`remediation_checklist`) được định nghĩa tĩnh, tất định (deterministic) trong
  `backend/app/services/alert_rules.py` theo `rule_key` và `source_type`.

### B. Service & Telegram Template

1. **Checklist xử lý theo loại sự cố (`remediation_checklist_for_alert`):**
   - Mỗi `rule_key` (ví dụ `account_restricted_status`, `account_disabled_status`, `platform_account_status_blocking`,
     `platform_account_status_pending`, `spend_change_vs_baseline`, `spend_cap_approaching`,
     `spend_observation_missing_or_stale`, `spend_currency_mismatch`, `critical_account_event_open`,
     `mandatory_readiness_evidence_missing`, ...) ánh xạ tới danh sách 3 bước hành động cụ thể `[ĐỀ XUẤT — chờ BA duyệt]`.
   - Tuân thủ tuyệt đối luật 6: không hứa hẹn an toàn, không dùng từ ngữ kiểu "được bảo vệ", "an toàn", "sẽ được duyệt".
2. **Tin nhắn Telegram (`MessageInputs` & `render`):**
   - Mở rộng `MessageInputs` với hai trường allowlist có mặc định rỗng:
     - `login_identities: tuple[dict, ...] = ()` — mỗi phần tử chỉ giữ `label`, `owner_member_name`,
       `two_factor_method`, `vault_reference`, `via`, `role`. **Không** đưa `email_hint` hay email đầy đủ vào tin
       Telegram.
     - `remediation_checklist: tuple[str, ...] = ()`
   - Trong `render(inputs)`:
     - Thêm dòng `Login to fix: Đăng nhập <label> (người giữ: <holder>, 2FA: <2fa>, chỗ cất: <vault_reference>)`
       (hoặc báo chưa nối hồ sơ FB nếu danh sách rỗng).
     - Không dùng từ tiếng Anh `"password"` trong nhãn template để tuân thủ test ghim bảo mật
       `test_the_outbound_message_carries_no_secret_and_no_stack_trace`.
     - Thêm dòng `Checklist: 1) ... 2) ... 3) ...` đã qua `sanitise()`.

### C. API (`GET /api/v1/alerts` & `GET /api/v1/alerts/{id}`)

- `GET /api/v1/alerts`:
  - Gọi `FacebookIdentityService.identities_for_accounts` một lần cho toàn bộ các `AdAccount` xuất hiện trong trang
    hiện tại (tối đa 3 truy vấn SQL cho cả trang, không bị N+1).
  - Bổ sung `facebook_identities: list[AccountIdentityOut]` và `remediation_checklist: list[str]` vào từng phần tử.
- `GET /api/v1/alerts/{id}`:
  - Bổ sung `facebook_identities: list[AccountIdentityOut]` và `remediation_checklist: list[str]`.

### D. Giao diện (`Alerts.tsx`, `AlertDrawer.tsx`, `LoginToFixPanel.tsx`)

- `LoginToFixPanel.tsx`: hiển thị thêm chỗ cất mật khẩu (`vault_reference`) — nếu là URL `https://` thì hiện liên kết
  mở trực tiếp, nếu là chữ thường (ví dụ `Bitwarden → Agency/FB2`) thì hiện dòng chữ.
- `Alerts.tsx`: thêm cột **Tài khoản FB** (`facebook_identity`) vào bảng cảnh báo (bật mặc định), cho phép bấm **1
  bước** mở thẳng `/facebook-accounts/{id}` và thấy ngay người giữ, 2FA, chỗ cất.
- `AlertDrawer.tsx`: hiển thị khối **Đăng nhập để xử lý** (`LoginToFixPanel`) và khối **Checklist xử lý sự cố**
  (`remediation_checklist`).

## Success Criteria

- Từ bất kỳ dòng cảnh báo hoặc ngăn kéo cảnh báo nào của tài khoản quảng cáo, người vận hành biết ngay cần đăng nhập
  tài khoản Facebook nào, ai giữ, 2FA gì, chỗ cất ở đâu và mở được hồ sơ trong **≤ 1 bước bấm**.
- Tin nhắn Telegram cho cảnh báo tài khoản hiển thị dòng `Login to fix:` và `Checklist:`, đi qua allowlist và vượt qua
  toàn bộ bộ test bảo mật (`test_alert_security.py`) cũng như giới hạn hiệu năng (`test_alert_performance.py`).
