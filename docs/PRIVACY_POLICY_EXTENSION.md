# Chính sách quyền riêng tư — tiện ích AdsOps Control Center / Privacy Policy — AdsOps Control Center extension

> **BẢN NHÁP — chưa được pháp chế/chủ sở hữu duyệt, chưa công bố.** Các chỗ `<...>` là placeholder
> phải do người có thẩm quyền điền; không ai (kể cả agent) được tự bịa tên pháp nhân, địa chỉ, email.
> Nội dung đối chiếu với `extension/PERMISSIONS.md` và mã nguồn `extension/src` (đọc 2026-10-26).
> Nếu mã đổi (ví dụ bản 0.2.0 thêm dữ liệu gửi đi), **phải rà lại bản này trước khi công bố**.
> Bản này không phải tư vấn pháp lý; cần luật sư xem trước khi dùng cho khách thương mại.

- Hiệu lực / Effective: `<NGÀY HIỆU LỰC>`
- Nhà cung cấp / Provider (data controller for the extension itself): `<CÔNG TY>`, `<ĐỊA CHỈ PHÁP NHÂN>`
- Liên hệ / Contact: `<EMAIL LIÊN HỆ>`

---

# PHẦN TIẾNG VIỆT

## 1. Tiện ích làm gì

AdsOps Control Center ("tiện ích") là tiện ích Chrome **chỉ đọc**. Khi bạn mở một trang Meta Ads
Manager, tiện ích nhận ra tài khoản quảng cáo bạn đang xem và hiện, trong popup và side panel, trạng
thái sẵn sàng, sức khoẻ, cảnh báo và các số liệu vận hành mà **dashboard AdsOps của tổ chức bạn** đã
ghi. Bạn cũng có thể ghi một ghi chú rà soát vào tài khoản đó.

Tiện ích **không** bấm, sửa, gửi biểu mẫu, tự động hoá hay chặn bất cứ thao tác nào trong Ads Manager, và
không ghi gì vào trang.

## 2. Dữ liệu tiện ích xử lý

### 2.1 Đọc từ trang Ads Manager (tại máy bạn)

Chỉ trên: `adsmanager.facebook.com`, `business.facebook.com`, và đường dẫn `/adsmanager` của
`www.facebook.com`. Tiện ích đọc:

- mã tài khoản quảng cáo trong URL (tham số `act=`);
- đường dẫn (route) của trang, đã loại bỏ phần query string;
- tên tài khoản nếu tiêu đề trang có — **chỉ để hiển thị tại máy bạn**, không gửi đi và không dùng để đối chiếu.

Tiện ích **không** đọc cookie, `localStorage`, `sessionStorage`, IndexedDB, lưu lượng mạng, phím gõ, giá
trị trong biểu mẫu hay nội dung trang ngoài những mục trên.

### 2.2 Gửi tới dashboard AdsOps của bạn

Tiện ích chỉ gửi dữ liệu tới **địa chỉ dashboard do chính bạn nhập** ở trang Tuỳ chọn — không tới máy chủ
nào khác của chúng tôi hay của bên thứ ba. Cụ thể:

| Khi nào | Dữ liệu gửi | Mục đích |
|---|---|---|
| Bấm Kết nối | Email và mật khẩu dashboard của bạn; mã nhận diện ngẫu nhiên của bản cài đặt; nhãn thiết bị bạn đặt; số phiên bản tiện ích | Đăng nhập một lần, đổi lấy một phiên riêng cho tiện ích, rồi **quên mật khẩu** |
| Khi xem trang Ads Manager | Mã tài khoản (`act`), loại trang, đường dẫn đã lọc, số phiên bản | Tra tình trạng của tài khoản trong workspace của bạn |
| Khi bạn chủ động ghi một sự kiện/ghi chú | Mã tài khoản trong hệ thống, loại sự kiện (từ danh sách cố định), nội dung ghi chú bạn gõ, loại trang, đường dẫn đã lọc, số phiên bản | Lưu vào dòng thời gian của tài khoản, kèm nhật ký kiểm toán |
| Khi bạn ngắt kết nối | Yêu cầu thu hồi phiên | Cắt phiên ngay phía máy chủ |

