# Audit Before Build — Tự phát hiện theo lịch và tự nhập vào registry (Meta, chỉ đọc) — O3

Ngày: 2026-10-27 · Baseline `c7f01ea` (S2) · working tree: chỉ `M docs/VIBEHOST_SUPPORT_REQUEST.md` ·
**Đây là bản audit, không phải bản build.** Không một dòng mã sản phẩm nào được sửa để viết tài liệu
này; không gọi Meta, không gửi Telegram, không deploy, không migration, không commit.

Đây là MINI-SPEC bước 1–3 theo `MINI_SPEC_PLAYBOOK.md`. Bước 4 (code) chỉ bắt đầu khi người dùng chốt
các câu hỏi ở §8. Khuôn tài liệu theo `docs/AUDIT_BEFORE_BUILD_SPEND.md` (S1) và
`docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` (S2).

---

## 0. Đo được gì, không đo được gì

Rule 41: mọi khẳng định về trạng thái sản phẩm dưới đây là **đo tại thời điểm viết**, kèm cách đo.

| Nguồn | Trạng thái lúc viết | Hệ quả |
|---|---|---|
| Mã nguồn | đọc trực tiếp tại `c7f01ea`; `grep` toàn `backend/app`, `backend/tests`, `frontend/src`, `docs/` | mọi `file:line` dưới đây là của commit này |
| Cơ sở dữ liệu dev (`adsops-db`, `localhost:5434`) | **đang chạy** (`scripts/dev.sh status`: backend `8001` + frontend `5173` đều `answering=yes`). Đếm bằng `psql`: `users=1`, `meta_connections=1` (**0** `production`), `business_managers=0`, `ad_accounts=0`, `business_manager_discovery_runs=0`, `discovered_*_observations=0`, `ad_account_spend_observations=0`, `operational_runs(kind=spend_sweep)=0`, `notification_deliveries(status=sent)=0`; `alembic_version=0016_s1_spend_observations` | DB dev là bản **dựng lại rỗng** (ghi chú `CLAUDE.md:27`). Mọi bằng chứng "đã chạy thật" dưới đây đến từ `TEST_LOG.md` của một DB đã không còn, và được ghi rõ ngày |
| Production (Vibe Host) | **không đo lại hôm nay.** `CLAUDE.md:25` (đo 2026-10-26): stack chỉ có project api, `list_env` không có `META_*` lẫn `RUN_DISPATCHER_IN_API` → production **không chạy dispatcher, không có credential Meta, chưa từng chạy sweep nào** | mọi "nhịp phát hiện" ở §4 là của thiết kế, không phải của hệ thống đang chạy |
| Meta Graph API | **không gọi** (rule 22) | hành vi của Meta với tài khoản **được chia sẻ từ đối tác** (`client_ad_accounts`) khi đọc node/insights, và trường `business` trên cạnh đó: **[CHƯA KIỂM]** |
| Tài liệu Meta (chỉ đọc, 2026-10-27) | `marketing-api/reference/business/client_ad_accounts/` → **HTTP 404** (lần hai sau 2026-09-10, `meta_real_provider.py:68`); `…/reference/business/client_pixels/` (v26.0) **có**; `…/reference/business/` (v25.0) **có**; `…/reference/ad-account/` **có** | trích dẫn ở §2e; bộ tóm tắt trang có thể bỏ sót — chỗ nào chỉ có tóm tắt đều ghi rõ |
| Trợ giúp Meta Business (chỉ đọc) | bài `1717412048538897` ("Give a Partner Access to Business Assets in Your Business Portfolio") và `708679622611131` ("Add Partners to Your Business Portfolio") — **chỉ tải được tiêu đề**, thân bài không render qua fetch; thứ tự bước lấy từ kết quả tìm kiếm tóm tắt trang | hướng dẫn chủ BM ở §5 đánh dấu **[CHƯA KIỂM]** ở từng nhãn menu |
| `share-projects/mb-connect`, `share-projects/ads-manager` | đọc mã 2026-10-27 (`lib/providers/meta.ts`, `lib/connections.ts`, `lib/store.ts`, `app/api/v1/**`, `app/api/oauth/meta/callback/route.ts`, `ads-manager/lib/connect/gateway.ts`, `meta-assets.ts`) | §2i, §6 |

---

## 1. Khoảng trống, nói chính xác

Người dùng (2026-10-27): đội quản lý **~30 Business Manager, mỗi BM do một người khác sở hữu**, không có
admin chung; **từ chối mọi thao tác token/env thủ công theo từng BM**. Quyết định: **"tự đọc + tự
nhập"** — khi một BM/tài khoản quảng cáo mới *nhìn thấy được*, hệ thống tự tạo những gì cần, tự nhập
tài khoản vào registry, và S1 (chi tiêu) + S2 (trạng thái) tự bắt đầu theo dõi; chỉ đọc, có audit, có tin
Telegram "phát hiện tài khoản/BM mới", có công tắc tắt.

Hai cách để sự đồng thuận **không thể bỏ** của mỗi chủ BM xảy ra:

| | Hiện tại — mô hình hub | Sau — Phase 4, mb-connect |
|---|---|---|
| Ai làm gì | Chủ BM **chia sẻ đối tác** tài khoản (và Pixel) sang **một** BM hub `1993884657458857` — BM đang có system-user token (`RUNBOOK_META_CONNECTION.md:154`) | Chủ BM bấm "Connect Meta" qua cổng `mb-connect`; sản phẩm là một **bản cài** của cổng |
| Tài sản hiện ở đâu | dưới `{hub}/client_ad_accounts` (và có thể `{hub}/client_pixels`) | là một **connection mới** đọc bằng token của chính chủ BM |
| Sản phẩm phải làm gì | quét hub theo lịch, nhập tài khoản mới, bắt đầu S1/S2 | "connection xuất hiện → quét theo lịch → tự nhập → S1/S2" — **cùng một lõi** |

Hôm nay sản phẩm **không có đường nào** làm việc đó mà không có người bấm: discovery chỉ chạy khi người
bấm (§2b), import chỉ **một dòng một lần** khi người bấm (§2b), và tiền đề ấy được ghi ở **14 chỗ**
trong mã, test và tài liệu. "Tự đọc + tự nhập" ở đây được hiểu là:

> **Theo lịch, với mỗi connection đã được chủ workspace bật "tự động", sản phẩm chạy đúng lượt discovery
> đang có (chỉ đọc), rồi nhập vào registry mọi tài khoản quảng cáo mà lượt quét đó trả về và registry chưa
> có — mỗi dòng một audit, actor là hệ thống, không bao giờ xoá/lưu trữ gì tự động — và báo một tin tóm tắt;
> S1/S2 tự tiếp quản vì tài khoản vừa nhập đã có BM và connection đọc được.**

Không phải: tự tạo tài khoản trên Meta, tự chia sẻ quyền, tự nhập Pixel (schema không cho — §2e), tự
lưu trữ tài khoản biến mất, tự đổi trạng thái đã ghi.

---

## 2. Bước 1 — Audit: cái gì đã có (kiểm trong mã, không giả định)

### 2a. Discovery hôm nay chạy thế nào

| Bước | Ở đâu | Gọi Meta |
|---|---|---|
| Route (owner-only) | `POST /meta-connections/{id}/discoveries` — `api/v1/routers/meta_operations.py:379-405`; `OwnerCtx` cho **toàn bộ** 23 route của module (`:39-44`, `docs/ACCESS_SCOPE_MATRIX.md:73`) | — |
| Chọn provider | `_provider_for` `:60-78`: thật **chỉ khi** `environment == production` **và** `resolve_reader(...) != READER_NONE`; còn lại là `_seeded_fake_provider` `:186-214` (tự gieo 2 tài khoản + 1 Pixel **giả** mang BM id thật) | — |
| Xác thực BM | `MetaDiscoveryService.validate_configured_business_manager` `services/meta_discovery.py:147-217`: `check_capability` (1 GET node BM) + `list_business_managers` (1 GET node BM) | 2 |
| Đọc tài sản | `discover_assets` `:219-289`: `identify` (`me`), `discover_ad_accounts` (2 cạnh `AD_ACCOUNT_EDGES` `meta_real_provider.py:75`), `discover_pixels` (1 cạnh `PIXEL_EDGES` `:76`); mỗi cạnh ≤ `MAX_PAGES=10` × `PAGE_SIZE=100` (`:122-123`); kết quả rỗng thì hỏi thêm `{bm}/system_users` (`:342-363`) | 3–4 (+ trang) |
| Lưu | mỗi tài sản một `DiscoveredAdAccountObservation` / `DiscoveredPixelObservation` (`meta_discovery.py:247-273`) kèm `source_edge`, `safe_metadata_json` (`account_status, currency, timezone_name` — `meta_real_provider.py:149-153`); run lưu coverage/authority/`read_as` (`models/meta_discovery.py:75-122`) | — |
| Audit | `_finish` ghi `meta_discovery.business_manager_validated` / `meta_discovery.assets_discovered` **theo run** (`meta_discovery.py:572-597`) | — |
| Giá một lượt | `AUDIT_BEFORE_BUILD_A10_3.md:247-252`: **6 GET tối thiểu / BM / lượt**, xấu nhất 33 | |

Trường tài khoản đang xin: `AD_ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name"`
(`meta_real_provider.py:79`) — **không có `business`** (BM sở hữu), xem §2e.

### 2b. Tiền đề "chỉ khi người bấm" — mọi nơi đang nói ra điều đó

O3 là lần **thứ hai** (sau S1) phá tiền đề này, và là lần đầu phá nó cho **ghi vào registry**. Từng nơi
phải được viết lại, không để câu cũ đứng cạnh hành vi mới:

