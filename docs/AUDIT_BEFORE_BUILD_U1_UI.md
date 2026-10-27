# Audit Before Build — U1 · Hệ thống giao diện & làm mới thị giác (dashboard + tiện ích Chrome)

`ID`: **U1** · `Name`: UI system & visual redesign · `Parent phase`: Lớp UX dùng chung cho mọi phase
(A1–A10, O1.1, S1, S2) · `Author`: Nguyễn Thiên Triều <trieunt@matbao.com> (team `mk`) ·
`Date`: 2026-10-27 · Baseline: `c7f01ea` (S2) + working tree (`M docs/VIBEHOST_SUPPORT_REQUEST.md`,
`?? docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md` — không liên quan U1).

**Đây là bản audit + spec + bản xem trước. Không một dòng mã sản phẩm nào được sửa.** Không cài gói,
không commit, không đăng nhập ứng dụng đang chạy (rule 42), không gọi Meta, không deploy. Bước 4
(code) chỉ bắt đầu khi chủ sản phẩm chốt §12 (câu hỏi mở) và duyệt bản xem trước
`docs/ui/U1_PREVIEW.html`.

Khuôn theo `MINI_SPEC_PLAYBOOK.md` v2 (+§13) và quy trình 7 bước của skill `ui-ux-resource-navigator`;
mục §10 của skill được điền đủ ở §6–§11 dưới đây.

---

## 0. Đo được gì, không đo được gì (rule 41)

| Nguồn | Trạng thái lúc viết | Cách đo |
|---|---|---|
| Mã nguồn frontend | 94 tệp `src/`, 73 tệp không phải test, 13.714 dòng (không tính test) | `find`, `wc -l` tại `c7f01ea` |
| Bộ test frontend | **207 passed, 20 skipped** (20 tệp + 1 tệp live bị skip), 7,5 s | `npx vitest run` chạy 2026-10-27 11:19 |
| Bộ test tiện ích | **không chạy lại hôm nay**; `TEST_LOG.md` (S2) ghi 74 passed | đọc `TEST_LOG.md` |
| Frontend production | **không đo lại hôm nay.** Ghi chú `CLAUDE.md` 2026-10-26: `audit-ads-app…` trả catch-all 404 | không có bằng chứng mới → mọi nhận xét dưới đây là từ mã, không từ màn hình thật |
| Click-through trình duyệt | **không thể**: agent không được đúc phiên (rule 42, memory `project_audit_ads_clickthrough_blocked`) | — |
| Mockup cũ | `docs/MOCKUP.md` chỉ có mockup A6 Preflight (2026-09-08), không có hệ thiết kế | đọc tệp |
| Giấy phép font/icon | Be Vietnam Pro (SIL OFL), JetBrains Mono (SIL OFL), Lucide (ISC), Radix/shadcn (MIT) — **theo hiểu biết, chưa mở trang giấy phép hôm nay** | quy tắc bảo trì của skill: mở trang giấy phép trước khi cài (U1a) |

---

## 1. Context (bắt buộc hiểu trước khi chạm mã)

