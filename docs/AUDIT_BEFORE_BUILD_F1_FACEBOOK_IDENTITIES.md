# Audit Before Build — F1: Hồ sơ tài khoản Facebook

Ngày: 2026-10-28. Theo `MINI_SPEC_PLAYBOOK.md` v2. Kế hoạch mẹ: `docs/PLAN_AGENCY_V2.md`.

## Context

Mỗi tài khoản quảng cáo và mỗi cảnh báo cần trả lời được câu hỏi: **"đăng nhập tài khoản FB nào để sửa"**.
Chủ sản phẩm đã quyết định ngày 2026-10-28:

| Mục | Quyết định |
|---|---|
| D2 | Hồ sơ lưu email ở dạng **che một phần**. Muốn xem đủ email thì phải nhập **mã PIN 6 số** do người dùng tự đặt |
| D3 | Thứ tự P0 → F1 → F2 → F3 → F4 |
| D1 | Đang chờ trả lời. Bản này viết theo đề xuất: mật khẩu và 2FA nằm ở password manager, tool lưu **chỗ cất** |

## Audit — đã có gì (đọc code ngày 2026-10-28)

| Thứ | Có | Thiếu |
|---|---|---|
| `PersonalAccountReference` (A1) | `label`, `display_name`, `external_reference_id`, `status`, `country`, `timezone`, `notes`, chỉ lưu trữ không xoá. CRUD chung ở `/api/v1/personal-account-references`. Docstring: *"Never an authentication container"* | Không nối với BM. Không có người giữ, 2FA, chỗ cất, email |
| `AdAccount.personal_account_reference_id` | Nối trực tiếp, chỉ dùng cho tài khoản **loại cá nhân**. Tab Tài sản hiện nhãn | Tài khoản quảng cáo của agency thuộc **BM**, nên phải suy qua BM |
| `meta_reader_credentials` (O4) | `label`, `provider_user_name` | Với System User, `provider_user_name` là tên system user, không phải người. Không có khoá ngoại tới hồ sơ FB |
| Giao diện | Quản lý chung trong trang **Tài sản** | Không có trang riêng, không có khối "Đăng nhập để xử lý" |
| `StrictPayload` / `find_sensitive_keys` | Từ chối mọi trường có tên kiểu password, token, secret… | Chưa có tên `pin` trong danh sách. Cần thêm |
| `core/security.hash_password` | PBKDF2 | Dùng lại được để băm PIN |
| `core/secret_vault` | Fernet, khoá ở cấu hình máy chủ | Theo luật 1/40, hiện chỉ dùng cho quyền đọc Meta |

**Kết luận:** mở rộng `PersonalAccountReference`, đặt tên hiển thị là **"Tài khoản Facebook"**. Không tạo thực thể
song song.

## Design Choice

### A. Domain (migration `0019_f1_facebook_identities`)

1. Thêm cột vào `personal_account_references`. Mọi cột đều nullable hoặc có mặc định; dữ liệu cũ giữ nguyên.

   | Cột | Kiểu, ý nghĩa |
   |---|---|
   | `owner_member_id` | Nhân viên giữ tài khoản |
   | `two_factor_method` | `app` / `sms` / `security_key` / `none` / `unknown`; mặc định `unknown` |
   | `vault_reference` | Chữ hoặc URL https, ví dụ link mở thẳng mục trong Bitwarden. Lưu dạng chữ thường. **Từ chối nếu trông như mật khẩu hoặc mã 2FA** (dùng `looks_like_credential_value`) |
   | `email_hint` | Ví dụ `ng***@gmail.com`. Máy chủ tự sinh, client không gửi lên |
   | `email_encrypted` | Email đầy đủ, mã hoá Fernet bằng `CREDENTIAL_VAULT_KEY`. Thiếu khoá thì chỉ lưu `email_hint` và báo rõ |
   | `recovery_note` | Ví dụ "SĐT khôi phục do chị B giữ". Từ chối nếu trông như mã |

2. Bảng mới `personal_account_business_links`: hồ sơ FB ↔ BM.
   - Các cột: `role` (`admin` / `employee` / `unknown`), `linked_at`, `linked_by`, `unlinked_at`, `unlinked_by`, `note`.
   - Gỡ liên kết chỉ ghi `unlinked_at`, không xoá dòng (giống `AccountAssetLink`).
3. Thêm khoá ngoại `meta_reader_credentials.personal_account_reference_id`: quyền đọc này do tài khoản FB nào cấp.
4. Thêm vào `users`: `reveal_pin_hash`, `reveal_pin_failed_count`, `reveal_pin_locked_until`.

### B. Service

- **Suy hồ sơ cho một tài khoản quảng cáo:**
  - Nối trực tiếp, cộng với mọi hồ sơ đang nối tới BM của tài khoản.
  - Không có hồ sơ nào thì trả `[]` kèm cờ `unknown`, không đoán (luật 4).
- **PIN:**
  - Đặt hoặc đổi PIN phải nhập lại **mật khẩu đăng nhập**. PIN là đúng 6 chữ số, băm PBKDF2, không bao giờ lưu
    dạng thường.
  - Sai 5 lần thì khoá 15 phút. Owner xoá được PIN của nhân viên, nhân viên phải đặt lại.