| # | Nơi | Câu đang nói |
|---|---|---|
| 1 | `core/enums.py:518-528` (`DiscoveryTrigger`) | *"`scheduled_reconciliation` is deliberately absent: A10.1 only runs when a person asks, so there is no code path that could start one on a timer"* — chỉ có `MANUAL`, `INTERNAL_TEST` |
| 2 | `routers/meta_operations.py:381-388` (`run_discovery`) | *"Only ever runs because an operator asked: there is no timer, no page-load trigger and no retry"* (đã chua thêm S1) |
| 3 | `services/meta_real_provider.py:224-226` (`check_capability`) | *"Never runs on a page load or a timer — only when an operator explicitly asks"* |
| 4 | `services/meta_discovery.py:296-300` (`import_ad_account`) | *"One row at a time, never automatic. … Collapsing the two would turn every scan into a silent writer, and A10.1 deliberately shipped with no such path"* |
| 5 | `schemas/meta_operations.py:38-45` (`DiscoveryImportRequest`) | *"Deliberately not a list: an import writes a registry record this workspace is then answerable for, so each one is its own decision with its own audit row"* |
| 6 | `routers/meta_operations.py:533-541` (`import_discovered_ad_account`) | *"the operator is acting on a result they are looking at"* |
| 7 | `docs/META_READ_ONLY_DISCOVERY.md:138-140` | *"an explicit, per-row import. Never automatic, never in bulk"* |
| 8 | `docs/META_READ_ONLY_DISCOVERY.md:253-254`, `:264` | *"Every **discovery** call is explicit — a person pressed a button"*; `refresh` *"is human-initiated like discovery"* |
| 9 | `docs/RUNBOOK_META_CONNECTION.md:197-199` | *"Mọi cú gọi discovery đều là tường minh — do người bấm nút, hoặc do người chạy probe. Không có gì poll"* |
| 10 | `docs/AUDIT_BEFORE_BUILD_A10.md:72-75` | *"never on a page load, never on a timer"* (đã chua S1) |
| 11 | `docs/AUDIT_BEFORE_BUILD_A10_3.md:244`, `:265-266` | *"discovery stays one connection per request, operator-initiated"*; *"an operator-initiated import, per row, confirmed … never automatic"* |
| 12 | `FEATURES.md:52-53`, `:143` | *"Discovery never writes to the registry by itself. Importing is one row, one action, one audit record, always explicit"*; S1 là *"The first Meta read in the product that is not human-initiated"* |
| 13 | `docs/MINI_SPEC_A10_1_REPORT.md:114`; `docs/AUDIT_BEFORE_BUILD_O1_1.md:166-167` | *"No timer, no page-load"*; *"No auto-import, no bulk import"* |
| 14 | Test ghim | `test_a10_3_registry_import.py:241` (`test_the_import_makes_no_provider_call`), `:149` (nhập hai lần → `409`), `:196` (body thừa field bị từ chối); `test_a10_1_discovery_api.py:147`, `:255`; `test_o1_1_discovery_workspace.py:162` — đều khẳng định **đọc không gọi provider**; không test nào ghim "không có trigger tự động" ngoài giá trị enum |

`ARCH.md` không có câu nào về điều này (grep `human-initiated|never automatic|on a timer`: 0 kết quả).

### 2c. Ngữ nghĩa `coverage_status` — một lượt quét tự động được kết luận gì

Đây là hợp đồng O3 phải thừa kế nguyên vẹn (`services/meta_provider.py:237-276`, `docs/META_READ_ONLY_DISCOVERY.md:35-45`):

| `coverage_status` | Khi nào | Được kết luận **vắng mặt**? | Được kết luận **có mặt**? |
|---|---|---|---|
| `complete` | mọi cạnh bắt buộc trả lời, không `truncated`, **và** (nếu rỗng) authority `established` | **có** | có |
| `partial` | `rate_limited` / `provider_server_error` / `timeout` / chạm trần trang | không | có — tài sản đã trả về là đã quan sát |
| `incomplete` | `permission_missing` / `not_supported` / cạnh bắt buộc chưa hỏi | không | có |
| `unknown` | lỗi không phân loại được, **hoặc rỗng mà không chứng minh được quyền** (`:263-269`) | không | (không có gì để có) |
| `not_attempted` | chưa hỏi loại tài sản | không | không |

Thứ tự reconcile (`meta_discovery.py:434-475`): không id → `unknown`; có trong union → `matched`; không
có BM mapping / khác BM → `out_of_scope`; coverage không `complete` → `unknown`; còn lại →
`missing_from_latest_discovery`. **Import không gate theo coverage hay authority** (`:302-307`;
`test_an_account_from_an_incomplete_run_can_still_be_imported` `:214`) — có mặt không cần kiểm kê đầy đủ,
chỉ vắng mặt mới cần. Hệ quả cho O3: **một lượt tự động được phép nhập mọi tài khoản nó trả về, nhưng
tuyệt đối không được dùng `missing_from_latest_discovery` để làm gì ngoài báo hiệu** — và chỉ khi `complete`.

Một điểm nữa: `missing_from_latest_discovery` **chỉ nghĩa là "không được trả về trong lần quét hoàn chỉnh
gần nhất"**, không phải Meta xoá/khoá (`META_READ_ONLY_DISCOVERY.md:197-204`). Lượt quét bằng token hẹp hơn
vẫn `complete` một cách trung thực (`:72-79`), nên tự động hoá kết luận vắng mặt là nhân một kết luận
có điều kiện lên 30 lần mỗi ngày.

### 2d. Import ghi gì — và một lần nhập hàng loạt sẽ kéo theo gì

Chuỗi một lần `import_ad_account` (`meta_discovery.py:293-360`), **tất cả trong một transaction**:

```
import_ad_account(run, external_id)
 ├─ canonical_external_id; observation PHẢI thuộc run này            :313-329  (không thì 404)
 ├─ _registry_business_manager(run)                                  :362-401
 │    └─ BusinessManager theo configured_business_manager_reference; tạo nếu chưa có
 │       + audit business_manager.created                             :394-400
 ├─ AdAccountRegistryService.create(...)                             services/registry.py:210-227
 │    ├─ _assert_external_id_unique  (KHÔNG lọc archived)            :195-208 → ConflictError 409
 │    ├─ audit ad_account.created                                     :219-224
 │    ├─ checklists.initialise(account)  (+ audit)                    :225; checklist.py:40-66
 │    └─ rollup.evaluate(account)  → readiness `unknown`              :226
 ├─ evaluate_account_safe(trigger=ACCOUNT_MUTATION)                   :341-345 (SAVEPOINT, rule 15)
 │    └─ luật 5 attention · luật 8 attention · luật 9 **warning** · luật 11 attention nếu observable
 │       → alert info · info · **warning** · info  → deliveries (plan)    alert_rules.py:24-29; ALERT_POLICY_V1 §1
 └─ audit meta_discovery.ad_account_imported {run, BM ref, source_edge, read_as}   :349-359
```

Đo thật ngày 2026-09-14 (`TEST_LOG.md:2777-2800`): hai tài khoản **owned** nhập bằng tay → `audit_logs`
28 → 56 (**14 dòng audit / tài khoản**), *"checklist initialised, three health signals opened, snapshot
changed, three alerts created, three notifications skipped (Telegram not configured)"*. Ba tín hiệu đó
theo bảng `docs/HEALTH_RULES_V1.md:13-24` là luật 5 (`mandatory_readiness_evidence_missing`, attention),
8 (`readiness_unknown`, attention), 9 (`manual_review_due_or_stale`, **warning** — *"This account has never
been manually reviewed"*, `health_rules.py:342-371`); từ S1 có thêm luật 11 (`spend_observation_missing_or_stale`,
attention) **ngay lúc nhập** nếu tài khoản có connection đọc được (`:451-460`: `never_observed`).

**Hệ quả ở quy mô 30 BM × N tài khoản** (N = 5 để có số; không phải số đo):

| Thứ sinh ra ở lượt nhập đầu | Mỗi tài khoản | 150 tài khoản | Ghi chú |
|---|---|---|---|
| `ad_accounts` + checklist items + snapshot | 1 + k + 1 | 150 + 150k | k = số item mặc định của `DEFAULT_CHECKLIST` |
| Dòng audit | ~14 | ~2 100 | theo đo 2026-09-14 |
| Tín hiệu sức khoẻ | 4 (3 attention + 1 warning) | 600 | |
| Alert Center | 4 | 600 | 450 `info` + 150 `warning` |
| **Ứng viên Telegram** | **1** (luật 9 `warning`; `warning_telegram_enabled=true` mặc định, `ALERT_POLICY_V1.md:60`) | **150 tin**, dồn về cuối giờ yên lặng | đây là cơn bão; `attention`/`info` không gửi |
| Hàng đợi S1 | 1 tài khoản `never_observed` | 150 → với `SPEND_SWEEP_BATCH=10`/giờ: **15 giờ** mới đọc hết lượt đầu; 2 GET/tài khoản | mỗi tài khoản lại một tín hiệu luật 11 cho tới khi được đọc |
| GET Meta/ngày sau đó | 2 × 24/26 | ≈ 280/ngày ở `26h`; ≈ 3 600/ngày ở `2h` (quyết định S2 §7 6.1) | hạn mức thật **[CHƯA KIỂM]** (S1 §2e) |

Hai đòn bẩy **đã có sẵn, không cần code** để giảm bão: (a) chủ workspace tắt luật 9 bằng
`PATCH /account-health/rules/manual_review_due_or_stale` (`routers/health.py:500-524`, `WriteCtx`, commit `a8392b6`);
(b) `telegram_chat_id = null` mặc định → mọi tin `skipped: no_recipient_configured` (`ALERT_POLICY_V1.md:63`, `:100`).
Cả hai đều là tắt **cả workspace**, không riêng cho tài khoản mới nhập — xem §4b "kiểm soát bão".

