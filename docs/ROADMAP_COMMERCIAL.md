# Lộ trình thương mại — từ hôm nay đến một sản phẩm bán được

Ngày: 2026-10-26 · Baseline `a8392b6` · Tài liệu định hướng, **không phải cam kết ngày**. Mỗi phase
dưới đây vẫn phải qua đủ 7 bước của `MINI_SPEC_PLAYBOOK.md` khi đến lượt; không phase nào tự bắt đầu.

Rule 41: mọi câu "đã có / chưa có" dưới đây đều đo ngày 2026-10-26 (đọc mã tại `a8392b6`, đọc mã
`share-projects/mb-connect` và `share-projects/ads-manager`), hoặc được đánh dấu **chưa kiểm được**.
Cơ sở dữ liệu dev đang tắt; số liệu DB dẫn lại từ `FEATURES.md` (đo 2026-09-14) và ghi rõ.

**Ba quyết định của người dùng (2026-10-26) mà lộ trình này bám theo:**
1. Sản phẩm sẽ **bán cho nhiều khách**, không chỉ dùng nội bộ.
2. Giữ là **sản phẩm riêng** với AdsCommand, nhưng **dùng chung cổng mb-connect** để khách tự kết nối
   Google/Meta một chạm.
3. Thứ tự nỗi đau: **(a) theo dõi chi tiêu → (b) tài khoản bị khoá/vô hiệu → (c) tạo & chia sẻ tài
   khoản hàng loạt**. Đội còn chạy nhiều tài khoản Google Ads và TikTok.

---

## Tổng quan

| Phase | Mục tiêu một câu | Cỡ | Phụ thuộc |
|---|---|---|---|
| 0 — Dùng được | Người thật mở được giao diện prod, nhận được một tin Telegram thật, đọc được cả hai BM | S (nhiều việc nhỏ, mỗi việc một phê duyệt) | hạ tầng Vibe Host, người dùng |
| 1 — Chi tiêu (S1) | Mỗi tài khoản có chi tiêu theo ngày + độ mới + tín hiệu lệch/trần | M | 0.1, 0.2 |
| 2 — Tài khoản bị khoá (S2) | Trạng thái Meta của tài khoản thành tín hiệu `critical` có nguồn gốc rõ, đối chiếu với trạng thái người ghi | S–M | 1 |
| 3 — Dùng thật tạo/chia sẻ | Một pilot tạo tài khoản thật; mở hai đường ghi còn lại trong transport | M | 0.5, phê duyệt theo rule 22 |
| 4 — Nền thương mại (C1) | Nhiều khách trên một sản phẩm, token của khách qua mb-connect, gói/thanh toán, onboarding, hồ sơ Meta/Google | L | 1–2, quyết định sửa luật |
| 5 — Đa nền tảng | Google Ads rồi TikTok, qua cùng cổng và cùng khung quan sát | Google M–L · TikTok L | 4, mb-connect có provider TikTok |

Thứ tự 1 → 2 → 3 là của người dùng. Phase 4 có thể bắt đầu **phần tài liệu và quyết định** song song
với 1–2 vì nó chặn mọi thứ sau nó; phần mã của 4 nên đi sau 2.

---

## Phase 0 — Dùng được

Mục tiêu: xoá các điểm "đã xây nhưng chưa dùng được" đang ghi ở `FEATURES.md` §"What is blocked".
Mọi mục dưới đây là **thao tác vận hành** — rule 22: mỗi mục cần **phê duyệt riêng, có tên hành
động**; phê duyệt mục này không hàm ý mục kia.

| # | Việc | Trạng thái đo được | Cần gì | Cỡ |
|---|---|---|---|---|
| 0.1 | **Frontend prod vào được** | `FEATURES.md:25`: hai hostname trả trang catch-all của nền tảng, stack kẹt `deploying` từ 2026-09-07 (đo 2026-09-14); yêu cầu hỗ trợ ở `docs/VIBEHOST_SUPPORT_REQUEST.md`. **Hôm nay chưa đo lại** | người dùng/đội Vibe Host xử lý định tuyến; sau đó đo lại bằng `curl` và ghi `TEST_LOG.md` | S (ngoài mã) |
| 0.2 | **Kiểm phiên bản Graph `v21.0`** | ghim ở `core/config.py:85`; AdsCommand đang ở `v24.0`–`v26` (bộ nhớ dự án); **chưa kiểm `v21.0` còn sống không** | một GET đọc tay (`scripts/a10_live_probe.py`) có người xem; nếu chết → đổi `META_GRAPH_API_VERSION` là **quyết định phát hành** (`config.py:82-83`) | S |
| 0.3 | **Bật health sweep** | xây xong 2026-09-15, `HEALTH_SWEEP_EVERY_N_PASSES=0` mặc định (`FEATURES.md:860-866`) | quyết định phát hành đặt `N>0` trên prod | S |
| 0.4 | **Telegram thật** | 6 dòng `notification_deliveries` đều `SKIPPED`, chưa có `SENT` (`FEATURES.md:31`, đo 09-14) | `TELEGRAM_BOT_TOKEN` vào env prod (rule 18) **+** phê duyệt riêng cho **một chat có tên** (rule 20/22) **+** chạy "controlled test send" (`ALLOW_TEST_SEND`, `docs/RUNBOOK_TELEGRAM_TEST_SEND.md`) | S |
| 0.5 | **Token cho BM thứ hai** `109796697343603` | mã đã có (`META_ACCESS_TOKENS_BY_BUSINESS`, `FEATURES.md:283-293`); thiếu system user **bên trong** BM đó | người dùng tạo system user trong Business Settings của BM đó, sinh token, đưa vào env; không dán vào chat | S (ngoài mã) |
| 0.6 | **Credential live-verify** | ba script đọc `ADSOPS_LIVE_EMAIL/PASSWORD` qua `scripts/lib/live_auth.py`, thiếu thì exit 2 (`FEATURES.md:826-840`) | người dùng export hai biến trong shell của họ khi cần click-through; agent không tự đúc token (quyết định 2026-09-14) | S |
| 0.7 | **Schema prod ở head** | lần cuối xác nhận 2026-09-12 từ log; **không kiểm được từ workspace** (`CLAUDE.md:22`) | đọc log `migration complete` hoặc `GET /operations/overview` sau khi 0.1 xong | S |