- **Xem đủ email:** cần PIN đúng. Ghi audit `facebook_identity.email_revealed` (ai xem, xem lúc nào, **không** ghi
  email).
  - Chỉ owner, admin và người giữ hồ sơ được xem.
- Mọi thay đổi đều ghi audit trong cùng transaction (luật 3). Audit đi qua `redact`.

### C. API

| Đường dẫn | Ghi chú |
|---|---|
| `GET/POST/PATCH /api/v1/personal-account-references` (có sẵn) | Thêm các trường mới. Response **không bao giờ** chứa email đầy đủ |
| `POST /…/{id}/business-links`, `POST /…/{id}/business-links/{link_id}/unlink` | Nối hoặc gỡ BM |
| `POST /…/{id}/reveal-email` body `{pin}` | Trả `{email}`. Sai PIN trả 403 kèm số lần còn lại. Bị khoá trả 423 |
| `PUT /api/v1/me/reveal-pin` body `{current_password, new_pin}` | Đặt hoặc đổi PIN |
| `DELETE /api/v1/team/members/{id}/reveal-pin` | Owner xoá PIN của nhân viên |
| `GET /ad-accounts/{id}` | Thêm `facebook_identities[]` gồm nhãn, người giữ, 2FA, chỗ cất, email đã che |

**Ngoại lệ có chủ ý cho luật 1:** hai body `{pin}` và `{current_password, new_pin}` là `BaseModel` với
`extra="forbid"`, giống `LoginRequest`, vì phải nhận một giá trị dùng để xác minh. Giá trị chỉ được so qua hash và
không bao giờ lưu. Docstring ghi lý do. `CLAUDE.md` luật 1 cập nhật từ "hai body" thành "bốn body", ghi nguyên văn.
Email **không** phải bí mật đăng nhập; mã hoá chỉ để một bản dump database không lộ danh sách email.

### D. UI (theo `ui-ux-resource-navigator`, dùng chung design system U1)

- **Menu mới "Tài khoản Facebook"** (`/facebook-accounts`). Bảng gồm: nhãn, người giữ, 2FA (dạng chip; `none` và
  `unknown` **không** dùng màu xanh), số BM, số tài khoản quảng cáo, trạng thái. Có tìm kiếm và lọc theo người giữ.
- **Trang chi tiết:**
  - Thông tin hồ sơ.
  - Email đã che, kèm nút **"Xem đầy đủ"**. Bấm mở hộp nhập PIN 6 ô. Email đầy đủ hiện 30 giây, có nút sao chép.
  - Nút **"Mở chỗ cất mật khẩu"** nếu `vault_reference` là URL.
  - Danh sách BM: nối hoặc gỡ.
  - Danh sách tài khoản quảng cáo suy ra.
  - Danh sách quyền đọc Meta đã gắn.
- **Trang tài khoản quảng cáo:** khối **"Đăng nhập để xử lý"** ở tab Tổng quan. Chưa nối thì hiện "Chưa biết tài
  khoản FB nào. Nối BM với tài khoản FB" kèm link.
- **Danh sách tài khoản quảng cáo:** cột và bộ lọc *Tài khoản FB*.
- **Cài đặt → Bảo mật:** đặt hoặc đổi PIN.
- Có đủ trạng thái rỗng, đang tải và lỗi. Câu chữ i18n tiếng Việt và tiếng Anh do AI sinh; BA rà soát sau.

### E. Tests

- **Backend:**
  - Migration lên và xuống.
  - `StrictPayload` từ chối `password`, `otp`, `totp`, `two_factor_code`, `pin` trên các route CRUD.
  - `vault_reference` hoặc `recovery_note` trông như mật khẩu hay mã 6 số thì bị từ chối.
  - Không response nào chứa email đầy đủ, trừ `reveal-email`.
  - PIN sai 5 lần thì bị khoá. Hết 15 phút thì mở lại.
  - Audit `email_revealed` không chứa email.
  - Thiếu `CREDENTIAL_VAULT_KEY` thì chỉ lưu `email_hint`.
  - Suy hồ sơ cho tài khoản quảng cáo đúng trong các trường hợp: trực tiếp, qua BM, nhiều hồ sơ, liên kết đã gỡ,
    hồ sơ đã lưu trữ.
  - Luật 8: không thấy được dữ liệu của workspace khác.
- **Frontend:**
  - Trang danh sách, trang chi tiết, hộp PIN (đúng, sai, bị khoá).
  - Khối "Đăng nhập để xử lý" có hồ sơ và không có hồ sơ.
  - Không dùng màu "thành công" cho `unknown` hay `none`.
  - Kiểm `no-raw-palette`, giao diện tối, màn 375px.

## Success Criteria

- Từ một tài khoản quảng cáo bị khoá, người dùng thấy tài khoản FB cần đăng nhập, người giữ, cách 2FA và nút mở chỗ
  cất mật khẩu. Không quá **1 bước bấm**.
- Database và mọi response **không chứa** mật khẩu hay mã 2FA. Có test ghim điều này.
- Xem email đầy đủ cần PIN, và mọi lần xem đều có trong nhật ký.

## Ngoài phạm vi

- Tự đọc danh sách người trong BM: để cho F3.
- Cảnh báo ghi tên tài khoản FB: để cho F2.
- Lưu mật khẩu và mã 2FA: không làm (D1).