**Dedupe/idempotence hiện có**: `unique(workspace_id, external_account_id)` (`models/entities.py:128`) +
`_assert_external_id_unique` **không lọc `archived_at`** (`registry.py:198-204`) → nhập lại tài khoản đã
có **hoặc đã lưu trữ** đều `409`. Nhưng `reconcile_ad_accounts` chỉ nạp tài khoản **chưa archived**
(`meta_discovery.py:420-429`) → một tài khoản đã lưu trữ mà Meta vẫn trả về hiện là `missing_in_registry`.
Một vòng tự nhập ngây thơ sẽ **thử nhập lại nó mỗi lượt và ăn `409` mỗi lượt** — và một vòng "thông minh"
hơn có thể cám dỗ tự `restore`, điều rule 2 và tinh thần "registry là quyết định của workspace" không cho.

### 2e. Cạnh `client_ad_accounts` — token hub đọc được gì cho một tài khoản chia sẻ

| Câu hỏi | Trạng thái | Bằng chứng |
|---|---|---|
| Cạnh có trả lời với system-user token của hub không? | **Đã kiểm, live** | `TEST_LOG.md:2050-2062` (2026-09-10): 4 tài khoản chia 2–2, hai tài khoản `client_ad_accounts` có **tên** (`Quàng Chính`, `Vũ Hiếu`); `CLAUDE.md:20` run `8d153a28…` 5 owned + 3 client. Cùng quyền với các cạnh khác (`meta_real_provider.py:68-69`) |
| Tài khoản client có nhập được vào registry không? | **Đã kiểm trong test**, chưa click-through live với tài khoản client | `test_a_second_import_reuses_the_business_manager` nhập `"222"` từ `client_ad_accounts` (`test_a10_3_registry_import.py:97-118`); hai tài khoản nhập thật ngày 2026-09-14 đều **owned** (`TEST_LOG.md:2789`) |
| Nhập xong, `business_manager_id` trỏ vào BM nào? | **BM hub** — `_registry_business_manager(run)` dùng `run.configured_business_manager_reference` (`meta_discovery.py:373`), không phải BM sở hữu | hệ quả tốt: S1 tìm connection theo `account.business_manager.external_id` (`spend_service.py:107-124`) → tài khoản client **observable qua connection hub ngay sau khi nhập**; hệ quả xấu: registry nói "thuộc BM hub" trong khi thật ra thuộc BM khác |
| Có biết BM **sở hữu** từ cạnh client không? | **[CHƯA KIỂM]** | `AD_ACCOUNT_FIELDS` không xin. Trang reference AdAccount (đọc 2026-10-27) có trường **`business`** — *"The Business Manager, if this ad account is owned by one"* (kiểu `Business`) — và **`owner`** — *"The ID of the account owner"* (numeric string). AdsCommand đã dùng `business{name}` trên `/me/adaccounts` (`share-projects/ads-manager/lib/connect/meta-assets.ts:32-33`). Có xin được trên `{hub}/client_ad_accounts?fields=…,business{id,name}` với token hub hay không: **chưa ai gọi** |
| Token hub đọc được **node** `act_<id>` + **`/insights`** của tài khoản client không (S1/S2)? | **[CHƯA KIỂM]** — **chưa có bất kỳ lần đọc chi tiêu thật nào**, kể cả cho tài khoản owned | `TEST_LOG.md:3175-3179`: *"No live Meta read… The spend sweep has never run outside pytest"*; `:3202` chỉ là test. Trang AdAccount không nêu quyền đọc node; hướng dẫn chia sẻ Pixel của Meta (đọc 2026-10-27) ghi đọc tài khoản chia sẻ cần `business_management`/`ads_management`/`ads_read` — token hub có hai trong ba (`RUNBOOK:22`). Thêm một tầng chưa rõ: system user **chỉ thấy tài sản được gán cho nó** (`RUNBOOK:60-62`); hai tài khoản client ngày 2026-09-10 **đã** hiện với system user, nên ít nhất gán được để *liệt kê*; đọc node/insights là câu hỏi khác |
| Pixel trên cạnh client? | **Không đọc hôm nay** | discovery chỉ đọc `adspixels` (`PIXEL_EDGES`, `meta_real_provider.py:76`). Trang node Business (v25.0, đọc 2026-10-27, bản tóm tắt) liệt kê `adspixels` — *"The business has access to these pixels"*, `client_pixels` — *"This business has access to these client pixels"*, `owned_pixels` — *"This business owns these pixels"*, `pending_client_ad_accounts`, `pending_owned_ad_accounts`. Trang `client_pixels` (v26.0): *"This business has access to these client-owned pixels"*, không tham số, trả `AdsPixel` kèm `permitted_tasks`. **`adspixels` có gồm Pixel được chia sẻ không: [CHƯA KIỂM]** (TEST_LOG 2026-09-11 đếm 7/5 Pixel theo vai trò, không tách sở hữu) |
| Pixel nhập được vào registry không? | **Không**, là giới hạn schema | `Pixel` không có quan hệ BM (`META_READ_ONLY_DISCOVERY.md:152-154`, `:206-222`); import *"offers nothing for Pixels"*. O3 **chỉ có thể báo** Pixel mới, không nhập |

(Bản tóm tắt trang Business node **không** nêu `owned_ad_accounts`/`client_ad_accounts`; trang reference
riêng của `client_ad_accounts` trả 404. Cạnh vẫn trả lời live — bằng chứng 2026-09-10 là thứ đáng tin
hơn bộ tóm tắt, và đúng tinh thần `AUDIT_BEFORE_BUILD_A10_3.md:98-100`.)

### 2f. Lịch chạy và actor — khuôn đã có

| Mảnh | Ở đâu |
|---|---|
| Vòng lặp một container, pass theo cadence `every_n_passes`, **0 = tắt** mặc định | `commands/run_dispatcher.py:373-421`; `core/config.py:128-158` (docstring S1 nói rõ "release decision with a named approver") |
| Khuôn một sweep: duyệt workspace → chọn đến hạn → làm → `OperationalRun` + counters trong `SAFE_SUMMARY_KEYS` (khoá lạ **bị bỏ lặng**) | `run_dispatcher.py:159-239` (health), `:242-370` (spend); `services/operations.py:27-39` |
| Dừng theo connection khi `rate_limited`; `due_remaining` | `run_dispatcher.py:301-305`, `:325-327` |
| Lệnh tay một lượt trước khi bật cadence | `--health-sweep`, `--spend-sweep` (`:454-466`) |
| **Actor cho audit ngoài request = thành viên đầu tiên** của workspace, `None` nếu không có | `run_dispatcher.py:277-283` (`:187-193` cho health) — mọi service trên đường này **đã chấp nhận `actor=None`** |
| `AuditLog.actor_id` **nullable** | `models/entities.py:429`; `AuditLogService(session, ws, actor_id: uuid.UUID \| None)` `services/audit.py:21` |
| `BusinessManagerDiscoveryRun.created_by` nullable | `models/meta_discovery.py:124` |
| Follow-up đã ghi: "system actor sạch hơn" | `AUDIT_BEFORE_BUILD_SPEND.md:195-196`; `ROADMAP_COMMERCIAL.md:144` |
| Dispatcher container **chưa có `META_*`** trong compose; S1 đã yêu cầu cấp | `docker-compose.production.yml:120-131`; `PRODUCTION_ENVIRONMENT.md:91-93`; `.env.example:86-89` |
| Một connection cho mỗi BM: `production`, reader ≠ `none`, ưu tiên connection tự khai BM, rồi cũ nhất | `spend_service._connections_by_business` `:75-104` |
| Độ mới của một run discovery | hằng `DISCOVERY_STALE_AFTER = 24h` trong **router** (`meta_operations.py:106-116`), không phải `Settings` |

Rule 3 với actor hệ thống: không có **user giả** nào trong mã (grep `system_user|is_service|service_account`
trong `models/`, `bootstrap.py`: 0 kết quả); `bootstrap.py:40-59` chỉ tạo một owner thật từ env. Mẫu
"thành viên đầu tiên" đang **ghi tên một người cho việc người đó không làm** — S1 chấp nhận vì theo tiền lệ;
O3 ghi vào registry nên không nên tiếp tục (§4b).

### 2g. Cấu hình hub hôm nay

`META_BUSINESS_ID='1993884657458857'` là BM hub (`RUNBOOK:154`); production **không có** biến này lẫn token
(`CLAUDE.md:25`). DB dev: 1 connection, **0** `production`. Vậy "connection hub đang có" (`AUDIT_BEFORE_BUILD_SPEND.md:499`)
là của một DB đã mất; trước khi O3 chạy thật phải tạo lại connection `production` trỏ `1993884657458857` —
việc vận hành, không phải mã.

### 2h. Giao diện hiện có

| Bề mặt | Hiện gì | Ở đâu |
|---|---|---|
| Meta connections (danh sách thẻ) | badge môi trường, `ReaderSourceBadge`, nút Check capability, form tạo | `pages/MetaConnections.tsx:11-30`, `:32-93` |
| Connection workspace (O1.1) | tab `Overview · Ad Accounts · Pixels · Discovery History`; cảnh báo authority; per-row Add-to-registry có xác nhận | `pages/MetaConnectionWorkspace.tsx:13-18`, `:206-213`; `components/meta/AssetInventory.tsx`; `MINI_SPEC_O1_1_REPORT.md:80` |
| History tab | in `run.trigger` **dạng chuỗi thô** cạnh `read_as` | `pages/meta-connection/HistoryTab.tsx:86` |
| Account detail | `imported_from_discovery` suy từ audit row (run, BM ref, edge, thời điểm) — **không có** "nhập tự động" hay "BM sở hữu" | `AUDIT_BEFORE_BUILD_IMPORT_PROVENANCE.md` §3 |
| Khái niệm "tự động" | **không có ở đâu** | grep `auto` trong `components/meta`, `pages/MetaConnection*`: 0 |

