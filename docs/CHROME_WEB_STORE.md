# Bộ hồ sơ đăng AdsOps Control Center lên Chrome Web Store

Trạng thái: **bản nháp chuẩn bị — chưa nộp, chưa đăng gì.** Tài liệu này chỉ mô tả; không đổi mã.
Soạn 2026-10-26 từ mã trong `extension/` và tài liệu chính thức tại developer.chrome.com
(các trang đã đọc ghi ở mục 11). Theo luật 41 của `CLAUDE.md`: mục nào không kiểm được thì ghi
**[CHƯA KIỂM]** — đừng coi là đã đúng.

> Phiên bản extension đang được agent khác nâng lên 0.2.0 và thêm khối chi tiêu vào side panel.
> Mô tả bên dưới cố ý viết chung ("trạng thái sẵn sàng, sức khoẻ, cảnh báo, và số liệu vận
> hành đã có trong sản phẩm") để vẫn đúng. **Trước khi nộp phải đọc lại đối chiếu với bản build
> cuối** — nhất là chuỗi mô tả và ảnh chụp.

---

## 0. Hai chỗ chặn phát hiện khi đọc mã (làm TRƯỚC mọi thứ khác)

| # | Phát hiện | Hệ quả | Ai sửa |
|---|---|---|---|
| B1 | `extension/icons/` **rỗng** và `manifest.json` **không có khoá `icons`** (đo 2026-10-26) | Store bắt buộc icon 128x128; gói không có icon là gói thiếu. Thanh công cụ Chrome cũng chỉ hiện chữ cái mặc định | Cần một bản mã nhỏ: thêm `icons/icon-{16,32,48,128}.png` và khoá `icons`/`action.default_icon` vào manifest. **Ngoài phạm vi tài liệu này** — cần một mini-spec riêng |
| B2 | `description` trong `manifest.json` dài **140 ký tự** (đếm bằng Python) | Giới hạn 132 ký tự cho trường tóm tắt của Store (xem 2.2, **[CHƯA KIỂM]** từ trang chính thức) — Store lấy trường này từ manifest, nên 140 có thể bị từ chối lúc tải gói lên | Rút gọn chuỗi manifest xuống ≤132. Gợi ý ở 2.2 |

> **Cập nhật 2026-10-26 (sau khi soạn):** B1 và B2 **đã xử lý** trong mã. Có `extension/icons/icon-{16,32,48,128}.png` (vẽ bằng `extension/scripts/make-icons.py`), khoá `icons` và `action.default_icon` trong manifest, và `description` đã rút xuống 129 ký tự (thêm "spend"). `tests/manifest.test.ts` canh cả hai. Gói để tải lên Store là `extension/adsops-extension-0.2.0.zip`, có `manifest.json` ở gốc. `dist.zip` vẫn để thư mục `dist/` ở gốc, chỉ dùng cho "Load unpacked".
>
> **Cập nhật 2026-10-27 (S2):** bản **0.3.0** thêm một dòng "Trạng thái Meta" (mã `account_status` Meta trả, kèm thời điểm) vào popup và side panel; không đổi quyền, host permission hay dữ liệu gửi đi (extension chỉ **nhận** thêm một khối từ API). Gói tải lên Store nay là `extension/adsops-extension-0.3.0.zip`; gói 0.2.0 đã xoá. Mô tả/ảnh trên Store nên nhắc dòng mới trước khi nộp.

> **Cập nhật 2026-10-27 (U1e):** bản **0.3.1** chỉ đổi giao diện (token, font Be Vietnam Pro đóng gói sẵn, icon SVG, chế độ tối theo hệ điều hành, `lang` theo ngôn ngữ, nhãn loại trang); **không đổi** quyền, host permission, content-script matches hay CSP. Gói tải lên Store nay là `extension/adsops-extension-0.3.1.zip`; ảnh chụp màn hình trên Store (nếu đã chuẩn bị) cần chụp lại theo giao diện mới.

Ngoài ra: **URL chính sách quyền riêng tư công khai (HTTPS) chưa có** — xem mục 9.

---

## 1. Checklist trước khi bắt đầu (việc của người, không phải của agent)

| ☐ | Việc | Ghi chú / nguồn |
|---|---|---|
| ☐ | Chọn **tài khoản Google** sẽ làm chủ tài khoản developer | Nên là tài khoản của công ty, không phải cá nhân. Sau khi tạo, **không đổi được email** (developer.chrome.com/docs/webstore/register). Nếu từng xoá tài khoản developer, không dùng lại email đó |
| ☐ | Đăng ký developer tại Chrome Web Store Developer Dashboard, đồng ý Developer Agreement | Quốc gia/khu vực phải nằm trong danh sách được hỗ trợ — **[CHƯA KIỂM]** Việt Nam có trong danh sách hay không: trang chính thức chỉ nói "có danh sách", tôi không đọc được danh sách. Kiểm lúc đăng ký |
| ☐ | Trả **phí đăng ký một lần** | Trang chính thức xác nhận "một lần" nhưng **không ghi số tiền**. Trang "What's new" của Google nhắc con số **5 USD** (qua kết quả tìm kiếm). **[CHƯA KIỂM]** — số tiền do Google quyết định và có thể đổi; xem số hiện hành ngay trên dashboard trước khi trả |
| ☐ | Bật **xác minh 2 bước (2-Step Verification)** cho tài khoản Google đó | Chính sách chương trình yêu cầu có 2SV trước khi đăng hoặc cập nhật extension (theo kết quả tìm kiếm từ trang Program Policies; tôi không đọc được nguyên văn điều khoản — **[CHƯA KIỂM]** nguyên văn) |
| ☐ | Điền **Publisher name** và **email liên hệ**, bấm đường dẫn xác minh Google gửi tới email đó | Xác minh email liên hệ là **bắt buộc** khi lập tài khoản mới (developer.chrome.com/docs/webstore/set-up-account). Publisher name hiện ở "Offered by". Dùng hộp thư của công ty, có người đọc thường xuyên — Store gửi thông báo từ chối/đình chỉ tới đây. Tài liệu này **không** điền email hộ: `<EMAIL LIÊN HỆ>` |
| ☐ | (Tuỳ chọn) **Verified publisher / Official URL** | Chọn "Official URL" từ miền đã xác minh sẽ hiện huy hiệu nhà phát hành xác minh. **Không bắt buộc** để đăng. Cần miền đã xác minh trong Google Search Console — **[CHƯA KIỂM]** cách xác minh chi tiết, trang tôi đọc không nói. Bỏ qua ở lượt đầu nếu chưa có miền |
| ☐ | Tài khoản Google của từng người thử (nếu chọn Private/Trusted testers) | Mỗi email phải gắn với một Google Account |
| ☐ | Chốt **câu mục đích đơn nhất** (mục 4.1) | Store yêu cầu mục đích "hẹp và dễ hiểu" |
| ☐ | Chốt người ký chính sách quyền riêng tư: điền `<CÔNG TY>`, `<EMAIL LIÊN HỆ>`, `<NGÀY HIỆU LỰC>` trong `docs/PRIVACY_POLICY_EXTENSION.md` | Không agent nào được tự bịa tên pháp nhân/địa chỉ/email |
| ☐ | Tài khoản thử cho người duyệt (xem mục 8, "Test instructions") | Extension chỉ hoạt động khi đăng nhập vào một dashboard — người duyệt không có tài khoản thì không thấy gì |

New publisher: ban đầu chỉ được **2 extension đã đăng** (developer.chrome.com/docs/webstore/publish) — không ảnh hưởng ta (1 extension).

---

## 2. Các trường Store listing

Chrome Web Store Developer Dashboard → Store listing. Ràng buộc đã kiểm từ docs: mô tả chi tiết
phải mở đầu bằng một câu ngắn nói extension làm gì và **không được nhồi từ khoá** (keyword spam);
icon 128x128; ≥1 ảnh chụp.

### 2.1 Tên

| | |
|---|---|
| EN | `AdsOps Control Center` |
| VI | `AdsOps Control Center` (giữ nguyên tên sản phẩm, không dịch) |

Khớp `manifest.json` → `name`. Không thêm từ "Meta"/"Facebook" vào tên: đó là nhãn hiệu của bên khác,
dễ bị hiểu là sản phẩm chính chủ. Trong mô tả chỉ dùng để chỉ **trang** ("Meta Ads Manager").

### 2.2 Mô tả ngắn (summary — từ manifest `description`)

Giới hạn **132 ký tự**: đây là giới hạn đã biết rộng rãi cho trường `description` của manifest;
**[CHƯA KIỂM]** từ trang chính thức — các trang tôi đọc (`cws-dashboard-listing`, `publish`) không
nêu con số. Dùng 132 làm trần và kiểm lại khi tải gói lên.

Chuỗi hiện tại (140 ký tự) **vượt trần**. Ứng viên (đếm bằng Python khi soạn):

| Ngôn ngữ | Chuỗi | Độ dài |
|---|---|---|
| EN | `Shows readiness, health and open alerts for the ad account you are viewing. Read-only: changes nothing on any ad platform.` | 122 |
| VI | `Hiện trạng thái sẵn sàng, sức khoẻ và cảnh báo của tài khoản quảng cáo đang xem. Chỉ đọc, không thay đổi gì trên nền tảng quảng cáo.` | 132 (sát trần; nên rút thêm vài ký tự) |

(Hai chuỗi ngắn hơn vì bỏ cụm "of the ad account you are looking at". Đếm lại bằng công cụ khi
sửa — đây là việc của người sửa manifest.) Trường tóm tắt trong manifest chỉ có **một** ngôn ngữ;
muốn có cả hai cần `_locales/` (thay đổi mã, ngoài phạm vi).

### 2.3 Mô tả chi tiết

**English**

```
AdsOps Control Center shows, beside Meta Ads Manager, what your team's AdsOps dashboard already
knows about the ad account you are looking at.

Open an Ads Manager page and the extension recognises the account by its exact account id, then
shows in a side panel and popup:
- the account's readiness state, with how fresh that state is;
- its health state and the open alerts, if any;
- operational figures already recorded in your AdsOps workspace;
- a "Workspace Guard" checklist, so a teammate can record that they reviewed the account before
  making a change, and add a note to the account's timeline.

What it does NOT do:
- It is read-only on the page. It never clicks, edits, submits, automates or blocks anything in
  Ads Manager, and never writes into the page.
- It does not read cookies, localStorage, sessionStorage, IndexedDB, network traffic, keystrokes
  or form values.
- It runs only on Ads Manager pages (adsmanager.facebook.com, business.facebook.com and the
  /adsmanager path of www.facebook.com), never on your feed, Messenger or profiles.
- It does not sell or share data, and has no ads or analytics.
- It does not decide for Meta: the states shown are operational records kept in your own
  workspace. They are not a platform decision and do not guarantee that an account cannot be
  restricted or that an ad will be approved.

You need an AdsOps Control Center workspace (an account on your organisation's own AdsOps
dashboard). The extension connects only to the dashboard address you enter in Options, and
signs in with that dashboard's own email and password. Accounts that are not registered in your
workspace are shown as "Not registered" — the extension never guesses.

Interface languages: Tiếng Việt, English.
Privacy policy: <URL CHÍNH SÁCH QUYỀN RIÊNG TƯ>
```

**Tiếng Việt**

```
AdsOps Control Center hiện, ngay cạnh Meta Ads Manager, những gì dashboard AdsOps của đội bạn đã
biết về tài khoản quảng cáo bạn đang xem.

Mở một trang Ads Manager, extension nhận ra tài khoản theo đúng mã tài khoản (khớp tuyệt đối), rồi
hiện trong side panel và popup:
- trạng thái sẵn sàng của tài khoản và mức độ còn mới của trạng thái đó;
- trạng thái sức khoẻ và các cảnh báo đang mở (nếu có);
- các số liệu vận hành đã được ghi trong workspace AdsOps của bạn;
- danh sách kiểm "Workspace Guard": để đồng nghiệp ghi lại rằng mình đã rà soát tài khoản trước
  khi thay đổi, và thêm ghi chú vào dòng thời gian của tài khoản.

Extension KHÔNG làm gì:
- Chỉ đọc trên trang. Không bấm, không sửa, không gửi biểu mẫu, không tự động hoá, không chặn
  thao tác nào trong Ads Manager, và không ghi gì vào trang.
- Không đọc cookie, localStorage, sessionStorage, IndexedDB, lưu lượng mạng, phím gõ hay giá trị
  trong biểu mẫu.
- Chỉ chạy trên các trang Ads Manager (adsmanager.facebook.com, business.facebook.com và đường
  dẫn /adsmanager của www.facebook.com); không chạy trên bảng tin, Messenger hay trang cá nhân.
- Không bán hay chia sẻ dữ liệu, không quảng cáo, không phân tích hành vi.
- Không phán quyết thay Meta: các trạng thái hiển thị là ghi nhận vận hành trong workspace của
  chính bạn, không phải quyết định của nền tảng, và không bảo đảm tài khoản không bị hạn chế hay
  quảng cáo sẽ được duyệt.

Cần có workspace AdsOps Control Center (tài khoản trên dashboard AdsOps do tổ chức của bạn vận
hành). Extension chỉ kết nối tới địa chỉ dashboard bạn nhập ở Tuỳ chọn và đăng nhập bằng chính
email/mật khẩu của dashboard đó. Tài khoản chưa đăng ký trong workspace sẽ hiện "Chưa đăng ký" —
extension không bao giờ đoán.

Ngôn ngữ giao diện: Tiếng Việt, English.
Chính sách quyền riêng tư: <URL CHÍNH SÁCH QUYỀN RIÊNG TƯ>
```

Các câu cấm đã tránh (luật 6): không có "không bao giờ bị khoá", "đảm bảo duyệt". Hai câu phủ định ở
trên nói ngược lại (không bảo đảm) và được phép. Các câu "KHÔNG làm gì" đã đối chiếu: luật 32,
33, 36; `PERMISSIONS.md`; manifest (CSP, host_permissions).

**Chú ý đối chiếu khi bản 0.2.0 hoàn tất:** nếu side panel hiện thêm số chi tiêu, dòng "operational
figures" vẫn đúng. Đừng thêm câu về chi tiêu cụ thể (số liệu chi tiêu chưa từng đọc từ Meta thật
theo `FEATURES.md` S1 — không quảng cáo).

