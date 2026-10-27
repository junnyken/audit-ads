# Audit Before Build — O4 · Một credential đọc cho mỗi tài khoản Facebook (Meta, chỉ đọc, tự gia hạn)

`ID`: **O4** · `Name`: One reader credential per Facebook account — vault + Facebook Login for Business ·
`Parent phase`: Phase 1–2 (S1 chi tiêu, S2 trạng thái) chạy trên lõi O3 (tự phát hiện → tự nhập) ·
`Author`: Nguyễn Thiên Triều <trieunt@matbao.com> (team `mk`) · `Date`: 2026-10-27 ·
Baseline: `c7f01ea` (S2) **+ working tree đang build O3** (xem §0) · Playbook: `MINI_SPEC_PLAYBOOK.md` **v2** + §13.

**Đây là bản audit (bước 1–3), không phải bản build.** Không một dòng mã sản phẩm nào được sửa để viết
tài liệu này; không gọi Meta, không gửi Telegram, không deploy, không migration, không commit. Tài liệu
Meta chỉ được **đọc** (developers.facebook.com, 2026-10-27); mã của `tracking-audit-os` và `mb-connect`
chỉ được **đọc**.

---

## 0. Đo được gì, không đo được gì

Rule 41: mọi khẳng định về trạng thái sản phẩm dưới đây là **đo tại thời điểm viết**, kèm cách đo.

| Nguồn | Trạng thái lúc viết | Hệ quả |
|---|---|---|
| Mã nguồn | đọc tại `c7f01ea`; `grep` toàn `backend/app`, `backend/tests`, `frontend/src`, `docs/` | mọi `file:line` dưới đây là của commit này |
| Working tree (chưa commit, `git status` 2026-10-27) | **O3 đang được build song song**: `?? backend/alembic/versions/0017_o3_connection_automation.py` (revision `0017_o3_conn_automation`), `?? backend/app/services/discovery_sweep.py`, `?? discovery_facts.py`, `M meta_real_provider.py`, `M spend_service.py` (thêm `reader_for_connection(connection, settings)` — predicate "đọc được" dùng chung cho S1 và O3; docstring: *"A later reader source (mb-connect, Phase 4) is a new branch of `resolve_reader`, not of this"*), `M health_rules.py`, `M alert_service.py`, `M notification_*.py`, `M operations.py`, `M config.py`, `M enums.py`, `M models/meta_operations.py`; `?? docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md`, `?? docs/AUDIT_BEFORE_BUILD_U1_UI.md`; `M MINI_SPEC_PLAYBOOK.md` (v2) | O4 **không** trích dòng của working tree làm bằng chứng; O4 cắm vào đúng hai seam O3 để lại (`resolve_reader` thêm nhánh; `reader_for_connection` giữ nguyên) và **migration của O4 là `0018`**, không phải `0017` |
| Cơ sở dữ liệu dev (`localhost:5434`) | backend `8001` + frontend `5173` `answering=yes` (`scripts/dev.sh status`); **không đếm được dòng** hôm nay — `psql` không có trong workspace. O3 §0 đếm cùng ngày: `users=1`, `meta_connections=1` (0 `production`), `business_managers=0`, `ad_accounts=0`, `alembic_version=0016` | mọi số liệu "đã có dữ liệu thật" dưới đây lấy từ `TEST_LOG.md` của một DB đã bị dựng lại rỗng (`CLAUDE.md:27`) và ghi rõ ngày |
| Production (Vibe Host) | **không đo lại hôm nay.** `CLAUDE.md:25-26` (đo 2026-10-26): stack chỉ có project api, `list_env` không có `META_*`, không dispatcher; frontend prod **không vào được** | đường "redirect về frontend sau khi đồng ý trên Meta" (§4) **chưa thể chạy trên prod** cho tới Phase 0.1 |
| Meta Graph API | **không gọi** (rule 22) | mọi hành vi của Meta với **user token** trong sản phẩm này là **[CHƯA KIỂM]** — sản phẩm **chưa bao giờ** gọi Meta bằng user token; mọi lần đọc thật (2026-09-10 → 09-14) đều bằng **system-user token** |
| Tài liệu Meta (chỉ đọc, 2026-10-27, qua bộ tóm tắt trang) | **đọc được**: `facebook-login/guides/access-tokens`, `…/get-long-lived`, `facebook-login/facebook-login-for-business`, `docs/permissions` (0–100k ký tự), `graph-api/overview/access-levels` (bản tiếng Việt), `graph-api/reference/user/businesses/` (v26.0), `graph-api/reference/v21.0/debug_token` (bản tiếng Việt), `graph-api/guides/error-handling`, `marketing-api/overview/authorization/`. **404**: `…/access-tokens/debugging`, `…/access-tokens/handling-invalid`, `…/access-tokens/expiration-and-extension`, `graph-api/reference/user/adaccounts/` | §2d ghi từng điều là **đã kiểm (URL)** hay **[CHƯA KIỂM]**; trang nào chỉ có bản tóm tắt thì nói rõ; ví dụ trên tài liệu dùng `v26.0`, sản phẩm ghim `v21.0` (`core/config.py:85`) — Phase 0.2 chưa đo |
| `projects/tracking-audit-os` (chỉ đọc) | `a965d6e` (2026-08-15): `backend/app/services/platform_oauth_service.py` (309 dòng), `platform_credential_service.py` (113), `app/core/secret_encryption.py`, `models/platform_credential.py`, `models/enums.py:2868-2888`, `api/platform_oauth.py`, `frontend/components/PlatformConnectionsView.tsx` (781), `PlatformCredentialsView.tsx` (293), `docs/platform-credential-rollout.md` §10b, `docs/ARCH.md` mục R3 + R8 | §2e: phần nào mang sang được, phần nào không |
| `share-projects/mb-connect` (chỉ đọc) | `lib/providers/meta.ts:1-110`, `lib/connections.ts:1-30,225-245`, `lib/config.ts:30-35` | §2f |

---

## 1. Context — bối cảnh bắt buộc

**Tài liệu bắt buộc đã đọc**: `CLAUDE.md` (42 luật; chạm 1, 3, 4, 8, 18, 20, 22, 26, 28, 40, 41),
`MINI_SPEC_PLAYBOOK.md` v2, `FEATURES.md`, `ARCH.md` §4i, `API.md`, `TEST_LOG.md` (A10 → S2),
`docs/RUNBOOK_META_CONNECTION.md` §5, §7b, `docs/AUDIT_BEFORE_BUILD_MULTI_TOKEN.md`,
`docs/META_READ_ONLY_DISCOVERY.md`, `docs/ROADMAP_COMMERCIAL.md` Phase 4 (§4.2–4.3),
`docs/AUDIT_BEFORE_BUILD_SPEND.md` (S1), `docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` (S2),
`docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md` (O3, cùng ngày).

**Yêu cầu của người dùng (2026-10-27)**, nguyên văn ý:

1. Chủ sản phẩm có **4 tài khoản Facebook**; mỗi tài khoản là **admin của 4 Business Manager**; mỗi BM
   có **2 tài khoản quảng cáo** → 16 BM, 32 tài khoản. **Từ chối** 16 system-user token + sửa env.
2. Muốn: mỗi tài khoản Facebook cấp **một** credential (4 tổng cộng); hệ thống **tự liệt kê BM**
   (`me/businesses`), tự nhập, tự theo dõi mọi tài khoản dưới đó (S1 chi tiêu + S2 trạng thái).
3. **Yêu cầu cứng (bổ sung cùng ngày)**: credential phải **tự gia hạn** — không dán lại token mỗi ~60
   ngày. Phải nói thật Meta cho phép gì (Meta **không có** `refresh_token` như Google).
4. Bảo mật: token bị đánh cắp **không được** cho phép chiếm tài khoản. **Cookie không bao giờ** được
   chấp nhận (rule 1, 7).
5. Mẫu đã làm thành công ở `tracking-audit-os` (Google OAuth, refresh token mã hoá trong vault, tự
   xác minh) — học và tái dùng **hình dạng**, nói rõ phần nào mang sang Meta được, phần nào không.

**Trạng thái hiện tại liên quan** (đo, §2): mọi credential Meta là **system-user token trong env**, khoá
theo BM id (`META_ACCESS_TOKENS_BY_BUSINESS`) hoặc token mặc định (`META_ACCESS_TOKEN`) — rule 40.
Sản phẩm **chưa từng** gọi Meta bằng user token; **chưa từng** đọc chi tiêu thật (S1 sweep chỉ chạy trong
pytest — `TEST_LOG.md:3175-3179`); không có bảng nào, cột nào, route nào mang credential; `StrictPayload`
từ chối mọi field có tên chứa `token`/`secret`/`credential`… (`core/redaction.py:19-36`).

**Quyết định kiến trúc phải giữ nguyên**:

- Lõi O3 là lõi: **connection là đơn vị**; "đọc được" = `reader_for_connection` (working tree) /
  `_connections_by_business` (`spend_service.py:75-104`); O4 **chỉ thêm một nguồn credential** cho
  `resolve_reader` (`meta_real_provider.py:618-632`), không viết sweep thứ hai, không import thứ hai.
- Transport Meta duy nhất `services/meta_graph_transport.py`, GET + đúng một POST path (rule 20).
- Discovery/coverage/authority/`read_as` giữ nguyên nghĩa (`META_READ_ONLY_DISCOVERY.md`): kết quả là
  bằng chứng về **danh tính đã đọc**, không phải về BM.
- Rule 2 (không bao giờ archive tự động), rule 4/28 (thiếu bằng chứng → degrade, "chưa từng" ≠ "cũ"),
  rule 5 (không trạng thái mới nào xanh), rule 26 (finding chỉ mã + câu), rule 22 (bật cadence trên prod
  = duyệt có tên).
- **Không cookie, không Chromium, không tự động hoá trình duyệt** (rule 1, 7): "kết nối" nghĩa là
  **người thật bấm trên hộp thoại của Meta**, sản phẩm chỉ nhận `code` ở callback.

---

## 2. Goal — một câu

> Mỗi tài khoản Facebook của chủ sản phẩm **kết nối một lần** trên màn hình của sản phẩm; từ đó sản
> phẩm tự biết BM nào đọc được, tự nhập và tự theo dõi (lõi O3 → S1/S2) bằng credential **được giữ mã
> hoá phía server và tự kiểm tra còn sống mỗi ngày** — không ai dán token vào env nữa, và khi Meta vô
> hiệu credential thì sản phẩm nói đúng một câu *"cần kết nối lại"* kèm một nút, **không bao giờ** báo
> "ổn".

---

## 3. Constraints — guardrails bắt buộc

1. **Không cookie, không session, không password** của Facebook ở bất kỳ đâu (rule 1, 7). Credential
   duy nhất được giữ là **access token do Meta cấp qua Facebook Login for Business**, chỉ đọc.
2. **Chỉ scope đọc**: `ads_read` + `business_management`. **Không bao giờ** xin `ads_management`. Token
   có scope ghi (do cấu hình login config sai) bị **từ chối lưu** ở callback — như mb-connect từ chối
   token thiếu scope (`lib/providers/meta.ts:98-103`), chiều ngược lại.
3. **Không request body nào mang credential**; `StrictPayload` giữ nguyên. Token đi **Meta → server**
   qua `code` trên callback GET, không bao giờ qua trình duyệt của người dùng dưới dạng token.
4. **Credential được mã hoá** bằng khoá chỉ có trong cấu hình server (`CREDENTIAL_VAULT_KEY`); thiếu
   khoá → vault **không hoạt động**, không bao giờ lưu plaintext (mẫu `tracking-audit-os`
   `secret_encryption.py:22-24`). Giải mã **chỉ** trong `resolve_reader`, giữ trong bộ nhớ đúng một
   chuỗi gọi provider, **không cache qua lượt** (O3 §6.2).
5. **Không bao giờ** trả token, ciphertext, hay `client_secret` qua response/audit/log/bundle
   (rule 18/26/40). Thứ được lộ: nhãn, loại, tên tài khoản Facebook, scope, hạn, lần kiểm gần nhất,
   trạng thái, BM đã thấy.