### 2i. mb-connect — hợp đồng đo được (ảnh hưởng hình dạng O3, không nằm trong O3)

Đọc mã 2026-10-27 (chi tiết đầy đủ ở `ROADMAP_COMMERCIAL.md` §4.2):

- Endpoint v1 của cổng: `POST connect/start`, `POST connections/:id/confirm`, `GET connections/:id`
  (trả `status, provider, createdBy, scopes, metaBusinessId` — `lib/store.ts:114-115`), `DELETE connections/:id`,
  `POST token`, `GET install`. **Không có** endpoint liệt kê connection, **không có** webhook → "một
  connection xuất hiện" chỉ được biết vì **chính sản phẩm là bên gọi `confirm`**.
- Callback Meta **không ghi `metaBusinessId`** (`app/api/oauth/meta/callback/route.ts:49` chỉ truyền
  `metaUserId`) → BM phải được **khám phá sau** (`me/businesses`, `meta_real_provider.py:212-221` đã có
  nhánh cho user token) rồi người chọn.
- Một bản cài = **một** connection active mỗi provider (`lib/connections.ts:2-4`; `README.md:69`).
- Cổng đòi scope `ads_management` (`lib/providers/meta.ts:11`, kiểm lại mỗi lần cấp `lib/connections.ts:232`).
- Token Meta qua cổng là token **không hết hạn**, cấp lại mỗi giờ sau `debug_token` (`lib/connections.ts:14-16`).

---

## 3. Bước 2 — Khoảng trống và ranh giới (từ vựng của playbook)

| # | Khoảng trống | Loại | Trong O3? |
|---|---|---|---|
| G1 | `DiscoveryTrigger` không có giá trị cho lượt theo lịch; `OperationalRunKind` không có `discovery_sweep`; không có từ vựng cho **quyết định tự nhập** (`imported / already_in_registry / archived_in_registry / conflict / skipped`) | `vocabulary` | có — thêm enum, **không migration** (`sa.Enum(native_enum=False)` không sinh CHECK — S1 §2b) |
| G2 | Tiền đề "chỉ người bấm" ở 14 chỗ (§2b) | `architecture` | có — viết lại, không để câu cũ đứng cạnh hành vi mới |
| G3 | Không có pass dispatcher nào gọi discovery; `DISCOVERY_STALE_AFTER` là hằng trong router, không phải `Settings` | `architecture` | có |
| G4 | Không có công tắc nào nói connection này **được phép** tự quét / tự nhập; không có chỗ ghi **ai bật, lúc nào** | `data_model` | có — migration `0017`, hai cột boolean + ai/lúc nào trên `meta_connections` |
| G5 | Audit ngoài request ghi tên "thành viên đầu tiên"; không có actor hệ thống | `data_model` / `security` | có — `actor_id = NULL` + `metadata.actor = "system:discovery_sweep"`; không tạo user giả |
| G6 | Tài khoản archived mà Meta còn trả về → `missing_in_registry` → vòng tự nhập sẽ `409` mỗi lượt; không có khái niệm "đã lưu trữ nhưng Meta vẫn thấy" | `state_machine` | có — bảng suy giảm §4b |
| G7 | Không có cách biết BM **sở hữu** tài khoản client; registry gán tài khoản client vào BM hub | `data_model` / `API` | một nửa — xin thêm `business{id,name}` vào `AD_ACCOUNT_FIELDS` **[CHƯA KIỂM]**, lưu ở `safe_metadata_json` + audit, **không** tạo BM row cho BM sở hữu (lý do §4b) |
| G8 | Nhập hàng loạt lần đầu = 1 tin Telegram `warning`/tài khoản (luật 9) + 3 alert `info`/tài khoản; không có tin tóm tắt "phát hiện mới" | `observability` / `security` (nhiễu) | có — tin tóm tắt theo lượt + thời gian ân hạn cho delivery từ tài khoản tự nhập |
| G9 | Không có API/UI bật-tắt tự động, không badge "auto", History in `trigger` thô, provenance không nói "tự động"/"chia sẻ từ BM …" | `API` / `frontend_UX` | có |
| G10 | `SAFE_SUMMARY_KEYS` thiếu counters mới (`connections_due, runs, imported, already_in_registry, archived_returned, conflicts, pixels_new, not_returned_complete`) | `observability` | có |
| G11 | Pixel: không đọc `client_pixels`; không nhập được Pixel (schema) | `data_model` | **không** — chỉ báo số Pixel mới trong tin tóm tắt; đọc `client_pixels` là follow-up riêng |
| G12 | Dispatcher container chưa có `META_*`; production chưa có dispatcher | `deployment` | không sửa gì mới — là điều kiện S1 đã nêu (`PRODUCTION_ENVIRONMENT.md:91-93`) |
| G13 | Không fixture nào có tài khoản client + run theo lịch + tài khoản archived tái xuất; không test "nhập tự động không bao giờ đến từ connection `fake`" | `testing` | có |
| G14 | Tài liệu: `META_READ_ONLY_DISCOVERY.md` §Importing + §Bounds, `RUNBOOK` §6, `FEATURES/ARCH/API/TEST_LOG`, `ALERT_POLICY_V1.md` §6 (skip reason mới), `PRODUCTION_ENVIRONMENT.md` | `deployment` / tài liệu | có (bước 6) |

**Lỗi không liên quan → follow-up, không phải phạm vi:**

- `meta_operations.py:1-7` docstring module vẫn nói *"No route here calls a real Meta API"* — sai từ A10. Sửa câu.
- `ALERT_POLICY_V1.md:146-152` "No scheduler" và "No real message has ever been sent" — câu đầu lỗi thời từ A4.
- `README.md` của `mb-connect` ghi bước Meta "chưa" trong khi mã đã có (đã ghi ở S1 §3).
- `HistoryTab.tsx:86` in `trigger` thô — O3 sửa vì cần badge; ghi để biết là lỗi có sẵn.
- `AssetReconciliationStatus.METADATA_MISMATCH` vẫn là từ vựng chết (S2 §8c).

---

## 4. Bước 3 — Thiết kế

### 4a. Ba ứng viên

| | **A — Discovery sweep + tự nhập theo connection (đề xuất)** | B — Tự nhập **sau** lượt discovery do người bấm | C — Theo dõi không cần registry (S1/S2 đọc thẳng từ observation) |
|---|---|---|---|
| Cách làm | Pass mới `discovery_sweep_pass` trong dispatcher: với mỗi connection `production` + reader + **`auto_discovery_enabled`**, chạy đúng `MetaDiscoveryService` hiện có với `trigger=scheduled_sweep`, rồi (nếu **`auto_import_enabled`**) nhập mọi `missing_in_registry` của **run đó** qua `import_ad_account`; một tin tóm tắt | Giữ discovery thủ công; thêm cờ "sau khi quét, nhập hết tài khoản mới" | Bỏ bước nhập: sweep S1/S2 chọn tài khoản từ `discovered_ad_account_observations` thay vì `ad_accounts` |
| Đáp ứng "tự đọc + tự nhập"? | **có** | **không** — vẫn cần người bấm cho từng BM, 30 lần/ngày | đọc có, **nhập không**; mọi màn A1 (checklist, readiness, assignment A9, extension A5 — khớp theo registry) không thấy tài khoản |
| Tái dùng | engine discovery, coverage, authority, import, audit, health chain — **không viết lại gì** | như A | phải viết lại `select_due_accounts`, `HealthFacts`, scope A9, extension context |
| Chạm tiền đề | có — một chỗ, nói rõ, tắt mặc định, có công tắc theo connection | không (là ưu điểm duy nhất) | có, và phá luôn ranh giới "registry là điều workspace chịu trách nhiệm" (`META_READ_ONLY_DISCOVERY.md:138-140`) |
| Lắp mb-connect sau | connection là đơn vị → một nguồn connection nữa là đủ (§6) | không giúp gì | không liên quan |
| Kết luận | **chọn** | **bỏ** — không giải quyết yêu cầu; nhưng nút "Import all new (N)" trên UI là biến thể rẻ, ghi làm follow-up | **bỏ** — đổi mô hình dữ liệu nền, xoá ranh giới đã có lý do |

Biến thể **D — tự tạo BM row cho BM sở hữu tài khoản client và gán tài khoản vào đó**: bỏ trong O3.
`AdAccount.business_manager_id` là **khoá tìm connection đọc** (`spend_service.py:107-124`): gán vào BM sở
hữu (không có connection nào đọc BM đó) → tài khoản thành `not_observable` → S1/S2 **không bao giờ bắt
đầu** — đúng điều người dùng không muốn. BM sở hữu là **provenance**, không phải quan hệ đọc (§4b).

### 4b. Thiết kế A — chi tiết

**Hai công tắc độc lập, hai người khác nhau** — cùng lý lẽ `_provider_for` (`meta_operations.py:63-68`):

1. **Cadence trong môi trường** (deployment): `DISCOVERY_SWEEP_EVERY_N_PASSES` (**mặc định 0 = tắt**), đặt `>0`
   trên production là **quyết định phát hành có tên người duyệt**, ghi `TEST_LOG.md` (rule 22; tiền lệ S1 §6.7).
2. **Cờ theo connection** trong DB (owner): `auto_discovery_enabled`, `auto_import_enabled` — **mặc định `false`
   trong mã**. Người dùng muốn "bật": bật là **một hành động có tên** — `PATCH …/automation` của owner, lưu
   `automation_enabled_by` + `automation_enabled_at` trên dòng và audit `meta_connection.automation_changed`
   với actor thật. Đó chính là "phê duyệt có tên" cho connection ấy; không có cờ mặc định nào "trôi" sang bật.