### 2.4 Danh mục, ngôn ngữ, liên kết

| Trường | Giá trị đề xuất | Ghi chú |
|---|---|---|
| Primary category | **Workflow & Planning** (dự phòng: Productivity) | **[CHƯA KIỂM]** tên danh mục hiện hành — trang docs không liệt kê; chọn trong dropdown của dashboard |
| Language | Tiếng Việt (chính) + English | Mô tả chi tiết/ảnh chụp có thể bản địa hoá theo ngôn ngữ; **ô tile nhỏ không bản địa hoá được** (docs) |
| Official URL | để trống lượt đầu | Cần miền đã xác minh |
| Homepage URL | `<URL TRANG SẢN PHẨM>` | Chưa có — chưa bịa. Có thể dùng chính URL chính sách khi chưa có trang giới thiệu |
| Support URL | `<URL HỖ TRỢ hoặc mailto>` | `<EMAIL LIÊN HỆ>` |
| Mature content | Tắt | |
| YouTube video | bỏ qua | tuỳ chọn |

---

## 3. Tài nguyên hình ảnh (số đo lấy từ developer.chrome.com/docs/webstore/images và /cws-dashboard-listing)

| Tài nguyên | Kích thước chính xác | Bắt buộc | Ghi chú |
|---|---|---|---|
| Store icon | **128x128 px**, PNG (hình 96x96 + 16 px trong suốt mỗi cạnh) | **Có** | Hiện **chưa có tệp** (B1) |
| Ảnh chụp màn hình | **1280x800** hoặc **640x400** | Có, ≥1, tối đa **5** | Góc vuông, **tràn khung, không viền đệm** |
| Small promo tile | **440x280** | Không | PNG hoặc JPEG |
| Marquee promo tile | 1400x560 | Không | Bỏ qua lượt đầu |

