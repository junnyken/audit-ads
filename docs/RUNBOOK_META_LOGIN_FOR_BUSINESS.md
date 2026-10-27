# Runbook — Kết nối tài khoản Facebook đọc dữ liệu Meta (Facebook Login for Business, O4)

Đối tượng: **chủ sản phẩm / người vận hành**. Các bước dưới đây nằm **ngoài mã**: sản phẩm không làm
thay được, và nếu thiếu thì nút *Kết nối một tài khoản Facebook* trong **Cài đặt** sẽ bị khoá với lý do
`not_configured` (không bao giờ lỗi 500, không bao giờ âm thầm lưu gì).

Thiết kế và quyết định: `docs/AUDIT_BEFORE_BUILD_O4_USER_TOKENS.md` (§7, §14). Luật: `CLAUDE.md` rule 1
(ngoại lệ duy nhất), 18, 20, 22, 40.

> **Nhãn [CHƯA KIỂM]**: tên menu/nút trên giao diện Meta dưới đây được viết theo tài liệu Meta đọc ngày
> 2026-10-27, **chưa ai đối chiếu trên màn hình thật**. Meta đổi giao diện thường xuyên — gặp nhãn khác
> thì theo ý nghĩa của bước, và ghi lại nhãn thật vào đây.

---

## 1. Sản phẩm làm gì, không làm gì

- Người thật bấm *Kết nối* → trình duyệt **của chính họ** mở hộp thoại của Meta → họ đồng ý → Meta gửi
  về máy chủ một `code` → máy chủ tự đổi `code` lấy quyền đọc và hỏi Meta (`debug_token`) quyền đó là gì.
- Sản phẩm **từ chối và không lưu** nếu: quyền thuộc ứng dụng khác (`app_mismatch`), không còn hiệu lực
  (`invalid_token`), thiếu `ads_read` hoặc `business_management` (`scope_missing`), hoặc **có
  `ads_management`** (`scope_too_broad` — không ngoại lệ).
- Quyền được lưu **đã mã hoá** (Fernet) bằng khoá chỉ có trên máy chủ (`CREDENTIAL_VAULT_KEY`). Không màn
  hình, API, nhật ký, audit hay tin Telegram nào chứa nó.
- Sản phẩm **không** đọc cookie, phiên, mật khẩu Facebook, **không** tự động hoá trình duyệt (rule 1, 7).
- Sản phẩm **không thể** gỡ quyền ở phía Meta (transport không có lệnh DELETE) — xem §6.

## 2. Chuẩn bị ứng dụng Meta (một lần) [CHƯA KIỂM]

1. **Chọn ứng dụng** sinh quyền đọc (câu hỏi §13.4 của tài liệu audit chưa được trả lời: ứng dụng của
   A10 hay ứng dụng "Mắt Bão Marketing" của mb-connect). Ứng dụng phải là **loại Business**.
2. Trong **developers.facebook.com → My Apps → <ứng dụng> → Facebook Login for Business →
   Configurations**, tạo cấu hình mới:
   - **Token type: System User access token** (quyết định §14 13.3 — loại không hết hạn). Không bật tuỳ
     chọn hết hạn sau 60 ngày.
   - **Permissions**: chỉ `ads_read` và `business_management`. **Không** chọn `ads_management` — sản phẩm
     sẽ từ chối mọi quyền có nó.
   - Assets: tài khoản quảng cáo cần theo dõi (nếu hộp cấu hình hỏi).
   - Ghi lại **Configuration ID** → đó là `META_LOGIN_CONFIG_ID`.
3. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: thêm đúng URI
   `https://<host của api>/api/v1/meta-reader-credentials/callback` (phải là https; trùng từng ký tự với
   `META_OAUTH_REDIRECT_URI`).
4. **App roles**: nếu ứng dụng chưa có *Advanced Access*, mỗi tài khoản Facebook sẽ kết nối phải có vai
   trò trên ứng dụng (Administrator / Developer / Tester). Vai trò nào là đủ: **[CHƯA KIỂM]**.
5. **2FA (khuyến nghị bắt buộc)**: bật xác thực hai lớp cho từng tài khoản Facebook sẽ kết nối, và bật
   *Two-factor authentication required* cho từng Business Manager (**Business Settings → Security
   Center**). Sản phẩm không kiểm được điều này.

## 3. Cấu hình máy chủ (5 biến chính + khoá)

Đặt cho **cả api lẫn dispatcher** (dispatcher giải mã để đọc và hỏi `debug_token` để kiểm). Đây là
thay đổi cấu hình phát hành — rule 22: cần người duyệt có tên trước khi đặt trên production.