Không cái nào một mình gọi được Meta hay ghi được registry. Connection `fake`/`sandbox` **không bao giờ**
đủ điều kiện (như `_connections_by_business`), nên tài khoản giả của `_seeded_fake_provider` không thể vào registry.

**Từ vựng (G1)** — thêm enum, không migration:

- `DiscoveryTrigger.SCHEDULED_SWEEP = "scheduled_sweep"` (docstring `enums.py:518-528` viết lại).
- `OperationalRunKind.DISCOVERY_SWEEP = "discovery_sweep"`.
- `AutoImportDecision` (StrEnum Python, **không cột**): `imported · already_in_registry · archived_in_registry ·
  conflict · skipped_import_disabled · skipped_run_unusable`.
- Audit actions mới: `meta_discovery.ad_account_auto_imported` (mỗi tài khoản, cùng metadata với
  `ad_account_imported` + `decision`, `owner_business_reference`), `meta_discovery.sweep_pass_recorded`
  (mỗi workspace mỗi lượt — tiền lệ `spend.observations_recorded`, `run_dispatcher.py:340-346`).

**Dữ liệu (G4, G5, G7)** — migration `0017_o3_connection_automation`, cộng thêm, chỉ `meta_connections`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `auto_discovery_enabled` | bool, `default=False`, `server_default=false` | connection này được quét theo lịch |
| `auto_import_enabled` | bool, như trên | lượt quét theo lịch được nhập tài khoản mới; chỉ có nghĩa khi cờ trên bật |
| `automation_enabled_by` | uuid, nullable | ai bật lần gần nhất (người thật) |
| `automation_enabled_at` | tz, nullable | lúc nào |

**Không** cột nào trên `ad_accounts`, `business_managers`, `*_observations`, `*_runs`. BM sở hữu (nếu
đọc được): `AD_ACCOUNT_FIELDS` thêm `business{id,name}` **[CHƯA KIỂM]** → `_ad_account_from_row` giữ
`owner_business_id`, `owner_business_name` vào `safe_metadata` (allowlist, đã là `dict[str,str]`) →
`import_ad_account` chép vào metadata của audit row → `imported_from_discovery` (đã suy từ audit,
`AUDIT_BEFORE_BUILD_IMPORT_PROVENANCE.md` §3) thêm hai trường. Derive, không store — cùng tiền lệ. Nếu Meta
không trả trường này cho cạnh client, metadata không có khoá đó và UI nói "BM sở hữu: không được trả về",
không đoán.

**Actor (G5, rule 3)**: pass chạy `AuditLogService(session, workspace.id, actor_id=None)` và mọi audit row
của pass mang `metadata.actor = "system:discovery_sweep"` + `metadata.operational_run_id`. `actor_id` đã
nullable (`entities.py:429`); không tạo user giả (rule 1/10 không bị chạm). **Bỏ** mẫu "thành viên đầu
tiên" trong pass mới; S1/A4 giữ nguyên (ngoài phạm vi). `BusinessManagerDiscoveryRun.created_by = NULL`,
`trigger = scheduled_sweep` là cách phân biệt trên History. `AuditLog.tsx` hiển thị actor rỗng ra sao:
**[CHƯA KIỂM]** — nếu in trống thì thêm nhãn "System" từ metadata.

**Sweep (G3, G10)** — `discovery_sweep_pass(batch)` trong `run_dispatcher.py`, cùng khuôn `spend_sweep_pass`:

1. Cadence `discovery_sweep_every_n_passes` (mặc định **0**), `discovery_sweep_batch` (mặc định **5 connection /
   workspace / lượt**), `discovery_stale_after_hours` (mặc định **24**, **thay** hằng `DISCOVERY_STALE_AFTER`
   trong router để sweep và badge độ mới đồng ý theo cấu trúc — tiền lệ `AUDIT_BEFORE_BUILD_SCHEDULED_HEALTH.md` §8).
2. Chọn: connection chưa archive, `production`, `resolve_reader != none`, `auto_discovery_enabled`, có BM id
   (`connection_business_id` khác rỗng), và run gần nhất **chưa** `completed_at` trong cửa sổ (chưa từng chạy xếp
   trước — rule 28, đếm riêng `never_discovered` / `stale`). Connection không có BM → đếm `not_configured`, không
   gọi gì (như `validate_configured_business_manager:174-184`).
3. Mỗi connection: `validate_configured_business_manager(trigger=SCHEDULED_SWEEP, actor_id=None)` → nếu
   `SUCCEEDED` thì `discover_assets`. Mã lỗi `rate_limited` ở bất kỳ GET nào → **dừng các connection còn lại
   của lượt**, đếm `rate_limited`, `due_remaining`. Không ngủ, không retry.
4. **Tự nhập** (chỉ khi `auto_import_enabled` và run `succeeded`/`succeeded_with_warnings`): với mỗi hàng
   `missing_in_registry` loại `ad_account` của **run này** (reconcile ad accounts), gọi `import_ad_account` trong
   **SAVEPOINT riêng từng tài khoản** — một `ConflictError` (đua unique) không làm hỏng các tài khoản khác;
   trước đó tra **cả hàng archived** cùng canonical id (query mới, vì reconcile không nạp archived): có → quyết
   định `archived_in_registry`, **không nhập, không restore**. Mỗi tài khoản nhập xong vẫn đi qua
   `evaluate_account_safe` như hôm nay (rule 15/21).
5. Ghi `OperationalRun(kind=DISCOVERY_SWEEP, summary={never_discovered, stale, runs, succeeded, warnings, failed,
   rate_limited, not_configured, imported, already_in_registry, archived_returned, conflicts, pixels_new,
   not_returned_complete, due_remaining, workspaces})` — thêm các khoá mới vào `SAFE_SUMMARY_KEYS`.
6. Audit theo lượt/workspace `meta_discovery.sweep_pass_recorded` với counters + danh sách `ad_account_id` đã nhập.
7. Lệnh tay `python -m app.commands.run_dispatcher --discovery-sweep` (một lượt rồi thoát) để chạy thử trước khi bật cadence.

Giá: ~6 GET / BM / lượt. **Mô hình hub = 1 connection** → ~6 GET/ngày ở cadence 24h. Nếu sau này 30 connection
(mb-connect) → ~180 GET/ngày; hạn mức thật **[CHƯA KIỂM]**, sweep tự bảo vệ bằng `rate_limited` → dừng lượt.

**Vắng mặt: chỉ báo hiệu, không bao giờ lưu trữ (rule 2, §2c)**. Luật sức khoẻ mới, `v1`, registry 18 → 19:

| `rule_key` | Category | Severity | Nổ khi | Đóng khi |
|---|---|---|---|---|
| `account_not_returned_by_latest_discovery` | data_quality | `attention` | tài khoản có BM mapping tới BM của một connection **có** run `complete` (ad accounts) hoàn thành trong `discovery_stale_after_hours`, và tài khoản **không** nằm trong observations của run đó (đúng nhánh `missing_from_latest_discovery`, cùng thứ tự `meta_discovery.py:434-475`) | run `complete` mới hơn trả về nó; hoặc không còn run `complete` trong cửa sổ (→ không nổ, không phải "đã ổn"); hoặc người lưu trữ tài khoản bằng tay |

`HealthFacts` thêm `discovery: DiscoveryFacts | None` (run id, completed_at, read_as, `returned: bool`), lắp
trong `_facts` từ DB — một query. Evidence: `discovery_run_id`, `business_manager_reference`, `read_as`,
`coverage_status`, `message` = *"Not returned by the latest completed discovery (run … as …). This says nothing
about whether Meta removed or restricted it."* `source_type=PROVIDER_OBSERVATION`. `attention` → alert `info`,
không Telegram, đúng mức của một kết luận có điều kiện. Bước tiếp theo luôn thủ công (`META_READ_ONLY_DISCOVERY.md:203-204`).

**Kiểm soát bão lần nhập đầu (G8)** — ba lớp, đều ghi được ra:

1. **Tin tóm tắt một lượt** (cái người dùng xin: "phát hiện tài khoản/BM mới"): một `Alert` mới mỗi lượt mỗi
   connection **khi có gì để nói** (`imported > 0` hoặc `archived_returned > 0` hoặc `pixels_new > 0` hoặc
   `not_returned_complete > 0`), `AlertSourceType.DISCOVERY_SWEEP` (enum, không migration), `ad_account_id = NULL`
   (cột đã nullable, `models/alerts.py:92`), key `discovery_sweep:{connection_id}:{run_id}`. Nội dung allowlist:
   nhãn connection, BM ref + tên, `read_as`, 4–5 bộ đếm, tối đa 10 external id mới (BM sở hữu nếu có), coverage.
   Mẫu tin **`a3-v1-summary`** mới vì `a3-v1` bắt buộc có dòng `Account:` (`notification_templates.py:38`, `:130`).
   Severity: đề xuất **`warning`** (để đi Telegram theo policy hiện có, tôn trọng giờ yên lặng) — phương án thay
   thế là cờ policy riêng `discovery_summary_telegram_enabled` (migration thêm `notification_policies`). Câu hỏi §8.3.
2. **Ân hạn cho tài khoản tự nhập**: planner bỏ qua delivery (`skipped`, lý do mới **`auto_import_grace`**) cho
   alert `warning` của tài khoản có audit `ad_account_auto_imported` trong `AUTO_IMPORT_TELEGRAM_GRACE_HOURS`
   (mặc định 24). `critical` **không bao giờ** bị ân hạn (tài khoản client đến nơi đã `DISABLED` phải báo ngay).
   Alert vẫn mở, vẫn đếm, vẫn trong Alert Center (rule 17: chỉ câm delivery, có lý do, có hạn). Hệ quả phải nói
   rõ: theo dedupe `ALERT_POLICY_V1.md` §4.2, `warning` luật 9 của tài khoản đó **sẽ không được gửi riêng về sau**
   nếu điều kiện không đổi — nó đã nằm trong tin tóm tắt ("N tài khoản mới, chưa ai review").