Chỉ icon và ≥1 ảnh chụp là bắt buộc.

### Danh sách ảnh nên chụp (1280x800)

Dùng **dữ liệu minh hoạ của workspace thử**, không chụp tài khoản khách thật; che mã tài khoản
thật nếu có. Mọi trạng thái hiển thị thật — không dựng trạng thái "đẹp" không có trong sản phẩm.
(Quy tắc: không trình dữ liệu bịa; ghi chú ảnh là dữ liệu thử.)

| # | Màn hình | Cần cho thấy |
|---|---|---|
| 1 | Ads Manager + side panel, tài khoản đã đăng ký | Trạng thái `Confirmed`, readiness + health + cảnh báo. Ảnh chính |
| 2 | Popup trên trang tài khoản đã đăng ký | Tóm tắt nhỏ, nút "Open account" |
| 3 | Trạng thái `Not registered` (tài khoản lạ) | Chứng minh "không đoán bừa" (luật 31) |
| 4 | Workspace Guard: checklist + ô ghi chú | Cho thấy đây là bản **ghi nhận**, dòng chữ chỉ-đọc ("changes nothing in Ads Manager") còn đó (luật 33) |
| 5 | Trang Options | Ô địa chỉ dashboard + đăng nhập, nút Disconnect — minh bạch về nơi dữ liệu đi |