Rủi ro chính: tất cả nằm ngoài mã và ngoài tay agent; lộ trình có thể đứng ở đây vô thời hạn mà
không có gì "hỏng". Đề nghị: người dùng chốt 0.1 và 0.2 trước khi cho Phase 1 viết mã, vì S1 không
có giá trị nếu không ai mở được UI và Meta từ chối phiên bản.

---

## Phase 1 — Theo dõi chi tiêu (S1)

Toàn bộ audit + thiết kế ở `docs/AUDIT_BEFORE_BUILD_SPEND.md`. Tóm tắt để nhìn trong lộ trình:

- **Mục tiêu**: mỗi tài khoản Meta trong registry có chi tiêu theo ngày (múi giờ tài khoản, tiền tệ
  Meta trả), độ mới 4 trạng thái, ba luật (`spend_observation_missing_or_stale`,
  `spend_change_vs_baseline`, `spend_cap_approaching`) + một luật lệch tiền tệ, alert tự suy theo A3.
- **Phạm vi**: 1 bảng quan sát (migration `0016`), 1 phương thức provider, 1 pass dispatcher **tắt mặc
  định**, 4 endpoint, 1 tab + 1 cột + 1 mục Overview. Transport không đổi (rule 20 nguyên vẹn).
- **Rủi ro chính**: đơn vị `amount_spent`/`spend_cap` và hành vi dòng-0 của insights **chưa kiểm**
  (lưu chuỗi thô, luật cap bật sau lần đọc thật); hạn mức Graph chưa đo; `v21.0` có thể chết (0.2);
  đây là **lần đầu Meta được gọi theo đồng hồ** — thay đổi tiền đề ghi ở 3 tài liệu, phải viết lại.
- **Phụ thuộc**: 0.1 (để thấy), 0.2 (để đọc được), 0.5 nếu muốn cả hai BM.
- **Cỡ**: M.

---

## Phase 2 — Tài khoản bị khoá / vô hiệu (S2)

- **Mục tiêu**: trạng thái **Meta nói** về tài khoản (`account_status`, `disable_reason`) trở thành tín
  hiệu sức khoẻ có nguồn `provider_observation`, **tách bạch** với trạng thái **người ghi**
  (`AdAccount.status`, luật `account_disabled_status` hiện có `health_rules.py:138-159`). Khi hai
  bên lệch → tín hiệu đối chiếu, **không tự ghi đè** registry (tiền lệ: discovery không bao giờ ghi
  registry — `FEATURES.md:52-53`).
- **Có sẵn**: `account_status` đã được đọc từ A10.1 vào `safe_metadata_json` (`meta_real_provider.py:74`,
  `:106-110`) nhưng **không hiển thị, không đối chiếu** (đo 2026-10-26, §2a của audit S1). S1 sẽ lưu
  thêm `observed_account_status` + `observed_disable_reason` dạng chuỗi thô mỗi lượt đọc (nếu người
  dùng chọn "đọc ngay" ở câu hỏi 6.5 của S1), nên S2 **không cần gọi thêm Meta**.
- **Phạm vi**: bảng ánh xạ mã Meta → nhãn nội bộ dạng **allowlist** (mã lạ → `unknown`, không đoán);
  2 luật: `platform_account_status_not_active` (`critical` khi mã Meta ∈ tập "không hoạt động" đã
  xác minh; `attention` khi mã lạ), `platform_vs_recorded_status_mismatch` (`attention`); một hành
  động **tường minh** "Ghi nhận trạng thái Meta vào registry" (owner, có lý do, audit) thay vì tự
  đồng bộ; Telegram `critical` đi theo chính sách A3 có sẵn.