3. **Đòn bẩy có sẵn** ghi trong runbook: tắt luật 9 cả workspace (`PATCH /account-health/rules/…`), hoặc để
   `telegram_chat_id` trống cho tới khi lượt nhập đầu xong.

**Bảng suy giảm (rule 4 / 28) — là hợp đồng, test theo từng dòng:**

| Tình huống | Quét | Nhập | Kết luận vắng mặt | Tin tóm tắt |
|---|---|---|---|---|
| `DISCOVERY_SWEEP_EVERY_N_PASSES=0` | không | không | — | — |
| Cờ connection tắt | không | không | — | — |
| `auto_discovery_enabled`, `auto_import_enabled=false` | có (run `scheduled_sweep`) | **không** — `missing_in_registry` hiện như hôm nay, người bấm | luật 19 theo run `complete` | có nếu có gì mới ("N tài khoản mới chưa nhập") |
| Connection `fake`/`sandbox` | **không bao giờ** | không bao giờ | — | — |
| Reader `none` / BM rỗng | không gọi; `not_configured` | không | — | — |
| Validation `failed` (`token_expired`, `permission_missing`, `not_configured`) | run `failed` | **không có gì** | không | không ("quét lỗi" đã là OperationalRun `partial` + run `failed` trên History) |
| Coverage `partial`/`incomplete`/`unknown` nhưng có tài sản | run `succeeded_with_warnings` | **có** — có mặt không cần kiểm kê đủ (`meta_discovery.py:302-307`) | **không** — luật 19 chỉ đọc run `complete` | có, kèm coverage |
| Rỗng + authority `not_established` → `unknown` | run ghi | không có gì để nhập | **không** | không |
| `rate_limited` giữa lượt | dừng connection còn lại | nhập những gì run đã trả | không (run không `complete`) | có cho run đã xong |
| Tài khoản đã có trong registry (`matched`) | — | `already_in_registry`, không đụng | — | không đếm là mới |
| Cùng id dưới dạng `act_`/trần | — | một lần (canonical, `test_a10_3_registry_import.py:119`) | — | |
| Tài khoản xuất hiện trên **cả hai cạnh** | union đã dedupe (`meta_real_provider.py:319-325`) | một lần | — | |
| **Tài khoản archived mà Meta vẫn trả về** | — | **`archived_in_registry`: không nhập, không restore** | — | **có**: "N tài khoản đã lưu trữ vẫn được Meta trả về: …" → người quyết định `POST /ad-accounts/{id}/restore` |
| Đua unique (hai lượt chồng nhau) | — | `conflict`, SAVEPOINT rollback tài khoản đó, lượt tiếp tục | — | đếm |
| `business{id,name}` không được trả về | — | nhập dưới BM hub; provenance "BM sở hữu: không được trả về" | — | id không kèm BM sở hữu |
| Pixel mới trên `adspixels` | ghi observation | **không nhập** (schema) | không (Pixel `out_of_scope` như hôm nay) | đếm `pixels_new` |
| Dispatcher không có `META_*` | mọi connection `not_configured`, **0** gọi | không | — | không |

Không dòng nào tạo `clear_signals` hay ghi `AdAccount.status`/`last_synced_at`/readiness.

**API (G9)** — owner-only như mọi route `meta-connections`:

| Method | Path | Ghi chú |
|---|---|---|
| `PATCH` | `/meta-connections/{id}/automation` | body `{auto_discovery_enabled, auto_import_enabled}` (`StrictPayload`); `auto_import` không bật được khi `auto_discovery` tắt; từ chối cho connection `fake`/`sandbox` (`409`) — bật tự động cho dữ liệu giả là bịa dữ liệu; ghi `automation_enabled_by/at`; audit `meta_connection.automation_changed` với actor thật |
| `GET` | `/meta-connections`, `/{id}` | thêm khối `automation: {auto_discovery_enabled, auto_import_enabled, enabled_by, enabled_at, eligible: bool, ineligible_reason}` — `eligible` = production + reader ≠ none + có BM |
| `GET` | `/meta-connections/{id}/discoveries` | mỗi run thêm `auto_import: {imported, already_in_registry, archived_returned, conflicts} \| null` suy từ audit rows của run (không bảng mới) |
| `GET` | `/ad-accounts/{id}` | `imported_from_discovery` thêm `trigger` (`manual`/`scheduled_sweep`), `owner_business_reference`, `owner_business_name` |
| `GET` | `/operations/runs?kind=discovery_sweep` | đã có cơ chế |

**UI (G9)** — tối thiểu, theo mẫu có sẵn:

- `MetaConnections.tsx` thẻ connection: hai công tắc (owner) với câu nói rõ hệ quả; badge **"Auto"** khi
  `auto_discovery_enabled`, thêm "+ import" khi cả hai; nếu `eligible=false` công tắc disabled kèm lý do.
- `HistoryTab.tsx:86`: `trigger` thành badge `Manual` / `Scheduled`; cột "Imported automatically: n".
- Account detail `OverviewTab`: provenance thêm "Imported automatically by the discovery sweep on … · shared
  from Business Manager <id> (<name>)" hoặc "owning Business Manager not returned".
- Overview page: không thêm card (tin tóm tắt là đủ); Alert Center hiện alert tóm tắt như alert thường
  (không có account → cột account "—").

**Cấu hình**: `DISCOVERY_SWEEP_EVERY_N_PASSES=0`, `DISCOVERY_SWEEP_BATCH=5`, `DISCOVERY_STALE_AFTER_HOURS=24`,
`AUTO_IMPORT_TELEGRAM_GRACE_HOURS=24` (`core/config.py`, `.env.example`, compose dispatcher). Dispatcher cần
`META_*` — điều kiện S1 đã ghi, không mới.

**Migration**: **một**, `0017_o3_connection_automation` (4 cột trên `meta_connections`, upgrade/downgrade/upgrade
sạch — bước 5). Nếu chọn cờ policy riêng cho tin tóm tắt (§8.3) thì thêm 1 cột trên `notification_policies`
trong cùng revision.

**Test cần có** (tên theo tiền lệ S1/S2; bảng suy giảm là hợp đồng — mỗi dòng một test cùng tên):

- `test_o3_discovery_sweep.py`: tắt mặc định; loop chỉ chạy khi cadence > 0; `--discovery-sweep` một lượt;
  không credential → 0 gọi; `fake`/`sandbox` không bao giờ được chọn; cờ tắt không được chọn; chưa từng quét
  trước cũ; batch + `due_remaining`; `rate_limited` dừng connection còn lại; run `failed` không nhập gì;
  counters ⊆ `SAFE_SUMMARY_KEYS`; mọi audit row của pass có `actor_id IS NULL` và `metadata.actor` hệ thống;
  run có `trigger=scheduled_sweep`, `created_by IS NULL`.
- `test_o3_auto_import.py`: nhập từ `client_ad_accounts` và `owned`; `already_in_registry`; `act_`/trần;
  hai cạnh một lần; **archived tái xuất → không restore, không dòng mới, có đếm**; đua unique → `conflict`,
  lượt tiếp tục; run `partial` vẫn nhập; `auto_import_enabled=false` không nhập; tài khoản nhập có BM hub,
  readiness `unknown`, `last_synced_at IS NULL`; S1 `select_due_accounts` thấy nó `never_observed` ngay lượt sau;
  `owner_business_*` vào metadata khi fake trả `business`, vắng khi không.
- `test_o3_absence_rule.py` (thuần qua `build_candidates`): chỉ nổ với run `complete`; không nổ khi `partial`;
  đóng khi run `complete` mới trả về; evidence allowlist; không `clear_signals`; registry 18 → 19 (sửa ghim
  trong `test_health_api.py`, `test_health_engine.py`, `test_s1_spend_rules.py`, test S2).
- `test_o3_summary_alert.py`: alert không account render bằng `a3-v1-summary`, không raw payload, ≤ 10 id;
  `auto_import_grace` chỉ cho `warning`, không cho `critical`; sau ân hạn điều kiện đổi → delivery mới;
  không đổi → không gửi (và test nói ra điều đó).
- `test_o3_automation_api.py`: owner-only; scope 404; `fake` → 409; `auto_import` cần `auto_discovery`;
  audit với actor thật; `eligible` đúng theo reader; `GET` không gọi provider.
- `test_alert_security.py` / `test_health_security.py`: allowlist module ra ngoài **không đổi**; payload/tin
  không có từ "safe"/"cannot be restricted".
- Frontend: badge `Auto`; công tắc disabled khi không `eligible`; History badge; provenance "shared from".