Ảnh nên có chú thích ngắn bằng EN và VI (hai bộ ảnh nếu bản địa hoá). Small tile 440x280: nền
đơn sắc + tên + một dòng "Read-only account context for Ads Manager" — không dùng logo Meta/Facebook.

---

## 4. Tab "Privacy practices"

### 4.1 Single purpose (mục đích đơn nhất)

**EN:** `Show the readiness, health and open alerts that the user's own AdsOps dashboard holds for the ad account currently open in Meta Ads Manager, and let the user record a review note against that account. Read-only on the page.`

**VI:** `Hiển thị trạng thái sẵn sàng, sức khoẻ và cảnh báo mà dashboard AdsOps của chính người dùng đang giữ cho tài khoản quảng cáo đang mở trong Meta Ads Manager, và cho phép ghi một ghi chú rà soát vào tài khoản đó. Chỉ đọc trên trang.`

Trường này dán EN (dashboard thường nhận một ngôn ngữ; ô này không bản địa hoá theo docs đã đọc — **[CHƯA KIỂM]**).

### 4.2 Lý do cho từng quyền (permission justification)

Dán EN. Nguồn: `extension/PERMISSIONS.md` + `manifest.json`.

| Quyền | Lý do (EN, dán vào dashboard) | Ghi chú VI |
|---|---|---|
| `storage` | `Stores the dashboard address the user enters, the extension's own session token (in-memory session storage where available), the interface language, and a short per-tab cache of the last result. It is never used to read anything a website stored.` | Token ở `chrome.storage.session` (xoá khi đóng trình duyệt); cài đặt ở `local` |
| `sidePanel` | `Opens the account panel beside Ads Manager so the user can see the account's status while working.` | |
| `activeTab` | `Reads the URL of the tab the user is actively looking at when they open the popup, to identify which ad account is shown. Not a standing permission over all tabs.` | **Lưu ý:** mã gọi `chrome.tabs.query({active, currentWindow})` — hoạt động nhờ host permission khớp + activeTab; không xin `tabs` |
| Host `https://adsmanager.facebook.com/*` | `The read-only content script runs here to read the ad account id from the page URL and the account name from the page title (display only).` | |
| Host `https://business.facebook.com/*` | `Same purpose: Ads Manager is also served from business.facebook.com. The script reads only the URL and title.` | |
| Host `https://www.facebook.com/adsmanager/*` | `Same purpose; scoped to the /adsmanager path so the script never loads on the Facebook feed, Messenger or profiles.` | |

Điểm cần biết với người duyệt: host permission rộng hơn "một trang" nhưng **không có** `<all_urls>`,
`cookies`, `webRequest`, `scripting`, `tabs`, `proxy`, `debugger` (PERMISSIONS.md). API của dashboard
**không** nằm trong `host_permissions` — gọi qua CORS thường. Việc này làm người duyệt khó thấy
extension nói chuyện với đâu: nêu rõ ở "Test instructions" (mục 8).

### 4.3 Remote code