6. **Thiếu bằng chứng → degrade**: credential chưa được `debug_token` xác nhận = `pending_verification`,
   **không đọc**; hết hạn / Meta trả `190` / thiếu scope = `reconnect_required`, **không đọc**, mọi tài
   khoản dưới nó `not_observable` với **lý do**; S2 **không** coi "mất reader" là hồi phục
   (`AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md:590`).
7. **Không bypass**: bật kiểm tra sống theo lịch trên production là quyết định phát hành có tên
   (rule 22, tiền lệ S1 §6.7); kết nối/kết nối lại/thu hồi là hành động của **owner** có audit với actor
   thật (rule 3, 8).
8. **Không rebuild**: không sweep mới cho discovery/import (O3), không provider mới, không transport
   mới; thêm **hai GET path** trên cùng host Graph (`oauth/access_token`, `debug_token`).
9. **Không tự đổi danh tính đọc**: khi một BM có hai credential nhìn thấy, chọn **một** lần, ghi trên
   connection; đổi là hành động của owner, có audit — vì kiểm kê phụ thuộc danh tính
   (`META_READ_ONLY_DISCOVERY.md:64-87`).
10. **Không hứa điều Meta không hứa**: tài liệu Meta **không** mô tả "gia hạn token dài hạn khi chưa hết
    hạn"; thiết kế **không được phụ thuộc** vào điều đó (§2d, §4).

---

## 4. Scope — phạm vi implementation (tóm tắt; chi tiết ở §7)

| Block | O4 chạm gì | Không chạm gì |
|---|---|---|
| **A. Domain model** | **1 bảng mới** `meta_reader_credentials` (credential mã hoá + vòng đời) + **1 cột mới** `meta_connections.reader_credential_id` (FK nullable); enum `ReaderCredentialKind`, `ReaderCredentialStatus`; giá trị `reader_source` mới `vault` / `vault_reconnect_required`; `OperationalRunKind.CREDENTIAL_CHECK`; `AlertSourceType.READER_CREDENTIAL`; migration **`0018_o4_reader_credentials`** (sau `0017_o3_conn_automation`) | `ad_accounts`, `business_managers`, `*_observations`, `*_runs`, `Pixel`; **không** cột nào mang credential ngoài `encrypted_secret` của bảng mới |
| **B. Service / engine** | `core/secret_vault.py` (module **duy nhất** mã hoá/giải mã + ký `state`); `services/meta_reader_credentials.py` (connect-start, callback, verify, renew, revoke, chọn credential cho BM); nhánh **thứ ba** trong `resolve_reader` (`vault`); `credential_check_pass` trong dispatcher (sống/hạn/`me/businesses`); hai GET path mới qua `MetaGraphTransport.get` (`oauth/access_token`, `debug_token`) | `MetaDiscoveryService`, `discovery_sweep` (O3), `spend_sweep_pass`, `health_engine`, `alert_rules`, `registry` — **không đổi logic**; transport không thêm method |
| **C. API contract** | `GET/POST /meta-reader-credentials…` (owner-only; connect-start, callback **không đăng nhập** — tiền lệ `POST /team/invitations/accept` `routers/team.py:230`; verify-now; reconnect; revoke; use-for-connection); `GET /meta-connections` thêm khối `reader_credential`; `GET /ad-accounts/{id}/spend` thêm `not_observable_reason`; `GET /operations/overview` thêm `reader_credentials` + `credential_check_*` | mọi route S1/S2/O3 hiện có giữ nguyên shape (chỉ **thêm** field) |
| **D. UI surfaces** | Settings → mục **"Meta reader credentials"** (owner): danh sách + nút *Kết nối một tài khoản Facebook* + *Kiểm lại* + *Kết nối lại* + *Thu hồi*; badge credential trên thẻ connection (`ReaderSourceBadge` thêm hai giá trị); Spend tab nói **vì sao** `not_observable`; System Status thêm một dòng | không dashboard mới; không màn hình nào hiện token/ciphertext; U1 (đang audit song song) quyết token màu — O4 chỉ dùng `tone` hiện có |
| **E. Tests** | unit (vault round-trip/tamper/missing key; state TTL; `resolve_reader` ưu tiên; mapping `debug_token` → trạng thái; bảng suy giảm từng dòng), integration (HTTP + DB: connect-start/callback/verify/revoke/scope 404; **không response nào chứa token**; `StrictPayload` vẫn từ chối), regression (`test_only_named_modules_may_make_an_outbound_request` **không đổi** danh sách; transport không có method mới; `_WRITABLE_PATH` không đổi; S1/S2 không đổi khi không có credential vault), live (≤ 6 GET có người xem, §10) | — |

---

## 5. Audit Before Build — cái gì đã có (kiểm trong mã, không giả định)

### 5a. Hôm nay một BM được đọc bằng credential nào — và `reader_source` là gì

| Bước | Ở đâu | Điều đã đúng | Điều O4 phải nới |
|---|---|---|---|
| Hai nguồn credential, đều là **env** | `core/config.py:66` `meta_access_token`, `:81` `meta_access_tokens_by_business: dict[str, str]` (JSON) | server-side only; tên field chứa `token` nên redactor tự che nếu lỡ vào log (`AUDIT_BEFORE_BUILD_MULTI_TOKEN.md:104-107`) | thêm nguồn **thứ ba** không nằm trong `Settings` |
| Chọn credential cho một BM | `meta_real_provider.resolve_reader(settings, business_id)` `:618-632` → `(token, reader_source)`; thứ tự: entry riêng của BM (`business_specific`) → `META_ACCESS_TOKEN` (`server_default`) → `("", "none")` | **một** chỗ quyết định; `test_multi_reader_credentials.py:41-100` ghim cả ba nhánh và "không cấu hình gì thì không đổi gì" | chữ ký chỉ nhận `settings` + `business_id` — **không có session, không biết connection** → nhánh vault cần `(settings, business_id, *, connection=None, session=None)` hoặc caller truyền sẵn credential đã giải mã |
| Dựng provider thật | `build_real_provider(settings, *, business_id)` `:635-648` → `MetaGraphTransport(access_token=…)` | token chỉ đi vào transport | như trên |
| Ai gọi `resolve_reader` | `routers/meta_operations.py:75` (`_provider_for`), `:87` (`_serialize_connection` → `token_configured`, `reader_source`); `spend_service.py:97` (`_connections_by_business`), `:133` (`provider_for_connection`); working tree O3: `reader_for_connection` | `reader_source` đã là **tên, không phải giá trị** (rule 40) và đã được **lưu** trên mỗi quan sát chi tiêu (`models/spend.py:51`) và trả ra ở 4 chỗ (`routers/spend.py:66,99,137,240`), evidence luật S1 (`health_rules.py:445,691`) | cột `reader_source` là `String(32)` → giá trị mới `vault` / `vault_reconnect_required` vừa; frontend union type `lib/types.ts:794` chỉ có 4 giá trị → thêm |
| Điều kiện một connection "đọc được" | `_connections_by_business` `spend_service.py:75-104`: `production` + `archived_at IS NULL` + có BM id + `reader_source != none`; nhiều connection cùng BM → ưu tiên connection **tự khai BM**, rồi **cũ nhất** | predicate một chỗ (O3 đang gom thành `reader_for_connection`) | O4 **không** đổi predicate; chỉ làm cho `resolve_reader` trả `vault` khi connection có `reader_credential_id` sống |
| Kiểm cấu hình production | `core/production_checks.py:210-230`: entry rỗng / placeholder trong `META_ACCESS_TOKENS_BY_BUSINESS` là finding **chỉ nêu BM id, không nêu giá trị** | tiền lệ rule 26 cho credential | thêm finding cho `META_APP_SECRET` placeholder, `CREDENTIAL_VAULT_KEY` thiếu/không hợp lệ khi `META_LOGIN_CONFIG_ID` có |
| UI | `components/meta/ReaderSource.tsx:12-19`: `business_specific` → *"Own reader for this Business Manager"* (`positive`), `server_default` (`neutral`), `none` (`attention`); `readerSourceNote` `:21-30` nói rõ *"an empty result is not evidence the business is empty"*; thẻ connection `pages/MetaConnections.tsx:66`; Spend tab in thô `Read via: {reader_source}` (`pages/account/SpendTab.tsx:75-76`) | câu chữ đã trung thực | thêm hai nhánh; Spend tab in **nhãn**, không in chuỗi thô |

### 5b. `list_business_managers` — đã có, và trả gì cho system-user token vs user token

| Điều | Bằng chứng | Trạng thái |
|---|---|---|
| Một helper duy nhất `_read_business_managers()` (`meta_real_provider.py:197-221`): có `business_id` → đọc **node BM** `GET {bm}?fields=id,name`; **không** có → `GET me/businesses?fields=id,name&limit=…` | `ARCH.md:498-507`: ba reader từng lệch nhau, nay đi chung; test ghim không reader nào đụng `me/businesses` khi đã cấu hình id; `test_a10_meta_real_provider.py:271` ghim nhánh fallback **gọi đúng path** `me/businesses` | **đã có** |
| `check_capability()` `:223-261`: `list_business_managers=True` **chỉ khi** thật sự về được ≥1 BM; 200 rỗng → `False` + `NOT_CONFIGURED` | `TEST_LOG.md:1859-1866`, `:1919-1924`, `:1942-1975` (2026-09-10) — defect "`True` trên 200 rỗng" đã sửa; `RUNBOOK:185-193` | **đã có** |
| **System-user token**: `me/businesses` → **rỗng**, dù token đọc thẳng BM theo id được; `business` là field → `invalid_request`; `businesses` expand → rỗng | `TEST_LOG.md:1901-1910`, `:1942-1958` (đo thật 2026-09-10, 5 GET); `config.py:93-100`; `RUNBOOK:157-162` | **đã kiểm, live** — vì vậy `META_BUSINESS_ID` tồn tại |
| **User token**: `me/businesses` trả danh sách BM người đó có vai trò | mã chỉ có **chú thích**: `meta_real_provider.py:212` *"which does work for an ordinary user token"*, `TEST_LOG.md:1963-1964`, `ROADMAP_COMMERCIAL.md:199` *"hoạt động với user token"* — **không có dòng TEST_LOG nào đo điều đó trong dự án này**; tài liệu Meta (`reference/user/businesses/`, v26.0, đọc 2026-10-27): trả `data: list<Business>` + field thêm `permitted_roles` (*"Roles the user has on the business"*), **không tham số**, không nêu scope bắt buộc, mã lỗi liệt kê gồm `200 Permissions error`, `459 checkpointed`, `2635 deprecated Ads API version` | **[CHƯA KIỂM] trong sản phẩm** — là GET đầu tiên của phiên đo §10 |
| `identify()` `:270-287`: `GET me?fields=id,name` → `read_as` | với system user, `me` trả id **khác** id trong Business Settings (`TEST_LOG.md:1907-1910`) | với user token, `me` là **tài khoản Facebook** → `read_as` sẽ hiện tên người; đúng nghĩa đã định (`META_READ_ONLY_DISCOVERY.md:64-70`) |
| Authority gate `check_business_authority()` `:342-363`: `{bm}/system_users` — chỉ member đọc được | `TEST_LOG.md:2405-2447` (3 BM, 1 token) | với user token là admin BM: **[CHƯA KIỂM]** — edge có thể đòi vai trò admin; refusal vẫn chỉ là `not_established`, không phải "không phải member" (`:349-352`) |

### 5c. Giả định "một credential cho một BM" đã ăn sâu ở đâu