- **Rủi ro**: ý nghĩa các mã `account_status`/`disable_reason` **chưa kiểm** trong workspace (bảng
  của AdsCommand `lib/connect/meta-assets.ts:31` chỉ có 7 mã, là bảng tự lập); phải đối chiếu tài liệu
  Meta và ghi `TEST_LOG.md` với mã thật đã thấy. Rule 6: không bao giờ nói "không bị khoá".
- **Phụ thuộc**: 1 (bảng quan sát, pass sweep, `HealthSourceType.PROVIDER_OBSERVATION`).
- **Cỡ**: S–M.

---

## Phase 3 — Dùng thật tạo & chia sẻ tài khoản

- **Mục tiêu**: một pilot tạo tài khoản thật qua A10.2; sau đó mở **hai đường ghi còn lại**
  (`share_ad_account_access`, `share_pixel_access`) để A7/A8 chạy thật với quy mô.
- **Có sẵn**: engine batch draft → preview → confirm → run, idempotency, `unknown`-on-timeout, lease
  recovery (A7/A8); transport POST **đúng một path** `{bm}/adaccount` (`meta_graph_transport.py:51`);
  hai write còn lại **raise** (`meta_real_provider.py:437-445`); pilot cap `META_WRITE_PILOT_MAX_ITEMS=1`
  (`config.py:92`). Mọi bảng batch 0 dòng (`FEATURES.md:30`, đo 09-14).
- **Phạm vi**: (a) pilot 1 tài khoản — cần **billing trên BM, số slot còn lại, phê duyệt có tên BM**
  (`FEATURES.md:39`); (b) mini-spec "A11": widen `_WRITABLE_PATH` thành allowlist 3 path, mỗi path
  một test, Meta permissions cho share (**chưa kiểm** cần quyền gì ngoài `business_management`),
  bỏ `raise` ở hai phương thức; (c) nâng `META_WRITE_PILOT_MAX_ITEMS` **sau** khi pilot được kiểm
  trong Business Settings.
- **Rủi ro**: không hoàn tác được; timeout = `unknown` chờ người (thiết kế cố ý, `ARCH.md:584-591`);
  share nhầm quyền cho đối tác sai còn tệ hơn tạo thừa một tài khoản → preview hash phải phủ cả
  `recipient_reference` và `role` (đã có cho A7, kiểm lại khi mở đường ghi).
- **Phụ thuộc**: 0.5 nếu BM đích là BM thứ hai; phê duyệt rule 22 **từng lần**.
- **Cỡ**: M.

---

## Phase 4 — Nền thương mại (C1)

Đây là phase đổi bản chất sản phẩm: từ "công cụ nội bộ đọc bằng token của Mắt Bão" sang "dịch vụ
cho khách đọc bằng token của khách". Nó đụng bốn hard rule. **Mọi đề xuất sửa luật dưới đây là
quyết định của người dùng, chưa phải việc đã chốt.**

### 4.1 Cách ly nhiều khách — mô hình workspace đã cho được gì?

**Đã có (đo trong mã):**
- Mọi bảng nghiệp vụ mang `workspace_id`; workspace lấy từ membership, không từ request (rule 8;
  `ARCH.md:48-51`); `WorkspaceAccessService` (rule 10); A9 giới hạn non-owner theo BM/tài khoản được
  gán (`FEATURES.md:139-148`); ngoài scope luôn `404`.
- `health_rule_definitions` có dòng toàn cục (`workspace_id IS NULL`) + override theo workspace
  (`API.md:283-299`) — đúng hình dạng "mặc định của nhà cung cấp, khách tự chỉnh".
- `NotificationPolicy` một dòng **mỗi workspace**, `telegram_chat_id` theo workspace (`ALERT_POLICY_V1.md` §3).
- `WorkspaceSeatPlan` — "capacity only, never a billing engine" (`models/team.py:68`).

**Chưa có / là toàn cục trong khi phải theo khách:**

| Thứ | Hôm nay | Phải thành |
|---|---|---|
| Tạo workspace | chỉ `bootstrap.py:50` tạo **một** workspace lúc khởi động; không endpoint nào tạo thêm (grep `Workspace(` trong `backend/app`: 1 chỗ) | onboarding tự phục vụ hoặc admin tạo; invitation A9 có sẵn nhưng **không gửi email** (`FEATURES.md:127`) |
| Credential Meta | `META_ACCESS_TOKEN`, `META_ACCESS_TOKENS_BY_BUSINESS`, `META_BUSINESS_ID` là **cấu hình máy chủ toàn cục** (`config.py:66-100`) — một BM id xuất hiện ở hai workspace sẽ dùng **cùng** một token | theo workspace, qua mb-connect (4.2) |
| Telegram | một bot toàn cục (rule 18); chat theo workspace | giữ một bot của Mắt Bão (đề xuất) — xem 4.3 |
| `operational_runs` | cố ý **không** theo workspace (`ARCH.md:365-371`) | giữ; nhưng trang System Status phải chỉ cho **admin của Mắt Bão**, không cho owner của khách (hôm nay owner xem được — `API.md:452-453`) |
| Dispatcher | duyệt mọi workspace, actor = thành viên đầu tiên (`run_dispatcher.py:179-184`) | giữ vòng lặp; thêm "system actor"; bounded **theo workspace** để một khách lớn không chiếm hết lượt (đã có `batch` per workspace) |
| Rate limiter | theo subject, in-process (rule 37) | đủ cho một tiến trình; khi >1 tiến trình cần Redis — là việc hạ tầng, ghi nhận |
| CORS cho extension | một `CORS_ORIGINS` toàn cục với `chrome-extension://<id>` (`FEATURES.md:890-891`) | một extension id dùng chung là ổn (extension chỉ mang token của chính người đăng nhập) |
| Xoá dữ liệu khách | rule 2: **không bao giờ hard-delete**; mb-connect đã có data-deletion callback **ở cổng** (`mb-connect/app/api/meta/data-deletion/route.ts`) nhưng quan sát/registry nằm ở sản phẩm này | **va chạm rule 2 ↔ nghĩa vụ xoá dữ liệu của Meta/khách** → quyết định (4.3) |
| Rule 22 cho khách | mọi tin Telegram thật cần "người dùng" duyệt chat có tên | với khách, **owner workspace của khách** là người duyệt chat của họ → cần nói rõ trong luật (4.3) |