**Chọn: "No, I am not using remote code."** Đã đối chiếu: CSP trang extension là
`script-src 'self'; object-src 'none'; base-uri 'none'`; content script khai báo tĩnh
(`content/content.js`); không có `scripting`; không `eval`/tải script từ URL. **[CHƯA KIỂM bằng quét
bản build cuối]** — chạy `grep -rn "eval(\|new Function\|importScripts" extension/dist` trên bản
sẽ nộp để khẳng định.

### 4.4 Khai báo dữ liệu (Data usage)

Dựa trên mã `service-worker.ts`, `auth-session.ts`, `context-detector.ts` (đọc 2026-10-26). Dữ liệu
chỉ đi tới **dashboard do chính người dùng/tổ chức vận hành** (địa chỉ nhập ở Options); không có bên
thứ ba, không phân tích, không quảng cáo.

| Dữ liệu | Gửi đi? | Chi tiết (đối chiếu mã) |
|---|---|---|
| Mã tài khoản quảng cáo (`act=`) | Có | `POST /api/v1/extension/context/resolve`: `external_account_id`, `page_type`, `safe_path`, `extension_version` |
| Route (đường dẫn đã lọc, `safe_path`) | Có | Qua `sanitisePath` — bỏ query string; **không** gửi URL thô (luật 35) |
| Tên tài khoản từ tiêu đề trang | **Không gửi** | `displayName` chỉ dùng hiển thị tại chỗ; **không có** trong body của `resolve` lẫn `events` (đọc mã). Yêu cầu giao việc nói tên lấy từ tiêu đề trang được gửi: **mã không làm vậy**, nên tài liệu theo mã |
| Email + mật khẩu dashboard | Có, đúng một lần khi bấm Connect | `POST /api/v1/auth/login` tới dashboard của chính người dùng. Mật khẩu **không lưu** (hard rule 1, `auth-session.ts`); đổi lấy token loại `extension` rồi bỏ token dashboard |
| Token phiên extension | Lưu cục bộ + gửi kèm mỗi lệnh gọi | `chrome.storage.session` (bộ nhớ, mất khi đóng trình duyệt) |
| Email người dùng, tên workspace | Nhận về, lưu cục bộ để hiển thị | `StoredConnection` |
| Nhãn thiết bị (`label`), ID cài đặt ngẫu nhiên | Có | `extension_instance_id` (16 byte ngẫu nhiên do extension tạo), `label` người dùng gõ, `extension_version` |
| Ghi chú / loại sự kiện Workspace Guard | Có, **chỉ khi người dùng bấm ghi** | `POST /api/v1/extension/events`: `ad_account_id`, `event_type` (danh sách cố định), `note` (người dùng gõ), `page_type`, `safe_path` |
| Cookie / localStorage / sessionStorage / IndexedDB / lưu lượng mạng / phím gõ / biểu mẫu | **Không đọc** | Luật 32; eslint chặn |

**Đề xuất tick các nhóm trong dashboard** (người duyệt sẽ đối chiếu với hành vi; chọn thận trọng —
**[CHƯA KIỂM]** tên nhóm hiện hành vì trang `cws-dashboard-privacy` đọc được không liệt kê danh mục;
chọn theo dropdown thực):

- **Authentication information** — có (email + mật khẩu nhập để đăng nhập dashboard; token phiên).
- **Personally identifiable information** — có (email người dùng; ghi chú tự do có thể chứa tên).
- **Website content** — cân nhắc có (mã tài khoản + đường dẫn trang quảng cáo; tên tài khoản chỉ hiển thị cục bộ). Chọn "có" nếu phân vân: khai thừa an toàn hơn khai thiếu.
- **User activity / Web history** — không chọn nếu hiểu theo nghĩa theo dõi lịch sử duyệt; nhưng route + mã tài khoản gửi đi là một dạng "đang xem tài khoản nào". Quyết định cuối thuộc người nộp; nếu chọn, ghi trong chính sách (đã ghi).
- Các nhóm khác (health, financial, location, personal communications): **không**.

**Ba chứng nhận bắt buộc** (tick cả ba):

1. Không bán hoặc chuyển dữ liệu người dùng cho bên thứ ba ngoài các trường hợp được phép.
2. Không dùng/chuyển dữ liệu cho mục đích không liên quan đến chức năng đơn nhất của sản phẩm.
3. Không dùng/chuyển dữ liệu để xác định mức tín dụng hay mục đích cho vay.

Lưu ý: trang docs tôi đọc chỉ nói "certify compliance with the limited use policy"; **ba câu trên là
cách diễn đạt quen thuộc, [CHƯA KIỂM] nguyên văn hiện hành** — đọc đúng chữ trên dashboard và tick
theo đó. Đúng với hành vi mã (không bán, không dùng ngoài mục đích).

**Privacy policy URL**: bắt buộc vì sản phẩm xử lý dữ liệu người dùng (policy: "If your Product handles
any user data, then you must post an accurate and up to date privacy policy", phải gắn qua ô riêng
trong dashboard). Nội dung: `docs/PRIVACY_POLICY_EXTENSION.md`. Cần URL HTTPS công khai — mục 9.

---

## 5. Chọn kiểu phân phối

Docs (cws-dashboard-distribution) xác nhận: **Public / Unlisted / Private đều dùng cùng chính sách và
cùng quy trình duyệt**. Khác nhau ở ai thấy/cài được.