Dashboard (và dữ liệu trong đó) do **tổ chức của bạn** vận hành. Chính sách này chỉ nói về tiện ích.
Cách dashboard lưu, giữ và xoá dữ liệu do `<CÔNG TY>`/tổ chức vận hành dashboard quy định tại chính sách của dashboard: `<URL CHÍNH SÁCH DASHBOARD>`.

### 2.3 Lưu trên máy bạn

- Địa chỉ dashboard, nhãn thiết bị, mã ngẫu nhiên của bản cài, ngôn ngữ giao diện: bộ nhớ cục bộ của tiện ích (`chrome.storage.local`).
- Token phiên của tiện ích: bộ nhớ phiên (`chrome.storage.session`) — mất khi đóng trình duyệt. Mật khẩu của bạn **không được lưu**.
- Email của bạn và tên workspace (nhận từ dashboard) để hiển thị.
- Kết quả tra gần nhất theo từng tab (bộ nhớ đệm ngắn hạn), xoá khi đóng tab hoặc sau khi bạn ghi sự kiện.

## 3. Mục đích sử dụng

Chỉ để thực hiện chức năng đơn nhất nêu ở mục 1. Không dùng cho quảng cáo, hồ sơ hoá, phân tích hành vi,
đánh giá tín dụng hay mục đích nào khác. Không có SDK phân tích hay quảng cáo.

## 4. Chia sẻ

Không bán, không cho thuê, không chuyển dữ liệu cho bên thứ ba. Bên duy nhất nhận dữ liệu là dashboard
AdsOps do bạn chọn ở Tuỳ chọn. Có thể phải tiết lộ khi pháp luật yêu cầu: `<CÔNG TY>` chỉ làm vậy theo trình tự hợp pháp.
Bên hạ tầng của dashboard (nếu có) là nhà thầu xử lý của người vận hành dashboard: `<DANH SÁCH NHÀ HẠ TẦNG, nếu cần nêu>`.

## 5. Quyền xin trình duyệt và lý do

| Quyền | Lý do |
|---|---|
| `storage` | Lưu địa chỉ dashboard, phiên tiện ích, ngôn ngữ, bộ nhớ đệm theo tab |
| `sidePanel` | Mở bảng tài khoản cạnh Ads Manager |
| `activeTab` | Đọc URL tab bạn đang xem khi mở popup |
| Ba host: `adsmanager.facebook.com/*`, `business.facebook.com/*`, `www.facebook.com/adsmanager/*` | Chạy script chỉ-đọc để lấy mã tài khoản và tên hiển thị trên các trang Ads Manager |

Tiện ích **không** xin `cookies`, `webRequest`, `scripting`, `tabs`, `proxy`, `debugger` hay `<all_urls>`.
Tiện ích không tải hay chạy mã từ xa.

## 6. Thời gian lưu giữ và quyền của bạn

- Trên máy bạn: gỡ tiện ích hoặc bấm Ngắt kết nối sẽ xoá phiên; gỡ tiện ích xoá toàn bộ dữ liệu cục bộ.
- Trên dashboard: sự kiện/ghi chú bạn ghi nằm trong nhật ký kiểm toán của dashboard, **không bị xoá cứng** theo thiết kế của sản phẩm (lịch sử kiểm toán là vĩnh viễn). Yêu cầu truy cập, chỉnh sửa hoặc ẩn dữ liệu gửi tới `<EMAIL LIÊN HỆ>`. `<CÔNG TY>` sẽ trả lời trong `<SỐ NGÀY>` ngày làm việc. **[CẦN PHÁP CHẾ: đối chiếu với nghĩa vụ xoá dữ liệu theo luật bảo vệ dữ liệu cá nhân áp dụng — đây là điểm xung đột đã ghi nhận trong `ROADMAP_COMMERCIAL.md` §4.1]**
- Bạn có thể thu hồi phiên của tiện ích bất cứ lúc nào trong dashboard hoặc bằng nút Ngắt kết nối.