- Tài liệu: `CLAUDE.md` (42 luật cứng), `MINI_SPEC_PLAYBOOK.md`, `FEATURES.md`, `ARCH.md`,
  `API.md`, `TEST_LOG.md`, `docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` (S2 — quyết định "Meta active
  không bao giờ xanh"), `docs/ACCESS_SCOPE_MATRIX.md` (vai `owner` / `operator` / `viewer` / `auditor`).
- Trạng thái: dashboard React 18 + Vite 6 + Tailwind 3.4 + TanStack Query 5 + react-router 6; **không
  có** thư viện component, icon, chart, i18n, dark mode. Giao diện tiếng Anh toàn bộ. Tiện ích Chrome
  (React 18, CSS thuần) **đã có** lớp i18n VI/EN với kiểm tra khoá lúc biên dịch
  (`extension/src/shared/i18n/`), mặc định `vi`.
- Quyết định kiến trúc **phải giữ nguyên**:
  - Màu/nhãn của trạng thái quyết định **một chỗ**: `frontend/src/lib/readiness.ts` (`TONE_CLASS`,
    `READINESS_META`, `SPEND_FRESHNESS_META`), `lib/health.ts`, `lib/platformStatus.ts`,
    `lib/alerts.ts`; tiện ích: `extension/src/shared/presentation.ts`.
  - `unknown`, `not_ready`, mọi độ mới chi tiêu, mọi trạng thái Meta (kể cả `active`) **không bao giờ**
    mang kiểu thành công (rule 5, S2 §7).
  - Số tiền Meta là **chuỗi nguyên văn**, không parse/chia/định dạng (`lib/spend.ts:3-7`, S1). Thiếu
    dòng là "—", **không phải 0** (`AccountSpendCell.tsx:8-10`, `SpendTab.tsx:195`).
  - Readiness ≠ health, không điểm số (rule 9, 11). Không nói "an toàn / sẽ được duyệt" (rule 6).
  - Tiện ích không tự động hoá, không chặn gì trong Ads Manager (rule 33); khớp tài khoản theo id
    chính xác (rule 31).
  - CSP production: `font-src 'self' data:`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`
    (`frontend/default.conf.template:41`) → **font phải tự host**, không CDN, không script ngoài.
  - Wording thuộc BA (CLAUDE.md toàn cục, hợp đồng BA⇄DEV). Mọi chuỗi tiếng Việt đề xuất ở đây gắn
    `[ĐỀ XUẤT — chờ duyệt]` và sẽ nằm trong tệp i18n, không rải trong JSX.

---

## 2. Goal

> Người vận hành Việt Nam mở dashboard hoặc side panel và **thấy ngay việc cần làm, bằng tiếng Việt,
> trên một hệ thống thị giác nhất quán (token, chữ, icon, trạng thái)** — mà không một trạng thái
> "không biết" nào trông như "ổn".

---

## 3. Constraints (guardrails)

1. **Additive-first.** Không đổi API, schema, enum, service, state machine. Không đổi `queryKey`, URL
   filter/tab (bookmark hiện có vẫn chạy).
2. Ba tệp quyết định màu (`readiness.ts`, `health.ts`, `platformStatus.ts`, + `alerts.ts`) **vẫn là nơi
   duy nhất** quyết định tone. U1 chỉ đổi *giá trị* của `TONE_CLASS` sang lớp token; không thêm nơi
   quyết định thứ hai. Test hiện có "no positive for unknown/Meta/freshness" phải tiếp tục xanh.
3. Không thêm tone mới mang nghĩa thành công; không thêm điểm số, thanh "sức khoẻ %" hay biểu tượng
   ✓ cho `unknown`/`not_ready`/`active (Meta)`.
4. Chuỗi hiển thị lấy từ i18n (`vi` là nguồn sự thật, `en` kiểm tra khoá lúc biên dịch như tiện ích).
   Không "tự chế" wording: mỗi chuỗi là `[ĐỀ XUẤT — chờ duyệt]` cho tới khi BA duyệt.
5. Số tiền Meta giữ nguyên chuỗi thô; chỉ đổi **cách trình bày** (căn phải, `tabular-nums`, mono, kèm
   tiền tệ, kèm ngày/nguồn). Không vẽ biểu đồ từ chuỗi thô (xem Q5).
6. Không thêm script/CSS/font từ CDN vào bundle sản phẩm (CSP). Mọi gói là dependency build-time.
7. Một bộ icon (Lucide), tối đa hai họ font, một thư viện component. Không trộn.
8. Mỗi màn hình dữ liệu có đủ 5 trạng thái: tải / rỗng / lỗi / không có quyền / một phần dữ liệu.
9. Không dùng `window.confirm`; hành động không hoàn tác dùng hộp xác nhận nêu đối tượng + hệ quả
   (§6.4 skill). Lưu trữ vẫn là `archived_at`, không có nút xoá.
10. Mỗi lát (U1a–U1e) tự kiểm được: `vitest`, `tsc -b`, `vite build`, `eslint` xanh; test
    regression token/i18n/a11y mới phải có trong lát đó.
11. Thiếu bằng chứng → ghi "chưa kiểm" (ví dụ: dấu tiếng Việt trên Chrome thật, side panel thật),
    không ghi "đã kiểm".

---

## 4. Scope

### A. Domain model — **không đổi.**
### B. Service / Engine — **không đổi.**
### C. API contract — **không đổi.** (Nhận xét: `GET /api/v1/ad-accounts` đã trả `platform_status`,
`spend` compact; `/spend/summary` đã trả `platform_status_counts`. Đủ cho mọi màn hình đề xuất.)

### D. UI surfaces (trọng tâm)

| Lớp | Việc |
|---|---|
| Token | Biến CSS sáng/tối (màu, chữ, khoảng cách, bo góc, bóng, z) → `tailwind.config.js` đọc biến; `index.css` khai báo; `TONE_CLASS` trỏ về lớp token |
| Shell | `AppShell` mới: sidebar nhóm (7 nhóm, co được trên mobile thành Sheet), header (workspace, tìm nhanh, chủ đề, ngôn ngữ, menu người dùng), một disclaimer/trang |
| i18n | `src/i18n/{vi,en,types,index}.ts` + `useI18n()`; `format.ts` nhận locale từ ngôn ngữ |
| Component | shadcn/ui copy-in (Radix) thay `ui.tsx` dần: Button, Badge, Card, Tabs, Sheet, Dialog/AlertDialog, DropdownMenu, Select, Input, Label, Checkbox, Textarea, Table, Tooltip, Skeleton, Separator, Popover; thêm `EmptyState`, `ErrorState`, `NoPermissionState`, `PartialDataNote`, `StatTile`, `SegmentBar` của dự án |
| Trang | 5 khuôn trang (§9) áp cho 21 route hiện có; không route mới bắt buộc |
| Tiện ích | Cùng giá trị token (CSS thuần), dark theo `prefers-color-scheme`, `lang` theo ngôn ngữ, nhãn cho `page_type`, 3–4 icon Lucide SVG inline |

### E. Tests — §10.

---

## 5. Audit Before Build

### 5a. Kiểm kê stack

| | Dashboard (`frontend/`) | Tiện ích (`extension/`) |
|---|---|---|
| Runtime deps | react 18.3, react-dom, react-router-dom 6.28, @tanstack/react-query 5.62 (`package.json:12-17`) | react, react-dom |
| CSS | tailwindcss 3.4.17, 4 nhóm màu tuỳ biến `surface/ink/line/brand` (`tailwind.config.js:6-11`), `index.css` 30 dòng (`.card .btn .input .label .th .td .table-scroll`) | `styles/extension.css` 95 dòng, biến `--ink/--line/--surface/--brand`, `color-scheme: light` (`:11`) |
| Font | `fontFamily.sans: ['Inter', …]` (`tailwind.config.js:13`) nhưng **không có** `@font-face`/`<link>` nào (grep `fonts.googleapis|@font-face|Inter` → chỉ dòng config) → chạy bằng `system-ui` | system stack 13px |
| Icon | **0** `<svg>`; 4 glyph ký tự làm icon (§5h P06) | 0 |
| Chart | không | không |
| i18n | **không**; `index.html:2` `lang="en"` | có, `vi` mặc định (`LanguageProvider.tsx:23`), parity khoá lúc biên dịch (`i18n/types.ts`) |
| Dark mode | `dark:` **0** lần; không `darkMode` trong config | không |
| Component dùng chung | `components/ui.tsx` 289 dòng: Badge, Card, StatTile, EmptyState, ErrorState, Skeleton, Field, Drawer, Tabs, Progress, InlineNote | class CSS: `.card .badge .kv .notice .lang-toggle` |
| Test | vitest 2 + testing-library; 21 tệp | vitest; 5 tệp |
| Lint | eslint 9 + ts-eslint + react-hooks; **không** jsx-a11y (`eslint.config.js`) | tương tự + luật cấm cookie/storage |
| Build/CSP | nginx, CSP `default-src 'self'`, `font-src 'self' data:` (`default.conf.template:41`) | MV3, `script-src 'self'` |

### 5b. Shell, điều hướng, route

- 21 route trong `App.tsx:43-64` (12 trang + 3 chi tiết/workspace + 3 wizard + team/security/audit/system/settings).
- Nav hiển thị **8 mục phẳng** (`AppShell.tsx:9-21`); A7 cố ý **ẩn 5 route đang chạy** (Readiness, Account
  Health, Preflight, Audit Log, System Status — `AppShell.tsx:6-8`). Chúng chỉ tới được qua link rải:
  `Settings.tsx:47,55,75` (Team, Security devices, System), `Overview.tsx:122,282`, `Alerts.tsx:164`,
  `Operations.tsx:53`. Không có nhóm, không icon, không breadcrumb chung.
- Mobile: sidebar là khối `hidden/block` bật bằng nút chữ "Menu" (`AppShell.tsx:29-31,62-69`); không
  focus trap, không đóng bằng Esc.
- Header: tên workspace + `email · role` (vai hiển thị **thô** `owner`) + "Sign out" (`:70-80`).
- Footer: disclaimer readiness lặp trên **mọi** trang (`:87-89`), cộng thêm đoạn disclaimer ở đầu
  Overview (`Overview.tsx:74-77`) và `InlineNote` trong từng thẻ (`SpendSummaryCard.tsx:86`,
  `PlatformStatusSummaryCard.tsx:33-36`) → 3–4 disclaimer trên một màn.

### 5c. Màu / chữ / khoảng cách: token hay lớp cứng?

- Có token "nửa vời": 4 nhóm màu đặt tên (`surface/ink/line/brand`) nhưng **không có** tone token;
  tone nằm ở `TONE_CLASS` bằng lớp Tailwind thô (`readiness.ts:41-57`: `bg-emerald-50 text-emerald-800 …`).
- **93 lần** lớp bảng màu thô (`emerald/rose/amber/sky/slate-…`) trong **25 tệp** ngoài `readiness.ts`
  (grep có `.gitignore`-safe `/bin/grep`): `SpendTab.tsx` 11, `ui.tsx` 7, `AuditDiff.tsx` 6,
  `AlertDrawer.tsx` 6, `DiscoverySection.tsx` 5, `PreflightDetail.tsx` 4 … Ví dụ: `ui.tsx:115`
  (ErrorState), `SpendTab.tsx:85,90,100` (ba hộp lỗi giống nhau viết tay), `Login.tsx:63`,
  `Overview.tsx:349`, `ui.tsx:273`.
- Cỡ chữ: **10 giá trị tuỳ ý** `text-[…px]`: `12.5px` ×136, `12px` ×134, `11.5px` ×96, `11px` ×41,
  `13px` ×24, `17px` ×18, `15px` ×3, `14px` ×2, `13.5px` ×1 (body, `index.css:7`), `10.5px` ×1. Không có
  thang đặt tên; nửa pixel; tiêu đề trang 17px chỉ hơn body 3,5px.
- Khoảng cách: dùng bội số 4px của Tailwind (tốt) nhưng padding thẻ/ô bảng lệch nhau (`p-3`, `p-4`,
  `px-3 py-2`, `px-4 py-2.5`, `py-1.5` trong cùng trang Overview).
- Bo góc: `rounded`, `rounded-md`, `rounded-lg`, `rounded-full` không theo vai trò.

### 5d. Trạng thái theo trang (đếm `<EmptyState|ErrorState|Skeleton>` trong tệp; "uỷ quyền" = thành phần con lo)

| Trang | Tải | Rỗng | Lỗi | Không quyền | Một phần |
|---|---|---|---|---|---|
| Overview | 7 Skeleton | chuỗi văn bản thuần ×4 (`Overview.tsx:304,330,338,378`) | 3 | `DiscoveryOverview` **biến mất** với non-owner (`:155 return null`) | chỉ chữ (`SpendSummaryCard.tsx:79`) |
| Accounts | 1 | 1 (tốt, có 2 hành động) | 1 | — | — |
| AccountDetail + 7 tab | có | OverviewTab/ReadinessTab **0** EmptyState | có | nút Refresh **ẩn** với non-owner (`SpendTab.tsx:58`) | SpendTab có ghi chú "—" (tốt) |
| Alerts, AccountHealth, Readiness, AuditLog, Preflight(+5 tab), TeamSeats, MetaConnections, HistoryTab | 1/1/1 | 1 | 1 | — | — |
| Assets, BusinessManagers, Operations, preflight/OverviewTab | **0/0/0** (Assets/BM uỷ quyền `ReferenceManager`; Operations là trang tĩnh) | | | | |
| 3 wizard (Create/Share/PixelShare) | **0 Skeleton** | 0 | 3 | — | — |
| Settings, SystemStatus, SecurityDevices | có | 0/1/0 | 4/6/2 | Settings có nhánh `!isOwner` (`:266`) — chỗ duy nhất nói lý do | — |
| Login | — | — | hộp lỗi tự vẽ (`Login.tsx:63`) | — | — |

Kết luận: tải/lỗi phủ tốt; **không có component "không có quyền"** (tính năng biến mất im lặng, trái
§6.6 skill), **không có mẫu "một phần dữ liệu"** chuẩn, rỗng của Overview là chữ trần.

### 5e. Đáp ứng & trợ năng

- Đáp ứng: `.table-scroll` giữ trang không tràn ngang (tốt, `index.css:27`); bảng Accounts
  `min-w-[1320px]` **15 cột** (`Accounts.tsx:158-177`); thanh lọc **9 select + 1 checkbox** gói thành 3–4
  hàng ở 375px (`:87-126`); KPI `grid-cols-2 … xl:grid-cols-6` ×3 hàng.
- Trợ năng: **5** `aria-label` toàn app; `Drawer` không focus trap, không Esc, nút đóng là "✕"
  (`ui.tsx:191-230`); `Tabs` có `role=tab` nhưng không điều hướng phím mũi tên (`:232-264`); `Select`
  lọc có `<label>` **không gắn** `htmlFor` (`Accounts.tsx:312`); `Progress` chỉ có `title`, không
  `role=progressbar` (`ui.tsx:266-282`); `window.confirm` ×2 (`AccountDetail.tsx:160`,
  `PreflightDetail.tsx:120`); không eslint-plugin-jsx-a11y; focus ring có (`index.css:8`, tốt).
- Locale: `formatDateTime`/`formatRelative` dùng locale `undefined` (`format.ts:5,24`) → theo trình
  duyệt, chữ `'never'`, `'just now'` cứng tiếng Anh (`:15,17,28`); tiện ích `toLocaleString()` không
  locale (`ContextView.tsx:46,222`).

### 5f. Wording / i18n

- ~240 chuỗi JSX + ~234 chuỗi thuộc tính (`label=/title=/placeholder=`) tiếng Anh (grep thô, trùng lặp
  đã gộp) → quy mô i18n ≈ 400–500 khoá.
- Enum thô tới người dùng qua `humanise()/titleCase()` **30 chỗ**: `Accounts.tsx:213,218`,
  `Overview.tsx:297`, `OverviewTab.tsx:78,80,227`, `HealthTab.tsx:228,230,273`, `ReadinessTab.tsx:47,102,104,132`,
  `SystemStatus.tsx:190-200`, `AssetsTab.tsx:93`, `EventsTab.tsx:134`, `AccountHealth.tsx:248`, drawers…;
  `AccountDetail.tsx:108` `.replace(/_/g,' ')`; `SpendTab.tsx:258`; tiện ích in `page_type` thô
  (`ContextView.tsx:76`).
- Thuật ngữ nội bộ lộ ra UI: "A1 stores operator-entered records only" (`Overview.tsx:387`), "Browser
  ref / Proxy ref" (`Accounts.tsx:109-112`), "Reference ID" (`ui.tsx:121`).
- Chuỗi tiếng Việt **đã có và đã dùng** trong tiện ích (`vi.ts`: readiness, health, freshness, Meta
  status, spend) — là **tiền lệ wording** để dashboard tái dùng, không dịch lại khác đi.

### 5g. Tiện ích (popup / side panel / options)

- Bố cục hợp lý (thẻ, `dl.kv`), chữ 13px, h2 chữ hoa 12,5px; `.popup{width:360px}` cố định, `.panel`
  ≥320px. Không icon, không dark, `html lang="en"` (`sidepanel.html:2`, `popup.html:2`) dù ngôn ngữ
  mặc định `vi`.
- Bảng màu hex riêng (`extension.css:47-51`: `#05603a`, `#93370d`…) khác bảng Tailwind của dashboard →
  hai palette trôi dạt.
- **Lệch quyết định tone**: `presentation.ts:33` `FRESHNESS_META.current: 'positive'` trong khi
  dashboard `health.ts:51` là `neutral` với chú thích "deliberately never green". `SPEND_FRESHNESS_META.current`
  tiện ích là `info` (`:45`), dashboard là `neutral` (`readiness.ts:141-145`).
- `LanguageToggle.tsx:7` `aria-label="Language"` không dịch. `CONTEXT_META.confirmed` xanh (`:69`) —
  chấp nhận được: "khớp id chính xác" là sự kiện thật, không phải nhận định về tài khoản.

### 5h. Danh sách vấn đề cụ thể (mã U1-P##, kèm bằng chứng)

| # | Vấn đề | Bằng chứng | Nhóm gap |
|---|---|---|---|
| P01 | Dashboard tiếng Anh, không lớp i18n; tiện ích đã tiếng Việt → một sản phẩm hai ngôn ngữ | `index.html:2`; ~470 chuỗi; `extension/src/shared/i18n/vi.ts` | vocabulary / frontend_UX |
| P02 | Màu rải 93 lần/25 tệp ngoài nơi quyết định | §5c | architecture |
| P03 | Không dark mode; tiện ích khoá `color-scheme: light` | `dark:` = 0; `extension.css:11` | architecture |
| P04 | 10 cỡ chữ tuỳ ý, nửa pixel, không thang | §5c | architecture |
| P05 | Font khai báo nhưng không nạp; CSP buộc tự host; dấu tiếng Việt chưa từng được thử | `tailwind.config.js:13`; `default.conf.template:41` | architecture / deployment |
| P06 | Không hệ icon; glyph ký tự làm icon | `ui.tsx:222` "✕", `MetaConnectionWorkspace.tsx:107` "←", `PreflightDetail.tsx:104` "▶", `Operations.tsx:41` "→"; nút "Menu" chữ `AppShell.tsx:68` | architecture |
| P07 | Overview không có thứ bậc: 18 ô KPI đồng hạng ×3 hàng + 2 thẻ tóm tắt + discovery + 4 thẻ + 1 ghi chú; tiêu đề 17px | `Overview.tsx:80-111,133-176,214-257,272-276,278-381` | frontend_UX |
| P08 | Bảng Accounts 15 cột/1320px, 9 bộ lọc, không ẩn/hiện cột, số tiền căn trái, checkbox chọn không có hành động | `Accounts.tsx:87-126,158-177,268-269`; `AccountSpendCell.tsx:21` | frontend_UX |
| P09 | Enum thô tới người dùng (30 chỗ) | §5f | vocabulary |
| P10 | Locale/ngày giờ theo trình duyệt; từ tiếng Anh cứng | `format.ts:5,15,17,24,28`; `ContextView.tsx:46,222` | vocabulary |
| P11 | Trợ năng: 5 aria-label; Drawer/Tabs thiếu bàn phím; label không gắn; `window.confirm`; Progress không ARIA | §5e | frontend_UX / testing |
| P12 | Thiếu trạng thái "không có quyền" (tính năng biến mất) và "một phần dữ liệu" chuẩn; rỗng là chữ trần; wizard không skeleton | §5d | frontend_UX |
| P13 | Tone xanh cứng ngoài bảng quyết định: API badge luôn `positive` bất kể giá trị; "Browser ref: Assigned" xanh | `SystemStatus.tsx:191`; `Accounts.tsx:239` | state_machine (hiển thị) — liên quan rule 28 |
| P14 | Tiện ích lệch tone độ mới với dashboard; palette riêng; `lang="en"`; aria-label không dịch | §5g | architecture / vocabulary |
| P15 | 5 route ẩn khỏi nav; Team/Security chỉ qua Settings; không nhóm; mobile nav không phải drawer | §5b | frontend_UX |
| P16 | Disclaimer lặp 3–4 lần một màn | §5b | frontend_UX / vocabulary |
| P17 | Vai hiển thị thô (`owner`) trên header; "AO" chữ thay logo | `AppShell.tsx:33-35,75` | vocabulary |
| P18 | Login không khung sản phẩm, lỗi hộp tự vẽ, không chọn ngôn ngữ | `Login.tsx:30-37,63` | frontend_UX |

### 5i. Chỗ **đã đúng** — tái dùng, không viết lại

- Bốn bản đồ tone/label tập trung (+ `platformStatusBadge()` luôn kèm thời điểm quan sát, `PLATFORM_STATUS_NONE` "—").
- `rawMoney()` "—" không bao giờ 0; `SpendTab` ghi rõ "— nghĩa là Meta không trả dòng. Không phải 0".
- Bộ lọc & tab đồng bộ URL (`Accounts.tsx:21-49`, `AccountDetail.tsx:32-39`).
- `.table-scroll` giữ trang không tràn ngang; `Field` gắn label đúng (`ui.tsx:143-189`).
- Skeleton/Empty/Error có mặt rộng; `ErrorState` có `role=alert` + requestId.
- Tiện ích: i18n với parity khoá lúc biên dịch, `label` là khoá dịch trong bản đồ tone (`presentation.ts`) — **đây là mẫu dashboard sẽ sao chép**.
- Mọi câu disclaimer hiện có đúng rule 6/13 — U1 chỉ dịch và giảm lặp, không đổi nghĩa.

### 5j. Phân loại gap (theo §13 Playbook)

`vocabulary`: P01 P09 P10 P17 · `architecture`: P02 P03 P04 P05 P06 P14 · `frontend_UX`: P07 P08 P11 P12 P15 P16 P18 ·
`state_machine` (chỉ phần hiển thị): P13 · `testing`: thiếu test token/i18n/a11y · `deployment`: font tự host, kích
thước bundle · `data_model` / `API` / `security` / `observability`: **không có gap, không chạm.**

---

## 6. Brief (skill bước 1)

```text
Loại sản phẩm:      tool nội bộ vận hành (sẽ bán cho khách — memory 2026-10-26), B2B
Người dùng chính:   người chạy ads/quản lý tài khoản Meta (owner, operator), quen Ads Manager; BA/QA; sau này khách
Việc chính (top 3): (1) sáng ra biết tài khoản nào cần xử lý (chưa sẵn sàng / tín hiệu nghiêm trọng / Meta không hoạt động)
                    (2) xem chi tiêu & trạng thái Meta của từng tài khoản, độ mới số liệu
                    (3) ghi nhận việc đã kiểm / rà soát / sự kiện, theo dõi cảnh báo và việc gửi thông báo
Dữ liệu chính:      bảng (21 bảng), badge trạng thái, cặp nhãn–giá trị, form/wizard; không biểu đồ (S1 giữ chuỗi thô)
Stack:              React 18 + Vite 6 + Tailwind 3.4 + TanStack Query 5 (+ shadcn/ui, Radix, Lucide — đề xuất)
Ngôn ngữ giao diện: vi mặc định + en phụ (đã có ở tiện ích, parity rẻ) — Q4
Chế độ màu:         cả hai, mặc định theo hệ điều hành, có công tắc — Q2
Mật độ:             cân bằng (body 14px, hàng bảng 40px); không có chế độ "dày" trong U1 — Q3
Ràng buộc:          CSP không CDN; font tự host; rule 5/6/9/11/28/33; wording do BA duyệt; 375px không tràn ngang;
                    WCAG AA; không đổi API; agent không đăng nhập được app → kiểm thị giác do người thật
```

Giả định còn thiếu: màu thương hiệu (Q1); tên hiển thị của sản phẩm bằng tiếng Việt (giữ "AdsOps Control
Center" làm tên riêng, không dịch — cần BA xác nhận).

---

## 7. Hướng tham chiếu (2–3, mô tả **cấu trúc**, không sao chép thương hiệu)

1. **Bảng điều khiển vận hành kiểu "hàng đợi việc"** (tham khảo cấu trúc màn hình của các công cụ
   quản trị thương mại / console đám mây): sidebar trái có nhóm thu gọn + icon 20px; vùng cuộn duy nhất;
   trên cùng là **một hàng 4 ô "cần xử lý"**, dưới là **thanh phân bố** (segmented bar) cho từng khía cạnh,
   rồi mới tới bảng chi tiết. Lý do: đúng thứ bậc KPI → xu hướng/phân bố → chi tiết → hành động của §6.1;
   sửa P07.
2. **Bảng dữ liệu kiểu hệ thiết kế doanh nghiệp** (IBM Carbon / Polaris về *quy ước*, không giao diện):
   tiêu đề cột cố định, cột số căn phải `tabular-nums`, cột phụ ẩn sau "Cột", hàng có menu ⋯, trên
   mobile hàng biến thành thẻ. Lý do: sửa P08, giữ URL filter.
3. **Form/báo lỗi theo GOV.UK Error summary + PatternFly Empty state**: lỗi nói *chuyện gì → vì sao →
   làm gì → link*, rỗng nói *vì sao rỗng + 1–2 hành động*. Lý do: sửa P12, đúng §6.5.

Không tham chiếu landing page, hiệu ứng, glassmorphism, gradient (tool vận hành).

---

## 8. Design Choice (một hướng duy nhất)

**Chọn: giữ stack, thêm lớp hệ thống thiết kế bằng token CSS + shadcn/ui (Radix) copy-in + Lucide +
Be Vietnam Pro/JetBrains Mono tự host + i18n tự viết theo mẫu tiện ích. Không viết lại dữ liệu/logic.**

Lý do chọn / bỏ:

| Hạng mục | Chọn | Bỏ | Vì sao |
|---|---|---|---|
| Token | Biến CSS `--*` sáng/tối, Tailwind đọc qua `hsl(var(--…))`/`rgb(var(--…))`; `darkMode: ['class']` + đồng bộ `prefers-color-scheme` | Giữ hex trong `tailwind.config.js` | Một nơi đổi màu cho cả hai chủ đề; `TONE_CLASS` chỉ còn trỏ `tone-positive…`; tiện ích dùng **cùng tệp giá trị** (CSS thuần) → hết trôi dạt (P02, P03, P14) |
| Component | shadcn/ui copy-in trên Radix (MIT): Button, Badge, Card, Tabs, Sheet, Dialog, AlertDialog, DropdownMenu, Select, Input, Label, Checkbox, Textarea, Table, Tooltip, Skeleton, Separator, Popover | DaisyUI/Flowbite (theme CSS khó ép token, Flowbite cần JS riêng); MUI/Ant/Mantine/Chakra (runtime CSS-in-JS hoặc hệ token riêng, nặng, đè Tailwind); Headless UI (ít primitive hơn Radix) | Mã nằm trong repo, cùng Tailwind, Radix lo focus trap/Esc/phím mũi tên/ARIA → sửa P11 mà không tự viết; `ui.tsx` hiện có được thay dần, không phá |
| Icon | Lucide (ISC), 16/20/24, một nét 1,75–2px | Phosphor/Heroicons/Tabler, emoji | Một bộ; tree-shake theo icon; đủ icon vận hành |
| Font | **Be Vietnam Pro** (OFL; thiết kế cho tiếng Việt) 400/500/600/700 subset `vietnamese,latin` qua `@fontsource/be-vietnam-pro`; **JetBrains Mono** (OFL) cho id/số tiền thô | Inter (không nạp được qua CDN vì CSP; dấu tiếng Việt kém hơn ở cỡ nhỏ); font hệ thống | Tự host đúng CSP; đã thiết kế cho dấu chồng; bản xem trước có mẫu "Quyết định, Thiết lập, Nhượng quyền, Ướt" ở mọi cỡ |
| i18n | Tự viết ~60 dòng theo đúng mẫu `extension/src/shared/i18n/` (`vi` nguồn sự thật, `en` parity lúc biên dịch, `interpolate {var}`), `useI18n()`; `label` trong 4 bản đồ tone đổi thành **khoá dịch** như `presentation.ts` | i18next/react-intl | Mẫu đã chứng minh trong tiện ích; ~500 khoá, tiếng Việt không chia số nhiều; không thêm runtime; parity là lỗi biên dịch |
| Bảng | HTML table + lớp token + "Cột" (Popover) + hàng→thẻ ở ≤640px; phân trang/sắp xếp vẫn phía server qua URL | TanStack Table | Server đã lọc/sắp/phân trang; thêm TanStack bây giờ là engine song song (Playbook §6.2). Để ngỏ cho sau |
| Biểu đồ | **Không** trong U1. "Xu hướng" chi tiêu = bảng ngày + trung vị (đã có) | Recharts/Tremor | S1: chuỗi thô không parse. Muốn vẽ cần API trả số → spec S riêng (Q5) |
| Chuyển động | Chỉ 150–200ms cho hover/focus/Sheet; `prefers-reduced-motion` | framer-motion, GSAP, React Bits | Tool vận hành (§5.2 skill) |
| Thông báo | Giữ thông điệp inline hiện có; Sonner để sau | Toast ngay trong U1 | Không đổi hành vi phản hồi của mutation trong lát UI |

Gói thêm (devDependencies/dependencies, **chưa cài** — cài ở U1a sau khi duyệt): `@radix-ui/*` (theo
từng component shadcn kéo vào), `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`,
`lucide-react`, `@fontsource/be-vietnam-pro`, `@fontsource-variable/jetbrains-mono`; dev: `axe-core` +
`vitest-axe` (hoặc `jest-axe`), `eslint-plugin-jsx-a11y`. Tiện ích: **không thêm gói** (CSS thuần, SVG inline).

Tái dùng engine cũ: `READINESS_META/HEALTH_META/PLATFORM_STATUS_META/ALERT_*_META` giữ nguyên hình dạng và
tone; `platformStatusBadge()`, `rawMoney()`, `refreshErrorMessage()` giữ nguyên; `queryKey` giữ nguyên;
`AccountFormDrawer` v.v. chỉ đổi vỏ `Drawer`→`Sheet`.

---

## 9. Kiến trúc thông tin & khuôn trang

### 9a. Điều hướng nhóm (nhãn **[ĐỀ XUẤT — chờ duyệt]**, khoá i18n gợi ý)

| Nhóm / mục | Route (giữ nguyên) | Icon Lucide | Khoá |
|---|---|---|---|
| **Tổng quan** | `/` | `layout-dashboard` | `nav.overview` |
| **Tài khoản** → Tài khoản quảng cáo | `/accounts` | `wallet` | `nav.accounts` |
| → Business Manager | `/business-managers` | `building-2` | `nav.businessManagers` |
| → Tài sản | `/assets` | `package` | `nav.assets` |
| **Theo dõi** → Sức khoẻ tài khoản | `/account-health` | `activity` | `nav.accountHealth` |
| → Mức sẵn sàng | `/readiness` | `list-checks` | `nav.readiness` |
| → Cảnh báo | `/alerts` | `bell` | `nav.alerts` |
| → Kiểm tra trước khi chạy | `/preflight` | `clipboard-check` | `nav.preflight` |
| **Vận hành** | `/operations` (+3 wizard) | `wrench` | `nav.operations` |
| **Kết nối Meta** | `/meta-connections` | `link-2` | `nav.metaConnections` |
| **Đội & bảo mật** → Thành viên | `/team` | `users` | `nav.team` |
| → Thiết bị đăng nhập | `/security-devices` | `smartphone` | `nav.securityDevices` |
| → Nhật ký kiểm toán | `/audit-log` | `scroll-text` | `nav.auditLog` |
| **Hệ thống** → Cài đặt | `/settings` | `settings` | `nav.settings` |
| → Trạng thái hệ thống | `/system` | `server` | `nav.systemStatus` |

"Chi tiêu" **không** là route riêng trong U1: hiện ở Tổng quan (thẻ theo tiền tệ + đếm độ mới), cột
"Chi tiêu" ở danh sách, tab "Chi tiêu" ở chi tiết. Nhóm thu gọn ghi nhớ trong `localStorage`
(`adsops.nav`), mobile mở bằng Sheet trái. Mục không thuộc vai thì **ẩn** (§6.6) — hiện không có route
nào chỉ-owner, chỉ có *hành động* chỉ-owner (xem `NoPermissionState`).

Quyết định cần chủ sản phẩm: bỏ "ẩn 5 route" của A7 để nhóm lại (Q6).

### 9b. Năm khuôn trang

| Khuôn | Áp cho | Cấu trúc (trên→dưới) |
|---|---|---|
| **T1 Dashboard** | Tổng quan | Tiêu đề + workspace + "cập nhật lúc" → **hàng 4 ô "Cần xử lý hôm nay"** (Chưa sẵn sàng · Tín hiệu nghiêm trọng đang mở · Cảnh báo nghiêm trọng chưa xử lý · Thông báo gửi thất bại — mọi ô tone attention/caution, bấm = lọc) → **thanh phân bố** Mức sẵn sàng (4 đoạn + Lưu trữ) và Sức khoẻ (5 đoạn + "Dữ liệu cũ") với chú giải và số → **thẻ "Nguồn & độ mới"** (đánh giá sức khoẻ gần nhất, thông báo gửi thành công gần nhất, đếm độ mới chi tiêu, đếm trạng thái Meta) → Chi tiêu theo tiền tệ (bảng, không cộng chéo) → Cần rà soát thủ công / Thay đổi gần đây / Hoạt động kiểm toán (3 thẻ) → một disclaimer cuối trang |
| **T2 Danh sách** | Accounts, Alerts, Account health, Readiness, Preflight, Audit log, Team, Security devices, Meta connections, History | Tiêu đề + số bản ghi + nút chính → **thanh công cụ**: ô tìm (icon), 3 bộ lọc chính (Select), "Bộ lọc khác" (Popover chứa phần còn lại), sắp xếp, chip bộ lọc đang bật + "Xoá" → **bảng**: header dính, cột mặc định ≤ 8, "Cột" (Popover) bật cột phụ, số/tiền căn phải mono, hàng có menu ⋯, ≤640px hàng→thẻ → phân trang (Trước/Sau + "Trang x/y") → trạng thái: skeleton bảng / rỗng (lý do + hành động) / lỗi (4 phần) / không quyền / một phần |
| **T3 Chi tiết có tab** | Account detail (7 tab), Preflight detail (5), Meta connection workspace, Member (Sheet) | Breadcrumb → **thẻ đầu trang**: tên + badge (ghi nhận · mức sẵn sàng · Meta kèm giờ) + id mono + BM + checklist → hành động (1 phụ + 1 chính + ⋯ chứa Lưu trữ) → Tabs (URL `?tab=`) → panel là lưới thẻ 2 cột (xl) |
| **T4 Form / Sheet** | AccountForm, Alert, HealthSignal, PreflightFinding, PreflightDraft, Invite/Member, ReferenceManager | Sheet phải 480px (mobile toàn màn), tiêu đề + mô tả, nhóm trường, footer "Huỷ / Lưu"; lỗi theo trường + tóm tắt lỗi đầu form; hành động không hoàn tác → AlertDialog nêu **đối tượng, giá trị cũ→mới, phạm vi, có khôi phục được không** |
| **T5 Wizard** | 3 wizard vận hành | Stepper 4 bước (Nhập → Kiểm trước → Xác nhận → Chạy & đọc lại) giữ nguyên luồng A7/A8, thêm skeleton + "đọc lại kết quả" rõ ràng |
| (T6) Cài đặt / Hệ thống | Settings, System status | Thẻ theo mục, nhãn–giá trị 2 cột, badge chỉ `positive` khi giá trị thật sự là "đạt" (sửa P13) |
| (T7) Đăng nhập | Login | Thẻ giữa màn, tên sản phẩm + một câu mô tả tiếng Việt, chọn ngôn ngữ, lỗi 4 phần |
| (T8) Tiện ích | popup 360 / side panel ≥320 / options | Giữ cấu trúc hiện có; token chung; dark; icon; nhãn `page_type` |

---

## 10. Token đề xuất (bước 3 skill) — giá trị đúng như trong `U1_PREVIEW.html`

Độ tương phản tính bằng công thức WCAG 2.x (script, không ước lượng), ghi ở cột cuối.

### 10a. Màu nền / chữ / viền

| Token | Sáng | Tối | Ghi chú / tương phản |
|---|---|---|---|
| `--bg` (nền trang) | `#f4f6f9` | `#0c1220` | xám lạnh nghiêng về brand |
| `--surface` (thẻ, bảng) | `#ffffff` | `#131b2c` | |
| `--surface-2` (chìm, header bảng) | `#eef1f5` | `#1a2438` | |
| `--border` / `--border-strong` | `#dde3ea` / `#c6cfda` | `#273246` / `#344158` | |
| `--fg` | `#121a2b` | `#e7ecf3` | 17,4:1 / 14,5:1 trên surface |
| `--fg-muted` | `#4b5767` | `#a7b2c3` | 7,4:1 / 8,0:1 |
| `--fg-faint` (nhãn phụ, 11–12px) | `#5b6980` | `#8491a6` | ≥4,5:1 trên surface **và** surface-2 (đã sửa từ `#66748a` vì 4,18:1 trên surface-2) |
| `--brand` / `--brand-hover` | `#1f5fbf` / `#184f9f` | `#6ea0ec` / `#88b3f3` | giữ dòng màu hiện có (Q1) |
| `--brand-fg` (chữ trên nút brand) | `#ffffff` | `#0c1220` | 6,1:1 / 7,0:1 |
| `--brand-text` (link) | `#1a4f9e` | `#8fb8f5` | 7,9:1 / 8,5:1 |
| `--brand-soft` (nav active) | `#e7eefb` | `#19284a` | |
| `--ring` | = `--brand` | = `--brand` | focus 2px + offset 2px |

### 10b. Tone (bản đồ 1-1 với `Tone` hiện có; **không thêm tone**)

| Tone | Dùng cho | Sáng bg / chữ / viền | Tối bg / chữ / viền | Tương phản chữ/bg |
|---|---|---|---|---|
| `positive` | `operationally_ready`, `clear_signals`, `resolved`, `sent`, `verified`, `completed`, context `confirmed` | `#e6f6ee` / `#0f6b43` / `#a9dfc2` | `#0f2b22` / `#6fd3a3` / `#1f5a42` | 5,9 / 8,3 |
| `caution` | `ready_with_warnings`, `warning`, `stale`, pending Meta, `acknowledged` | `#fff5dc` / `#7a4b00` / `#f1d48a` | `#332607` / `#f3c86b` / `#6b5213` | 6,8 / 9,4 |
| `attention` | `not_ready`, `critical`, `disabled/closed (Meta)`, `open`, `failed_final` | `#fdeaea` / `#9b1c1c` / `#f3b4b4` | `#3a1518` / `#f29a9a` / `#7a2a2e` | 7,0 / 7,6 |
| `info` | `attention_needed`, `deferred`, `today_partial` | `#e8f3fd` / `#0b4f86` / `#a8cff0` | `#0f2740` / `#86bff0` / `#1f4d78` | 7,5 / 7,8 |
| `neutral` | **`unknown`**, **`active (Meta)`**, **độ mới `current`**, `never_observed`, pending delivery | `#eceff4` / `#3b4656` / `#cdd5df` | `#1f2a3d` / `#c2cbd8` / `#3a4860` | 8,3 / 8,8 |
| `muted` | `archived`, `not_applicable`, `not_observable`, `expired`, "—" | `#f4f6f9` / `#5c6878` / `#dde3ea` | `#161f30` / `#95a2b6` / `#273246` | 5,2 / 6,4 |

Mỗi badge luôn có **chữ**; tone `attention`/`caution` có thêm icon (`triangle-alert`/`clock`) — không
màu-đơn-độc (§9 skill, dataviz "status ships with icon + label").

### 10c. Chữ

Họ: `--font-sans: "Be Vietnam Pro", system-ui, "Segoe UI", Roboto, sans-serif`;
`--font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace` (chỉ id, mã, số tiền thô).

| Token | Cỡ/dòng | Dùng |
|---|---|---|
| `text-2xs` | 11/16 | overline, nhãn cột (chữ hoa, `letter-spacing .04em`, 600) |
| `text-xs` | 12/16 | meta, thời gian tương đối, chú thích |
| `text-sm` | **14/20 — body** | ô bảng, nội dung thẻ, nút |
| `text-base` | 16/24 | tiêu đề thẻ, tên trong header chi tiết |
| `text-lg` | 18/26 | tiêu đề mục |
| `text-xl` | 20/28 | tiêu đề trang (mobile) |
| `text-2xl` | 24/32 | tiêu đề trang (≥1024) |
| `text-3xl` | 30/36 | số KPI (`tabular-nums`, 600) |

Thang = Tailwind mặc định + `2xs`, body = `sm` (khớp giả định của shadcn). Line-height ≥ 1,4 mọi nơi vì
dấu chồng (Ấ, Ướ). Thay 10 cỡ tuỳ ý bằng 8 cỡ đặt tên; xoá nửa pixel.

### 10d. Khoảng cách · bo góc · bóng · lớp

- Khoảng cách: bội số 4; gutter trang 16 (mobile) / 24 (≥1024); padding thẻ 16; khoảng cách mục 24;
  stack 12; ô bảng 8×12, hàng ≥40px; header 52; sidebar 240.
- Bo góc: `--r-sm 4` (chip, checkbox) · `--r-md 6` (input, nút) · `--r-lg 8` (thẻ) · `--r-xl 12`
  (dialog, sheet) · `9999` (badge).
- Bóng: thẻ **không bóng** (viền); popover `0 4px 12px rgb(10 18 36 / .10)`; sheet/dialog
  `0 16px 40px rgb(10 18 36 / .24)`; tối tăng alpha ×1,5.
- Z: 0 nội dung · 10 header/thead dính · 20 dropdown/tooltip · 40 overlay sheet/dialog (khớp `z-40`
  hiện có) · 50 toast.
- Chuyển động: 150ms ease-out (hover/focus), 200ms (sheet); `@media (prefers-reduced-motion) { * {transition: none} }`.

### 10e. Định dạng số & thời gian

- `format.ts` nhận `locale` từ ngôn ngữ (`vi-VN` | `en`): ngày `27/10/2026 09:15`, tương đối "2 giờ
  trước" / "vừa xong" / "chưa từng" (khoá i18n, không chữ cứng).
- Đếm: `Intl.NumberFormat('vi-VN')` (1.250). Tiền Meta: **chuỗi thô + mã tiền tệ**, mono, căn phải,
  kèm ngày và "nguyên văn Meta trả về". Không cộng chéo tiền tệ (giữ).
- Bốn trạng thái dữ liệu có nhãn riêng (§6.3): *đầy đủ* (không nhãn) · *thiếu* ("Chưa có dữ liệu" /
  "Meta không trả dòng") · *ước tính* (không có trong sản phẩm — không bịa) · *chưa xác minh* ("Chưa
  quan sát", "Đã cũ", "Mã lạ"). `0` chỉ hiện khi API trả số 0 thật.

---

## 11. Trạng thái theo màn hình (bước 6) — mẫu văn bản là **[ĐỀ XUẤT — chờ duyệt]**

| Màn | Tải | Rỗng | Lỗi | Không có quyền | Một phần |
|---|---|---|---|---|---|
| Tổng quan | skeleton 4 ô + 2 thanh + 3 thẻ | "Chưa có tài khoản nào được đăng ký" + [Thêm Business Manager] [Đăng ký tài khoản] | theo khối: khối lỗi hiện `ErrorState`, khối khác vẫn hiện | thẻ Discovery: hiện thẻ với dòng "Chỉ chủ workspace xem được kết quả đọc Meta" thay vì biến mất | thẻ chi tiêu: "Tổng VND thiếu 3/13 tài khoản (2 số liệu cũ, 1 không có dòng) — tổng chưa đầy đủ" |
| Tài khoản (danh sách) | skeleton 8 hàng cùng cột | hai biến thể hiện có (không lọc / có lọc) | "Không tải được danh sách tài khoản" → vì sao (nếu `message`) → [Thử lại] + "Mã tham chiếu" | — | ô Chi tiêu: "Chưa có dữ liệu" / "Không có kết nối đọc"; ô Meta: "—" + tooltip |
| Chi tiết → Chi tiêu | skeleton thẻ | "Chưa có lần đọc thành công nào" + lý do theo `freshness` (giữ) | giữ `ErrorState` + lỗi làm mới inline (token attention) | nút "Làm mới" **vẫn hiện, vô hiệu + tooltip** "Chỉ chủ workspace mới làm mới được chi tiêu" (`403` từ `refreshErrorMessage`) | "Ngày không có dòng: —, không phải 0"; "Hôm nay (chưa đủ ngày)"; "Tiền tệ lệch: sổ VND · quan sát USD" |
| Sức khoẻ / Cảnh báo / Mức sẵn sàng | skeleton bảng | "Không có tín hiệu/cảnh báo đang mở theo bộ lọc này" (không nói "an toàn") | 4 phần | hành động owner-only (bật/tắt luật, suppress) vô hiệu + lý do | "Dữ liệu cũ: N tài khoản được báo là *không xác định* thay vì *không phát hiện*" |
| Kết nối Meta / Discovery | skeleton | "Chưa chạy lần đọc nào" + [Chạy đọc chỉ-đọc] | 4 phần, không lộ response thô (rule 26) | non-owner: thấy kết quả, không thấy nút chạy + lý do | "N tài sản chưa đối chiếu được" |
| Đội / Thiết bị / Kiểm toán / Hệ thống | skeleton | có | 4 phần | Hệ thống: non-owner thấy bản rút gọn + lý do | Hệ thống: "Chưa từng chạy" ≠ "cũ" (rule 28) giữ nguyên |
| Đăng nhập | nút busy | — | "Không đăng nhập được" → lý do từ API → "Thử lại / liên hệ chủ workspace" | — | — |
| Tiện ích popup/side panel | "Đang tải…" (giữ) | `unknown`/`ambiguous`/`unsupported_page` (giữ, dịch sẵn) | `.notice.error` → token attention | — | spend `conflict` ẩn số + ghi chú (giữ) |

Mẫu lỗi 4 phần: **chuyện gì** (tiêu đề) → **vì sao** (`error.message` đã được server làm sạch; không
stack trace) → **làm gì tiếp** (nút Thử lại / link Trạng thái hệ thống) → **mã tham chiếu** (`requestId`
mono, copy được).

---

## 12. Rủi ro giấy phép / hiệu năng / trợ năng (bước 6 §10 skill)

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Giấy phép: Be Vietnam Pro, JetBrains Mono (OFL), Lucide (ISC), Radix/shadcn/cva/clsx/tailwind-merge (MIT), axe-core (MPL-2.0, chỉ dev) | thấp | U1a mở trang giấy phép từng gói trước `npm i`, ghi vào `docs/ui/LICENSES.md`; không CDN |
| Bundle tăng (font 4 weight ×2 subset ≈ 160–220 KB woff2; Radix ≈ 40–60 KB gz) | trung bình | chỉ subset `vietnamese,latin`; `font-display: swap`; tree-shake Lucide; đo `vite build` trước/sau, ghi `TEST_LOG.md` |
| Dấu tiếng Việt bị cắt ở line-height thấp / trong badge | trung bình | line-height ≥1,4; badge `py-0.5` + `leading-4`; mẫu "Ướt, Ấ" trong preview; **kiểm trên Chrome thật do người** |
| Dark mode làm đổi nghĩa tone (xanh lá tối trông như xám) | trung bình | giá trị tối chọn riêng (không tự đảo), tương phản ≥5:1; test "tone không đổi theo theme" |
| Đổi `label` thành khoá dịch phá test đọc `.label` | chắc chắn xảy ra | cập nhật test cùng lát; test parity khoá là lỗi biên dịch |
| Trộn VI/EN trong thời gian chuyển (U1a→U1d) | chắc chắn | mỗi lát dịch trọn trang của lát; `i18n.coverage.test` liệt kê trang đã dịch; không phát hành giữa chừng |
| Người dùng mất bookmark/URL | thấp | không đổi route/tham số |
| Hiệu năng bảng 200 dòng (Overview tải `page_size: 200`) | có sẵn, không do U1 | ghi follow-up, không chạm |
| Trợ năng: màu + chữ trên badge, focus, bàn phím Sheet/Tabs/Menu (Radix), `aria-label` cho mọi nút icon | — | axe trong vitest cho 6 trang chính; checklist §13 |
| Agent không đăng nhập được → không có ảnh chụp thật trước khi giao | chắc chắn | mỗi lát kèm danh sách click-through cho chủ sản phẩm/BA (rule 42 runbook) |

---

## 13. Lộ trình lát nhỏ (mỗi lát độc lập kiểm được)

| Lát | Nội dung | Cổng kiểm (ngoài `vitest`/`tsc -b`/`vite build`/`eslint` xanh) |
|---|---|---|
| **U1a — Token · shell · nav · i18n scaffold · font** | `index.css` token sáng/tối; `tailwind.config.js` đọc biến, `darkMode:['class']`, `fontSize` thêm `2xs`; `ThemeProvider` (hệ thống/sáng/tối, `adsops.theme`); font tự host; shadcn init + Button/Badge/Card/Tooltip/Sheet/DropdownMenu/Separator; `lucide-react`; `AppShell` mới (nhóm, Sheet mobile, header, 1 disclaimer); `src/i18n/*` + `useI18n` + `I18nProvider`; `format.ts(locale)`; `TONE_CLASS`→`tone-*`; **nav + shell + Login tiếng Việt**, thân trang còn tiếng Anh | test: `tone-classes.test` (TONE_CLASS chỉ lớp token; 4 bản đồ không `positive` cho unknown/Meta/độ mới — mở rộng test S2); `theme.test` (data-theme/class, persist, tone không đổi); `i18n.parity.test`; `appshell.test` (15 mục/7 nhóm, Esc đóng Sheet, focus về nút mở, `aria-current`); `no-raw-palette.test` (grep `src/` trừ allowlist — ban đầu allowlist = 25 tệp hiện có, lát sau rút dần); axe cho AppShell + Login; đo kích thước bundle |
| **U1b — Tổng quan + Tài khoản** | T1 cho Overview (4 ô + 2 thanh phân bố + Nguồn & độ mới + bảng tiền tệ + 3 thẻ); T2 cho Accounts (toolbar, Bộ lọc khác, Cột, hàng→thẻ, số căn phải, ⋯); `EmptyState/ErrorState/NoPermissionState/PartialDataNote` chuẩn; bỏ `humanise()` ở 2 trang (bản đồ nhãn enum trong i18n); DiscoveryOverview không còn `return null` | test hiện có `accounts-spend`, `platform-status`, `discovery.overview` xanh sau sửa nhãn; mới: KPI tiles đúng số & tone; SegmentBar đúng tỉ lệ & chú giải; ô spend `never_observed` → "Chưa có dữ liệu", không bao giờ "0"; column chooser; hàng→thẻ ở 375 (jsdom: class/attr); axe 2 trang |
| **U1c — Chi tiết tài khoản** | T3 header + 7 tab; `AccountFormDrawer`→Sheet; Lưu trữ→AlertDialog (đối tượng, hệ quả, khôi phục được); SpendTab/HealthTab/ReadinessTab/EventsTab/AssetsTab/AuditTab/OverviewTab dịch + bỏ `humanise()`; bảng ngày căn phải mono + chú thích "—" | test `account.provenance`, `spend`, `health.components` xanh; mới: AlertDialog chặn khi chưa xác nhận; nút Làm mới non-owner vô hiệu + tooltip; tab đồng bộ URL; axe |
| **U1d — Các trang còn lại** | Alerts(+AlertDrawer), AccountHealth(+HealthSignalDrawer), Readiness, Preflight(+detail, 2 drawer), Operations + 3 wizard (T5), MetaConnections(+workspace, Discovery*, AssetInventory, ReaderSource), BMs/Assets(+ReferenceManager), Team(+2 drawer), SecurityDevices, AuditLog(+AuditDiff), SystemStatus (sửa P13), Settings; xoá `ui.tsx` cũ khi không còn ai import; allowlist `no-raw-palette` = rỗng; `window.confirm` = 0 | test hiện có xanh; `i18n.coverage.test` = 100% trang; `SystemStatus` API badge tone theo giá trị; axe 6 trang |
| **U1e — Tiện ích** | `extension.css` dùng **cùng giá trị** token (chép từ một tệp nguồn `design-tokens.json` → sinh CSS cho cả hai dự án bằng script build nhỏ, hoặc chép tay + test so khớp); dark theo `prefers-color-scheme` + `color-scheme`; `lang` theo ngôn ngữ; `FRESHNESS_META.current`→`neutral`, `SPEND_FRESHNESS_META.current`→`neutral` (khớp dashboard — **quyết định**, ghi `TEST_LOG`); nhãn `page_type`; 4 icon SVG inline; aria-label dịch; bump 0.3.1 | `npm test` tiện ích xanh + mới: không `positive` cho độ mới; token trùng dashboard (test đọc hai tệp); manifest = package version; **UAT trong Chrome thật theo `docs/RUNBOOK_EXTENSION_UAT.md` do người làm** |

Thứ tự bắt buộc: U1a → U1b → U1c → U1d; U1e độc lập sau U1a. Mỗi lát một báo cáo theo Playbook §7 và
cập nhật `FEATURES.md`/`ARCH.md`/`TEST_LOG.md` (không có `API.md` thay đổi).

---

## 14. Test Plan (Playbook §5 + skill §9)

### 14.1 Unit
- `TONE_CLASS` chỉ chứa `tone-{positive|caution|attention|info|neutral|muted}`; không lớp bảng màu thô.
- `READINESS_META.unknown/not_ready`, `SPEND_FRESHNESS_META.*`, `PLATFORM_STATUS_META.*`,
  `FRESHNESS_META.*` không `positive` (giữ + mở rộng test S2 sang tiện ích).
- i18n: parity khoá `vi`↔`en` (biên dịch + runtime), `interpolate`, không khoá nào rỗng; mọi nhãn enum
  trong 4 bản đồ là khoá hợp lệ.
- `format.ts`: `vi-VN` → `dd/MM/yyyy HH:mm`, tương đối tiếng Việt, `null` → "chưa từng"/"—".
- Theme: `system|light|dark` → class/`data-theme`, persist, không ném khi `localStorage` lỗi.

### 14.2 Integration (component + jsdom)
- AppShell: 7 nhóm, `aria-current="page"`, Sheet mobile đóng bằng Esc và trả focus; menu người dùng.
- Accounts: toolbar, Popover bộ lọc, Cột, hàng→thẻ (class ở ≤640), ô chi tiêu 4 trạng thái, ô Meta 5
  trạng thái, số căn phải (`text-right tabular-nums font-mono`).
- Overview: 4 ô + 2 thanh phân bố đúng số từ 3 summary; thẻ "Nguồn & độ mới" nói "chưa từng" khi null.
- Account detail: AlertDialog lưu trữ; nút owner-only vô hiệu + tooltip; tab URL.
- axe-core: 0 vi phạm `serious/critical` trên Login, Overview, Accounts, AccountDetail (3 tab), Alerts, Settings.

### 14.3 Regression (invariant)
- Không `positive` cho `unknown`/`not_ready`/mọi Meta status/mọi độ mới — **cả dashboard lẫn tiện ích**.
- Không `0` khi `spend_raw === null`/không có quan sát (`AccountSpendCell`, `SpendTab`, side panel).
- Không `window.confirm`, không `humanise(` trong `pages/`, không `lang="en"` khi ngôn ngữ `vi`, không
  lớp bảng màu thô ngoài `lib/tokens.ts` (test kiểu grep như `test_alert_security.py`).
- Route/param/`queryKey` không đổi (snapshot danh sách route từ `App.tsx`).
- Readiness ≠ health trên mọi màn; không phần tử nào hiển thị `%` cho readiness/health.

### 14.4 Live verification (người thật — agent không được đúc phiên)
- `scripts/` theo `docs/LIVE_VERIFICATION_RUNBOOK.md` với `ADSOPS_LIVE_EMAIL/PASSWORD` do chủ sản phẩm
  export; click-through 7 nhóm nav, 3 màn chính, Sheet/Dialog bằng bàn phím; chụp 375/768/1280 ×
  sáng/tối; thử dấu tiếng Việt ở `text-2xs` trong badge; tiện ích theo `RUNBOOK_EXTENSION_UAT.md`.
- Ghi **đúng** vào `TEST_LOG.md`: ảnh nào đã chụp, bug thật nào tìm thấy, gì **chưa kiểm**.

### 14.5 Những gì không kiểm được trong workspace này
Hiển thị font thật trên Chrome/Windows/macOS; trình đọc màn hình; side panel Chrome thật; Lighthouse/CWV
trên production (frontend production chưa truy cập được theo đo 2026-10-26, chưa đo lại hôm nay).

---

## 15. Success Criteria (quan sát được)

1. Mở Overview ở 1280px: **4 ô "Cần xử lý hôm nay"** là thứ đầu tiên dưới tiêu đề; không ô nào trong hàng
   đó màu xanh lá; `unknown` ở thanh phân bố là xám.
2. Mọi màn hình: tiếng Việt từ i18n; `grep -r "humanise(" frontend/src/pages` = 0; `grep 'lang="en"'
   frontend/index.html` = 0; chuyển EN không hỏng bố cục.
3. `grep -rE 'bg-(emerald|rose|amber|sky|slate)-' frontend/src --include=*.tsx` = 0 (ngoài tệp token);
   `dark:`/token tối hoạt động: đổi theme không đổi tone của bất kỳ badge nào (test).
4. Danh sách tài khoản ở 375px: không cuộn ngang trang; hàng thành thẻ; ô chi tiêu chưa đọc ghi "Chưa
   có dữ liệu", không "0"; ô Meta chưa quan sát ghi "—" kèm tooltip.
5. Mọi nút chỉ icon có `aria-label`; Sheet/Dialog đóng bằng Esc; axe 0 lỗi serious trên 6 trang.
6. Tiện ích và dashboard dùng **cùng giá trị** token (test đọc hai tệp); `FRESHNESS_META.current` không
   còn `positive` ở tiện ích.
7. Không route, `queryKey`, tham số URL, endpoint, enum nào thay đổi (snapshot test).
8. `vitest` ≥ 207 + test mới xanh; `vite build` thành công; bundle tăng được đo và ghi.

---

## 16. Câu hỏi mở cho chủ sản phẩm (chỉ quyết định thật)

| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| Q1 | Màu thương hiệu: giữ xanh dương `#1f5fbf` (dòng hiện tại) hay đổi theo nhận diện Mắt Bão / khách? | Giữ, tinh chỉnh tối `#6ea0ec` |
| Q2 | Chủ đề mặc định: theo hệ điều hành + công tắc, hay luôn sáng? | Theo hệ điều hành |
| Q3 | Mật độ: body 14px/hàng 40px (cân bằng) hay 13px/36px (dày)? | 14px; chế độ dày để sau |
| Q4 | Ngôn ngữ: chỉ VI, hay VI mặc định + EN phụ (parity biên dịch, chi phí thấp vì tiện ích đã có)? | VI + EN |
| Q5 | Biểu đồ chi tiêu: U1 **không vẽ** (S1 giữ chuỗi thô). Có mở spec S riêng để API trả số và vẽ cột theo ngày không? | Không trong U1 |
| Q6 | Bỏ quyết định A7 "ẩn 5 route", đưa vào nav nhóm thu gọn? | Có |
| Q7 | Trạng thái **đội ghi nhận** `active` đang xanh (`readiness.ts:61`) trong khi `active (theo Meta)` xám. Giữ xanh hay hạ xuống xám cho đồng nhất? (cần BA) | Giữ nguyên trong U1, hỏi BA |
| Q8 | Ai là BA duyệt wording cho `vi.ts` (và có duyệt `en.ts` không)? | — |

Quyết định ghi vào chính tệp này (§13 Playbook) trước khi U1a bắt đầu.

---

## 17. Prompt sẵn dùng cho agent triển khai (skill §8; model theo bảng tổ chức: UI = `sonnet`/agy, Claude ráp & review)

**P-U1a**
```text
Thực hiện lát U1a theo docs/AUDIT_BEFORE_BUILD_U1_UI.md §10, §13. Chỉ sửa frontend/. Không đổi API, route, queryKey.
1) index.css: khai báo token §10a–10b sáng (:root) và tối (.dark + prefers-color-scheme khi chưa chọn); tailwind.config.js đọc biến,
   darkMode ['class'], fontSize thêm 2xs 11/16, fontFamily sans "Be Vietnam Pro", mono "JetBrains Mono".
2) Cài (sau khi mở trang giấy phép): @fontsource/be-vietnam-pro (subset vietnamese,latin, 400/500/600/700), @fontsource-variable/jetbrains-mono,
   lucide-react, shadcn/ui (Button, Badge, Card, Tooltip, Sheet, DropdownMenu, Separator) + cva/clsx/tailwind-merge/tailwindcss-animate. Không CDN.
3) lib/readiness.ts: TONE_CLASS/TONE_DOT trỏ lớp tone-*; KHÔNG đổi tone của bất kỳ trạng thái nào.
4) src/i18n/{types,vi,en,index}.ts + I18nProvider/useI18n theo đúng mẫu extension/src/shared/i18n; vi là nguồn sự thật; mọi chuỗi đánh dấu
   [ĐỀ XUẤT — chờ duyệt] ở đầu tệp; format.ts nhận locale.
5) AppShell mới: 7 nhóm §9a (icon Lucide 20px), Sheet trái trên <1024px (Esc, focus trả về), header: workspace · tìm nhanh · theme · VI/EN ·
   menu người dùng (vai dịch); một disclaimer ở footer; Login dịch.
6) Test §14.1 + appshell/theme/i18n parity/no-raw-palette (allowlist = tệp hiện có) + axe (AppShell, Login). Chạy vitest, tsc -b, vite build, eslint.
Báo cáo theo Playbook §7, kèm kích thước bundle trước/sau và danh sách gì CHƯA kiểm.
```

**P-U1b**
```text
Lát U1b: Overview (khuôn T1) và Accounts (khuôn T2) theo §9b, §11; dùng component U1a; bỏ humanise() ở hai trang (nhãn enum trong vi.ts);
EmptyState/ErrorState(4 phần)/NoPermissionState/PartialDataNote dùng chung; StatTile + SegmentBar mới (status tones, có chú giải + số, không %).
Ô chi tiêu: chuỗi thô căn phải mono; never_observed → "Chưa có dữ liệu", không bao giờ 0. Ô Meta: badge + thời điểm, "—" khi không có.
Cột mặc định ≤8, "Cột" bật cột phụ, ≤640px hàng→thẻ. Giữ URL filter. Test §14.2 cho hai trang; test S1/S2 hiện có phải xanh.
```

**P-U1c / P-U1d**: như trên cho T3/T4/T5/T6 (§13), kèm "AlertDialog thay window.confirm: nêu đối tượng,
hệ quả, có khôi phục được; không nút xoá".

**P-U1e**
```text
Lát U1e (extension/): không thêm gói. extension.css đọc cùng giá trị token §10 (sáng + @media prefers-color-scheme: dark, color-scheme);
lang theo ngôn ngữ; FRESHNESS_META.current và SPEND_FRESHNESS_META.current → neutral (ghi TEST_LOG là quyết định đồng bộ với dashboard);
nhãn page_type qua i18n; 4 icon Lucide SVG inline (refresh, external-link, triangle-alert, info) có aria-label dịch; bump 0.3.1.
Test: không positive cho độ mới; token trùng dashboard; manifest = package. UAT Chrome thật theo RUNBOOK_EXTENSION_UAT.md do người làm.
```

**P-review (§8.6)**
```text
Rà soát lát U1x theo checklist §9 skill ui-ux-resource-navigator + CLAUDE.md rule 5/6/9/11/28/33. Trả về bảng: vấn đề | mức | file:line |
đề xuất | đã kiểm hay chưa kiểm. Đặc biệt: có chỗ nào unknown/not_ready/Meta/độ mới trông "ổn" không; có chỗ nào 0 thay cho chưa biết không.
```

---

## 18. Bản xem trước

`docs/ui/U1_PREVIEW.html` — một tệp tĩnh, CSS inline, Google Fonts (chỉ cho bản xem trước; sản phẩm tự host),
không script ngoài. Hiển thị: token sáng/tối, ma trận tone (kèm chú giải "không bao giờ xanh"), thang chữ với
"Quyết định, Thiết lập, Nhượng quyền, Ướt" ở mọi cỡ, khoảng cách/bo góc/bóng, icon; màn Tổng quan, Danh sách
tài khoản (đủ trạng thái ô chi tiêu/Meta, hàng→thẻ ở ≤640px), Chi tiết tài khoản + tab Chi tiêu, bộ trạng thái
(tải/rỗng/lỗi/không quyền/một phần), side panel tiện ích sáng + tối. Mọi số là **"Dữ liệu mẫu"**, ghi trên
từng khung. Hỗ trợ `prefers-color-scheme` + công tắc.

Đã kiểm (2026-10-27): cân bằng thẻ HTML (script: 0 lỗi, không trùng `id`, mọi icon có `symbol`); tương phản
**mọi** cặp token sáng/tối bằng script (thấp nhất 4,86:1 — `fg-faint` trên `surface-2` tối; mọi cặp ≥ 4,5:1,
màu tô thanh phân bố ≥ 6,5:1 trên nền thẻ); kích thước 114 KB; **render trong Chromium headless của workspace
qua DevTools MCP**: 1280×900 sáng và 375×812 tối đều `scrollWidth = clientWidth` (không tràn ngang), font
Be Vietnam Pro 400/500/600/700 + JetBrains Mono nạp xong (`document.fonts`), sidebar ẩn và hàng→thẻ bật ở 375;
lần đo đầu phát hiện ô trong chế độ thẻ bị cắt ở mép phải và nhãn "Chi tiêu" thừa hưởng font mono → đã sửa
(bảng chuyển `display:block`, giá trị xếp cột, `.amt` riêng cho số) và đo lại: 0 phần tử tràn khung.
**Chưa kiểm**: Chrome trên máy người dùng (Windows/macOS), trình đọc màn hình, thao tác bàn phím (bản tĩnh
không có Sheet/Dialog thật).

Mở: `xdg-open docs/ui/U1_PREVIEW.html` hoặc kéo vào trình duyệt; không cần build. Bản sao để xem nhanh (riêng
tư, cùng nội dung, do agent xuất bản 2026-10-27): https://claude.ai/artifact/WmrEdxLLvJiiAiihnTEteL — tệp trong
repo là nguồn sự thật.

---

## 19. Follow-up ngoài phạm vi (chỉ đề xuất, không tự bắt đầu)
- Spec S-?: API trả số tiền dạng số (minor units) để vẽ biểu đồ ngày (Q5).
- Overview tải `page_size: 200` để tự tính phân bố checklist (`Overview.tsx:34-37`) — nên có endpoint summary; không thuộc U1.
- Chế độ mật độ dày; sidebar thu thành rail icon; toast (Sonner); TanStack Table khi cần lọc phía client.
- Mockup live theo `/mockup` (từng màn một tệp) nếu BA muốn click thử trước khi code — bản xem trước này là tĩnh.

---

## Quyết định của chủ sản phẩm (2026-10-27)

| Câu | Quyết định |
|---|---|
| Q1 | Giữ xanh dương `#1f5fbf`, như bản xem trước |
| Q2 | Sáng/tối theo hệ điều hành, có công tắc đổi |
| Q3 | Mật độ cân bằng: chữ 14px, hàng bảng 40px |
| Q4 | Tiếng Việt mặc định, tiếng Anh là ngôn ngữ phụ |
| Q5–Q8 | Chưa hỏi riêng, áp đề xuất: U1 không vẽ biểu đồ; đưa 5 route đang ẩn vào menu nhóm; Q7 và Q8 (wording) để BA duyệt. Mọi chuỗi mới gắn `[ĐỀ XUẤT — chờ duyệt]` |

Thứ tự triển khai: U1a → U1b → U1c → U1d → U1e. Mỗi lát xong phải xanh test rồi mới commit.