| | Private (Trusted testers) | **Unlisted** | Public |
|---|---|---|---|
| Ai cài | Chỉ email Google trong danh sách tester (cấp ở tài khoản developer, không theo item) hoặc Google Group bạn quản lý | Bất kỳ ai có URL của item | Mọi người, có trong tìm kiếm |
| Hiện trong tìm kiếm | Không | Không | Có |
| Phù hợp | 3-10 người nội bộ thử | Gửi link cho khách chọn lọc | Bán rộng |
| Hạn chế | Phải có Google Account; nhóm tester là của cả tài khoản dev | Link bị chuyền tay là cài được; mã ở công khai | Bị soi nhiều hơn, review chính sách/nhãn hiệu kỹ hơn |

**Khuyến nghị: Unlisted trước** (Private nếu chỉ nội bộ thuần). Lý do: (1) extension vô dụng nếu không có
workspace AdsOps — không cần tìm kiếm công khai; (2) vẫn đủ cho khách tương lai (gửi link, chưa phải
cam kết hỗ trợ cho công chúng, khớp `ROADMAP_COMMERCIAL.md` — mô hình một extension id dùng chung);
(3) có thể chuyển sang Public sau mà **ID không đổi**. Đổi sang Public khi: có trang giới thiệu, quy
trình hỗ trợ, miền xác minh và đã qua UAT (`RUNBOOK_EXTENSION_UAT.md` — hiện **chưa từng thực hiện**;
theo CLAUDE.md, extension chưa chạy trong trình duyệt thật. Không nên nộp trước UAT).

Khu vực: "All regions" mặc định; nếu chỉ bán cho VN thì chọn VN. Docs: sau khi publish thì hiện ngay trong
các khu vực chọn.

### ID cố định và CORS

Khi tạo item, Store cấp **ID extension cố định** (32 chữ cái) — id này không đổi qua các bản cập nhật
và các mức hiển thị. Vì vậy:

1. Lấy ID từ dashboard (sau khi tải gói lên lần đầu, có thể trước khi nộp duyệt — **[CHƯA KIỂM]**
   đúng thời điểm ID xuất hiện; thường là ngay sau khi tạo item).
2. Thêm vào backend: `CORS_ORIGINS=<origin dashboard>,chrome-extension://<ID>` (PERMISSIONS.md; đây là
   origin chính xác, không phải ký tự đại diện, nên không làm yếu kiểm tra cấu hình production của A4).
3. Cần release backend (đổi cấu hình môi trường + redeploy) — là hành động **cần duyệt riêng** (luật 22).
4. ID khi nạp "Load unpacked" **khác** ID từ Store. UAT trên dist chưa đăng dùng ID khác; sau khi đăng
   phải thêm ID Store. Nên giữ cả hai trong `CORS_ORIGINS` giai đoạn thử.

---

## 6. Các bước tải lên và nộp (đối chiếu docs `publish`)

1. Sửa B1, B2; hoàn tất bản 0.2.0 và cập nhật chuỗi mô tả/ảnh; chạy `npm run lint && npm run typecheck && npm test && npm run build` trong `extension/`.
2. **Hoàn tất UAT** (`RUNBOOK_EXTENSION_UAT.md` §1: chạy `check-urls` với URL Ads Manager thật). Việc này có thể làm ngay.
3. Tạo gói: zip **nội dung** của `extension/dist/` sao cho `manifest.json` nằm ở **gốc zip** (không bọc thêm thư mục). Chứa mọi tệp. Tối đa 2 GB (dư xa). Nên kiểm: `unzip -l` thấy `manifest.json` ở gốc. (`extension/dist.zip` hiện có là bản cũ 2025-09-07 — **không dùng**, dựng lại.) Không obfuscate; minify được nhưng nên gửi mã dễ duyệt (docs review-process).
4. Dashboard → **Add new item** → tải zip.
5. Điền các tab: **Store listing** (mục 2-3), **Privacy practices** (mục 4), **Distribution** (mục 5: visibility, regions), **Test instructions** (mục 8).
6. Bấm **Submit for review**, xác nhận. Chọn **defer publish** nếu muốn tự bấm đăng sau khi duyệt xong (phải đăng trong **30 ngày** sau duyệt, nếu không về lại nháp).
7. Sau khi được duyệt và publish: lấy URL item, ghi ID vào `CORS_ORIGINS` (mục 5), release backend, rồi cài từ Store và thử lại từ đầu.
8. Ghi kết quả thật vào `TEST_LOG.md` (kể cả bị từ chối).

---

## 7. Duyệt và cập nhật

**Thời gian duyệt (docs review-process, cập nhật gần nhất của trang là 2021-12):** phần lớn trong vài
ngày, có thể tới vài tuần; chờ quá **3 tuần** thì liên hệ developer support. Lâu hơn với nhà phát triển
mới, extension mới, quyền nhạy cảm, hoặc gửi lại sau khi bị từ chối. Ta là nhà phát triển mới + extension
mới: **dự kiến vài ngày tới ~1-2 tuần; đừng hứa mốc cho khách.** **[CHƯA KIỂM]** con số hiện hành.