| Nơi | Giả định | O4 ảnh hưởng |
|---|---|---|
| `resolve_reader` khoá theo **BM id** (`:627`) | credential là thuộc tính của BM | user token là thuộc tính của **người**, bao nhiều BM → ánh xạ **credential → connection(BM)** phải nằm trong DB (`meta_connections.reader_credential_id`), không trong env |
| `RealMetaBusinessProvider.business_id` (`:190`) một BM / một provider instance | mỗi connection một provider | giữ: sweep đã dựng **provider mỗi connection** (`run_dispatcher.py:301-305`); cùng user token dùng cho 4 provider = 4 transport, cùng chuỗi — chấp nhận |
| `_connections_by_business`: một BM → **một** connection đọc | hai connection cùng BM chọn theo rank | giữ; O4 thêm tiêu chí rank **trước**: connection có `reader_credential_id` sống > connection env |
| `identify()` gọi **mỗi connection mỗi lượt** (`run_dispatcher.py:306-310`) | đổi danh tính theo connection | với một user token cho 4 connection = 4 GET `me` giống nhau/lượt → memo theo **credential** trong một pass (không qua lượt) |
| `MetaConnection.business_manager_reference` "set at creation, never updated" (`models/meta_operations.py:40-42`) | BM của connection bất biến | giữ: connection tạo từ `me/businesses` mang BM id ngay lúc tạo |
| Discovery/import gắn tài khoản vào BM của connection (`meta_discovery.py:362-401`) | owned + client của **BM đó** | giữ: với user token, mỗi BM có connection riêng nên tài khoản client của BM-X vào BM-X, không vào hub — tốt hơn mô hình hub (O3 §2e) |
| `token_configured` boolean trên card (`routers/meta_operations.py:88`) | có token = cấu hình xong | với vault: *có* nhưng có thể `reconnect_required` → card phải hiện **trạng thái credential**, không chỉ boolean |
| `docs/RUNBOOK_META_CONNECTION.md:79-91` *"Chỉ đặt trong biến môi trường của server, không ở đâu khác … Không đưa vào database — sản phẩm này không có cột nào cho nó và sẽ không sinh ra cột đó"*; `FEATURES.md:388-396`; `ARCH.md:636-660`; `config.py:78-80`; `models/spend.py:11-13` | credential **không bao giờ** vào DB | **câu này sẽ không còn đúng** sau O4 — phải viết lại ở 5 chỗ, không để câu cũ đứng cạnh hành vi mới (tiền lệ O3 §2b) |

### 5d. Sự thật về token Meta — từng dòng ghi **đã kiểm (nguồn)** hay **[CHƯA KIỂM]**

Quy ước: *đã kiểm (doc)* = đọc trên developers.facebook.com ngày 2026-10-27 (qua bộ tóm tắt trang, trích
khi có); *đã kiểm (live)* = đo thật trong dự án này, có dòng `TEST_LOG.md`; **[CHƯA KIỂM]** = không có cả
hai — thiết kế **không được** dựa vào.

| # | Điều | Trạng thái | Nguồn / ghi chú |
|---|---|---|---|
| T1 | User access token **ngắn hạn** sống ~1–2 giờ; **dài hạn** ~60 ngày; *"Do not depend on these lifetimes remaining the same — they may change without warning or expire early"* | đã kiểm (doc) | `developers.facebook.com/docs/facebook-login/guides/access-tokens` |
| T2 | Đổi ngắn hạn → dài hạn: `GET /{version}/oauth/access_token?grant_type=fb_exchange_token&client_id=…&client_secret=…&fb_exchange_token=…`; *"Make this call from your server, not a client"*; trả `access_token`, `token_type`, `expires_in` (mẫu: `5183944` s ≈ 60 ngày); token mới là **chuỗi khác** | đã kiểm (doc) | `…/access-tokens/get-long-lived` |
| T3 | *"You can not use an expired token to request a long-lived token"* → hết hạn rồi thì **chỉ còn đăng nhập lại** | đã kiểm (doc) | như T2 |
| T4 | **Tái trao đổi** một token dài hạn **còn hạn** bằng `fb_exchange_token` để được 60 ngày mới | **[CHƯA KIỂM]** — tài liệu **không mô tả** (hỏi thẳng hai lần: không có câu nào về "refresh"/"still valid"); chỉ nói SDK **client** (iOS/Android/JS) tự làm mới *"if the person has used your app within the last 90 days"*, *"refreshed once per day"*; **không có** `grant_type=fb_refresh_token` cho Facebook (Instagram có, Facebook không) | đây là điều mà "4 token, tự gia hạn, không chạm" phụ thuộc vào → phải **đo** (§10) trước khi hứa; thiết kế §7 **không** phụ thuộc |
| T5 | System-user token (Business Manager) *"do not expire based on time, though they are still subject to invalidation for other reasons"* | đã kiểm (doc) + **live**: token 2026-09-11 `expires: never`; token sau đó `expires: 1794294290` (~60 ngày) — Business Settings cho chọn **never** hoặc **60 ngày** lúc sinh | `…/access-tokens`; `TEST_LOG.md:2232-2237`, `:2349-2353` |
| T6 | **Facebook Login for Business** (LfB): app **loại Business**; cấu hình (**`config_id`** thay `scope`) quyết định loại token; **User access token** — *"short-lived"*, cho *"online activities such as web browsers"*; **System User access token** (business integration system user) — *"Defaults to never expire for the common offline server-to-server communication"*, có thể đặt `set_token_expires_in_60_days=true`; `ads_read`, `ads_management`, `business_management` đều xin được cho cả hai loại; *"To serve businesses that you do not own or manage, your app must be approved for Advanced Access"*; system-user token đòi app gắn với một business portfolio *"that you fully control"*, chỉ trên web | đã kiểm (doc) | `developers.facebook.com/docs/facebook-login/facebook-login-for-business` |
| T7 | Token **system-user LfB** gắn với **đúng một** business portfolio mà người dùng chọn trong hộp thoại (*"tied to the client's business portfolio"*); mb-connect mô tả: *"khách chọn doanh nghiệp + tài sản … KHÔNG hết hạn"* (`lib/providers/meta.ts:3-5`) | đã kiểm (doc + mã mb-connect) | hệ quả: với 16 BM là **16 lần đồng ý một lần**, không phải 4 — **trừ khi** hộp thoại cho chọn nhiều portfolio một lượt: **[CHƯA KIỂM]** |
| T8 | `debug_token`: `GET /debug_token?input_token=…`; **người gọi** phải dùng *"app access token hoặc user access token của nhà phát triển ứng dụng"*; trả `app_id`, `application`, `expires_at`, `data_access_expires_at`, `is_valid`, `issued_at`, `scopes`, `granular_scopes[{scope,target_ids}]`, `user_id`, `error{code,message,subcode}` | đã kiểm (doc, bản tiếng Việt v21.0) + live cho field `type` (`SYSTEM_USER`, `TEST_LOG.md:2234`) | `…/graph-api/reference/v21.0/debug_token` (trang không liệt kê `type`, live có) — **vì vậy O4 cần app access token = `META_APP_ID|META_APP_SECRET` trong cấu hình server** (mb-connect làm đúng thế: `meta.ts:66-70`); để 4 tài khoản tự soi token của mình thì họ phải là developer của app — [CHƯA KIỂM], không dựa vào |
| T9 | Token mất hiệu lực không do thời gian — mã lỗi `190` + subcode: `458` app chưa cài, **`459` người dùng bị checkpoint** (*phải đăng nhập facebook.com*), **`460` đổi mật khẩu** (*"họ phải đăng nhập lại vào ứng dụng"*), `463` hết hạn, `464` chưa xác nhận, `467` token không hợp lệ; `102` phiên API; `10`/`200–299` thiếu quyền; `4`/`17`/`341` rate limit | đã kiểm (doc) | `…/graph-api/guides/error-handling`; transport đã map `190`/`102` → `token_expired`, `10`/`200`/`299` → `permission_missing`, `4`/`17` → `rate_limited` (`meta_graph_transport.py:36-42`) — **subcode bị bỏ** (`:204-209` chỉ đọc `code`) → O4 cần đọc `error_subcode` để nói "đổi mật khẩu" ≠ "hết hạn" |
| T10 | Đổi mật khẩu / checkpoint có **vô hiệu token system-user LfB** không (nó không phải phiên của người) | **[CHƯA KIỂM]** | suy luận: token thuộc system user tích hợp, không phải session người dùng; nhưng T5 nói *"still subject to invalidation for other reasons"* — chỉ đo mới biết; thiết kế coi mọi credential **đều có thể chết bất ngờ** |
| T11 | Quyền: `ads_read` — *đọc báo cáo quảng cáo cho tài khoản bạn sở hữu hoặc được cấp quyền*; `business_management` — *"read and write with the Business Manager API"*, quản lý/claim tài sản | đã kiểm (doc) | `developers.facebook.com/docs/permissions` (0–100k ký tự); `business_management` **rộng** (có ghi) — bề mặt ghi bị chặn bởi **mã của ta** (transport GET + 1 POST path), không bởi scope |
| T12 | **Standard Access** (bản tiếng Việt: *Quyền truy cập tiêu chuẩn*): app *"chỉ có thể yêu cầu các quyền có Quyền truy cập tiêu chuẩn từ người dùng có vai trò trên ứng dụng yêu cầu"*; app **Business** *"tự động được phê duyệt Quyền truy cập tiêu chuẩn đối với mọi quyền và tính năng"*; **Advanced Access** đòi **Xác minh doanh nghiệp** + App Review từng quyền | đã kiểm (doc) | `…/graph-api/overview/access-levels` → **4 tài khoản Facebook phải có vai trò trên app** (admin/developer/tester) nếu app chưa Advanced Access; vai trò nào là đủ: **[CHƯA KIỂM]** |
| T13 | Marketing API tier: **Limited access** (mặc định) *"heavily rate-limited per ad account. For development only"*, *"App admins or developers can make API calls on behalf of ad account admins or advertisers"*, không giới hạn số ad account; **Full access** sau App Review + ≥500 call/15 ngày + lỗi <15% | đã kiểm (doc) | `…/marketing-api/overview/authorization/` → với 32 tài khoản đọc 2 GET/ngày mỗi cái (≈64–70 GET/ngày) ở **Limited** là **[CHƯA KIỂM]** có bị `rate_limited` không; sweep đã tự dừng theo connection |
| T14 | Một user token của **admin BM** đọc được `{bm}/owned_ad_accounts`, `{bm}/client_ad_accounts`, `act_<id>` node, `act_<id>/insights` cho **mọi** tài khoản dưới BM mà **không** cần gán từng tài khoản | **[CHƯA KIỂM]** | tiền lệ ngược chiều: system user **chỉ thấy tài sản được gán** (`RUNBOOK:60-62`); Employee vs Admin thấy 4 vs 8 tài khoản (`TEST_LOG.md:2355-2360`) → danh tính quyết định kiểm kê; phải đo bằng 1 tài khoản (§10) |
| T15 | `me/adaccounts` (liệt kê tài khoản theo **người**, có field `business{id,name}` — AdsCommand dùng, `ads-manager/lib/connect/meta-assets.ts:32-40` theo ROADMAP §4.2.4) | trang reference **404** hôm nay → **[CHƯA KIỂM]** | không cần cho O4: O4 đi theo BM (`me/businesses` → connection) để S1/S2 giữ nguyên khoá `business_manager_id` |
| T16 | `oauth/access_token` đổi `code` → token là **GET** với `client_secret` trong query; `fb_exchange_token` cũng GET | đã kiểm (doc T2; mã mb-connect `meta.ts:92-95`) | ⇒ **không cần method mới** trên transport; nhưng query string mang secret → transport **không bao giờ log URL** (đã đúng: `meta_graph_transport.py:14-16`, `:119`, `:238-241`) — test phải ghim thêm cho hai path mới |
| T17 | `appsecret_proof` (HMAC của token bằng app secret) — Meta có cài đặt "Require App Secret" | **[CHƯA KIỂM]** trang không tải được | không bật trong O4; ghi follow-up |

**Kết luận T4/T6/T7 cho yêu cầu "kết nối một lần, không dán lại"**: thứ Meta **tài liệu hoá** là *"không hết
hạn"* chỉ có ở **token system user** (Business Settings — đường hiện tại; hoặc **LfB loại system user** — một
cú bấm, không env). Token **người dùng** luôn ~60 ngày và cách gia hạn không cần người **không được tài liệu
hoá**. Vì vậy §7 chọn vault + LfB và **khuyến nghị cấu hình LfB loại system user** làm mặc định; loại user
token được cùng mã xử lý nhưng được **nói thật** là sẽ cần một cú bấm lại trừ khi phép đo T4 cho thấy khác.

