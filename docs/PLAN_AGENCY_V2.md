# Kế hoạch v2 — AdsOps cho Agency: dùng được thật trước, rồi quản lý tài khoản Facebook

Ngày lập: 2026-10-28. Theo `MINI_SPEC_PLAYBOOK.md` v2. Thay thứ tự Phase 3+ của `ROADMAP_COMMERCIAL.md`
(Phase 0–2 ở đó đã xong: S1, S2, O3, O4, U1).

## Context

- Người dùng làm **agency**: 4 tài khoản Facebook, mỗi tài khoản 4 BM, mỗi BM khoảng 2 tài khoản quảng cáo. Sẽ còn
  tăng lên.
- Hai yêu cầu chính (2026-10-28):
  1. **Dùng được thật.** Cài Meta song song với việc code.
  2. **Biết tài khoản FB nào quản lý BM nào**, để khi có sự cố thì biết đăng nhập vào đâu mà sửa. Người dùng muốn lưu
     cả **email, mật khẩu, 2FA** trong tool.
- Đo ngày 2026-10-27:
  - Production chạy được: frontend `adsops-app.vibe.tinhgon.xyz`, backend `audit-ads-backend.vibe1.tinhgon.xyz`,
    schema ở bản 0018, dispatcher quét chi tiêu mỗi giờ.
  - Chưa có biến O4 nào trên panel.
- Đo trong code ngày 2026-10-28:
  - `meta_reader_credentials` lưu `provider_user_name`.
  - Với cấu hình **System User**, ô đó là tên system user do Meta tạo, **không phải** tài khoản FB thật.
  - Nghĩa là hôm nay tool **không biết** BM nào thuộc tài khoản FB nào.

## Goal

1. Đọc được thật 16 BM trên production.
   - Số chi tiêu và trạng thái **khớp với Ads Manager** khi người dùng đối chiếu.
   - Có cảnh báo khi tài khoản quảng cáo bị khoá.
2. Mỗi tài khoản quảng cáo và mỗi cảnh báo trả lời ngay câu hỏi: *"đăng nhập tài khoản FB nào để sửa, ai giữ nó, 2FA
   ra sao, mật khẩu cất ở đâu"*.

## Constraints

- **Luật 1 giữ nguyên: tool không lưu mật khẩu, mã 2FA (seed/TOTP), cookie hay phiên đăng nhập Facebook.** Lý do
  nằm ở quyết định D1 bên dưới.
- Luật 7 giữ nguyên: không proxy, không trình duyệt tự động. Tool đọc Meta qua API chính thức. Proxy không giảm
  rủi ro bị đánh dấu.
- Không hứa "không bị đánh dấu". Tool giúp **biết sớm** và **xử lý nhanh**. Việc Meta khoá hay không phụ thuộc cách
  chạy quảng cáo và cách người thật đăng nhập.
- Mỗi đợt có audit trước khi build (`docs/AUDIT_BEFORE_BUILD_*.md`), người dùng duyệt, rồi mới code.

## Quyết định cần người dùng chốt

### D1 — Lưu mật khẩu và 2FA ở đâu (đề xuất: **trình quản lý mật khẩu**, tool chỉ lưu *chỗ cất*)

| | (a) Tool lưu email, mật khẩu, 2FA | (b) **Đề xuất**: password manager (Bitwarden hoặc 1Password Teams) + tool lưu hồ sơ |
|---|---|---|
| Khi sự cố | Mở tool là thấy mật khẩu | Tool hiện "FB2, cất ở Bitwarden → *FB2 – Nguyễn A*". Mở Bitwarden là có mật khẩu và mã 2FA |
| Nếu tool bị hack | Mất **toàn bộ** tài khoản FB của agency, và sau này cả của khách mua tool | Kẻ xâm nhập chỉ thấy tên và ghi chú |
| Bán cho khách | Phải giữ mật khẩu Facebook của khách. Rủi ro pháp lý lớn, khách cẩn thận sẽ không mua | Bán được: tool không giữ bí mật của khách |
| Chia quyền nhân viên | Phải tự xây: mã hoá, nhật ký xem mật khẩu, thu hồi | Password manager đã có sẵn: chia theo nhóm, nhật ký, thu hồi khi nhân viên nghỉ |
| Ổn định tài khoản FB | Không hơn | Không kém |