**Yếu tố khiến bị soi kỹ:** host pattern rộng (`<all_urls>`, `*://*/*`) — ta không có; `cookies`/`webRequest`
kèm host — ta không có; mã khó đọc. Ta đã tối thiểu quyền (luật 36): đây là điểm mạnh, nhưng người duyệt
sẽ hỏi (a) vì sao có `facebook.com` ở host, (b) extension nói chuyện với server nào — chuẩn bị câu trả lời ở mục 8.

**Từ chối:** nhận email nêu điều khoản vi phạm + cách khiếu nại; bản đang live (nếu có) không bị ảnh hưởng.
Nếu phát hiện mã độc thì sang xử lý riêng, không phải từ chối thường.

**Cập nhật:**
1. Tăng `version` ở **cả** `extension/src/manifest.json` và `extension/package.json` (mỗi bản mới phải **lớn hơn** bản trước; ví dụ 0.2.0 → 0.2.1 hoặc 0.3.0).
2. `npm run build`, zip lại (toàn bộ tệp, cả tệp không đổi), Package tab → **Upload new package**.
3. Nếu danh sách/ quyền/ quyền riêng tư đổi thì sửa các tab tương ứng. **Thêm quyền mới → người dùng bị hỏi lại, có thể tắt extension** — tránh trừ khi cần.
4. **Submit for review**. Nộp không làm đổi bản đang chạy cho đến khi publish.
5. Rollout theo % chỉ có khi item có **>10 000 người dùng hoạt động 7 ngày** — chưa áp dụng.
6. **[CHƯA KIỂM]** thời gian bản mới tới máy người dùng: docs không nêu.

Nếu cần bản beta song song: tên phải có "BETA"/"DEVELOPMENT BUILD" và mô tả nói rõ để không bị gỡ nhầm (docs distribution).

---

## 8. Test instructions (tab "Test instructions") — bắt buộc phải có để qua duyệt

Người duyệt không có tài khoản dashboard, nên gói cần: (đây là phần **cần người làm**)

```
The extension is the companion of a private dashboard (AdsOps Control Center). To test:
1. Open the extension Options page. Dashboard address: <URL DASHBOARD DÙNG THỬ>.
   Sign in with: <EMAIL TÀI KHOẢN DUYỆT> / <MẬT KHẨU> (a dedicated review account in a demo workspace).
2. Open https://adsmanager.facebook.com/ and any ad account page. (A Meta account with ads access is
   needed to see real pages; a registered demo account id is <MÃ TÀI KHOẢN THỬ>.)
3. The popup / side panel shows readiness, health and alerts for the account id in the page URL.
4. Network: the extension talks only to the dashboard address entered in Options (CORS, no host permission).
   It does not read cookies or page content, and writes nothing into the page.
```

Không dán mật khẩu thật vào tài liệu/repo (luật 42). Tạo **tài khoản chỉ-xem riêng cho người duyệt** trong
workspace demo, đổi mật khẩu sau khi duyệt. Khi tạo tài khoản mới tức là **thao tác trên dashboard thật** —
cần người dùng duyệt. Rủi ro: **dashboard production hiện không truy cập được** (mục 9) nên chưa có
`<URL DASHBOARD DÙNG THỬ>`.

---

## 9. Còn chặn gì

| # | Chặn | Trạng thái (đo 2026-10-26 hay lấy từ CLAUDE.md?) | Hướng gỡ |
|---|---|---|---|
| 1 | **URL chính sách quyền riêng tư HTTPS công khai** | Chưa có. Frontend production không truy cập được (CLAUDE.md, đo 2026-09-14; **chưa đo lại hôm nay** — luật 41, đo lại trước khi viết tiếp) | Xem lựa chọn dưới |
| 2 | Icon + khoá `icons` trong manifest (B1) | Đã đo hôm nay | Mini-spec nhỏ |
| 3 | Mô tả manifest 140 > 132 (B2) | Đã đo hôm nay | Sửa chuỗi |
| 4 | UAT chưa từng chạy trong Chrome thật | `RUNBOOK_EXTENSION_UAT.md`, CLAUDE.md | Người dùng làm, đường (a)/(b)/(c) |
| 5 | Dashboard HTTPS cho extension (`isUsableDashboardUrl`: chỉ `https://` hoặc localhost) và cho người duyệt | Frontend production unreachable; **backend** có địa chỉ `audit-ads-backend.cmc-1.vibenode.matbao.ai` (đo 2026-09-14) | Cần định tuyến frontend (việc của hosting panel) hoặc dùng backend trực tiếp |
| 6 | Tài khoản developer + phí + 2SV + email xác minh | Việc của người | Mục 1 |
| 7 | Tên pháp nhân, email, địa chỉ cho chính sách | Không bịa | Điền placeholder |
| 8 | Ảnh chụp, tile | Chưa có | Mục 3, sau khi UAT chạy được |
| 9 | Dùng bản 0.2.0 + khối chi tiêu | Agent khác đang làm | Đối chiếu lại mô tả/ảnh |

### Chỗ lưu trữ URL chính sách (chọn một — không cái nào được thực hiện ở đây)