**Kết luận**: mô hình dữ liệu cho cách ly **đã đủ**; cái thiếu là cách ly **cấu hình** (credential,
phiên bản, bot) và các đường **vòng đời khách** (tạo, mời có email, gói, xoá). Không cần viết lại
authorization.

### 4.2 Token của khách qua mb-connect — cổng làm gì, sản phẩm này nối vào thế nào

**Đã tìm thấy**: `/home/coder/workspace/share-projects/mb-connect` (Next.js, lưu tệp JSON mã hoá
AES-256-GCM, một tiến trình; README ghi đang chạy ở `https://mbconnect.vibe.tinhgon.xyz` ngày
22/10; `ads-manager/docs/GOOGLE-OAUTH-VERIFICATION.md` (26/10) nhắm tên miền
`connect.marcom-matbao.io.vn` — **cái nào đang sống hôm nay chưa kiểm**). Thiết kế:
`ads-manager/docs/DESIGN-CONG-KET-NOI-MATBAO.md`; mini-spec đã duyệt 22/10:
`ads-manager/docs/mini-specs/GATEWAY-CONNECT-1.md`. Mã client mẫu: `ads-manager/lib/connect/gateway.ts`.

**Hợp đồng một bản cài (install) nối vào cổng — đọc từ mã, không suy đoán:**

| Bước | Ai gọi | Endpoint / dữ liệu | Nguồn |
|---|---|---|---|
| Khoá bản cài | admin Mắt Bão tạo bằng curl, **trả khoá thô đúng một lần** | `POST /api/admin/installs {name, appUrl}`; bản cài giữ `MB_CONNECT_URL` + `MB_CONNECT_INSTALL_KEY` trong env | `mb-connect/README.md` §Quản trị; `gateway.ts:8-12` |
| Mở lượt kết nối | bản cài (server) | `POST /api/v1/connect/start {provider:"meta", returnPath, createdBy:<email>, nonceHash:<sha256 hex>}` → `{url}`; **`returnPath` phải đúng chuỗi `/api/connect/meta/return`**, `createdBy` phải là email | `app/api/v1/connect/start/route.ts:13-16,23-25` |
| Khách đồng ý | trình duyệt khách | trang trung gian của cổng → Facebook Login for Business (`config_id`, system-user token doanh nghiệp, **không hết hạn**) → callback cổng → 302 về `appUrl + returnPath?provider=meta&ok=1&cid=…` (lỗi: `ok=0&reason=…`) | `lib/providers/meta.ts:1-7,27-38`; `app/api/oauth/meta/callback/route.ts` |
| Xác nhận | bản cài | `POST /api/v1/connections/:cid/confirm {nonce}` → `active`; **kết nối active cũ cùng provider bị thu hồi** | `connections/[id]/confirm/route.ts`; `lib/connections.ts:2-4` |
| Lấy token | bản cài, mỗi lần cần | `POST /api/v1/token {connectionId}` → `{accessToken, expiresAt, provider}`; Meta: trả chính token doanh nghiệp với hạn mềm 1 giờ, **mỗi lần cấp cổng hỏi `debug_token`**; 30 lượt/giờ/kết nối; cache phía bản cài, xin lại trước hạn 60 s, single-flight | `token/route.ts:15`; `lib/connections.ts:19-21,191-236`; `gateway.ts:61-95` |
| Lỗi ổn định | cổng → bản cài | `install_revoked`, `install_suspended`, `connection_missing` (409), `rate_limited` (429), `unauthorized`, `misconfigured` | `gateway.ts:30-37`; `lib/install-route.ts` |
| Thu hồi | bản cài / khách | `DELETE /api/v1/connections/:cid` → revoke ở Meta (`DELETE /me/permissions`) | `README.md` §Luồng; `lib/providers/meta.ts:95-105` |
| Hạn mức cổng | — | 30 lần xác thực sai/phút/IP; 300 lượt/phút/bản cài; 20 `connect/start`/giờ/bản cài | `install-route.ts:11-12`; `connect/start/route.ts:32` |