Password manager có sẵn mã 2FA (TOTP), chia sẻ theo nhóm và nhật ký truy cập. Đó chính là các tính năng agency cần,
và nó đã được kiểm định bảo mật nhiều năm. Phương án (a) phải sửa luật 1 và xây lại toàn bộ phần đó, nhưng kém an
toàn hơn.

### D2 — Hồ sơ có lưu email đăng nhập không

Đề xuất **có, dạng che một phần** (ví dụ `ng***@gmail.com`). Email không phải mật khẩu, mà giúp nhận ra tài khoản.

### D3 — Thứ tự các đợt

Đề xuất: P0 (song song) → F1 → F2 → F3 → F4, theo thứ tự bên dưới.

## Các đợt

### P0 — Dùng được thật (song song, người dùng làm phần Meta)

| Bước | Ai | Kiểm bằng |
|---|---|---|
| Cấu hình app Meta cũ: Login for Business System User, redirect URI, vai trò cho 4 FB | Người dùng | — |
| Đặt 5 biến O4 + chuyển `META_ACCESS_TOKEN` sang dạng secret, rồi redeploy | Người dùng | Agent đọc `list_env` và `/operations/configuration` (chỉ mã lỗi) |
| Kết nối 16 BM, đặt *Tên gợi nhớ* theo mẫu `FB2 – Nguyễn A – BM Shop XYZ` | Người dùng | Thẻ quyền ghi *Đang đọc được* |
| Bật tự khám phá và nhập (O3) trên từng kết nối | Người dùng (duyệt riêng) | Tài khoản quảng cáo hiện trong danh sách |
| **Đối chiếu**: 3 tài khoản bất kỳ, so chi tiêu, giới hạn chi tiêu và trạng thái với Ads Manager | Người dùng + agent | Ghi kết quả thật vào `TEST_LOG.md` |
| Nhập chat Telegram, duyệt **một** lần gửi thử | Người dùng (duyệt riêng, luật 22) | Tin nhắn đến nơi |

Xong P0: tool **dùng được** cho chi tiêu và tình trạng tài khoản.

### F1 — Hồ sơ tài khoản Facebook (khoảng 1–1,5 ngày)

- **A. Domain:** bảng mới `facebook_identities`.
  - Các trường:
    - `label`
    - `meta_user_id` (tuỳ chọn)
    - `email_hint` (đã che)
    - `owner_member_id`: nhân viên giữ tài khoản
    - `two_factor`: `app` / `sms` / `security_key` / `none` / `unknown`
    - `vault_reference`: chỗ cất, ví dụ "Bitwarden → Agency/FB2"
    - `recovery_note`
    - `status`: `active` / `checkpoint` / `disabled` / `unknown`, người dùng tự đặt
    - `notes`
    - `archived_at`
  - Bảng nối `facebook_identity_businesses` (identity ↔ BM, kèm vai trò `admin` / `employee` / `unknown`).
  - Thêm khoá ngoại `meta_reader_credentials.facebook_identity_id`.
  - `StrictPayload` tiếp tục từ chối mọi trường có tên kiểu password, secret, token, cookie hay otp.
- **B. Service:** CRUD có audit trong cùng transaction (luật 3). Chỉ lưu trữ, không xoá cứng (luật 2).
  - Từ một tài khoản quảng cáo suy ra *các* tài khoản FB quản lý nó, đi qua BM.
  - Dữ liệu không đủ thì hiện `unknown`, không đoán (luật 4).
- **C. API:** `/api/v1/facebook-identities` (list, create, patch, archive, gắn/gỡ BM).
  - `GET /ad-accounts/{id}` thêm `facebook_identities[]`.