**Tệp dự kiến đổi**: `core/enums.py` (3 giá trị), `core/config.py`, `models/meta_operations.py` (+4 cột),
`alembic/versions/0017_o3_connection_automation.py` (mới), `services/meta_discovery.py` (`import_ad_account`
nhận `decision`/metadata; helper tra archived; `auto_import_run`), `services/meta_real_provider.py`
(`AD_ACCOUNT_FIELDS` + `_ad_account_from_row` — **[CHƯA KIỂM]** trường `business`), `services/health_rules.py`
(+1 luật), `services/health_service.py` (`_facts`), `services/alert_rules.py` (+`from_discovery_sweep`),
`services/notification_service.py` (ân hạn), `services/notification_templates.py` (+`a3-v1-summary`),
`services/operations.py` (`SAFE_SUMMARY_KEYS`), `commands/run_dispatcher.py` (pass + cờ), `api/v1/routers/meta_operations.py`
(route + serializer + bỏ hằng `DISCOVERY_STALE_AFTER`), `api/v1/routers/ad_accounts.py` (provenance),
`schemas/meta_operations.py`; frontend `MetaConnections.tsx`, `HistoryTab.tsx`, `pages/account/OverviewTab.tsx`,
`lib/types.ts`; rồi `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `HEALTH_RULES_V1.md`, `ALERT_POLICY_V1.md`
(§1 nguồn mới, §6 skip reason), `META_READ_ONLY_DISCOVERY.md` (§Importing, §Bounds **viết lại**),
`RUNBOOK_META_CONNECTION.md` (§6 + §9 mới cho chủ BM), `PRODUCTION_ENVIRONMENT.md`, `.env.example`,
`docker-compose.production.yml`. **Không** đổi: `meta_graph_transport.py`, `registry.py`, `readiness.py`, `preflight_*`.

### 4c. Luật cứng bị chạm — và cách giữ

| Rule | O3 làm gì | Căng? |
|---|---|---|
| 1, 40 | không cột/field/response nào mang credential; sweep gọi `resolve_reader` mỗi lượt, không cache token; `reader_source` là tên | không |
| 2 | **không bao giờ** archive/restore tự động; tài khoản archived tái xuất chỉ được đếm và báo | không — là điểm thiết kế |
| 3 | mỗi tài khoản nhập = audit `ad_account.created` + `ad_account_auto_imported` cùng transaction (đường có sẵn); audit **actor NULL + metadata hệ thống** | **một diễn giải**: rule nói "redacted audit row", không nói actor phải là người; S1/A4 đã ghi tên người không làm — O3 chọn nói thật là hệ thống. Nêu để người dùng biết |
| 4 / 28 | chỉ `complete` mới sinh kết luận vắng mặt; `never_discovered` ≠ `stale`; `not_configured` ≠ `0 tài khoản`; BM sở hữu vắng → "không được trả về" | không |
| 5 | không trạng thái mới nào xanh; badge `Auto` là `neutral`/`info`, không `positive` | không |
| 6 | tin tóm tắt và luật 19 không nói gì về an toàn/hạn chế; câu luật 19 nói rõ "says nothing about whether Meta removed or restricted it" | không |
| 8, 10 | sweep duyệt theo workspace của connection; import qua `AdAccountRegistryService` | không |
| 9, 11 | luật 19 phân loại; không ghi readiness; import khởi `unknown` như hôm nay | không |
| 13 | không đổi câu `clear_signals` | không |
| 15 / 21 | mỗi tài khoản nhập trong SAVEPOINT riêng + evaluate_account_safe | không |
| 16 / 17 | ân hạn là **skip delivery có lý do và có hạn**, alert không bị ẩn, không chạm tín hiệu | **căng ở câu chữ**: "ân hạn" do hệ thống đặt, không phải người bấm suppress — là lý do nó là `skip_reason` (như `severity_delivery_disabled`), không phải `suppressed`. Người dùng chốt §8.4 |
| 18, 19 | Telegram một chiều, token chỉ ở server | không |
| 20 | không module ra ngoài mới; transport không đổi; `test_only_named_modules_may_make_an_outbound_request` không đổi | không |
| 22 | O3 không deploy/không gửi; **bật cadence trên production** = duyệt riêng có tên; **bật cờ connection** = owner, có audit; gửi tin tóm tắt thật vẫn cần chat có tên đã duyệt (Phase 0.4) | không sửa luật; ghi thêm một câu ở `META_READ_ONLY_DISCOVERY.md` §Bounds như S1 |
| 26 | tin tóm tắt chỉ id/tên/đếm; lỗi chỉ mã | không |
| 31 | khớp đúng canonical id; không fuzzy | không |
| 41 | §0 đo lại; production không đo lại hôm nay và nói vậy | — |
| Tiền đề "chỉ người bấm" (14 chỗ, không phải rule) | **thay đổi có chủ ý lần hai**: viết lại từng chỗ; câu mới: *"Discovery and import run either because a person pressed a button, or because the workspace owner switched a production connection to automatic and the release enabled the sweep — never because a page loaded, and never from a fake connection"* | |

Không hard rule nào cần sửa để làm O3. Phase 4 (mb-connect) vẫn cần sửa rule 1, 20, 40 (và quyết định về 2, 22) — §6.

### 4d. Ngoài phạm vi O3 (nói rõ)

| Không làm | Vì |
|---|---|
| Tự tạo tài khoản / tự chia sẻ quyền / bất kỳ ghi nào lên Meta | transport; rule 20/22; Phase 3 |
| Tự archive tài khoản không còn được trả về; tự restore tài khoản archived | rule 2; §2c |
| Nhập Pixel; đọc `client_pixels` | schema `Pixel` không có BM; đọc cạnh mới là follow-up riêng (đổi `required_edges` làm coverage cũ mất hiệu lực — `META_READ_ONLY_DISCOVERY.md:59-60`) |
| Tạo BM row cho BM sở hữu tài khoản client | biến thể D, §4a |
| Đọc token khách qua mb-connect | Phase 4; §6 nói O3 phải để sẵn gì |
| Nút "Import all new (N)" thủ công | follow-up rẻ, không phải yêu cầu |
| Tin Telegram "đã hồi phục", digest theo ngày | đổi A3 v1; spec riêng |
| Đổi mẫu actor của S1/A4 sang hệ thống | spec nhỏ riêng, cùng câu chữ với O3 |
| Nâng `v21.0`, bật sweep S1, cấp `META_*` cho dispatcher, tạo lại connection hub trong DB | Phase 0 / vận hành |

### 4e. Rủi ro

- **Trường `business` trên cạnh client chưa kiểm** → có thể không biết BM sở hữu; thiết kế vẫn chạy (provenance
  "không được trả về"); đo ở lần `--discovery-sweep` tay đầu tiên và ghi `TEST_LOG.md`.
- **Đọc node/insights tài khoản client chưa kiểm** → S1/S2 có thể thấy `permission_missing` cho toàn bộ tài khoản
  client; sản phẩm sẽ báo đúng (luật 11, `not_observable`/`failed`), không bịa; nhưng giá trị của O3 với mô hình
  hub phụ thuộc vào kết quả đó. **Đây là câu hỏi phải đo trước khi viết mã**, bằng `scripts/a10_live_probe.py`
  mở rộng hoặc `POST /ad-accounts/{id}/spend/refresh` trên một tài khoản client đã nhập tay (người bấm, 2 GET).
- **Bão alert ở lượt đầu** nếu cả ba lớp §4b bị bỏ qua: 1 tin/tài khoản. Runbook phải nói "bật `auto_import`
  → trước đó đặt chat hoặc tắt luật 9 hoặc chấp nhận ân hạn".
- **Hạn mức Graph** chưa đo; sweep dừng ở `rate_limited`; cadence mặc định tắt.
- **Hai lượt chồng nhau** (lệnh tay + cadence): unique constraint + SAVEPOINT từng tài khoản → `conflict`, không
  hai dòng; test cố định.
- **Production chưa có dispatcher/credential** → O3 ship xong vẫn là 0 lượt tự động cho tới khi S1 được bật
  theo đúng duyệt (như S2 §4e).

---

## 5. Hướng dẫn cho chủ BM — mô hình hub (chia sẻ đối tác sang `1993884657458857`)

> **Toàn bộ nhãn menu dưới đây là [CHƯA KIỂM]**: thân hai bài trợ giúp chính thức
> (`facebook.com/business/help/1717412048538897`, `…/708679622611131`) không tải được qua fetch hôm nay, chỉ có
> tiêu đề; thứ tự bước lấy từ bản tóm tắt tìm kiếm của chính các trang đó. Meta đổi tên "Business Manager" ↔
> "Business portfolio" ↔ "Meta Business Suite" và nhãn khác nhau giữa UI tiếng Việt/Anh. Bám theo **thứ tự**.
> BA kiểm trên giao diện thật rồi chốt câu chữ trước khi gửi cho 30 chủ BM.

**Việc chủ BM cần biết trước**: họ chỉ chia sẻ **quyền xem** tài khoản (và Pixel) sang BM hub của đội; không
chuyển quyền sở hữu; thu hồi được bất cứ lúc nào trong Partners. Sản phẩm phía đội **chỉ đọc** và không thể
tạo/sửa/chia sẻ gì trên tài khoản của họ (transport GET-only, rule 20).

**Bước 1 — Điều kiện** [CHƯA KIỂM từng ý, theo tóm tắt bài 1717412048538897]: người thao tác phải có **toàn
quyền** ("full control"/Admin) trên BM của mình; BM đã bật **xác thực hai yếu tố**; có **ID BM hub** của đội:
`1993884657458857` (không phải bí mật — `RUNBOOK:164-165`).

**Bước 2 — Thêm đối tác và gán tài khoản quảng cáo** [CHƯA KIỂM nhãn]:
1. Mở **Business Settings** / **Cài đặt** của Meta Business Suite cho BM của mình (`business.facebook.com/settings`).
2. Mục **Users → Partners** (Người dùng → Đối tác) → **Add** → chọn **"Give a partner access to your assets"**
   (Cấp cho đối tác quyền truy cập tài sản của bạn) — **không** chọn "Ask a partner to share their assets".
3. Nhập **Partner business ID** = `1993884657458857` → Next.
4. Chọn loại tài sản **Ad accounts** → tick các tài khoản cần đội theo dõi → chọn mức quyền **thấp nhất chỉ
   xem** (nhãn kiểu "View performance"/"Partial access" — [CHƯA KIỂM]; tránh "Manage ad account"/"Full control").
5. **Assign assets** / Save. Bài trợ giúp nói có thể cần một admin toàn quyền khác **duyệt** [CHƯA KIỂM].

**Bước 3 — Pixel (nếu muốn đội thấy Pixel)** [CHƯA KIỂM]: vẫn trong hộp thoại đối tác (hoặc **Data sources →
Pixels/Datasets** → chọn Pixel → **Assign partners**), tick Pixel, mức quyền **View**/ANALYZE. Theo tài liệu
API của Meta (đọc 2026-10-27), chia sẻ Pixel cho một business đối tác đặt `permitted_tasks` trong
`ANALYZE / UPLOAD / ADVERTISE` (`EDIT` bị hạn chế) và **có thể cần BM nhận chấp thuận** nếu hai bên chưa có quan
hệ đối tác. Pixel chia sẻ xuất hiện ở đâu trên hub (`adspixels` hay chỉ `client_pixels`): **[CHƯA KIỂM]**;
hôm nay sản phẩm chỉ đọc `adspixels`.

**Bước 4 — Phía đội (admin BM hub, làm một lần cho mỗi đợt chia sẻ)**: tài sản chia sẻ vào BM hub **không tự
hiện với system user** `adsops-readonly` — system user chỉ thấy tài sản được gán cho nó (`RUNBOOK:60-62`).
Vào Business Settings của hub → **Users → System users** → chọn system user → **Assign assets** → tick các tài
khoản/Pixel vừa được chia sẻ. Bằng chứng 2026-09-10 cho thấy hai tài khoản client **đã** được gán và liệt kê được
(`TEST_LOG.md:2061-2062`). Đây là thao tác tay **còn lại** trong mô hình hub; nếu Meta cho phép gán "mọi tài sản
hiện tại và tương lai" cho system user thì bước này biến mất — [CHƯA KIỂM].

**Bước 5 — Kiểm**: chạy `python -m app.commands.run_dispatcher --discovery-sweep` (sau O3) hoặc bấm Run discovery
trên connection hub; tài khoản mới phải hiện dưới cạnh **Client accounts** với tên; nếu `0` thì xem lại Bước 4
trước khi nghi ngờ công cụ (`RUNBOOK:260-261`).

Phần cho chủ BM nên là **một trang riêng** `docs/RUNBOOK_PARTNER_SHARE_TO_HUB.md` (tiếng Việt, có ảnh chụp do BA
làm) — O3 chỉ viết khung; câu chữ thuộc BA.

---

## 6. mb-connect lắp vào sau — O3 phải để sẵn gì

Để "một connection qua cổng" chỉ là **một nguồn connection nữa**, lõi O3 phải giữ năm điều:

1. **Đơn vị là `MetaConnection`, không phải env.** Sweep chọn connection bằng một predicate duy nhất
   (`production` + reader ≠ `none` + cờ) qua **một** helper (mở rộng `_connections_by_business` thành
   `eligible_connections(session, ws, settings, *, for_automation)`), để Phase 4 chỉ thêm nhánh `reader_source ==
   customer_gateway` ở `resolve_reader` (`ROADMAP` §4.2) mà không chạm sweep.
2. **Không cache credential qua lượt.** Provider được dựng **mỗi connection mỗi lượt** từ `resolve_reader`
   (như `spend_sweep_pass:306-310`); token cổng có hạn mềm 1 giờ → đúng vòng đời.
3. **"Connection xuất hiện" = một dòng `meta_connections`.** Với cổng, dòng được tạo khi sản phẩm gọi `confirm`
   (nó là bên gọi — §2i); với hub, khi owner tạo connection. Cờ `auto_*` mặc định của dòng mới là quyết định
   theo workspace (Phase 4: owner khách bật trong onboarding) — O3 để **mặc định `false`**, và `PATCH …/automation`
   là nơi duy nhất đổi.
4. **BM phải được chọn trước khi quét.** Connection cổng không có `business_manager_reference` lúc tạo (callback
   không ghi `metaBusinessId`); sweep O3 đã **bỏ qua** connection không có BM id (`not_configured`), nên Phase 4
   chỉ cần một bước "chọn BM từ `me/businesses`" trước khi cờ bật được — `eligible=false, ineligible_reason=
   business_manager_not_chosen`.
5. **Hạn mức theo connection.** Dừng ở `rate_limited` **theo connection**, không theo workspace, vì token khách
   là budget của khách.

Những gì Phase 4 **vẫn phải** làm và O3 **không** làm: module ra ngoài thứ tư (`mb_connect_transport.py`),
cột `gateway_connection_id`, giá trị `reader_source=customer_gateway`, login config **chỉ đọc** ở cổng (scope
`ads_read`+`business_management` thay vì `ads_management`), `tenantRef` hoặc một bản cài mỗi khách — và sửa
**rule 1, 20, 40** đúng như `ROADMAP_COMMERCIAL.md` §4.3 đề xuất (cùng quyết định về rule 2 và 22). Không câu nào
trong các luật đó được đổi ở đây.

---

## 7. Xác nhận

Không gọi Meta, không gửi Telegram, không deploy, không migration, không đổi mã, không đổi scope/authorization,
không đổi provider thật, không commit. DB dev đang chạy chỉ được **đếm**, không ghi. Tài liệu Meta chỉ được đọc;
chỗ nào chỉ có tiêu đề hoặc bản tóm tắt đều ghi rõ. Không test nào được chạy để viết tài liệu này.

---

## 8. Câu hỏi cho người dùng (chỉ những gì thuộc quyền người dùng)

1. **Phê duyệt có tên cho tự động hoá**: chấp nhận mô hình hai công tắc — cadence trong env (duyệt phát hành)
   **và** cờ theo connection do owner bật qua UI (audit ghi tên) — thay vì "bật sẵn mặc định"? Ai là người bật cờ
   cho connection hub (tên), và ai duyệt `DISCOVERY_SWEEP_EVERY_N_PASSES>0` trên production (tên, ngày)?
2. **Đo trước khi viết mã**: cho phép **một** lần đọc thật có người xem (≤ 8 GET) để trả lời hai câu [CHƯA KIỂM]
   quyết định giá trị của O3 với mô hình hub — (a) `business{id,name}` có về trên `client_ad_accounts` không;
   (b) token hub đọc được `act_<id>` + `insights` của **một** tài khoản client không? Nếu (b) là `permission_missing`
   thì O3 nhập được nhưng S1/S2 không theo dõi được tài khoản client, và cần bàn lại với chủ BM về mức quyền.
3. **Tin tóm tắt**: đi Telegram ở mức `warning` theo policy hiện có (tôn trọng giờ yên lặng), hay thêm cờ policy
   riêng `discovery_summary_telegram_enabled` (thêm một cột)? Nội dung tối đa 10 id mới mỗi tin — đủ chưa?
4. **Ân hạn Telegram cho tài khoản tự nhập** (`AUTO_IMPORT_TELEGRAM_GRACE_HOURS=24`, chỉ `warning`, không `critical`):
   chấp nhận hệ quả "warning 'chưa review' của tài khoản đó sẽ không được gửi riêng nếu không đổi" — hay bỏ ân hạn
   và chấp nhận một tin mỗi tài khoản ở lượt đầu, hoặc tắt luật 9 cả workspace trước khi bật?
5. **BM sở hữu tài khoản client**: chỉ hiện làm provenance (đề xuất), hay muốn một BM row "chỉ tham chiếu" cho
   mỗi BM sở hữu dù không có connection nào đọc nó (sẽ hiện `0 · Unknown` vĩnh viễn)?
6. **Luật 19 `account_not_returned_by_latest_discovery`** (attention, chỉ Alert Center) có nằm trong O3 không, hay
   O3 chỉ đếm trong tin tóm tắt và để luật này cho sau?
7. **Nhịp quét**: 24 giờ một lần cho connection hub (~6 GET/ngày) đủ với "phát hiện tài khoản mới" không, hay cần
   nhanh hơn (ví dụ 6 giờ ≈ 24 GET/ngày)?
8. **Ai viết trang hướng dẫn cho chủ BM** (§5) và kiểm nhãn menu trên giao diện Meta thật — BA? Có gửi kèm ảnh chụp?

---

## 9. Quyết định của người dùng (2026-10-27)

Chủ dự án yêu cầu "tiến hành thực hiện theo kế hoạch từng đợt". Câu §8 chưa trả lời riêng, nên áp
**đúng đề xuất của tài liệu này**. Chủ dự án sửa được bất kỳ dòng nào; sửa thì ghi lại ở đây.

| § | Quyết định |
|---|---|
| 4 (thiết kế) | **Thiết kế A** |
| 8.1 | Hai công tắc. `DISCOVERY_SWEEP_EVERY_N_PASSES` (env, mặc định 0) và cờ `auto_discovery_enabled`/`auto_import_enabled` theo từng connection (mặc định `false`). Owner bật cờ của connection hub qua `PATCH` (có audit). Bật nhịp trên production là duyệt riêng |
| 8.2 | Code trước, **chưa** có lần đọc thật. Lần đọc thật (≤ 8 GET) làm sau, khi có connection production. Nếu token hub không đọc được `act_<id>`/`insights` của tài khoản client thì ghi vào `TEST_LOG.md` và chuyển trọng tâm sang O4 |
| 8.3 | Tin tóm tắt đi theo mức `warning` của chính sách hiện có. Không thêm cờ policy mới |
| 8.4 | Chấp nhận ân hạn 24 giờ (`skip_reason=auto_import_grace`), chỉ áp cho `warning`, không bao giờ áp cho `critical` |
| 8.5 | BM sở hữu chỉ lưu làm provenance, không tạo BM row |
| 8.6 | Làm luật 19 `account_not_returned_by_latest_discovery` trong O3 |
| 8.7 | Nhịp 24 giờ cho mỗi connection |
| 8.8 | Agent soạn nháp hướng dẫn cho chủ BM, BA duyệt câu chữ và chụp ảnh |