**Bốn điểm va chạm giữa hợp đồng đó và sản phẩm này (đo được, phải quyết):**

1. **Cổng đòi scope `ads_management`** (`lib/providers/meta.ts:12` `META_REQUIRED_SCOPE`;
   `lib/connections.ts:232` kiểm lại mỗi lần cấp). Sản phẩm này chỉ cần `ads_read` +
   `business_management` (`docs/RUNBOOK_META_CONNECTION.md:22`). Hai lựa chọn: (a) mb-connect thêm
   một **login config thứ hai, chỉ đọc**, và `META_REQUIRED_SCOPE` theo bản cài; (b) chấp nhận token
   có quyền ghi — transport của sản phẩm này **không thể** ghi ngoài một path (rule 20), nên quyền
   thừa không dùng được, nhưng hồ sơ App Review và câu chữ "chỉ đọc" sẽ khó bảo vệ hơn. Đề xuất (a).
2. **Một bản cài = một kết nối active mỗi provider** (`lib/connections.ts:2-4`, GATEWAY-CONNECT-1
   §3.2). Sản phẩm này là **một deployment, nhiều workspace**. Hai lựa chọn: (a) **một install mỗi
   khách** — sản phẩm giữ `install key` theo workspace → mà key là credential → **không được nằm trong
   DB** (rule 1) → chỉ có thể là một deployment riêng mỗi khách (mô hình của AdsCommand: template
   Vibe Host) → khi đó multi-workspace không dùng tới; (b) **mb-connect học khái niệm `tenantRef`**:
   một install có nhiều kết nối active cùng provider, mỗi kết nối gắn `tenantRef = workspace_id`,
   `POST /token` nhận `connectionId` như cũ. Một sửa nhỏ ở cổng (người dùng sở hữu cả hai dự án).
   Đề xuất (b) nếu muốn một deployment; (a) nếu muốn bán theo bản cài như AdsCommand.
3. **`returnPath` cố định `/api/connect/meta/return`** và `createdBy` phải là email
   (`connect/start/route.ts:13-16,23-25`). Backend FastAPI của sản phẩm này phải phục vụ **đúng** path đó
   (không dưới `/api/v1`), hoặc cổng cho phép đăng ký `returnPath` theo install. Việc nhỏ, nhưng là
   hợp đồng.
4. **Cổng không ghi `metaBusinessId`** (có trường trong `lib/store.ts:46` nhưng callback chỉ truyền
   `metaUserId` — `oauth/meta/callback/route.ts:44-46`). Sản phẩm này đọc theo **BM id**
   (`business_manager_reference`); với token của khách, BM nào đọc được phải được **khám phá** sau khi
   kết nối (edge `me/businesses` — hoạt động với user token, `meta_real_provider.py:169-170`) rồi khách
   **chọn**, giống AdsCommand làm với `/me/adaccounts` (`ads-manager/lib/connect/meta-assets.ts:33-40`).

**Nối vào sản phẩm này — hình dạng (chưa phải thiết kế, chỉ để thấy phạm vi):**
- Module thứ tư được ra ngoài: `services/mb_connect_transport.py` — chỉ tới `MB_CONNECT_URL`, chỉ ba
  path (`connect/start`, `connections/{id}/confirm`, `token`) + `DELETE connections/{id}`; bearer là
  `MB_CONNECT_INSTALL_KEY` từ cấu hình máy chủ; không log khoá, không log token; thêm **theo tên**
  vào `test_only_named_modules_may_make_an_outbound_request` (`tests/test_alert_security.py:236-240`).
- `meta_connections` thêm cột `gateway_connection_id` (chuỗi opaque `c_…`, **không phải credential**)
  và `reader_source` có thêm giá trị `customer_gateway`. `resolve_reader` thêm nhánh: nếu connection
  có `gateway_connection_id` → token lấy từ cổng, **chỉ trong bộ nhớ**, cache ≤ 1 giờ.
- Token access của khách **không bao giờ** vào DB/audit/log/response — đúng tinh thần rule 1/40; thứ
  được lưu là `gateway_connection_id`.
- UI: nút "Kết nối Facebook" ở trang Meta Connections (owner của workspace), sau đó bảng chọn BM.

### 4.3 Bốn hard rule bị va chạm — nguyên văn, và đề xuất sửa (quyết định của người dùng)

**Rule 1** — *"Never store or accept passwords, cookies, session data, access/refresh tokens,
credentials or raw proxy authentication secrets. `StrictPayload` refuses such fields by name — keep it
that way. Exactly two request bodies are allowed to opt out of it …"*

- Va chạm: sản phẩm sẽ **nhận** một access token từ cổng trong HTTP response và giữ nó trong bộ nhớ
  tiến trình; `MB_CONNECT_INSTALL_KEY` là một credential mới trong cấu hình máy chủ.
- Không va chạm: không request body nào mang token; không cột nào mang token; `StrictPayload` giữ nguyên.
- Đề xuất sửa (thêm một câu, không bớt): *"A customer-connected credential is never stored here
  either: it is obtained from the connection gateway at call time, held in process memory for at most
  the gateway's stated expiry, and the only persisted reference is the gateway's opaque
  `connection id`. The gateway install key is server configuration, like every other credential."*