### 5e. Mẫu đã có ở `tracking-audit-os` (Google OAuth + vault) — mang sang được gì, không được gì

| Mảnh ở `tracking-audit-os` | Ở đâu | Mang sang O4? | Ghi chú |
|---|---|---|---|
| Vault Fernet **một khoá** từ env, module **duy nhất** encrypt/decrypt, thiếu khoá → `VaultNotConfiguredError`, **không bao giờ** fallback plaintext; `SecretDecryptionError` khi khoá đổi | `app/core/secret_encryption.py:1-57`; `docs/ARCH.md` R3 "Mã hoá" | **có** → `core/secret_vault.py` | audit-ads **chưa có** `cryptography` (`backend/requirements.txt`: PyJWT, httpx, không có) → **dependency mới có chủ ý** (A10 từng từ chối dep mới cho transport — `meta_graph_transport.py:18-19`; đây là mã hoá, stdlib không có AES) — quyết định §13 |
| `sign_state()`/`verify_state()` — state OAuth ký bằng **cùng** khoá Fernet, TTL enforce lúc đọc (`Fernet.decrypt(ttl=)`), payload **không** chứa secret | `secret_encryption.py:60-86`; `platform_oauth_service.py:146-151`, `:242-245` | **có** | chống CSRF/replay cho vòng redirect; TTL 10 phút |
| Vòng đời secret tách khỏi vòng đời kết nối: `draft → active / test_failed → revoked (cuối)`; `replace_secret` **reset về draft**; `resolve_active_secret()` là **hàm duy nhất** trả plaintext, chỉ khi `ACTIVE`, không gọi từ route | `platform_credential_service.py:13-20`, `:67-72`, `:105-113`; `models/enums.py:2878-2888`; ARCH R3 | **có**, đổi tên trạng thái cho đúng Meta: `pending_verification → active → reconnect_required → revoked` | khác một điểm: ở đây **không cho operator tự attest** "test thành công" (rule 4) — `active` chỉ đến từ `debug_token` thật |
| OAuth connect: app sở hữu **một** OAuth client trong env; `authorize` (owner, scoped) → 307 tới consent; `callback` **không scoped, không đăng nhập**, **luôn** 302 về frontend với `oauth_status`/`oauth_error` **mã ngắn**, không bao giờ JSON lỗi hay token trên URL; `OAuthCallbackError(error_code)` | `platform_oauth_service.py:23-29`, `:110-117`, `:231-264`; `api/platform_oauth.py:20-80` | **có** | precedent unauthenticated route ở audit-ads: `POST /team/invitations/accept` (`routers/team.py:230`), `/health/*` |
| **Auto-verify ngay sau exchange** bằng một lời gọi **read-only thật**; bài học: credential vừa tạo ở DRAFT nên verify đầu luôn `credential_missing` → fix bằng bootstrap rồi ghi đè kết quả thật | `platform_oauth_service.py:205-228`, `:284-304` | **có** → verify = `debug_token` + `check_capability`/authority trên BM đã khai | tránh đúng bẫy đó: O4 verify **trước khi** gán trạng thái, không qua `resolve_reader` |
| Provider **rẽ nhánh theo `credential_type` thật**, không đoán shape JSON | ARCH R8 "Bug thật … `resolve_active_credential()` trả kèm `credential_type`" | **có** → `ReaderCredentialKind` từ `debug_token.type` | `USER` vs `SYSTEM_USER` quyết định có `me/businesses` hay không |
| UI: credential card **không bao giờ** hiện secret; bảng metadata (loại, rotate gần nhất, test gần nhất, ghi chú); nút revoke "KHÔNG thể hoàn tác"; audit log mở được | `PlatformCredentialsView.tsx:26-28`, `:196-279` | **có** (hình dạng) | token màu/kích thước theo U1; câu chữ BA |
| Panel *"Cần làm gì tiếp theo?"* — mỗi platform **đúng một bước thủ công** app không tự động hoá được, hiện **trước** khi bấm Connect + gợi ý theo `last_error_code` | `PlatformConnectionsView.tsx:55-118` | **có** | bước thủ công của Meta: thêm 4 tài khoản vào **vai trò app** (T12) + bật **2FA**; gợi ý theo subcode `459/460` |
| `OAuthCallbackBanner` đọc `oauth_status` từ query | `PlatformConnectionsView.tsx:128-160` | **có** | |
| `refresh_token` + `access_type=offline` + `prompt=consent`; lỗi `no_refresh_token` | `platform_oauth_service.py:163-168`, `:259-264` | **không** — Meta **không có** refresh token (T4) | thay bằng: liveness `debug_token` theo lịch + (nếu T4 đo được) `fb_exchange_token` trước hạn + **kết nối lại một cú bấm** |
| Thư viện `google-auth`/`googleapiclient`/`httpx.post` | `:8-12`, `:171-184` | **không** — rule 20: chỉ `MetaGraphTransport.get` | hai path mới trên cùng host |
| `developer_token`/`login_customer_id` mang qua state | `:142-150`, `:270-276` | **không** (Google Ads-specific) | state O4 chỉ mang `workspace_id`, `label`, `business_manager_reference` (không bí mật), `nonce`, `requested_by` |
| Không có auth layer, scope theo `project_id` ở service | `platform_credential_service.py:43-49` | **không** — audit-ads đã có `OwnerCtx` + workspace từ membership (rule 8/10) | |
| `credential_reference_note` free-text, `environment_scope` | R1/R3 | **không** | |

### 5f. mb-connect — vì sao chưa phải đường của O4 (đo trong mã, không suy đoán)

- Cổng đòi **`ads_management`** (ghi) và kiểm lại mỗi lần cấp (`lib/providers/meta.ts:11`, `lib/connections.ts:232`) —
  trái Constraint 2; cần **login config chỉ đọc thứ hai** ở cổng (ROADMAP §4.2.1a).
- **Một bản cài = một kết nối active mỗi provider** (`lib/connections.ts:2-4`); không `tenantRef`; không endpoint
  liệt kê; không webhook; callback **không ghi `metaBusinessId`** (O3 §2i) → 16 BM/4 tài khoản không biểu diễn được.
- Cổng dùng **LfB loại system user** (`meta.ts:3-5`, `override_default_response_type=true` `:38-40`) → token không
  hết hạn, kiểm `debug_token` bằng app token (`:66-70`) mỗi giờ (`connections.ts:14-16`, `:227-243`): **đúng hình
  dạng O4 muốn** — O4 làm cùng việc **trong** sản phẩm, với vault riêng; Phase 4 đổi nguồn credential sang cổng
  bằng một nhánh `resolve_reader` nữa (`customer_gateway`), đúng seam O3 §6.1 đã để.
- Cần module ra ngoài thứ tư + sửa rule 20 ngay bây giờ — không xứng với việc chỉ phục vụ **chính chủ sản phẩm**.

### 5g. Tín hiệu vận hành & Telegram hôm nay — chỗ cắm cho "credential sắp hết hạn / đã chết"

| Thứ | Ở đâu | Dùng lại cho O4 |
|---|---|---|
| Màn System Status `GET /operations/overview` | `routers/operations.py:73-172`: `dispatcher_state`, `backup_state` qua `staleness()` ("never" ≠ "stale", rule 28), `OperationalRunKind` (`enums.py:346-360`) | thêm `credential_check_state` + `credential_check_last_run` + đếm `reader_credentials{active, expiring, reconnect_required, pending_verification}` |
| Báo cáo cấu hình `GET /operations/configuration` | `routers/operations.py:187`; `production_checks.py` | finding mới chỉ nêu **mã + câu** (rule 26) |
| Telegram chỉ đi từ **Alert** ← **health signal của một tài khoản** (`alert_rules.py:22-29`; `ALERT_POLICY_V1.md:9-15`): `critical` ngay, `warning` theo giờ yên lặng, `attention/info` không gửi; `NotificationDelivery.alert_id` bắt buộc (`notification_service.py:141`) | không có tin cấp workspace | **O3 đang thêm** alert không gắn tài khoản (`AlertSourceType.DISCOVERY_SWEEP`, `ad_account_id NULL`, mẫu `a3-v1-summary` — `discovery_sweep.py` docstring working tree; O3 §4b) → O4 thêm nguồn `READER_CREDENTIAL`, **không** thêm đường gửi mới |
| Luật sức khoẻ theo tài khoản (`health_rules.py:940-1130`, 18 luật + O3 thêm 1) | `spend_observation_missing_or_stale` **không nổ** khi `not_observable` (`:451-456`) | đúng ý: credential chết không sinh **32 tín hiệu**; một alert credential là đủ; S2 `blocking` vẫn nổ với dữ liệu cũ (`:717-731`), `mismatch` không (`:774-777`) |

---

## 6. Bước 2 — Khoảng trống và ranh giới (từ vựng của playbook)