## 7. Bảo mật

Kết nối tới dashboard dùng HTTPS (tiện ích chỉ chấp nhận địa chỉ `https://`, trừ `localhost` khi phát triển).
Token của tiện ích chỉ dùng được cho các đường dẫn của tiện ích và bị mọi route khác của dashboard từ chối.
Trong nhật ký, mật khẩu và token không được ghi.

## 8. Thông tin về Meta

Tiện ích không liên kết với, không được tài trợ hay xác nhận bởi Meta Platforms. Các trạng thái hiển thị
là ghi nhận vận hành trong workspace của bạn, **không phải quyết định của nền tảng quảng cáo** và không
bảo đảm tài khoản sẽ không bị hạn chế hay quảng cáo sẽ được duyệt.

## 9. Trẻ em

Dành cho người làm quảng cáo chuyên nghiệp, không hướng tới người dưới `<ĐỘ TUỔI>`.

## 10. Thay đổi

Khi thay đổi, ngày hiệu lực được cập nhật và thay đổi trọng yếu được thông báo trong trang cửa hàng của tiện ích hoặc qua dashboard.

## 11. Liên hệ

`<CÔNG TY>` — `<EMAIL LIÊN HỆ>` — `<ĐỊA CHỈ PHÁP NHÂN>`

---

# ENGLISH VERSION

> DRAFT — not yet reviewed by legal or the owner, not published. `<...>` are placeholders to be filled
> by an authorised person. Not legal advice.

- Effective: `<NGÀY HIỆU LỰC>` · Provider: `<CÔNG TY>`, `<ĐỊA CHỈ PHÁP NHÂN>` · Contact: `<EMAIL LIÊN HỆ>`

## 1. What the extension does

AdsOps Control Center (the "extension") is a **read-only** Chrome extension. When you open a Meta Ads
Manager page it recognises the ad account you are viewing and shows, in a popup and a side panel, the
readiness, health, alerts and operational figures that **your organisation's AdsOps dashboard** already
holds. You can also record a review note against that account.

It does **not** click, edit, submit, automate or block anything in Ads Manager, and it writes nothing into the page.

## 2. Data the extension handles

### 2.1 Read from Ads Manager pages (on your device)

Only on `adsmanager.facebook.com`, `business.facebook.com`, and the `/adsmanager` path of
`www.facebook.com`. It reads:

- the ad account id in the URL (`act=` parameter);
- the page route, with the query string removed;
- the account name, if the page title shows one — **for local display only; it is not sent anywhere and not used for matching**.

It does **not** read cookies, `localStorage`, `sessionStorage`, IndexedDB, network traffic, keystrokes,
form values or any page content beyond the above.

### 2.2 Sent to your AdsOps dashboard

Data goes only to the **dashboard address you enter** in Options — not to any other server of ours or of a third party.

| When | Data sent | Purpose |
|---|---|---|
| You press Connect | Your dashboard email and password; a random installation id; a device label you chose; the extension version | Sign in once, exchange for a separate extension session, then **forget the password** |
| You view an Ads Manager page | Account id (`act`), page type, filtered route, version | Look up the account's status in your workspace |
| You choose to record an event/note | Account id in the system, event type (from a fixed list), the note text you typed, page type, filtered route, version | Store on the account timeline with an audit record |
| You disconnect | A session-revocation request | End the session server-side immediately |

The dashboard and its data are operated by **your organisation**; this policy covers the extension only.
How the dashboard stores, retains and deletes data is set by its operator's policy: `<URL CHÍNH SÁCH DASHBOARD>`.

### 2.3 Stored on your device