**Rule 18** — *"The Telegram bot token lives only in server configuration. It never reaches the
database, an API response, an audit row, a log line or the frontend bundle."*

- Va chạm chỉ xảy ra nếu **mỗi khách muốn bot Telegram riêng** (token theo workspace → phải vào DB →
  vi phạm). Với **một bot của Mắt Bão** và `telegram_chat_id` theo workspace (đã có), rule 18 **không
  cần sửa**.
- Đề xuất: giữ nguyên rule 18; ghi vào roadmap rằng "bot riêng cho khách" là **không làm**. Quyết định.

**Rule 20** — *"Only three modules may make an outbound request, each to a narrow purpose: …
`services/telegram_transport.py` … `services/preflight_safe_http.py` … The third is
`services/meta_graph_transport.py` (… **GET-only by construction** …)."*

- Va chạm: cần module thứ tư (cổng mb-connect, có POST), và ở Phase 5 thêm mỗi nền tảng một module.
  Câu "GET-only by construction" đã **không còn đúng** từ A10.2 (transport có một POST) — tài liệu
  đang lệch mã.
- Đề xuất sửa: giữ cấu trúc "liệt kê theo tên + mỗi module một test nói nó bị giới hạn ở đâu"; đổi
  "three" thành danh sách; thêm `services/mb_connect_transport.py` (chỉ tới `MB_CONNECT_URL`, đúng
  bốn path, bearer từ cấu hình); sửa câu GET-only thành *"read-only except the single documented
  write path, enforced by `_WRITABLE_PATH` and its tests"*. Phase 5 thêm từng module **bằng một
  mini-spec riêng**, không thêm trước.

**Rule 40** — *"A Meta reader credential lives only in server configuration, keyed by Business Manager
id (`META_ACCESS_TOKENS_BY_BUSINESS`). Never add a column, a request field or a response field that
carries one; `reader_source` names which credential answered and is the most that may be disclosed. A
Business Manager with its own entry is never read with the default token. The fallback in the other
direction is deliberate and documented — do not tighten it into a refusal without measuring what access
that removes."*

- Va chạm: credential của khách **không** nằm trong cấu hình máy chủ và **không** khoá theo BM id — nó
  nằm ở cổng, khoá theo `connection id` thuộc một workspace. Cột `gateway_connection_id` là cột mới
  trên `meta_connections` (không mang credential, nhưng rule viết "never add a column" cho credential).