| Biến | Bí mật? | Giá trị |
|---|---|---|
| `META_APP_ID` | không | App ID của ứng dụng ở §2 |
| `META_APP_SECRET` | **có** (rule 18) | App Secret — chỉ trong cấu hình máy chủ |
| `META_LOGIN_CONFIG_ID` | không | Configuration ID ở §2.2 |
| `META_OAUTH_REDIRECT_URI` | không | URI ở §2.3, y hệt |
| `META_LOGIN_CONFIG_KIND` | không | `system_user` (mặc định) — hoặc `user` nếu cấu hình ở §2 phát quyền người dùng |
| `CREDENTIAL_VAULT_KEY` | **có** | sinh bằng `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |

Tuỳ chọn: `CREDENTIAL_CHECK_EVERY_N_PASSES` (mặc định **0 = tắt**), `CREDENTIAL_CHECK_BATCH` (10),
`CREDENTIAL_EXPIRY_WARNING_DAYS` (14), `CREDENTIAL_RENEW_BEFORE_DAYS` (20, chỉ có nghĩa với loại `user`).

- **Đổi `CREDENTIAL_VAULT_KEY` = mọi quyền đã lưu không mở được** → mỗi quyền phải *Kết nối lại*. Không
  có xoay khoá trong O4. Mất khoá (biến trống) thì sản phẩm ngừng đọc nhưng **không** đánh dấu quyền nào
  chết; đặt lại đúng khoá là chạy lại.
- `GET /api/v1/operations/configuration` báo thiếu/sai bằng **mã + câu**, không bao giờ in giá trị:
  `meta_app_secret_placeholder`, `meta_login_partially_configured`, `credential_vault_key_unusable`,
  `meta_oauth_redirect_not_https`, `meta_login_config_kind_unknown`.

## 4. Kết nối (mỗi Business Manager một lần với cấu hình System User)

1. Đăng nhập dashboard bằng tài khoản **chủ workspace** → **Cài đặt → Tài khoản Facebook đọc dữ liệu
   Meta**.
2. Nhập *Tên gợi nhớ* và *ID Business Manager* (bắt buộc với System User: Meta không cho biết BM sau một
   quyền system user — đã đo 2026-09-10).
3. Bấm **Kết nối một tài khoản Facebook** → hộp thoại Meta mở → chọn **đúng** BM có ID vừa nhập → đồng ý.
4. Quay về Cài đặt:
   - *Đã kết nối và xác minh* → quyền `Đang đọc được`; sản phẩm tạo (hoặc gắn) một kết nối Meta
     `production` cho BM đó. **Tự động khám phá/nhập vẫn tắt** — bật bằng công tắc O3 trên thẻ kết nối.
   - *Chưa kết nối được: …* → đọc lý do. `business_not_readable` thường nghĩa là đã chọn BM khác trong hộp
     thoại; quyền được giữ ở trạng thái *Chưa xác minh — không đọc*, bấm *Kết nối lại* và chọn đúng BM.
5. Phiên kết nối hết hạn sau **10 phút** (`invalid_state`) — bắt đầu lại.

Với cấu hình loại `user` (không phải đường chính): một lần cho mỗi tài khoản Facebook; sản phẩm tự liệt kê
BM qua `me/businesses` và tạo kết nối cho từng BM. Quyền người dùng sống khoảng 60 ngày; việc Meta có gia hạn
khi trao đổi lại hay không **[CHƯA KIỂM]** — sản phẩm *thử* và **đếm** (`renewed` / `renew_not_extended`),
không hứa.

## 5. Theo dõi sống / chết

- **Kiểm tay**: nút *Kiểm lại* trên thẻ quyền (≤ 3 GET), hoặc
  `python -m app.commands.run_dispatcher --credential-check` (một lượt).
- **Kiểm theo lịch**: `CREDENTIAL_CHECK_EVERY_N_PASSES > 0` — quyết định phát hành có người duyệt tên
  (rule 22). Ví dụ dispatcher 60 giây/lượt → `1440` ≈ một lần/ngày.
- Khi Meta báo quyền chết (hết hạn, bị thu hồi, đổi mật khẩu `460`, checkpoint `459`, ứng dụng bị gỡ
  `458`, thiếu quyền): quyền → *Cần kết nối lại — không đọc*, **một** cảnh báo `critical` (Telegram theo
  chính sách, `critical` bỏ qua giờ yên lặng nếu chính sách cho phép), mọi tài khoản dưới nó hiện
  *không theo dõi được* kèm lý do. Sản phẩm **không** chuyển sang token máy chủ hay quyền khác.
- Sắp hết hạn trong 14 ngày (chỉ loại có hạn) → một cảnh báo `warning`.
- System Status có dòng *Kiểm quyền đọc Meta*: `Never run` / `Stale` / `Current` + số quyền theo trạng thái.

## 6. Kết nối lại / thu hồi

- **Kết nối lại**: nút *Kết nối lại* → cùng hộp thoại → phải dùng **cùng danh tính** (khác thì bị từ chối
  `user_mismatch` — hãy kết nối như một quyền mới). Kết nối Meta giữ nguyên, lịch sử đọc liền mạch.
- **Thu hồi** trong sản phẩm: nút *Thu hồi* (cần lý do, **không hoàn tác**) — xoá bản mã hoá, giữ lịch sử.
- **Thu hồi ở phía Meta (bắt buộc làm tay)** [CHƯA KIỂM]: Business Settings → Users → System users →
  chọn system user tích hợp của ứng dụng → gỡ ứng dụng / gỡ tài sản; hoặc Business Settings →
  Integrations → Connected apps → gỡ ứng dụng. Nếu nghi lộ khoá máy chủ: làm bước này **trước**, rồi đổi
  `META_APP_SECRET` (App Settings → Basic → Reset).
- **Đổi danh tính đọc cho một BM** khi có hai quyền cùng thấy BM đó: trên thẻ kết nối, nút *Dùng <tên>
  cho kết nối này* — sản phẩm không bao giờ tự đổi.

## 7. Bán kính nổ (nói thật)

Kẻ có được quyền `business_management` có thể **đọc và ghi Business Manager API** với quyền của người đã
cấp (thêm/bớt người, gán tài sản). Không đăng nhập Facebook được, không đổi mật khẩu được. Giảm thiểu: khoá
vault tách khỏi DB, 2FA, chỉ `ads_read` + `business_management`, thu hồi ở §6. Câu hỏi bỏ
`business_management` (§13.7) chờ phiên đo có người xem (≤ 6 GET, cần duyệt riêng).