- Dashboard address, device label, random installation id, interface language: the extension's local storage (`chrome.storage.local`).
- The extension session token: session storage (`chrome.storage.session`), cleared when the browser closes. Your password is **not stored**.
- Your email and workspace name (returned by the dashboard) for display.
- The latest lookup result per tab (short-lived cache), cleared when the tab closes or after you record an event.

## 3. Use

Only for the single purpose in section 1. Not for advertising, profiling, behavioural analytics, credit
assessment or anything else. No analytics or advertising SDK.

## 4. Sharing

We do not sell, rent or transfer data to third parties. The only recipient is the AdsOps dashboard you
select in Options. Disclosure may be required by law; `<CÔNG TY>` would do so only through lawful process.
Dashboard hosting providers (if any) act as processors for the dashboard's operator: `<DANH SÁCH NHÀ HẠ TẦNG, nếu cần nêu>`.

## 5. Permissions requested and why

| Permission | Reason |
|---|---|
| `storage` | Keep dashboard address, extension session, language, per-tab cache |
| `sidePanel` | Open the account panel beside Ads Manager |
| `activeTab` | Read the URL of the tab you are looking at when you open the popup |
| Three hosts: `adsmanager.facebook.com/*`, `business.facebook.com/*`, `www.facebook.com/adsmanager/*` | Run a read-only script to get the account id and display name on Ads Manager pages |

It does **not** request `cookies`, `webRequest`, `scripting`, `tabs`, `proxy`, `debugger` or `<all_urls>`,
and loads or runs no remote code.

## 6. Retention and your rights

- On your device: removing the extension or pressing Disconnect clears the session; uninstalling removes all local data.
- On the dashboard: events/notes you record sit in the dashboard's audit history, which by product design is **not hard-deleted**. Send access, correction or hiding requests to `<EMAIL LIÊN HỆ>`; `<CÔNG TY>` replies within `<SỐ NGÀY>` working days. **[LEGAL TO REVIEW: reconcile with deletion obligations under applicable data-protection law — a recorded conflict, see `ROADMAP_COMMERCIAL.md` §4.1]**
- You may revoke the extension's session at any time from the dashboard or with Disconnect.

## 7. Security

Connections to the dashboard use HTTPS (the extension accepts only `https://` addresses, except `localhost` in development).
The extension token is refused by every other dashboard route. Passwords and tokens are not written to logs.

## 8. About Meta

The extension is not affiliated with, sponsored or endorsed by Meta Platforms. The states it displays are
operational records in your workspace; they are **not a decision by an advertising platform** and do not
guarantee that an account cannot be restricted or that an ad will be approved.

## 9. Children

For professional advertisers; not directed to anyone under `<ĐỘ TUỔI>`.

## 10. Changes

When this policy changes the effective date is updated, and material changes are announced on the store listing or via the dashboard.

## 11. Contact

`<CÔNG TY>` — `<EMAIL LIÊN HỆ>` — `<ĐỊA CHỈ PHÁP NHÂN>`

---

## Ghi chú cho người soạn (xoá trước khi công bố)

Những câu trong chính sách mà tôi **đã đối chiếu với mã**: không đọc cookie/storage (luật 32, lint); tên
tài khoản không gửi (`service-worker.ts` body của `resolve` và `events`); mật khẩu không lưu
(`auth-session.ts`); token ở `chrome.storage.session` (`storage.ts`); chỉ chấp nhận `https://` hoặc
localhost (`isUsableDashboardUrl`, theo RUNBOOK UAT — chưa mở hàm đọc lại).

**Chưa kiểm:** "token bị mọi route khác từ chối" (luật 34 — dựa vào CLAUDE.md, không chạy test); "nhật ký
không ghi mật khẩu/token" (luật 1/26, không chạy lại); khoảng thời gian lưu giữ phía dashboard; việc chính sách
dashboard riêng có tồn tại hay không (placeholder `<URL CHÍNH SÁCH DASHBOARD>`).