- **D. UI:** theo `ui-ux-resource-navigator`.
  - Trang mới **Tài khoản Facebook**: bảng gồm nhãn, người giữ, 2FA, số BM, số tài khoản quảng cáo, trạng thái.
  - Trang chi tiết tài khoản quảng cáo có khối **"Đăng nhập để xử lý"**.
  - Cột và bộ lọc *Tài khoản FB* trong danh sách tài khoản quảng cáo.
  - Có đủ trạng thái rỗng và trạng thái lỗi. Câu chữ do BA rà.
- **E. Tests:**
  - `StrictPayload` từ chối password, otp và các trường tương tự.
  - Audit được ghi trong cùng transaction.
  - Suy ra đúng identity qua BM, kể cả trường hợp nhiều identity.
  - Ẩn hồ sơ lưu trữ khỏi danh sách.
  - Giao diện không có màu "thành công" cho `unknown`.

### F2 — Cảnh báo chỉ thẳng chỗ sửa (ĐÃ HOÀN THÀNH & TRIỂN KHAI)

- Cảnh báo tài khoản bị khoá hoặc chi tiêu bất thường ghi: *"Đăng nhập FB2 – Nguyễn A (người giữ: B, 2FA: app,
  mật khẩu: Bitwarden → Agency/FB2)"*. Tin Telegram cũng vậy, trong allowlist, không trường nào chở bí mật.
- Mỗi loại sự cố có **checklist xử lý**, ví dụ: tài khoản bị vô hiệu → kiểm Account Quality → kháng nghị → chuyển
  ngân sách. Câu chữ do BA duyệt.

### F3 — Tự biết ai có quyền trong BM (ĐÃ HOÀN THÀNH & TRIỂN KHAI)

- Dùng `GET {business-id}/business_users`, thuộc quyền `business_management` đã có, để liệt kê người có quyền
  trong từng BM. Tool **đề xuất** nối identity ↔ BM; người dùng bấm xác nhận.
- **Chưa kiểm**: Meta có trả tên hoặc email người dùng cho token System User không. Cần một phiên đo ≤ 6 GET, duyệt
  riêng, trước khi viết audit.
- Lợi ích: cảnh báo khi BM có **người lạ được thêm vào** hoặc admin bị gỡ. Đây là dấu hiệu sớm của việc bị hack.

### F4 — Chạy thật tạo và chia sẻ tài khoản (Phase 3 cũ)

Giữ như `ROADMAP_COMMERCIAL.md` Phase 3. Lần chạy thật đầu tiên cần duyệt riêng.

### Sau đó (không đổi)

C1 thương mại (nhiều khách, mb-connect, gói, thanh toán) → Google Ads → TikTok. Xem `ROADMAP_COMMERCIAL.md` Phase
4–5.

## Success Criteria

- P0: người dùng đối chiếu 3 tài khoản khớp Ads Manager; có một cảnh báo thật đến Telegram.
- F1–F2: từ một cảnh báo bất kỳ, người dùng biết tài khoản FB cần đăng nhập trong **≤ 1 bước bấm**, và tool
  không chứa mật khẩu hay mã 2FA nào (có test ghim).
- F3: có số đo thật về `business_users` trước khi build; cảnh báo "người lạ vào BM" có test.


### C1 & C2 — Ngân sách cam kết & Cảnh báo tiến độ chi tiêu (ĐÃ HOÀN THÀNH & TRIỂN KHAI)
- **C1 (`budget_pacing`)**: Lưu tên khách hàng (`client_name`), ngân sách ngày cam kết (`planned_daily_budget_raw`) và ngân sách tháng cam kết (`planned_monthly_budget_raw`) cho từng tài khoản quảng cáo; tự động đối chiếu chi tiêu ngày hoàn chỉnh gần nhất và lũy kế tháng (`mtd_spend_raw`) theo đúng tiền tệ gốc của tài khoản.
- **C2 (`spend_budget_pacing_drift`)**: Tự động mở cảnh báo sớm và gửi tin nhắn Telegram (kèm hồ sơ FB đăng nhập và checklist 3 bước) khi chi tiêu vượt cam kết (`overspending`), chạm ngưỡng 90% ngân sách tháng (`approaching_monthly_budget`), hoặc thấp bất thường dưới 50% (`underspending`); tự động đóng khi tiến độ trở lại bình thường.