| # | Khoảng trống | Loại | Trong O4? |
|---|---|---|---|
| G1 | `reader_source` chỉ có `business_specific/server_default/none/fake`; không có từ cho "credential trong vault", "credential cần kết nối lại"; không có `ReaderCredentialKind/Status`; `OperationalRunKind` không có kiểm tra sống; `AlertSourceType` không có nguồn credential | `vocabulary` | có — enum, không migration riêng (`sa.Enum(native_enum=False)` — tiền lệ S1 §2b) |
| G2 | Credential chỉ có trong `Settings`; `resolve_reader(settings, business_id)` không biết connection/session; token mặc định đọc **mọi** BM không có entry | `architecture` | có — nhánh thứ ba theo `connection.reader_credential_id`; thứ tự ưu tiên viết thành luật (§7b) |
| G3 | Không nơi nào lưu được credential mã hoá; không có module mã hoá; không có `cryptography` | `data_model` / `security` | có — bảng `meta_reader_credentials`, `core/secret_vault.py`, dependency mới (quyết định §13) |
| G4 | Không có vòng đời credential (chưa kiểm / sống / sắp hết hạn / cần kết nối lại / thu hồi); `token_configured` là boolean | `state_machine` | có |
| G5 | Không có luồng "người bấm đồng ý trên Meta → server nhận `code`"; không route không-đăng-nhập nào ngoài `invitations/accept` và `/health`; không `state` ký | `API` / `security` | có — `connect/start` (owner) + `callback` (public, state ký TTL 10') |
| G6 | Transport map lỗi chỉ theo `code`, bỏ `error_subcode` → không phân biệt "đổi mật khẩu/checkpoint" với "hết hạn" (T9) | `observability` | có — đọc `subcode`, giữ vocabulary `MetaFailureCode`, thêm `failure_detail` **mã** (vd `password_changed`, `checkpointed`) — không phải chuỗi của Meta |
| G7 | Không có kiểm tra sống theo lịch; không ai biết trước N ngày token hết; không tin Telegram nào cho sự kiện cấp credential | `observability` | có — `credential_check_pass` (tắt mặc định), alert nguồn `READER_CREDENTIAL` qua đường O3 đang mở |
| G8 | Một BM được hai credential nhìn thấy → chưa có luật chọn/đổi; BM biến mất khỏi `me/businesses` → chưa có tín hiệu | `state_machine` | có — chọn một lần, đổi tường minh; tín hiệu `business_manager_not_listed` (attention, chỉ Alert Center), **không bao giờ** archive (rule 2) |
| G9 | Spend/Status API chỉ nói `not_observable`, không nói **vì sao** (không connection / không reader / credential chết) — rule 28 | `API` / `frontend_UX` | có — `not_observable_reason` |
| G10 | UI: không màn credential; `ReaderSourceBadge` 3 nhánh; Spend tab in chuỗi thô | `frontend_UX` | có |
| G11 | 5 chỗ tài liệu/chú thích nói "credential không bao giờ vào DB" (§5c dòng cuối) | tài liệu / `architecture` | có — viết lại, không để câu cũ cạnh hành vi mới |
| G12 | Production: không `META_*`, không dispatcher, frontend không vào được; app Meta chưa rõ cái nào, chưa có login config, 4 tài khoản chưa có vai trò app | `deployment` | **không sửa gì trong mã** — điều kiện vận hành (§10) |
| G13 | Không test nào cho user token, `debug_token`, callback, vault, ưu tiên credential, suy giảm khi credential chết | `testing` | có |
| G14 | Authority gate `{bm}/system_users` với user token admin: chưa đo; `me/businesses` với user token: chưa đo (T14, 5b) | `testing` (live) | phiên đo §10 — **trước khi viết mã** |

**Lỗi không liên quan → follow-up, không phải phạm vi O4**: `routers/meta_operations.py:1-7` docstring vẫn
nói *"No route here calls a real Meta API"* (sai từ A10; O3 đã ghi); `scripts/a10_live_probe.py:160-176`
soi `debug_token` bằng **chính token được soi** làm bearer — chỉ chạy được vì system user đó là admin của
business sở hữu app (T8), với user token thường sẽ fail; `production_checks.py` **không** soi placeholder
cho `META_ACCESS_TOKEN` đơn (chỉ soi map `:210-230`).

---

## 7. Bước 3 — Design Choice

### 7a. Ba nơi credential có thể sống — và vì sao chỉ một nơi đáp ứng yêu cầu cứng

| | (a) JSON trong env, khoá theo nhãn (`META_USER_READER_TOKENS={"fb-1":"…"}`) | **(b) Vault mã hoá trong DB, nạp bằng Facebook Login for Business trong sản phẩm** | (c) Lấy qua cổng mb-connect ngay |
|---|---|---|---|
| Kết nối một lần, **không dán lại** | **không**: user token ~60 ngày → sửa env mỗi 2 tháng × 4 — chính điều người dùng từ chối; nếu dùng system-user token thì lại là 16 entry | **có**: token vào vault từ callback, không ai gõ; sống/hạn kiểm bằng `debug_token`; chết → một nút | có về nguyên tắc, nhưng cổng hôm nay: scope ghi, một kết nối/provider, không BM id (§5f) |
| Tự gia hạn | không (người sửa env) | kiểm sống theo lịch; **nếu** T4 đo được thì tự trao đổi trước hạn; nếu không thì cảnh báo trước N ngày + nút kết nối lại; với LfB system user: **không có gì để gia hạn** | cổng tự kiểm (`debug_token`/giờ), không gia hạn user token |
| Rule 1/40 | **không chạm** (vẫn env) | **chạm**: lưu access token (mã hoá) trong DB → sửa rule 1 và 40 (§7c) | chạm rule 1, 20, 40 (ROADMAP §4.3) |
| Khoá trong DB? | không | **có**: bị lộ DB ≠ lộ token (cần thêm `CREDENTIAL_VAULT_KEY` từ env) | token ở cổng |
| Biết trước hết hạn | không (ai nhớ?) — TEST_LOG `:2349-2353`: *"Renewal belongs on a calendar, not in anyone's memory"* | có (`expires_at` từ `debug_token`) | có |
| Phase 4 (khách) | ngõ cụt | **đúng hình dạng Phase 4 cần** (credential theo workspace, không env); cổng sau này chỉ là nguồn credential khác | là Phase 4 |
| Dependency/mã | ~0 | `cryptography` + bảng + luồng callback + pass | module ra ngoài thứ tư + sửa cổng |
| Kết luận | **bỏ** — không đáp ứng yêu cầu 3 | **chọn** | **bỏ cho O4** — để Phase 4, O4 để sẵn seam |

**Trong (b), loại token do cấu hình LfB quyết định — mã O4 xử lý cả hai, khuyến nghị một:**

| | LfB **System User token** (khuyến nghị) | LfB **User token** |
|---|---|---|
| Hết hạn | **không** (mặc định, T6) | ~60 ngày (T1); gia hạn không cần người **[CHƯA KIỂM]** (T4) |
| Số lần bấm | **một lần cho mỗi BM** = 16 (T7; nếu hộp thoại cho chọn nhiều portfolio thì ít hơn — [CHƯA KIỂM]) | một lần cho mỗi tài khoản Facebook = 4 |
| Liệt kê BM | **không** qua `me/businesses` (system user: rỗng — đã đo 5b); BM = cái người dùng **chọn trong hộp thoại** và **khai trên form** của ta, verify bằng node BM + authority | `me/businesses` (T-5b, chưa đo trong sản phẩm) → tạo connection cho từng BM |
| Đổi mật khẩu/checkpoint | **[CHƯA KIỂM]** (T10) — có thể **không** ảnh hưởng | **chắc chắn** vô hiệu (`460`, `459`, T9) |
| "4 credential" đúng nghĩa đen? | không — 16 credential, nhưng **0 env, 0 dán lại, 0 hết hạn** | có — nhưng có thể phải bấm lại mỗi 60 ngày |
| Đề xuất | **làm cấu hình này trước**; nó là thứ duy nhất Meta tài liệu hoá là "không hết hạn" | tạo cấu hình thứ hai **chỉ sau** phiên đo T4; nếu T4 cho thấy `expires_at` được đẩy lùi khi tái trao đổi → user token thành đường "4 lần bấm, tự gia hạn"; nếu không → giữ làm đường phụ có cảnh báo trước N ngày |

### 7b. Thiết kế duy nhất — chi tiết

**Hai công tắc độc lập, hai người khác nhau** (cùng lý lẽ `_provider_for`, O3 §4b):

1. **Cấu hình server** (deployment, rule 18/22): `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
   `META_OAUTH_REDIRECT_URI`, `META_LOGIN_CONFIG_KIND` (`system_user` | `user` — loại token mà cấu hình LfB đã
   tạo sinh ra; chỉ để UI biết BM id có bắt buộc trên form hay không, callback **vẫn tin `debug_token.type`**),
   `CREDENTIAL_VAULT_KEY` (Fernet), `CREDENTIAL_CHECK_EVERY_N_PASSES` (**mặc định 0 =
   tắt**), `CREDENTIAL_CHECK_BATCH` (mặc định 10), `CREDENTIAL_EXPIRY_WARNING_DAYS` (mặc định 14),
   `CREDENTIAL_RENEW_BEFORE_DAYS` (mặc định 20, chỉ có nghĩa với `kind=user`). Thiếu bất kỳ biến nào trong bốn
   biến đầu → nút *Kết nối* **disabled** kèm lý do `not_configured`, không 500; `production_checks` soi
   placeholder/rỗng (mã + câu, không giá trị).
2. **Hành động của owner** trong UI: *Kết nối*, *Kiểm lại*, *Kết nối lại*, *Thu hồi*, *Dùng credential này cho
   BM này* — mỗi cái một audit với actor thật (rule 3, 8).

**A. Dữ liệu — migration `0018_o4_reader_credentials`** (sau `0017_o3_conn_automation`; up/down/up sạch):

Bảng mới `meta_reader_credentials` (`UUIDPrimaryKey, Timestamped, Archivable`):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `workspace_id` | uuid FK `workspaces` RESTRICT, index | scope từ membership (rule 8) |
| `label` | `String(200)` | do owner đặt lúc kết nối (vd "FB Triều — BM Quảng Cáo Top") |
| `kind` | enum `ReaderCredentialKind{user, system_user}` | từ `debug_token.type` (T8), **không** do người khai |
| `status` | enum `ReaderCredentialStatus{pending_verification, active, reconnect_required, revoked}` | `expiring` là **suy ra** từ `expires_at`, không lưu (rule 28: trạng thái tính được thì không ghi đè) |
| `encrypted_secret` | `Text` | ciphertext Fernet; **cột duy nhất** trong toàn schema mang credential |
| `secret_last_rotated_at` | tz | mỗi lần token đổi (kết nối lại / trao đổi) |
| `provider_user_external_id`, `provider_user_name` | `String(120)`, `String(200)` | `debug_token.user_id`, `me.name` — ai đã cấp (với system user là tên system user tích hợp) |
| `scopes_json` | JSON list | từ `debug_token.scopes ∪ granular_scopes[].scope` (mb-connect `meta.ts:78-82` ghi: với system user quyền có thể chỉ nằm ở `granular_scopes`) — **allowlist** chuỗi |
| `issued_at`, `expires_at`, `data_access_expires_at` | tz nullable | `expires_at NULL` = Meta nói `0` = không hết hạn |
| `last_verified_at`, `last_verify_outcome` | tz, `String(64)` | `valid` / `token_expired` / `permission_missing` / `provider_server_error`… (`MetaFailureCode`) |
| `reconnect_reason` | `String(64)` nullable | mã: `expired`, `invalid_token`, `password_changed` (subcode 460), `checkpointed` (459), `scope_missing`, `app_mismatch`, `revoked_by_owner` |
| `businesses_seen_json` | JSON nullable | `[{external_id, name, permitted_roles}]` từ `me/businesses` lần kiểm gần nhất (`kind=user`); `NULL` với system user |
| `connected_by`, `connected_at`, `revoked_by`, `revoked_at`, `revoke_reason` | | người thật |

Cột mới trên `meta_connections`: `reader_credential_id` uuid FK `meta_reader_credentials` **RESTRICT**, nullable,
index. **Không** cột nào khác; `business_manager_reference` giữ "set at creation, never updated".

Enum/giá trị mới (không migration): `READER_VAULT = "vault"`, `READER_VAULT_RECONNECT_REQUIRED =
"vault_reconnect_required"` (vào `reader_source` — cột `String(32)` đủ; union TS thêm);
`OperationalRunKind.CREDENTIAL_CHECK`; `AlertSourceType.READER_CREDENTIAL`; audit actions
`meta_reader_credential.connect_started / connected / verified / renewed / reconnect_required / revoked /
assigned_to_connection`, `meta_connection.created_from_credential`.

**B. Luồng kết nối** (`services/meta_reader_credentials.py`; mọi GET qua `MetaGraphTransport.get`):

```
owner  POST /meta-reader-credentials/connect/start {label, business_manager_reference?}   (StrictPayload; BM id KHÔNG bí mật)
       → state = sign_state({workspace_id, user_id, label, bm_ref, nonce}) TTL 600s (khoá vault)
       → 200 {url: https://www.facebook.com/{v}/dialog/oauth?client_id&redirect_uri&state&config_id
                   &response_type=code&override_default_response_type=true}      (mẫu mb-connect meta.ts:30-43)
browser → Meta hộp thoại (người thật bấm; cookie/phiên là của trình duyệt họ, sản phẩm không thấy)
Meta   → GET /meta-reader-credentials/callback?code&state            (KHÔNG đăng nhập; chỉ nhận code+state)
server → verify_state (sai/hết hạn → 302 ?connect=error&reason=invalid_state)
       → GET oauth/access_token?client_id&client_secret&redirect_uri&code       (transport, bearer rỗng → cho phép path này)
       → GET debug_token?input_token=<token>   với Authorization: Bearer <app_id|app_secret>
            ✗ app_id ≠ META_APP_ID → app_mismatch (không lưu)
            ✗ is_valid=false → invalid_token (không lưu)
            ✗ scopes ⊉ {ads_read, business_management} → scope_missing (không lưu)
            ✗ scopes ∋ ads_management → scope_too_broad (KHÔNG lưu — Constraint 2; chỉnh login config rồi làm lại)
       → kind = type; nếu kind=user và expires_at trong < 60 ngày và là token ngắn hạn → GET oauth/access_token?grant_type=fb_exchange_token… → dùng token dài hạn
       → encrypt + INSERT credential (status=pending_verification) + audit `connected` (metadata: kind, scopes, expires_at, user_id — KHÔNG token)
       → verify (cùng transaction, SAVEPOINT):
            kind=system_user: bm_ref BẮT BUỘC (form) → check_capability()+authority trên bm_ref → ok → connection
                              (production, label, bm_ref, reader_credential_id) nếu chưa có; có rồi → gán nếu connection chưa có credential
            kind=user:        GET me/businesses?fields=id,name,permitted_roles (≤ 10 trang) → mỗi BM: connection
                              production mới (hoặc gán vào connection cùng BM chưa có credential) + businesses_seen_json
            → status=active + audit `verified`; thất bại → status giữ pending_verification + reason, KHÔNG đọc gì
       → 302 {PUBLIC_APP_URL}/settings/meta-credentials?connect=ok&credential=<id>  |  ?connect=error&reason=<mã>
```

Cờ O3 (`auto_discovery_enabled`, `auto_import_enabled`) trên connection mới **mặc định `false`** — owner bật sau
(O3 §4b); O4 không bật hộ. Callback dùng `SystemAuditLogService`-style actor? **Không**: actor thật lấy từ
`state.user_id` (người đã bấm *Kết nối*), vì callback không có session — ghi `metadata.via = "oauth_callback"`.

**C. `resolve_reader` — thứ tự ưu tiên thành luật** (sửa chữ ký, giữ mọi caller cũ):

```
resolve_reader(settings, business_id, *, credential: ReaderCredential | None = None) -> (token, reader_source)
 1. credential là None            → như hôm nay (business_specific → server_default → none)
 2. credential.status == active   → (decrypt(credential), "vault")          # vault THẮNG env cho BM đã gắn
 3. credential.status != active   → ("", "vault_reconnect_required")        # KHÔNG rơi xuống env — rule 4: không âm thầm đọc bằng danh tính khác
```

`reader_for_connection` (O3) truyền `connection.reader_credential` vào. `_connections_by_business`: rank 0 =
có credential `active` và tự khai BM; rank 1 = tự khai BM (env); rank 2 = thừa kế server. `provider_for_connection`
nhận `session` để giải mã **lúc dựng provider**, không trước, không cache; `identify()` memo theo
`credential_id` trong **một** pass.

**D. Kiểm tra sống & gia hạn** — `credential_check_pass(batch)` trong `run_dispatcher.py`, cùng khuôn
`spend_sweep_pass` (`:242-370`), `OperationalRunKind.CREDENTIAL_CHECK`, tắt mặc định, lệnh tay
`--credential-check`:

1. Chọn credential `active` hoặc `reconnect_required` (để phát hiện tự hồi sinh? **không** — `reconnect_required`
   không tự quay lại `active`; chỉ `active` + `pending_verification` được kiểm), theo `last_verified_at` cũ nhất,
   `batch` mỗi workspace.
2. `GET debug_token` (1 GET, app token): cập nhật `expires_at`, `scopes_json`, `last_verified_*`.
   `is_valid=false` / lỗi `190`+subcode / thiếu scope → `reconnect_required` + `reconnect_reason` + audit + **alert**.
3. `kind=user`: `GET me/businesses` (1 GET) → `businesses_seen_json`; BM có connection gắn credential này mà **không
   còn** trong danh sách → tín hiệu `business_manager_not_listed` (attention, Alert Center) — **không** archive,
   không gỡ credential; BM **mới** → connection mới (`created_from_credential`), cờ O3 `false`.
4. `kind=user` và `expires_at − now < CREDENTIAL_RENEW_BEFORE_DAYS`: thử `GET oauth/access_token?grant_type=
   fb_exchange_token&fb_exchange_token=<token>` (1 GET). Nếu Meta trả token **và** `debug_token` của token mới có
   `expires_at` muộn hơn → `replace_secret` + audit `renewed` (ghi `expires_at` cũ/mới, không token). Nếu không →
   không đổi gì, đếm `renew_not_extended` — **đây là chỗ T4 được đo mỗi ngày thay vì được tin**.
5. Mọi credential có `expires_at − now < CREDENTIAL_EXPIRY_WARNING_DAYS` → alert `warning` (key
   `reader_credential:{id}:expiring:{expires_at.date}`); `reconnect_required` → alert **`critical`** (đề xuất,
   §13.5) key `reader_credential:{id}:reconnect:{reason}`. Alert không gắn tài khoản, đi mẫu `a3-v1-summary` của O3;
   nội dung: nhãn, kind, tên tài khoản FB, lý do (mã), số connection/tài khoản bị ảnh hưởng, link trang credential.
   `rate_limited` → dừng lượt (như S1).
6. `OperationalRun(summary={checked, valid, expiring, reconnect_required, renewed, renew_not_extended,
   businesses_added, businesses_not_listed, rate_limited, due_remaining, workspaces})` — thêm vào `SAFE_SUMMARY_KEYS`.

Giá: ≤ 3 GET / credential / lượt; 4–16 credential → ≤ 48 GET/ngày ở cadence 24h.

**E. Sau khi credential chết — không bao giờ "ổn"** (hợp đồng, test từng dòng ở §8):

- `resolve_reader` → `vault_reconnect_required` → `reader_for_connection` = `None` → S1: tài khoản `not_observable`
  với `not_observable_reason = "reader_reconnect_required"`; **không** đọc, **không** ghi quan sát mới.
- S2: giữ **lần cuối Meta nói**; `platform_account_status_blocking` vẫn nổ với dữ liệu cũ; `mismatch` không
  (`AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md:590`) — mất reader ≠ hồi phục.
- Luật `spend_observation_missing_or_stale` **không** nổ (đúng như hôm nay cho `not_observable`); thay vào đó
  **một** alert credential `critical` + dòng đỏ trên System Status + badge trên mọi thẻ connection liên quan.
- Một lượt đọc đang chạy gặp `190` giữa chừng: quan sát `failed/token_expired` được ghi như hôm nay; pass kế
  `credential_check` sẽ xác nhận và chuyển trạng thái — không suy từ một lần `failed` (có thể là lỗi tạm).
- **Kết nối lại** = đúng luồng B với `credential_id` trong state → `replace_secret`, `status=pending_verification`
  → verify → `active`; connection giữ nguyên (`reader_credential_id` không đổi), lịch sử quan sát liền mạch;
  audit `renewed`/`verified`. Kết nối lại bằng **tài khoản Facebook khác** (user_id khác) → **từ chối** (`user_mismatch`):
  đó là credential mới, gán tường minh.

**F. Quyền tối thiểu & bán kính nổ** (nói thật):

| Kẻ trộm có token… | làm được | không làm được | vì |
|---|---|---|---|
| `ads_read` | đọc báo cáo/chi tiêu/trạng thái của mọi tài khoản người cấp thấy | đổi ngân sách, tạo/tắt quảng cáo, đổi thanh toán | scope đọc |
| `business_management` | **đọc và ghi Business Manager API** với quyền của người cấp: thêm/bớt người, gán tài sản, claim tài khoản — **rộng** (T11) | đăng nhập Facebook, đổi mật khẩu, đọc tin nhắn, lấy cookie | token ≠ phiên; nhưng ghi BM là thiệt hại thật |
| token system user LfB | như trên nhưng **không hết hạn** cho tới khi thu hồi | | **thu hồi**: Business Settings → Users → System users → gỡ app / xoá system user tích hợp; hoặc `DELETE me/permissions` (transport **không có** DELETE → bước tay, ghi runbook) |

Giảm bán kính: (1) token **không bao giờ** rời server (vault + bearer, không query trừ hai path Meta bắt buộc,
không log URL); (2) khoá vault tách khỏi DB; (3) **2FA bắt buộc** trên 4 tài khoản Facebook và 2FA bắt buộc
cho BM (Business Settings → Security Center) — khuyến nghị ghi runbook, sản phẩm **không kiểm được**; (4) không xin
`ads_management` — **không** có ngoại lệ; (5) `business_management` là cái giá của `me/businesses`/authority
gate — nếu phiên đo cho thấy `ads_read` một mình đủ cho `{bm}/owned_ad_accounts` + insights thì **bỏ**
`business_management` khỏi login config (câu hỏi §13.7); (6) vai trò **owner** cho mọi route credential; (7) rate
limit hiện có áp cho callback (public) — `rate_limit_auth_*` bucket theo địa chỉ.

**G. API** (owner-only trừ callback; `StrictPayload`; scope ngoài → 404):

| Method | Path | Ghi chú |
|---|---|---|
| `GET` | `/meta-reader-credentials` | danh sách: `id, label, kind, status, derived_state (active/expiring/…)`, `provider_user_name`, `scopes`, `issued_at`, `expires_at`, `last_verified_at`, `last_verify_outcome`, `reconnect_reason`, `businesses_seen[]`, `connections[{id,label,bm_ref}]`, `configured: bool` (server có đủ 4 biến) — **không bao giờ** `encrypted_secret` |
| `POST` | `/meta-reader-credentials/connect/start` | `{label, business_manager_reference?}` → `{url}`; 409 `not_configured` nếu thiếu cấu hình |
| `GET` | `/meta-reader-credentials/callback` | **public**, chỉ `code`+`state`; luôn 302; không JSON |
| `POST` | `/meta-reader-credentials/{id}/verify` | 1–2 GET; trả bản ghi; audit |
| `POST` | `/meta-reader-credentials/{id}/reconnect/start` | như connect/start với `credential_id` trong state |
| `POST` | `/meta-reader-credentials/{id}/revoke` | `{reason}`; **terminal** (không un-revoke, mẫu R3); connection gắn nó giữ `reader_credential_id` để lịch sử đọc liền mạch nhưng `resolve_reader` trả `vault_reconnect_required` (không rơi về env); UI nhắc bước tay gỡ app/system user ở Meta (transport không có DELETE) |
| `POST` | `/meta-connections/{id}/reader-credential` | `{credential_id}` — gán/đổi credential cho BM này (G8); 409 nếu credential không thấy BM đó (`businesses_seen`) hoặc không `active` |
| `GET` | `/meta-connections`, `/{id}` | thêm `reader_credential: {id,label,kind,derived_state,expires_at} \| null`; `reader_source` 6 giá trị |
| `GET` | `/ad-accounts/{id}/spend`, list compact | thêm `not_observable_reason: no_business_manager \| no_production_connection \| no_reader \| reader_reconnect_required \| null` |
| `GET` | `/operations/overview` | `credential_check_state`, `credential_check_last_run`, `reader_credentials{…}` |

**H. UI** (theo `ui-ux-resource-navigator`: token trước, đủ trạng thái tải/rỗng/lỗi/không quyền/một phần; U1 quyết
token màu):

- `Settings` → mục **Meta reader credentials** (owner): trống → *"Chưa có tài khoản Facebook nào được kết nối"* +
  panel *Cần làm gì trước?* (4 tài khoản phải có vai trò trên app; bật 2FA); nút **Kết nối một tài khoản Facebook**
  (form: nhãn; BM id **bắt buộc** khi cấu hình LfB loại system user, tuỳ chọn khi loại user — server biết loại
  nào qua `META_LOGIN_CONFIG_KIND`); danh sách card: badge trạng thái (`active` **không** xanh "an toàn" — chỉ
  `neutral`; `expiring` `attention`; `reconnect_required` `critical`; `pending_verification` `attention`), hạn
  (*"Không hết hạn"* / *"Hết hạn 2026-12-26 (còn 58 ngày)"*), scope, *"Kiểm lần cuối … → valid"*, BM đã thấy, nút
  *Kiểm lại* / *Kết nối lại* / *Thu hồi (không hoàn tác)* / *Xem audit*. Banner sau callback đọc `connect=`.
- Thẻ connection: `ReaderSourceBadge` thêm `vault` (*"Reader: <label> (<kind>)"*) và `vault_reconnect_required`
  (*"Credential needs reconnecting — nothing is being read"*, `critical`); `readerSourceNote` tương ứng.
- Spend tab / Accounts: `not_observable` kèm câu theo `not_observable_reason`; không in chuỗi thô `reader_source`.
- System Status: dòng *Credential check: never / stale / ok · N active · N expiring · N need reconnect*.
- Câu chữ cuối thuộc BA (rule 8b S2); các câu trên là bản nháp kỹ thuật.

### 7c. Luật cứng bị chạm — câu chữ đề xuất **nguyên văn** (quyết định của người dùng; CLAUDE.md **không** được sửa ở đây)

**Rule 1 — thêm một đoạn, không bớt chữ nào:**

> 1. Never store or accept passwords, cookies, session data, access/refresh tokens, credentials or raw proxy
> authentication secrets. `StrictPayload` refuses such fields by name — keep it that way. Exactly two request
> bodies are allowed to opt out of it, each a plain `BaseModel` with `extra="forbid"` and a docstring saying why:
> `LoginRequest` (…) and `InvitationAcceptRequest` (…). Adding a third needs the same deliberate, documented
> justification, not a quiet swap of the base class.
> **One exception, by design and not by drift (O4): a Meta reader credential that the product itself obtained
> from Meta's login flow — never typed, pasted or posted by a person, never read from a browser — may be stored
> in `meta_reader_credentials.encrypted_secret`, encrypted with `CREDENTIAL_VAULT_KEY` from server
> configuration by `core/secret_vault.py`, the only module that may encrypt or decrypt. It is decrypted only
> inside `resolve_reader`, lives in memory for one provider call chain, is never cached across passes, and
> never reaches a request body, a response, an audit row, a log line or the frontend bundle. Cookies, sessions
> and passwords remain forbidden without exception.**

**Rule 20 — sửa câu đã lỗi thời từ A10.2, và nêu hai path mới (không thêm module):**

> 20. Only three modules may make an outbound request, each to a narrow purpose: `services/telegram_transport.py`
> (…) and `services/preflight_safe_http.py` (…). The third is `services/meta_graph_transport.py` (A10 — the
> Meta Graph API only, to the configured base; **read-only except the single documented write path
> `{business-id}/adaccount`, enforced by `_WRITABLE_PATH` and its tests — it has no method that can PATCH or
> DELETE. O4 adds two GET paths on that same host, `oauth/access_token` and `debug_token`, whose query strings
> carry a credential by Meta's design; the transport never logs a URL, and a test pins that these two paths
> appear in no log line and no response**).

**Rule 40 — viết lại trọn vẹn:**

> 40. A Meta reader credential lives in exactly one of two places: server configuration keyed by Business
> Manager id (`META_ACCESS_TOKENS_BY_BUSINESS`, with `META_ACCESS_TOKEN` as the documented fallback), or the
> encrypted credential vault (`meta_reader_credentials`, rule 1's single exception), filled only by the
> product's own Facebook Login for Business flow and bound to a connection through
> `meta_connections.reader_credential_id`. Never add any other column, a request field or a response field
> that carries one; `reader_source` (`vault` / `vault_reconnect_required` / `business_specific` /
> `server_default` / `none` / `fake`) names *which* credential answered, and the credential's label, kind,
> granting account, scopes, expiry, last verification and status are the most that may be disclosed. For one
> Business Manager the order is fixed: a connection bound to an `active` vault credential is read with it and
> never with a server token; a Business Manager with its own configuration entry is never read with the
> default token; the fallback from an unmapped Business Manager to the default token stays, deliberate and
> documented. A vault credential that is not `active` — unverified, expired, invalidated, revoked — is never
> used and never falls back silently to another identity: every read under it degrades to
> `not_observable` with a stated reason until a person reconnects. The Meta app secret, login configuration
> id and vault key are server configuration under rule 18's terms. Read scopes only: a credential carrying
> `ads_management` is refused at the door.

**Rule 18 không đổi** (bot token); **rule 22 không đổi** (bật `CREDENTIAL_CHECK_EVERY_N_PASSES>0` trên prod =
duyệt có tên). Các luật 3, 4, 5, 8, 26, 28: không sửa, bảng §8 chứng minh.

### 7d. Tài liệu/chú thích phải viết lại (G11) — không để câu cũ cạnh hành vi mới

`docs/RUNBOOK_META_CONNECTION.md:79-91` (+ mục mới "§9 Kết nối tài khoản Facebook" và "§10 Thu hồi / kết nối
lại"); `FEATURES.md:388-396`; `ARCH.md` §4i (+ §4j vault); `core/config.py:62-81` docstring; `models/spend.py:11-13`;
`docs/PRODUCTION_ENVIRONMENT.md` (5 biến mới + bảng "không bao giờ vào DB" sửa thành "chỉ ciphertext");
`docs/META_READ_ONLY_DISCOVERY.md` §Who read it (user token → `read_as` là người); `API.md`; `TEST_LOG.md`;
`ALERT_POLICY_V1.md` §1 (nguồn `READER_CREDENTIAL`); `.env.example`; `docker-compose.production.yml` (dispatcher cần
cùng 5 biến).

---

## 8. Test Plan

**Bảng suy giảm (rule 4 / 28) — là hợp đồng; mỗi dòng một test cùng tên:**

| Tình huống | `resolve_reader` | S1 (đọc/độ mới) | S2 | Alert / UI | Không bao giờ |
|---|---|---|---|---|---|
| Không cấu hình `META_APP_*`/vault | như hôm nay (env) | như hôm nay | như hôm nay | nút *Kết nối* disabled + `not_configured` | 500; đổi hành vi S1/S2/O3 hiện có (regression ghim: toàn bộ suite S1/S2 xanh **không sửa**) |
| `CREDENTIAL_VAULT_KEY` thiếu mà có hàng vault | `vault_reconnect_required` (`SecretDecryptionError`/`VaultNotConfigured` → mã `vault_unavailable`) | `not_observable` + lý do | giữ lần cuối | critical "vault unavailable" trên System Status | plaintext; fallback env |
| Callback `state` sai/hết hạn | — | — | — | 302 `reason=invalid_state` | tạo bản ghi; lộ gì trên URL |
| Callback token `app_id` lệch / `is_valid=false` / thiếu `ads_read`·`business_management` / có `ads_management` | — | — | — | 302 `reason=app_mismatch\|invalid_token\|scope_missing\|scope_too_broad` | **lưu** token |
| Verify sau connect thất bại (BM khai không đọc được / `me/businesses` lỗi) | credential `pending_verification` → `vault_reconnect_required` cho connection gắn nó | `not_observable` | — | banner lỗi + reason | `active`; đọc gì |
| Credential `active`, kind=user, 4 BM | `vault` cho 4 connection | 8 tài khoản observable sau import (O3) | S2 theo | badge *Reader: <label>* | dùng env cho các BM đó |
| **Token hết hạn** (`debug_token.is_valid=false`, `190/463`) | `vault_reconnect_required` | `not_observable` + `reader_reconnect_required`; **không quan sát mới** | giữ lần cuối; `blocking` vẫn nổ; `mismatch` không | alert **critical** `reconnect:expired` (1 tin, không phải 8); card critical | `clear_signals`; `current`; rơi về env; tự gắn credential khác |
| **Token bị thu hồi ở Meta** (`190/467`) / app bị gỡ (`458`) | như trên, reason `invalid_token`/`app_not_installed` | như trên | như trên | critical | như trên |
| **Đổi mật khẩu** (`190/460`) / **checkpoint** (`190/459`) | như trên, reason `password_changed`/`checkpointed` | như trên | như trên | critical, câu gợi ý đúng việc ("đăng nhập facebook.com rồi bấm Kết nối lại") | gộp thành "hết hạn" |
| **Thiếu scope** sau này (người gỡ quyền app) | `vault_reconnect_required`, reason `scope_missing` | như trên | như trên | critical | đọc bằng scope còn lại |
| Sắp hết hạn (< 14 ngày), kind=user | vẫn `vault` | bình thường | bình thường | alert **warning** `expiring:<date>` một lần mỗi ngày hạn | im lặng |
| Tái trao đổi thành công (`expires_at` lùi) | `vault` | bình thường | bình thường | audit `renewed`; alert expiring tự đóng | log token |
| Tái trao đổi **không** lùi hạn (T4 sai) | `vault` | bình thường | bình thường | đếm `renew_not_extended`; alert expiring còn | báo "đã gia hạn" |
| **Một BM được 2 credential thấy** | credential **đã gắn** trên connection; không tự đổi | theo credential đã gắn | theo | card hiện "cũng thấy bởi: <label khác>" + nút *Dùng credential này* (owner) | tự chuyển danh tính đọc |
| Credential đã gắn chết, credential khác còn sống thấy cùng BM | `vault_reconnect_required` | `not_observable` | giữ | critical + gợi ý một cú bấm "Dùng <label khác>" (audit `assigned_to_connection`) | tự chuyển |
| **BM biến mất khỏi `me/businesses`** | không đổi (credential vẫn `active`) | đọc vẫn thử; nếu Meta từ chối → quan sát `failed/permission_missing` như hôm nay | giữ | tín hiệu `business_manager_not_listed` (attention, Alert Center) | archive connection/BM/tài khoản (rule 2) |
| **BM mới** xuất hiện ở `me/businesses` | — | — | — | connection mới `production`, cờ O3 `false`; dòng trong tin tóm tắt | tự bật auto-discovery |
| **Token thấy 0 BM** (`me/businesses` rỗng với kind=user) | credential `active` nhưng **0 connection** | — | — | banner *"Tài khoản này không có vai trò trên Business Manager nào — kiểm Business Settings"*; không lỗi | tạo connection rỗng; gọi `check_capability` lung tung |
| kind=system_user, form thiếu BM id | — | — | — | 422 trước khi mở hộp thoại | đoán BM |
| kind=system_user, BM khai ≠ BM người chọn trong hộp thoại (authority `not_established`) | `pending_verification` | — | — | banner reason `business_not_readable` | gán vào BM khai |
| `rate_limited` trong credential-check | không đổi trạng thái | — | — | dừng lượt, `due_remaining` | đánh dấu chết vì rate limit |
| Connection `fake`/`sandbox` | **không bao giờ** có credential vault (409 khi gán) | — | — | — | — |
| Dispatcher không có `META_APP_*` | credential vault vẫn giải mã được → đọc S1/S2 bình thường; **credential-check** báo `not_configured`, 0 GET | bình thường | | System Status: credential check `never` | — |

**8.1 Unit** (`test_o4_secret_vault.py`, `test_o4_reader_resolution.py`, `test_o4_credential_lifecycle.py`):
Fernet round-trip / tamper / thiếu khoá → không plaintext; `sign_state`/`verify_state` TTL, tamper, payload không
có token; `resolve_reader` ba nhánh + credential `active` thắng env + credential không `active` **không** rơi về
env (+ mọi test `test_multi_reader_credentials.py:41-100` vẫn xanh nguyên); map `debug_token` → `kind/scopes/
expires_at` (0 → `NULL`); map `190`+subcode → `reconnect_reason`; `scope_too_broad` khi có `ads_management`;
`derived_state` (`expiring` theo ngưỡng); chọn credential cho BM (rank); `not_observable_reason`.

**8.2 Integration (HTTP + Postgres thật)** (`test_o4_credentials_api.py`): owner-only, non-owner 404/403 theo tiền lệ
`ACCESS_SCOPE_MATRIX.md`; scope workspace 404; `connect/start` 409 khi thiếu cấu hình; callback với transport giả
(FakeTransport trả `debug_token` theo kịch bản) → bản ghi, connection, audit, **302 không chứa token**; `verify`;
`reconnect` giữ `reader_credential_id`, `user_mismatch` 409; `revoke` terminal; gán credential cho connection;
**mọi response của mọi route** không chứa `encrypted_secret`/token (grep JSON theo giá trị giả `FAKE-TOKEN-…`);
`StrictPayload` vẫn 422 với `access_token` trong body (`test_multi_reader_credentials.py:213` mở rộng);
`GET /meta-connections` khối `reader_credential`; spend `not_observable_reason`; `/operations/overview`.

**8.3 Regression**: `test_alert_security.py:236-240` **danh sách module ra ngoài không đổi**; `MetaGraphTransport`
không thêm method, `_WRITABLE_PATH` không đổi (`test_a10_2_write_refusal.py`); **log không chứa URL** cho
`oauth/access_token`/`debug_token` (caplog theo chuỗi `client_secret=`, `input_token=`, `fb_exchange_token=`);
audit rows qua `redact()` không chứa token; migration `0018` up/down/up trên DB sạch (`test_s1_spend_migration.py`
mở rộng); toàn bộ suite S1/S2/O3 xanh không sửa; frontend: `ReaderSourceBadge` 6 giá trị không giá trị nào
`positive` cho `active`.

**8.4 Live verification** (có người xem, ghi `TEST_LOG.md` nguyên hình dạng response, **sau** khi người dùng duyệt
§13.9): (1) một tài khoản Facebook kết nối thật qua UI dev → bản ghi `active`, connection(s) đúng BM;
(2) `--credential-check` một lượt; (3) `POST /ad-accounts/{id}/spend/refresh` cho **một** tài khoản dưới credential
đó (2 GET) → quan sát `succeeded` hoặc mã lỗi thật (T14); (4) **cố ý** gỡ quyền app ở Facebook → `--credential-check`
→ `reconnect_required` + alert; bấm *Kết nối lại* → `active`.

---

## 9. Success Criteria — quan sát được

1. Có thể đi từ *Kết nối một tài khoản Facebook* → hộp thoại Meta → quay lại màn credential ở trạng thái `active`
   với BM đã liệt kê, **không ai gõ/dán token** và **không sửa env** nào ngoài 5 biến cấu hình app một lần.
2. Sau khi kết nối, các connection tương ứng đọc được bằng `reader_source=vault`; S1/S2/O3 **không đổi một dòng
   logic** mà vẫn chạy trên credential đó (test S1/S2/O3 hiện có xanh nguyên).
3. `grep` toàn bộ response JSON, audit rows, log của suite với token giả: **0** kết quả; cột duy nhất mang
   credential là `meta_reader_credentials.encrypted_secret`; `StrictPayload` vẫn từ chối tên field credential.
4. Khi `debug_token` nói token chết (hết hạn/thu hồi/đổi mật khẩu/checkpoint/thiếu scope): trong vòng một lượt
   `credential_check` credential là `reconnect_required` với **đúng lý do**, mọi tài khoản dưới nó `not_observable`
   + lý do, **không** quan sát mới, S2 giữ lần cuối, **một** alert critical, **không** màn nào xanh — và *Kết nối
   lại* một cú bấm đưa về `active` mà lịch sử quan sát liền mạch.
5. Credential sắp hết hạn được báo trước ≥ 14 ngày (warning); việc tự trao đổi có hiệu quả hay không được **đếm**
   (`renewed` / `renew_not_extended`) chứ không được khẳng định.
6. Không có token nào có `ads_management` được lưu; không có DELETE/PATCH nào xuất hiện trên transport; danh sách
   module ra ngoài không đổi.
7. Hai credential cùng thấy một BM không bao giờ tự đổi danh tính đọc; BM biến mất khỏi `me/businesses` không
   bao giờ dẫn tới archive.

---

## 10. Phụ thuộc & thứ tự — so với O3 và lần đọc thật đầu tiên

| Thứ tự | Việc | Ai | Vì sao trước |
|---|---|---|---|
| 0 | Phase 0.2: `v21.0` còn sống? (1 GET) | người dùng + agent | mọi path mới đều ghim `META_GRAPH_API_VERSION` |
| 1 | **O3 commit** (đang trong working tree): `reader_for_connection`, alert không gắn tài khoản `a3-v1-summary`, `SystemAuditLogService`, migration `0017` | O3 | O4 tái dùng cả ba; O4 lấy `0018`; nếu O4 đi trước, O4 phải tự dựng alert không tài khoản và O3 tái dùng — **không** dựng hai lần |
| 2 | **Lần đọc thật đầu tiên trên mô hình hub** (O3 §8.2: token hub đọc `act_<id>`+`insights` của tài khoản **client**?) | người dùng duyệt, ≤ 8 GET | nếu **có** → hub + partner sharing đã theo dõi được 32 tài khoản bằng **một** system-user token không hết hạn, và O4 trở thành **tuỳ chọn** (giá trị còn lại: 0 env, không cần 16 lần Business Settings, Phase 4-ready); nếu **không** → O4 là đường chính |
| 3 | **Phiên đo tiền đề O4** (≤ 6 GET, có người xem, `scripts/a10_live_probe.py` mở rộng `--user-token`, token lấy từ Graph API Explorer của app, prompt ẩn, **không lưu**): (a) `me/businesses` với user token của **một** tài khoản → trả 4 BM + `permitted_roles`?; (b) `debug_token` bằng app token; (c) `{bm}/owned_ad_accounts` + `act_<id>/insights` một tài khoản (T14); (d) `{bm}/system_users` với user token admin (authority); (e) `fb_exchange_token` tái trao đổi token dài hạn còn hạn → `expires_at` lùi? (T4); (f) hộp thoại LfB loại system user cho chọn mấy portfolio (T7) | người dùng duyệt §13.9 | T4/T7/T14 quyết định **cấu hình LfB nào** và câu chữ "4 hay 16 lần bấm" — đo trước khi viết mã, không hứa trước |
| 4 | Việc ngoài mã: chọn app Meta (app của A10 hay `2077040626352062` của mb-connect — ROADMAP §4.5), tạo **login config chỉ đọc**, đăng ký `redirect_uri`, thêm **4 tài khoản vào vai trò app** (T12), bật 2FA | người dùng | không có thì callback không bao giờ xảy ra |
| 5 | O4 bước 4–6 | agent | |
| 6 | Phase 0.1 (frontend prod) + cấp 5 biến cho api **và** dispatcher + duyệt có tên `CREDENTIAL_CHECK_EVERY_N_PASSES>0` | người dùng | redirect về frontend cần frontend sống |

O4 **không chặn** O3 và **không bị** O3 chặn về mặt mã, chỉ về thứ tự migration và việc tái dùng alert.

---

## 11. Ngoài phạm vi (nói rõ) & rủi ro

**Không làm trong O4**: mb-connect/`customer_gateway` (Phase 4; O4 để seam: nhánh `resolve_reader`, cột
`reader_credential_id` có thể trỏ loại credential khác sau); thu hồi ở phía Meta bằng API (`DELETE me/permissions`
— transport không có DELETE; bước tay); `appsecret_proof` (T17); tự gắn credential khác khi credential đã gắn chết
(Constraint 9); dùng vault cho `TELEGRAM_BOT_TOKEN`/env khác (rule 18 giữ); key rotation vault (R3 cũng không có;
đổi khoá = mọi credential `vault_unavailable` → kết nối lại); nhiều khoá vault theo workspace; `me/adaccounts`
(T15); Google/TikTok (Phase 5); bật cadence trên production; migration/deploy/Telegram thật.

**Rủi ro**:

- **T4 sai** (không tái trao đổi được): user token = bấm lại mỗi 60 ngày. Giảm bằng khuyến nghị LfB system user
  (không hết hạn) — nhưng 16 lần bấm một lần và T7/T10 chưa đo.
- **T12/App Review**: nếu app không ở chế độ cho 4 tài khoản (không có vai trò / không Advanced Access), hộp thoại
  từ chối hoặc token thiếu scope → callback trả `scope_missing`, không lưu — đúng, nhưng O4 **không chạy được**
  cho tới khi việc ngoài mã xong.
- **T13 rate limit Limited access**: 64–70 GET/ngày + credential-check 48 GET/ngày trên một app ở tier Limited —
  chưa đo; sweep tự dừng theo connection; không retry.
- **Dependency `cryptography`**: wheel có sẵn cho `python:3.12-slim`; thêm vào image; quyết định có chủ ý (§13.2).
- **Callback public**: bề mặt mới không đăng nhập; chỉ nhận `code`+`state` ký TTL 10', rate limit theo địa chỉ, luôn
  302, không bao giờ thực thi gì khi state sai — vẫn là bề mặt mới, test ghim.
- **Khoá vault nằm cùng host với DB**: lộ cả hai = lộ token; giảm bằng 2FA + scope đọc + bán kính F; không phải KMS.
- **Hai audit song song (O3, U1)** cùng sửa `ReaderSourceBadge`/`MetaConnections.tsx`: xung đột merge; thứ tự §10.

---

## 12. Xác nhận

Không gọi Meta, không gửi Telegram, không deploy, không migration, không đổi mã, không commit, không đổi
`CLAUDE.md`/`MINI_SPEC_PLAYBOOK.md`. DB dev không được đọc (không có `psql`), không được ghi. `tracking-audit-os`
và `mb-connect` chỉ được đọc. Tài liệu Meta chỉ được đọc; chỗ nào 404 hay chỉ có bản tóm tắt đều ghi rõ ở §0/§5d.
Không test nào được chạy để viết tài liệu này.

---

## 13. Câu hỏi cho người dùng (chỉ những gì thuộc quyền người dùng)

1. **Duyệt câu chữ luật** §7c: rule 1 (thêm đoạn ngoại lệ), rule 20 (sửa câu GET-only + hai path), rule 40 (viết
   lại) — đồng ý từng câu, hay sửa khác? Đây là điều kiện tiên quyết để O4 có bước 4.
2. **Dependency mới `cryptography`** (Fernet) cho vault — chấp nhận? (Thay thế không có: stdlib không có AES;
   pgcrypto đưa khoá vào SQL/log.)
3. **Cấu hình Facebook Login for Business nào trước**: **(khuyến nghị) loại System User** — không hết hạn, mỗi BM
   một lần bấm (16, một lần duy nhất), BM khai trên form; hay **loại User** — 4 lần bấm, ~60 ngày, gia hạn tự động
   **chưa được Meta tài liệu hoá** (T4) và chỉ được hứa sau phiên đo? Hay làm cả hai (hai `config_id`)?
4. **App Meta nào** sinh token: app đã dùng cho system-user token A10 (chưa thấy app id trong TEST_LOG) hay app
   `2077040626352062` "Mắt Bão Marketing" của mb-connect (đang dev mode, ROADMAP §4.5)? Ai thêm 4 tài khoản vào
   vai trò app, vai trò nào (admin/developer/tester)?
5. **Mức alert** khi credential chết: `critical` (đi Telegram ngay, bỏ qua giờ yên lặng — vì mọi tài khoản dưới nó
   ngừng được theo dõi) hay `warning`? Sắp hết hạn: `warning` trước **14** ngày — đủ?
6. **Khi credential đã gắn chết mà credential khác còn sống thấy cùng BM**: giữ "một cú bấm của owner" (đề xuất,
   vì đổi danh tính đọc đổi kiểm kê) hay cho phép tự chuyển kèm audit + alert?
7. **Scope**: giữ `ads_read` + `business_management` (cần cho `me/businesses` và authority gate; `business_management`
   là quyền **ghi BM** nếu token bị trộm — §7b.F), hay thử `ads_read` một mình ở phiên đo rồi quyết?
8. **2FA bắt buộc** trên 4 tài khoản Facebook và trên 16 BM (Security Center) — xác nhận sẽ bật trước khi kết nối?
9. **Phê duyệt phiên đo §10.3** (≤ 6 GET, có người xem, token nhập bằng prompt ẩn và không lưu) — ai, khi nào?
10. **Thứ tự với O3 và lần đọc thật hub** (§10.2): chờ kết quả đọc thật trên hub rồi mới quyết O4 là đường chính hay
    tuỳ chọn — hay làm O4 bất kể, vì mục tiêu "0 env" tự nó đủ lý do?
11. **Người duyệt có tên** cho `CREDENTIAL_CHECK_EVERY_N_PASSES>0` trên production và cho việc cấp 5 biến mới
    (api + dispatcher) — tên, ngày (rule 22).

---

## 14. Quyết định của chủ sản phẩm (2026-10-27)

| § | Quyết định |
|---|---|
| 13.1 | **Duyệt** câu chữ sửa rule 1, 20, 40 đúng nguyên văn §7c. Áp vào `CLAUDE.md` ngay trong commit O4 |
| 13.2 | **Chấp nhận** dependency `cryptography` |
| 13.3 | Cấu hình Facebook Login for Business loại **System User** (không hết hạn). Mã vẫn xử lý được loại User, nhưng loại User không phải đường chính |
| 13.5 | Credential chết thì bắn **một alert `critical`** và báo Telegram ngay. Loại có hạn thì cảnh báo `warning` trước 14 ngày |
| 13.10 | **Làm O4 ngay sau O3**, không chờ lần đọc thật trên hub |
| 13.4, 13.6–13.9, 13.11 | Chưa hỏi riêng, áp đề xuất của tài liệu: một cú bấm owner (không tự chuyển credential); giữ `business_management` và đo thêm ở phiên đo; 2FA là khuyến nghị bắt buộc trong runbook. Phiên đo ≤ 6 GET, chọn app Meta, gán vai trò app và người duyệt cadence trên production là việc ngoài mã, làm khi cấu hình thật |