- Đề xuất sửa: *"A Meta reader credential lives either in server configuration keyed by Business
  Manager id (the operator's own system users), or in the connection gateway keyed by an opaque
  connection id stored on `meta_connections.gateway_connection_id`. Neither form is ever a column, a
  request field or a response field here; `reader_source` (`business_specific` / `server_default` /
  `customer_gateway` / `none` / `fake`) names which answered. A connection with a gateway id is never
  read with a server credential, and a server credential is never used for a customer workspace."*
  — câu cuối là ranh giới thương mại quan trọng nhất: **token của Mắt Bão không bao giờ đọc hộ khách**.

**Hai va chạm phụ, không nằm trong bốn luật được hỏi nhưng phải nêu:**
- **Rule 2 ↔ xoá dữ liệu khách**: khách rời đi, hoặc Meta gọi data-deletion. Rule 2 nói archive, không
  xoá. Đề xuất: **archive toàn workspace + xoá nội dung quan sát (`daily_json`, metadata) nhưng giữ
  khung dòng và audit** — tức sửa rule 2 thành "never hard-delete a domain entity; personal/platform
  payloads may be blanked on a recorded deletion request". Quyết định, và cần luật sư/BA xem nghĩa vụ.
- **Rule 22 ↔ khách tự duyệt**: "the user's explicit, separate approval" hôm nay nghĩa là **chủ sản
  phẩm**. Với khách, chat Telegram của khách do **owner workspace của khách** duyệt qua UI (đã có
  `telegram_chat_id` + `enabled`). Đề xuất thêm câu: *"For a customer workspace, the workspace owner's
  recorded policy change is that approval; Mắt Bão never enables delivery on a customer's behalf."*

### 4.4 Gói, thanh toán, onboarding

- **Hôm nay**: `WorkspaceSeatPlan` là sức chứa, không phải billing (`models/team.py:68`); không có
  khái niệm gói, hạn mức tài khoản theo gói, hay trạng thái "quá hạn thanh toán". Không có tích hợp
  thanh toán nào trong workspace của sản phẩm này (grep `billing` chỉ ra một comment).
- **Đề xuất tối thiểu để bán**: một entity `WorkspacePlan` (tên gói, số tài khoản theo dõi tối đa, số
  nền tảng, `status: trial/active/past_due/suspended`, `valid_until`) do **admin Mắt Bão** đặt bằng tay
  qua API owner-of-platform; `suspended` → dispatcher bỏ qua workspace, UI hiện lý do, **không xoá gì**.
  Thu tiền ngoài sản phẩm (hoá đơn Mắt Bão) — cùng cách AdsCommand chưa quyết "thu phí"
  (`DESIGN-CONG-KET-NOI-MATBAO.md` Phần 6.5, còn chờ). Tích hợp cổng thanh toán **không** nằm trong C1.
- **Onboarding**: tạo workspace + owner (API mới, admin Mắt Bão), mời thành viên (A9 có sẵn nhưng
  **không gửi email** → cần transport email = module thứ năm theo rule 20, hoặc giữ "link mời do admin
  gửi tay" ở v1), "Kết nối Facebook" (4.2), chọn BM, import tài khoản (A10.3 có sẵn), bật sweep theo
  workspace (cần cờ **theo workspace**, không chỉ env toàn cục).
- **Vai trò "admin của Mắt Bão"**: hôm nay không có — owner của workspace là quyền cao nhất. Cần một
  vai **trên** workspace (nhìn `operational_runs`, tạo workspace, đặt gói, không nhìn dữ liệu khách).
  Thay đổi mô hình quyền; mini-spec riêng.

### 4.5 Hồ sơ Meta / Google / TikTok — chỉ nói điều kiểm được

Nguồn duy nhất trong workspace là tài liệu của AdsCommand (cùng người sở hữu); **tôi không xác minh
được với Google/Meta/TikTok từ đây** — mỗi dòng là "theo tài liệu X ghi ngày Y".

| Nền tảng | Điều cần có | Trạng thái theo tài liệu | Chưa kiểm |
|---|---|---|---|
| Meta | App "Mắt Bão Marketing" `2077040626352062` ở chế độ phát triển ("Đã huỷ đăng" 21/10); cần **xác minh doanh nghiệp**, **App Review** cho `ads_read`, `ads_management`, `business_management` (+ pages nếu giữ), bật Live, App Domains, URL privacy/terms/data-deletion trỏ về cổng | `DESIGN-CONG-KET-NOI-MATBAO.md` §Cập nhật 21/10, Phần 3; `GOOGLE-OAUTH-VERIFICATION.md` §Meta (26/10); data-deletion callback **đã có mã** ở cổng | sản phẩm này có được liệt kê là một "app use case" riêng trong hồ sơ, hay dùng chung hồ sơ AdsCommand; bậc Marketing API (`development_access` đo 12/10 cho app **cũ** `754532870834472`) của app mới |
| Google | scope `adwords` là quyền **nhạy cảm** → OAuth verification (video, hồ sơ); Google Ads API access level: Explorer **đã duyệt 22/10**, Basic cần brand verification, Standard cần RMF; developer token đã bị Google bỏ 09/09/2026 | `GOOGLE-OAUTH-VERIFICATION.md` (26/10); `DESIGN…` §1.1, §2.4, Phần 3 | tất cả — tôi không mở được Google Cloud Console; việc sản phẩm này gọi Google Ads API từ Python (không phải thư viện TS của AdsCommand) |
| TikTok | — | **không có một dòng nào** về TikTok trong `audit-ads`, `mb-connect`, `ads-manager` (grep 2026-10-26) | toàn bộ: TikTok Marketing API yêu cầu app + duyệt riêng (theo hiểu biết chung, **không có tài liệu nào trong workspace để dẫn**) |

- **Rủi ro chính**: thời gian duyệt do Meta/Google quyết; `tinhgon.xyz` không xác minh được với
  Google (`DESIGN…` §Lưu ý tên miền) nên cổng phải ở `*.marcom-matbao.io.vn` trước khi nộp.
- **Phụ thuộc**: 4.2 (sản phẩm này là một "bản cài" của cổng), quyết định ở 4.3.
- **Cỡ Phase 4**: L (mã M + quyết định + hồ sơ ngoài mã không ước lượng được).

---

## Phase 5 — Đa nền tảng: Google Ads rồi TikTok

### 5.1 Khung provider hôm nay là Meta-hình (đo)

- `MetaBusinessProvider` (`services/meta_provider.py:298-350`): mọi phương thức xoay quanh Business
  Manager, Pixel, `act_` (`canonical_external_id` bỏ tiền tố `act_` — `extension_context.py`);
  `MetaFailureCode`, `MetaEnvironment`, `MetaConnection` đều mang tên Meta.
- `AdAccount` **không có cột `platform`**; `unique(workspace_id, external_account_id)`
  (`entities.py:128`) — một Google customer id và một Meta account id khó trùng nhưng **danh tính phải
  mang nền tảng**, không dựa vào "khó trùng".
- Extension A5 chỉ nhận URL Ads Manager của Meta (`FEATURES.md:887-889`).
- Những gì **đã trung lập**: `AssetDiscovery`/`EdgeOutcome`/coverage/authority (một "edge" chỉ là một
  nguồn phải đọc đủ), `HealthFacts` + registry luật (đọc `AdAccount.status`, không biết nền tảng),
  A3 alert, A4 dispatcher, A9 scope; và nếu S1 làm đúng §4b của audit — bảng quan sát chi tiêu
  (chuỗi thô, `observed_currency`, `observed_timezone_name`, `reader_source`).

### 5.2 Tổng quát hoá — một mini-spec "P0" trước Google

- `AdAccount.platform` (enum `meta/google/tiktok`, mặc định `meta`, migration backfill) và
  `unique(workspace_id, platform, external_account_id)`.
- `MetaConnection` → bảng chung `platform_connections` **hoặc** thêm `platform` + đổi tên dần (ưu tiên
  thêm cột, giữ tên bảng — cộng thêm, không viết lại).
- `MetaFailureCode` → `ProviderFailureCode` (alias, không đổi giá trị); `MetaEnvironment` giữ.
- Interface tách làm hai: `AdPlatformReader` (identify, discover accounts, read spend, read status)
  — **mỗi nền tảng bắt buộc có**; `MetaBusinessOperations` (tạo/chia sẻ) — chỉ Meta.
- **Rule 20**: mỗi nền tảng một transport **theo tên**: `services/google_ads_transport.py`,
  `services/tiktok_transport.py`; mỗi module một test nói nó chỉ tới host cấu hình và chỉ những path
  nào. Lưu ý: Google Ads API đọc bằng **POST** (`googleAds:search`) — "GET-only by construction" không
  áp được; bất biến phải phát biểu theo **allowlist path**, như `_WRITABLE_PATH` đã làm.
- Token: **đều qua mb-connect** (Google: cổng đã có `lib/providers/google.ts`; TikTok: **cổng chưa có
  provider** — `mb-connect/lib/providers/` chỉ có `google.ts`, `meta.ts` — nên TikTok cần việc ở cổng
  trước). Không bao giờ có `GOOGLE_*`/`TIKTOK_*` credential trong cấu hình sản phẩm này (hệ quả của
  rule 40 sửa ở 4.3).

### 5.3 Google Ads (sau P0)

- Chi tiêu: GAQL `customer.currency_code`, `segments.date`, `metrics.cost_micros` — tên trường theo
  hiểu biết chung và một phần theo GATEWAY-CONNECT-1 §4.5 (`customer.currency_code`); **chưa kiểm**
  trong workspace, phải đọc tài liệu Google khi làm. `cost_micros` là micro-đơn vị → bảng quan sát
  lưu chuỗi thô + `unit = micros`, không chia trước khi đo thật.
- Trạng thái: `customer.status` (ENABLED/CANCELED/SUSPENDED/CLOSED — **chưa kiểm**) → Phase 2 kiểu
  Google.
- Tài khoản dưới MCC: `login-customer-id` theo từng tài khoản (AdsCommand lưu theo tài khoản —
  GATEWAY-CONNECT-1 §4.5); sản phẩm này cần cột `login_reference` trên `AdAccount` hoặc connection.
- Access level: Explorer/Basic đủ cho đọc; hạn mức **theo project Google Cloud dùng chung** với mọi
  khách (`DESIGN…` §2.3) → sweep phải có hạn mức **toàn cục** chứ không chỉ theo workspace.
- Cỡ: M–L (P0 + provider + spend + status + UI nhãn nền tảng).

### 5.4 TikTok (sau Google)

- Không có gì trong workspace để dẫn. Việc đầu tiên là **mini-spec ở mb-connect** (OAuth TikTok for
  Business, lưu token, `token` endpoint), rồi mới tới provider ở đây. Mọi tên trường/hạn mức **chưa
  kiểm**.
- Cỡ: L (cổng + provider + hồ sơ TikTok).

---

## Những quyết định cần người dùng chốt (gom lại)

1. **Bán theo mô hình nào**: một deployment nhiều workspace (cần mb-connect học `tenantRef`, 4.2.2b)
   hay **một bản cài mỗi khách** như AdsCommand (4.2.2a)? Câu này quyết định nửa Phase 4.
2. **Sửa bốn hard rule** theo đề xuất 4.3 (rule 1, 20, 40 sửa; rule 18 giữ) — đồng ý từng câu, hay
   sửa khác?
3. **Rule 2 ↔ xoá dữ liệu khách**: chấp nhận "archive + làm trống payload" hay giữ nguyên rule 2 và
   từ chối nghĩa vụ xoá (không khả thi nếu bán)?
4. **Scope Meta cho sản phẩm này qua cổng**: login config chỉ đọc riêng (4.2.1a, đề xuất) hay dùng
   chung config `ads_management` của AdsCommand?
5. **Một bot Telegram của Mắt Bão cho mọi khách** (đề xuất, không sửa rule 18) — đồng ý?
6. **Thứ tự**: cho phép làm phần **tài liệu + quyết định** của Phase 4 song song với Phase 1–2, hay
   tuần tự tuyệt đối?
7. **Phase 0**: ai làm 0.1 (định tuyến Vibe Host) và 0.2 (kiểm `v21.0`), vì cả Phase 1 chờ hai việc này.
8. **Google Ads từ Python**: chấp nhận gọi REST bằng stdlib (cùng mẫu transport hiện có) thay vì thư
   viện chính thức — để giữ rule 20 và không thêm dependency nặng? (Chỉ cần chốt khi tới Phase 5.)