URL phải công khai, HTTPS, ổn định, không cần đăng nhập, mở nhanh. Không đặt sau dashboard (frontend chết,
và người chưa đăng nhập phải đọc được).

| Phương án | Ưu | Nhược | Chi phí/việc |
|---|---|---|---|
| **A. GitHub Pages** từ repo (repo có `.github/workflows`, nên đã ở GitHub) — dựng `docs/privacy/index.html` hoặc dùng Pages với Markdown | Miễn phí, HTTPS, không phụ thuộc hạ tầng đang hỏng | Repo có thể private (Pages cho repo private cần gói trả phí **[CHƯA KIỂM]**); địa chỉ `*.github.io` nhìn không chính thức; đẩy lên GitHub cần quyền (kiến thức workspace: push GitHub cần external-auth) | Thấp |
| **B. Một dự án tĩnh nhỏ trên Vibe Host** | Cùng nền tảng hiện có, miền công ty | Nền tảng vừa lỗi định tuyến; subdomain phải duy nhất toàn nền tảng. Mỗi deploy là hành động cần duyệt (luật 22) | Trung bình |
| **C. Trang trên cổng/miền công ty đã có** (ví dụ cổng kết nối marcom-matbao.io.vn mà ROADMAP_COMMERCIAL nhắc tới, cần có sẵn trang `/privacy`) | Miền thật của công ty — tốt nhất cho "Official URL"/xác minh sau này; Meta cũng cần URL privacy cho app review (ROADMAP_COMMERCIAL §Phase 4) → **dùng chung một URL** | **[CHƯA KIỂM]** miền này đang phục vụ được không; cần người quản trị cổng | Thấp nếu cổng sống |
| **D. Google Sites** (tài khoản Google công ty) | Không cần hạ tầng, HTTPS, công khai nhanh | Giao diện hơi nghiệp dư; khó sau này gắn miền | Rất thấp |

**Khuyến nghị:** C nếu cổng công ty đang online (dùng lại cho cả Meta App Review); nếu không thì **D** để
gỡ chặn nhanh nhất, rồi chuyển URL sang miền chính thức khi có (đổi URL trong dashboard không cần bản mới
của extension — **[CHƯA KIỂM]**: Store có thể yêu cầu duyệt lại thông tin listing). Không cần xác minh
miền cho lượt Unlisted đầu.

---

## 10. Việc người dùng phải tự làm (tổng hợp)

1. Tạo/ chọn tài khoản Google công ty, bật 2SV, đăng ký developer, trả phí (xem số hiện hành), đặt Publisher name, xác minh email liên hệ.
2. Quyết định pháp nhân/địa chỉ/email và điền placeholder trong `docs/PRIVACY_POLICY_EXTENSION.md`; chọn nơi host và công bố URL.
3. Cho phép một mini-spec nhỏ: icon + khoá `icons`, rút `description` ≤132, (tuỳ chọn) `_locales`.
4. Chạy UAT trong Chrome thật (và gửi lại các URL Ads Manager thật cho `check-urls`).
5. Chụp ảnh (workspace thử), làm tile nhỏ.
6. Tạo tài khoản duyệt + dashboard HTTPS truy cập được cho người duyệt; ghi chú test.
7. Bấm Submit; sau khi có ID: duyệt riêng việc release backend thêm `chrome-extension://<ID>` vào `CORS_ORIGINS`.
8. Quyết định Unlisted/Private/Public (khuyến nghị Unlisted).

---

## 11. Nguồn đã đọc và những gì không kiểm được

Đã đọc (2026-10-26):
- developer.chrome.com/docs/webstore/register
- developer.chrome.com/docs/webstore/set-up-account
- developer.chrome.com/docs/webstore/publish
- developer.chrome.com/docs/webstore/images
- developer.chrome.com/docs/webstore/cws-dashboard-listing
- developer.chrome.com/docs/webstore/cws-dashboard-privacy
- developer.chrome.com/docs/webstore/cws-dashboard-distribution
- developer.chrome.com/docs/webstore/review-process
- developer.chrome.com/docs/webstore/update
- developer.chrome.com/docs/webstore/program-policies/privacy
- Kết quả tìm kiếm tóm tắt từ developer.chrome.com/docs/webstore/program-policies (2SV) và /docs/extensions/whats-new (phí)
  (`/program-policies/user-data-faq` trả 404.)

**Không kiểm được / chưa đối chiếu nguyên văn:**
- Số tiền phí hiện hành (docs không ghi; "5 USD" chỉ qua kết quả tìm kiếm).
- Nguyên văn yêu cầu 2SV.
- Giới hạn 132 ký tự (kiến thức chung, docs đọc không nêu).
- Danh sách quốc gia được hỗ trợ (có VN không); danh mục (category) hiện hành; tên nhóm dữ liệu và nguyên văn ba chứng nhận; thời điểm ID xuất hiện; thời gian lan truyền bản cập nhật; việc đổi URL privacy sau khi đăng có kích hoạt duyệt lại không; cách xác minh miền.
- Trạng thái hôm nay của frontend production, miền cổng, GitHub private/public (số liệu cũ là 2026-09-14).
- Hành vi extension trong Chrome thật (chưa từng chạy).
- Rằng bản 0.2.0 sau khi hoàn tất vẫn khớp mô tả.
