# Audit Before Build — Theo dõi chi tiêu (Meta, chỉ đọc) — S1

Ngày: 2026-10-26 · Baseline `a8392b6` · **Đây là bản audit, không phải bản build.** Không một dòng
mã sản phẩm nào được sửa để viết tài liệu này; không gọi Meta, không gửi Telegram, không deploy.

Đây là MINI-SPEC bước 1–3 theo `MINI_SPEC_PLAYBOOK.md`. Bước 4 (code) chỉ bắt đầu khi người dùng
chốt các câu hỏi ở §6.

---

## 0. Đo được gì, không đo được gì

Rule 41: mọi khẳng định về trạng thái sản phẩm dưới đây là **đo tại thời điểm viết**, kèm cách đo.

| Nguồn | Trạng thái lúc viết | Hệ quả |
|---|---|---|
| Mã nguồn tại `a8392b6` | đọc trực tiếp, `grep` toàn `backend/app` và `frontend/src` | mọi `file:line` dưới đây là của commit này |
| Cơ sở dữ liệu dev (`localhost:5434`) | **tắt** — `scripts/dev.sh status` báo `answering=NO` cho cả hai server, kết nối Postgres bị từ chối | số liệu dòng/bảng lấy từ `FEATURES.md` (đo 2026-09-14) và ghi rõ là số cũ; **không đo lại được hôm nay** |
| Meta Graph API | **không gọi** (rule 22) | mọi điều về hành vi của Meta (đơn vị tiền, múi giờ của insights, dòng 0, hạn mức) đánh dấu **chưa kiểm** |
| Hạn mức Graph (`X-Business-Use-Case-Usage`) | header được transport bắt (`meta_graph_transport.py:106`) nhưng **không nơi nào đọc** (grep `rate_limit_header` ngoài transport: 0 kết quả) | chưa có số đo nào về hạn mức thật; §2e chỉ tính số lần gọi theo thiết kế |

---

## 1. Khoảng trống, nói chính xác

Người dùng xếp "theo dõi chi tiêu" là nỗi đau số 1 (2026-10-26). Sản phẩm hôm nay **không đọc
một con số chi tiêu nào** từ Meta, và cũng không có chỗ để ghi một con số như thế:

- `grep -rn "amount_spent|spend_cap|balance|disable_reason|/insights|insights"` trên `backend/app`:
  **0 kết quả** cho mọi từ, trừ `account_status` (xem §2a). Đo 2026-10-26.
- `FEATURES.md:728` (loại trừ của A7): *"A combined multi-currency spend total anywhere — No spend
  source exists in this build; the field is `None`, never summed, never fabricated as zero."* Vẫn đúng.
- `AdAccount` (`models/entities.py:125-185`) không có cột nào về chi tiêu; `currency` (`:157`) và
  `timezone` (`:158`) là giá trị **operator gõ tay**, không phải giá trị Meta trả về.

"Theo dõi chi tiêu" ở đây được hiểu là: **mỗi tài khoản, mỗi ngày (theo múi giờ của tài khoản),
chi tiêu là bao nhiêu, bằng tiền gì, số đó mới đến đâu, và khi nào nó lệch đáng kể so với mức bình
thường hoặc tiến gần trần chi tiêu.** Không phải báo cáo hiệu quả (CPC/CPA), không phải ngân sách
chiến dịch, không phải dự báo.

---

## 2. Bước 1 — Audit: cái gì đã có (kiểm trong mã, không giả định)

### 2a. Đường đọc Meta

| Mảnh | Trạng thái | Ở đâu |
|---|---|---|
| Transport ra Meta | GET bất kỳ path Graph + **đúng một** POST `{bm}/adaccount`; không PATCH/DELETE | `services/meta_graph_transport.py:81-124`, `:126-188`, `_WRITABLE_PATH` `:51` |
| Lỗi Graph → từ vựng nội bộ | `token_expired`, `rate_limited`, `permission_missing`, `provider_server_error`, `billing_required`, `invalid_request`, `timeout` | `meta_graph_transport.py:197-244`; `MetaFailureCode` `services/meta_provider.py:23-37` |
| Header hạn mức | bắt vào `GraphResponse.rate_limit_header`, docstring tự nhận "observability only — nothing throttles itself on it" | `meta_graph_transport.py:63-65`, `:106` |
| Trường tài khoản đang đọc | `id,account_id,name,account_status,currency,timezone_name` — **không có** `amount_spent`, `spend_cap`, `balance`, `disable_reason` | `services/meta_real_provider.py:74` (`AD_ACCOUNT_FIELDS`) |
| `account_status` đã đọc nhưng không dùng | được giữ vào `safe_metadata` (`meta_real_provider.py:106-110`) → `safe_metadata_json` của observation (`services/meta_discovery.py:257`); **không được render** (grep `safe_metadata|account_status|timezone_name` trong `frontend/src`: chỉ có `AccountHealth.tsx:248`, và đó là `status` của **registry**, không phải của Meta); **không được so** với `AdAccount.status` |
| Edge `/insights` | **không có** nơi nào gọi | grep §1 |
| Chọn credential theo BM | `resolve_reader(settings, business_id)` → `(token, reader_source)`; `build_real_provider` | `meta_real_provider.py:487-517` |
| Cổng vào provider thật | chỉ khi connection `production` **và** `reader_source != none` | `api/v1/routers/meta_operations.py:59-77` |
| Trang/giới hạn mỗi edge | `PAGE_SIZE=100`, `MAX_PAGES=10`, vượt → `truncated` → coverage `partial` | `meta_real_provider.py:79-80`, `meta_provider.py:249-254` |
| Lúc nào Meta được gọi | **chỉ khi một người bấm** — không timer, không page-load, không retry | `enums.py:505-510` (`DiscoveryTrigger` cố ý không có `scheduled_reconciliation`); `meta_operations.py:378-386` (docstring `run_discovery`); `docs/META_READ_ONLY_DISCOVERY.md:251-254`; `docs/AUDIT_BEFORE_BUILD_A10.md:72-73` ("never on a page load, never on a timer") |
| Phiên bản Graph ghim | `v21.0` | `core/config.py:85`; `.env.example:85` |

Hai điều rút ra: (1) **transport và provider đã đủ để đọc thêm trường và thêm edge mà không đụng
rule 20** — vẫn GET, vẫn một module; (2) **tiền đề "mọi cuộc gọi Meta là do một người bấm" được
ghi ở ba nơi** và một sweep chi tiêu theo đồng hồ là lần đầu tiên phá tiền đề đó. Không có hard rule
nào cấm, nhưng đây là thay đổi phải nói to, không được âm thầm (xem §4c).

### 2b. Mô hình luật sức khoẻ — có nhận được một quan sát dạng số không?

| Điểm | Kiểm | Ở đâu |
|---|---|---|
| Luật = hàm Python thuần trong registry cố định, nhận `HealthFacts`, trả `SignalCandidate[]` | đúng | `services/health_rules.py:85-99`, `:397-541`; `health_engine.py:91-103` |
| `HealthFacts` chỉ có: `account`, `readiness`, `checklist_items`, `unresolved_events`, `now`, `manual_review_due_after_days` | đúng — **không có chỗ cho quan sát từ nền tảng** | `health_rules.py:52-62`; lắp ở `health_service.py:509-541` (`_facts`, đọc A1 bằng `persist=False`) |
| Luật đã so sánh **số** hôm nay | có: `_manual_review` so `reviewed_at` với `now - timedelta(days=interval)` (`:322-326`); evidence đã chứa số (`completed_item_count`, `required_item_count` `:313-314`) | nên "luật đọc một con số" **không** phải điều mới |
| Rule 9 cấm gì | **điểm rủi ro dạng số ở đầu ra**. Đầu vào số → ngưỡng → severity phân loại là mẫu có sẵn; `HealthRollup` không có số nào ngoài `counts` theo severity (`health_engine.py:160-165`) | `CLAUDE.md` rule 9, 11; `ARCH.md:793-796` |
| Ngưỡng cấu hình được không | `HealthRule.condition_config` (`:99`) và `HealthRuleDefinition.condition_config_json` (`models/health.py:64`) **tồn tại nhưng `evaluate(facts)` không nhận config** → ngưỡng v1 là hằng số/`Settings`, giống `health_evaluation_stale_after_hours` | `docs/HEALTH_RULES_V1.md:56`: "Per-workspace thresholds are deferred" |
| Nguồn của một tín hiệu | `HealthSourceType` = `account_status / manual_event / readiness_engine / checklist_item / evaluation_engine`; docstring: *"A manual observation must never look like platform data"* — chiều ngược lại cũng vậy: **chưa có giá trị cho dữ liệu đọc từ nền tảng** | `core/enums.py:180-187` |
| Thêm giá trị enum có cần migration không | **không**: `sa.Enum(native_enum=False)` dưới SQLAlchemy 2.0.36 biên dịch ra `VARCHAR(48)` **không có CHECK** (biên dịch DDL offline với dialect PostgreSQL ngày 2026-10-26; migration `0002_a2_account_health.py:57` cũng không khai `create_constraint`). `ARCH.md:80-81` viết "VARCHAR + CHECK" — **sai với thực tế**, ghi thành follow-up | |
| Severity `unknown` | chỉ rule 10 được phát; `unknown` chặn `clear_signals` | `health_rules.py:352-354`; `health_engine.py:232-234`; `HEALTH_RULES_V1.md:31-33` |
| Freshness tính lúc đọc; `clear_signals` chỉ khi `current` | đúng | `health_engine.py:106-126`, `:236-256` |
| Đánh giá trong SAVEPOINT (rule 15), alert lồng trong (rule 21) | đúng | `health_service.py:629-646` (`begin_nested`); `ARCH.md:282-287` |
| Tín hiệu → alert tự động | `warning` → alert `warning` (ứng viên Telegram); `attention`/`unknown` → `info` | `services/alert_rules.py:24-29`; `docs/ALERT_POLICY_V1.md` §1 |
| "Recalculate health" hứa gì với người dùng | *"It does not contact any advertising platform"* — câu này **phải giữ đúng** sau S1 | `frontend/src/lib/health.ts:118-119`; `HEALTH_RULES_V1.md:7-8` |

Kết luận: luật có thể nhận một quan sát chi tiêu **nếu** quan sát đó đã nằm trong DB trước khi
đánh giá (health đọc DB, không đọc Meta), và nếu đầu ra vẫn là severity phân loại + evidence
allowlist. Không cần sửa engine; cần mở rộng `HealthFacts` thêm một trường và lắp nó trong `_facts`.

### 2c. Lịch chạy — dispatcher lái sweep thế nào

| Mảnh | Trạng thái | Ở đâu |
|---|---|---|
| Vòng lặp bounded trong container `dispatcher` | `one_pass` mỗi `interval` giây; recovery mỗi N pass; health sweep mỗi `health_every` pass | `commands/run_dispatcher.py:233-274`; compose `docker-compose.production.yml:106-131` |
| Mẫu một sweep | `health_sweep_pass(batch)`: duyệt workspace, chọn tài khoản đến hạn, gọi `evaluate_account_safe`, ghi `OperationalRun` kèm counters | `run_dispatcher.py:150-230` |
| "Chưa từng" ≠ "cũ" (rule 28) | `_due_accounts` tách `never_evaluated`/`stale`, `nullsfirst()` | `run_dispatcher.py:114-147` |
| Loại run | `OperationalRunKind.HEALTH_SWEEP` thêm **không cần migration** (`kind` là `varchar(32)` không ràng buộc — `docs/AUDIT_BEFORE_BUILD_SCHEDULED_HEALTH.md:28`) | `core/enums.py:336-347` |
| Counters được giữ | chỉ khoá trong `SAFE_SUMMARY_KEYS`; khoá lạ **bị bỏ lặng** | `services/operations.py:27-39`, `:42-54` |
| Cadence tắt mặc định | `health_sweep_every_n_passes = 0` | `core/config.py:135-139` |
| Actor cho audit ngoài request | thành viên **đầu tiên** của workspace | `run_dispatcher.py:179-184` |
| Health sweep **không chạm nền tảng** — có test | `test_the_sweep_contacts_no_advertising_platform` | `tests/test_scheduled_health_sweep.py:208` |
| Container `dispatcher` **không nhận biến `META_*`** | env chỉ có DB/JWT/Telegram/dispatch | `docker-compose.production.yml:120-131` (bản Vibe Host đang chạy **chưa kiểm được** — xem `docs/PRODUCTION_ENVIRONMENT.md`) |

Hệ quả: cơ chế lịch có sẵn và đã chứng minh; cái thiếu là một pass mới, counters mới trong
allowlist, và **biến môi trường Meta cho container dispatcher** — thiếu nó, `resolve_reader` trả
`READER_NONE` và sweep sẽ không đọc được tài khoản nào (đúng rule 4: không có credential thì không
có quan sát, không phải "0 chi tiêu").

### 2d. Registry: những trường liên quan và ý nghĩa đang có

- `AdAccount.currency`, `timezone` (`entities.py:157-158`): operator gõ, không được xác thực với Meta.
- `AdAccount.last_synced_at` (`:171`): **chưa có gì ghi** — `ARCH.md:153-154`: *"`last_synced_at` is
  `null` in A1 because nothing syncs, so freshness reports `unknown`"*; readiness suy
  `data_freshness` từ nó (`services/readiness.py:234-244`). Một sweep chi tiêu *có thể* là thứ đầu
  tiên ghi cột này — nhưng làm vậy là để một phép đọc nền tảng **đẩy readiness** (rule 11: health không
  được ghi readiness; sweep không phải health nhưng tinh thần giống). §4 đề nghị **không** ghi trong S1.
- `AccountStatus` (`enums.py:30-36`): `unknown/active/warning/restricted/disabled/archived` — là trạng
  thái **do người ghi**. Meta trả `account_status` dạng **số** (AdsCommand ánh xạ `1,2,3,7,9,100,101`
  tại `share-projects/ads-manager/lib/connect/meta-assets.ts:31` — là bảng của đội, chưa đối chiếu với
  tài liệu Meta trong workspace này).
- `BusinessManager.external_id` + `AdAccount.business_manager_id` là mối nối duy nhất từ tài khoản
  đến một `MetaConnection` (qua `business_manager_reference`, `meta_operations.py:73` →
  `_business_id_for`). Tài khoản không có BM, hoặc BM không có connection `production` → **không
  thể đọc**, phải có trạng thái riêng (§4b).

### 2e. Hạn mức và chi phí gọi cho 30+ tài khoản

Không gọi Meta nên **không có số hạn mức đo được**. Những gì tính được từ thiết kế:

| Thiết kế | Gọi / tài khoản / lượt | 30 tài khoản | 60 | 100 |
|---|---|---|---|---|
| Node `act_<id>` (fields) + `act_<id>/insights` (8 ngày, theo ngày) | **2** | 60 / lượt | 120 | 200 |
| mỗi 1 giờ (24 lượt/ngày) | | 1 440 / ngày | 2 880 | 4 800 |
| mỗi 6 giờ (4 lượt/ngày) | | 240 / ngày | 480 | 800 |

So sánh với discovery hiện có: một run ≈ 1 (`me`) + 1 (BM node) + 2 edge × số trang + 1 (`adspixels`)
(+1 `system_users` nếu rỗng) ≈ 5–6 gọi **cho cả BM**, và chỉ khi bấm.

Điều **chưa kiểm được** và phải ghi lại ở lần đọc thật đầu tiên: (a) hạn mức Marketing API theo
ad account (BUC) ở bậc truy cập hiện tại của app — `docs/DESIGN-CONG-KET-NOI-MATBAO.md` §1.2 của
AdsCommand đo được app Mắt Bão cũ ở bậc `development_access` ("heavily rate-limited per ad account");
app nào đứng sau system-user token của sản phẩm này thì **chưa xác định**; (b) nội dung header
`X-Business-Use-Case-Usage` (transport đã giữ, chưa ai đọc); (c) **`v21.0` có còn được Meta phục vụ
không** — bộ nhớ dự án AdsCommand ghi họ đang chạy `v24.0`–`v26`; Graph thường ngừng một phiên bản
sau ~2 năm; `v21.0` phát hành 2024 → **có thể đã hết hạn tại thời điểm này**, phải xác nhận trước khi
bất kỳ sweep nào chạy (xem `ROADMAP_COMMERCIAL.md` Phase 0).

Cách sweep tự bảo vệ không phụ thuộc số hạn mức: một `rate_limited` **dừng lượt cho connection
đó**, phần còn lại ghi `due_remaining`, lượt sau tự lấy tiếp (§4b). Không retry trong cùng lượt.

### 2f. Giao diện hiện có

| Bề mặt | Hiện có | Ở đâu |
|---|---|---|
| Bảng Accounts | cột: Account, External ID, Type, BM/Personal ref, Status, Readiness, Checklist, Last manual review, Browser ref, Proxy ref, Last updated, Actions — **không có chi tiêu** | `frontend/src/pages/Accounts.tsx:157-173` |
| Chi tiết tài khoản | 6 tab: Overview, Assets & References, Readiness, Health, Events, Audit History | `pages/AccountDetail.tsx:16-23` |
| Overview | hai mục lớn "Account health" và "Alert Center" + 4 card | `pages/Overview.tsx:114`, `:195`, `:273-357` |
| Account Health | bảng có badge readiness/health/freshness tách riêng; "Configured checks" bật/tắt luật | `pages/AccountHealth.tsx:93`, `:248-261` |
| Bản đồ màu | readiness: `readiness.ts:12-47` (chỉ `operationally_ready` xanh); health: `health.ts:13-45`; **freshness không bao giờ xanh** (`health.ts:48-75`) — mẫu đúng để tái dùng cho "độ mới của chi tiêu" | |

### 2g. mb-connect — ảnh hưởng tới hình dạng S1, không nằm trong S1

Đã tìm thấy cổng ở `share-projects/mb-connect` (chi tiết đo trong `docs/ROADMAP_COMMERCIAL.md` §4).
S1 **vẫn đọc bằng system-user token trong cấu hình máy chủ** (rule 40, `resolve_reader`). Ảnh hưởng
duy nhất lên S1: bảng quan sát phải mang `reader_source` (tên, không phải giá trị — giống
`meta_connections` đã trả `reader_source`), để sau này một reader "cổng khách hàng" lắp vào **không
cần migration** cột đó.

---

## 3. Bước 2 — Khoảng trống và ranh giới (từ vựng của playbook)

| # | Khoảng trống | Loại | Trong S1? |
|---|---|---|---|
| G1 | Không có từ vựng cho "độ mới của chi tiêu" (`current / stale / never_observed / not_observable`) và cho "ngày địa phương của tài khoản" | `vocabulary` | có |
| G2 | `HealthSourceType` không có giá trị cho dữ liệu đọc từ nền tảng; `HealthCategory` không có `spend` | `vocabulary` | có (thêm enum, không migration — §2b) |
| G3 | Tiền đề "mọi cuộc gọi Meta là do người bấm" ghi ở 3 nơi; chưa có cuộc gọi nào theo đồng hồ | `architecture` | có — **thay đổi tiền đề, phải nói to** (§4c) |
| G4 | `MetaBusinessProvider` không có phương thức đọc chi tiêu; `FakeMetaBusinessProvider` không dựng được kết quả chi tiêu cho test | `architecture` / `testing` | có |
| G5 | Không có bảng quan sát chi tiêu; `AdAccount` không có (và không nên có) số chi tiêu cache | `data_model` | có — migration `0016` |
| G6 | `currency`/`timezone` của registry là giá trị gõ tay; chưa có chỗ lưu giá trị **Meta trả** mà không ghi đè | `data_model` | có — lưu trên quan sát, không ghi đè registry |
| G7 | `HealthFacts` không có chỗ cho quan sát; chưa có luật nào suy từ số | `architecture` / `state_machine` | có |
| G8 | Trạng thái và suy giảm khi thiếu dữ liệu (ngày thiếu dòng, không có baseline, không có múi giờ, không có credential) chưa định nghĩa | `state_machine` | có (§4b bảng suy giảm) |
| G9 | Không có endpoint chi tiêu; không có tổng theo tiền tệ | `API` | có |
| G10 | Không bề mặt UI; chưa có bản đồ màu cho chi tiêu | `frontend_UX` | có |
| G11 | Container `dispatcher` không có `META_*`; `funding_source_details` (thông tin thanh toán) không được phép lọt vào quan sát; audit cho quan sát chưa định nghĩa | `security` / `deployment` | có |
| G12 | Chưa có `OperationalRunKind.SPEND_SWEEP`; counters mới ngoài `SAFE_SUMMARY_KEYS` sẽ bị bỏ lặng; `rate_limited` chưa đếm | `observability` | có (counters); đọc header → follow-up |
| G13 | Test theo múi giờ: container UTC, tài khoản `Asia/Ho_Chi_Minh` — ranh giới ngày phải được test, không giả định | `testing` | có |
| G14 | `.env.example`, `ARCH/API/FEATURES/TEST_LOG`, `HEALTH_RULES_V1.md` chưa biết S1 | `deployment` / tài liệu | có (bước 6) |

**Lỗi không liên quan → follow-up, không phải phạm vi:**

- `ARCH.md:80-81` nói enum là "VARCHAR + CHECK"; thực tế không có CHECK (§2b). Sửa câu, không sửa schema.
- `rate_limit_header` được bắt mà không ai đọc (§2a). Đọc và ghi an toàn là việc riêng.
- `account_status` của Meta đã nằm trong `safe_metadata_json` từ A10.1 mà chưa được hiển thị hay
  đối chiếu với `AdAccount.status` — là việc của spec "tài khoản bị khoá" (ROADMAP Phase 2), không
  làm trong S1.
- `next_evaluation_due_at` vẫn không ai ghi (đã là follow-up từ `AUDIT_BEFORE_BUILD_SCHEDULED_HEALTH.md` §3).
- Actor của sweep = thành viên đầu tiên (`run_dispatcher.py:179-184`): một "system actor" sẽ sạch
  hơn cho audit; S1 dùng đúng mẫu hiện có.
- `share-projects/mb-connect/README.md` ghi bước 5 (Meta) "chưa" trong khi mã Meta đã có và đã chạy
  thật ngày 26/10 (`lib/providers/meta.ts:86`). Tài liệu của dự án khác, chỉ ghi nhận.

---

## 4. Bước 3 — Thiết kế

### 4a. Ba ứng viên

| | A — Sweep ghi quan sát theo ngày (đề xuất) | B — Nhét trường chi tiêu vào discovery | C — Tính lúc mở trang, không lưu |
|---|---|---|---|
| Cách làm | Pass mới trong dispatcher, mỗi tài khoản 2 GET (`act_<id>` + `act_<id>/insights` theo ngày), ghi bảng quan sát append-only, rồi `evaluate_account_safe` | Thêm `amount_spent,spend_cap` vào `AD_ACCOUNT_FIELDS`, chạy discovery theo lịch, đọc từ `safe_metadata_json` | Khi mở Accounts/Account detail, gọi Meta rồi hiển thị |
| Có lịch sử theo ngày? | **có** → baseline, lệch, "hôm qua" theo múi giờ tài khoản | không — `amount_spent` là số **luỹ kế** (đơn vị và ý nghĩa chưa kiểm), không tách ngày | không |
| Chạm tiền đề "không timer"? | có, **một chỗ, nói rõ, tắt mặc định** | có, và kéo theo `DiscoveryTrigger` phải thêm `scheduled` — thứ A10.1 cố ý bỏ (`enums.py:506-507`) | không timer nhưng **page-load** — bị cấm rõ hơn (`AUDIT_BEFORE_BUILD_A10.md:72-73`) |
| Health đọc được không? | có, từ DB, "Recalculate không chạm nền tảng" vẫn đúng | có nhưng discovery là **kiểm kê theo BM** (coverage, authority) — trộn "chi tiêu cũ" với "coverage không complete" làm rối `missing_from_latest_discovery` | **không** — health sẽ phải gọi mạng, phá `RECALCULATE_EXPLANATION` và rule 15 trở nên nguy hiểm (timeout trong SAVEPOINT của mutation) |
| Số gọi | 2/tài khoản/lượt, bounded, dừng khi `rate_limited` | ~5–6/BM/lượt nhưng không có insights → vẫn phải thêm 1/tài khoản | mỗi lần mở trang × mỗi người xem — không bounded |
| Kết luận | **chọn** | **bỏ**: sai đơn vị dữ liệu (kiểm kê ≠ chuỗi thời gian), làm bẩn khái niệm coverage | **bỏ**: vi phạm ranh giới đã ghi, không có baseline, không có độ mới |

Biến thể D (chỉ đọc node `act_<id>`, lấy hiệu `amount_spent` giữa hai lượt, 1 gọi): rẻ hơn A một
nửa nhưng hiệu số giữa hai mốc UTC không trùng "ngày của tài khoản", và ý nghĩa `amount_spent`
chưa kiểm. **Bỏ làm nguồn chính; giữ `amount_spent` như trường phụ trên quan sát** vì nó nằm trong
cùng một GET node, không tốn thêm.

### 4b. Thiết kế A — chi tiết

**Từ vựng (G1, G2)**

- `SpendFreshness`: `current` (quan sát thành công trong `spend_observation_stale_after_hours`) ·
  `stale` (có quan sát nhưng cũ) · `never_observed` (có thể đọc, chưa đọc lần nào) ·
  `not_observable` (không có BM/connection `production`/credential để đọc). Bốn trạng thái, không gộp
  (rule 28). **Không trạng thái nào được render xanh** — chi tiêu là số liệu, không phải "tốt/xấu".
- `HealthSourceType.PROVIDER_OBSERVATION = "provider_observation"` — tín hiệu suy từ dữ liệu nền tảng
  đọc qua một reader có tên. Giá trị mới, không migration (§2b).
- `HealthCategory.SPEND = "spend"` — nhóm riêng trên UI; frontend `HealthCategory` union
  (`lib/types.ts:244`) thêm `'spend'`.
- `EvaluationTrigger.SPEND_OBSERVATION = "spend_observation"` — để `HealthEvaluationRun.trigger_reference_id`
  trỏ đúng quan sát gây ra lần đánh giá. Không migration.
- `OperationalRunKind.SPEND_SWEEP = "spend_sweep"`.

**Dữ liệu (G5, G6) — migration `0016_s1_spend_observations`, một bảng, cộng thêm, không sửa bảng A1**

`ad_account_spend_observations` (`UUIDPrimaryKey, Timestamped, Archivable` — rule 2; **append-only**,
không có đường UPDATE ngoài `archived_at`):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `workspace_id` | FK | như mọi bảng (rule 8) |
| `ad_account_id` | FK `ad_accounts` | tài khoản registry |
| `meta_connection_id` | FK `meta_connections` | connection nào, tức BM nào, đã đọc |
| `reader_source` | `varchar(32)` | `business_specific / server_default` (tên, không bao giờ giá trị — rule 40) |
| `provider_actor_external_id`, `provider_actor_name` | nullable | ai đọc (mẫu `BusinessManagerDiscoveryRun:110-111`) |
| `observed_at` | tz-aware | UTC, lúc sweep gọi |
| `status` | `succeeded / failed` | `failed` kèm `failure_code` (`MetaFailureCode` dạng text, như discovery `:102`) + `failure_summary` an toàn |
| `observed_currency` | `varchar(3)`, nullable | **Meta trả**, không ghi đè `AdAccount.currency` |
| `observed_timezone_name` | `varchar(64)`, nullable | Meta trả (`timezone_name`) |
| `observed_account_status` | `varchar(16)`, nullable | mã số Meta **dạng chuỗi nguyên bản**, chưa diễn giải (dành cho Phase 2) |
| `observed_disable_reason` | `varchar(16)`, nullable | như trên — đọc kèm vì cùng GET; **không luật nào dùng trong S1** (câu hỏi §6.5) |
| `amount_spent_raw`, `spend_cap_raw`, `balance_raw` | `varchar(32)`, nullable | **giữ nguyên chuỗi Meta trả**, không chia 100, không đổi đơn vị — đơn vị chưa kiểm; diễn giải là việc của bước sau khi đã đo thật |
| `daily_json` | JSON | danh sách `{date_start, date_stop, spend, account_currency}` **đúng như Meta trả**, mỗi phần tử một ngày; ngày không có dòng thì **không có phần tử** (không chèn 0) |
| `window_since`, `window_until` | `date` | cửa sổ đã xin (8 ngày địa phương gần nhất) |
| `safe_metadata_json` | JSON, nullable | allowlist như `DiscoveredAdAccountObservation` |

Index: `(workspace_id, ad_account_id, observed_at desc)`; `(workspace_id, status, observed_at)`.

Trường **bị cấm đọc**: `funding_source_details`, `funding_source`, bất kỳ thứ gì mô tả phương thức
thanh toán — A1 loại trừ dữ liệu thanh toán (`PaymentProfileReference` chỉ là nhãn,
`entities.py:222-227`). Một test khẳng định `SPEND_ACCOUNT_FIELDS` không chứa chuỗi `funding`.

**Provider (G4)** — thêm vào `MetaBusinessProvider` (`meta_provider.py:298`) một phương thức:

```
read_account_spend(external_account_id: str, *, since: date, until: date) -> SpendRead
```

`SpendRead` (frozen dataclass): `ok`, `failure_code`, `failure_summary`, `currency`, `timezone_name`,
`account_status_raw`, `disable_reason_raw`, `amount_spent_raw`, `spend_cap_raw`, `balance_raw`,
`daily: tuple[DailySpend, ...]`, `rate_limit_header`. Real provider: GET `act_<id>` với
`SPEND_ACCOUNT_FIELDS = "account_id,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,balance"`,
rồi GET `act_<id>/insights` với `fields=spend,account_currency,date_start,date_stop`, cửa sổ theo
`time_range` (tên tham số theo mã AdsCommand `lib/writes/outcome.ts:135`), tách theo ngày
(`time_increment=1` — **chưa kiểm**, xác nhận ở lần đọc thật đầu). Mỗi edge trả lỗi → `ok=False`
với mã; không retry trong provider. Fake provider: `queue_spend_result(external_id, SpendRead)`,
mặc định trả `ok=False, not_configured` — **mặc định không bịa số**.

Transport **không đổi**: vẫn GET; `_WRITABLE_PATH` không đổi; `test_only_named_modules_may_make_an_outbound_request`
không đổi (rule 20 nguyên vẹn).

**Múi giờ và tiền tệ**

- "Ngày" là ngày **theo `observed_timezone_name`** của tài khoản, đúng chuỗi `date_start` Meta trả.
  Không quy về UTC, không cộng/trừ giờ. `observed_at` là UTC và chỉ dùng cho độ mới.
- "Ngày hoàn chỉnh gần nhất" = hôm qua **theo múi giờ tài khoản**, tính tại `observed_at`. Không có
  `timezone_name` → không xác định được ngày hoàn chỉnh → luật theo ngày trả `unknown` (bảng dưới).
- Ngày trong cửa sổ mà Meta **không trả dòng** là `no_row`, hiển thị "—", **không bao giờ là 0** (rule 4).
  Meta có trả dòng 0 cho ngày không phân phối hay bỏ hẳn — **chưa kiểm**; test fixture phải dựng cả hai.
- Tiền tệ dùng để nhóm là **`observed_currency`** (Meta), không phải `AdAccount.currency` (gõ tay).
  Hai giá trị lệch → tín hiệu `attention` (luật 3 dưới). **Không bao giờ cộng hai tiền tệ**
  (`FEATURES.md:728` giữ nguyên). Không quy đổi tỷ giá.
- Container chạy UTC, workspace của người dùng UTC+7: test ranh giới ngày phải chạy với `now` UTC
  và tài khoản `Asia/Ho_Chi_Minh` ở cả hai phía nửa đêm.

**Sweep (G3, G11, G12)** — `spend_sweep_pass(batch)` trong `run_dispatcher.py`, cùng khuôn
`health_sweep_pass`:

1. Cadence `spend_sweep_every_n_passes` (**mặc định 0 = tắt**; bật là quyết định phát hành, cùng lý
   lẽ `config.py:132-134`), `spend_sweep_batch` (mặc định 10 tài khoản/workspace/lượt),
   `spend_observation_stale_after_hours` (mặc định 26: lượt hằng giờ + 2 giờ đệm, cùng mẫu
   `backup_stale_after_hours`).
2. Chọn: tài khoản chưa archive, có `external_account_id`, có BM mà **đúng một** connection
   `production` với `reader_source != none` đang trỏ tới (nhiều connection cùng BM — đã xảy ra thật,
   `FEATURES.md:259-262` — chọn connection có `business_manager_source = connection`, rồi cũ nhất).
   Thứ tự: `never_observed` trước, rồi `stale` cũ nhất. Phần không chọn được → `not_observable`
   đếm riêng, **không** coi là đến hạn.
3. Mỗi tài khoản: `provider.read_account_spend(...)` → ghi **một** quan sát (kể cả `failed`) →
   `evaluate_account_safe(account, trigger=SPEND_OBSERVATION, trigger_reference_id=observation.id)`
   (rule 15/21 giữ nguyên).
4. `rate_limited` ở bất kỳ tài khoản nào → **dừng lượt cho connection đó**, đếm `rate_limited`,
   phần còn lại nằm trong `due_remaining`. Không ngủ, không retry trong lượt.
5. Ghi `OperationalRun(kind=SPEND_SWEEP, summary={never_observed, stale, observed, failed,
   rate_limited, not_observable, due_remaining, workspaces})` — thêm `rate_limited`, `observed`,
   `not_observable`, `never_observed` vào `SAFE_SUMMARY_KEYS` (`operations.py:27-39`), nếu không chúng
   bị bỏ lặng.
6. Audit (rule 3): một dòng `spend.observations_recorded` **mỗi workspace mỗi lượt**, `after` =
   counters + danh sách `ad_account_id` đã đọc (bounded bởi batch) — theo tiền lệ discovery ghi audit
   **theo run** chứ không theo từng observation (`meta_discovery.py:586-597`). Một dòng mỗi quan sát
   sẽ là 720 dòng/ngày cho 30 tài khoản hằng giờ; không chọn.
7. Lệnh tay: `python -m app.commands.run_dispatcher --spend-sweep` (một lượt rồi thoát), để bật
   thử trước khi bật cadence — giống `--health-sweep` (`run_dispatcher.py:299-304`).

**Luật sức khoẻ (G7, G8)** — ba luật `v1`, thêm vào `HEALTH_RULES_V1` (registry tăng 10 → 13),
`HealthFacts` thêm `spend: SpendFacts | None` lắp trong `_facts` từ **DB** (quan sát thành công mới
nhất + tối đa 14 ngày `daily` gần nhất gộp từ các quan sát, mỗi ngày lấy quan sát mới nhất):

| `rule_key` | Category | Severity | Nổ khi | Đóng khi |
|---|---|---|---|---|
| `spend_observation_missing_or_stale` | `spend` | `attention` | tài khoản **có thể đọc** (có connection+reader) nhưng `never_observed`, hoặc quan sát thành công mới nhất cũ hơn `spend_observation_stale_after_hours`, hoặc 3 quan sát gần nhất đều `failed` (evidence mang `failure_code` mới nhất) | có quan sát thành công trong hạn |
| `spend_change_vs_baseline` | `spend` | `warning` | có ngày hoàn chỉnh gần nhất **và** baseline = trung vị của ≥ `spend_baseline_min_days` (mặc định 5) ngày hoàn chỉnh trước đó có dòng; `spend_hôm_qua` lệch ≥ `spend_change_ratio_threshold` (mặc định 0.5, hai chiều) **và** \|delta\| ≥ `spend_change_min_amount` theo tiền tệ (mặc định: không đặt → luật không nổ cho tiền tệ chưa có ngưỡng — câu hỏi §6.1) | ngày hoàn chỉnh mới nhất không còn lệch; hoặc hết baseline (→ không nổ, không phải "đóng vì đã ổn": engine ghi `resolved_by=NULL` như mọi luật) |
| `spend_cap_approaching` | `spend` | `warning` | `spend_cap_raw` và `amount_spent_raw` đều có, parse được thành số, cùng đơn vị (**đơn vị chưa kiểm → luật chỉ bật sau khi lần đọc thật đầu xác nhận**), và `amount_spent / spend_cap ≥ spend_cap_ratio_threshold` (mặc định 0.9) | tỷ lệ xuống dưới ngưỡng hoặc cap được bỏ |

Thêm một luật nhỏ cùng nhóm, `attention`: `spend_currency_mismatch` — `observed_currency` ≠
`AdAccount.currency` khi cả hai có. Rẻ, và là điều kiện để "không bao giờ cộng sai tiền tệ".

**Suy giảm khi thiếu dữ liệu (rule 4 / 28)** — bảng là hợp đồng, test theo từng dòng:

| Thiếu gì | Độ mới hiển thị | Luật theo ngày | Luật cap | Rollup |
|---|---|---|---|---|
| Không có connection/reader | `not_observable` | không nổ | không nổ | không đổi (health không biết gì về chi tiêu — và nói vậy trên UI) |
| Có reader, chưa đọc lần nào | `never_observed` | không nổ | không nổ | `attention` (luật 1) |
| Quan sát mới nhất `failed` (`permission_missing`, `token_expired`, …) | theo quan sát thành công gần nhất, kèm mã lỗi | dùng dữ liệu cũ **nếu** còn trong hạn | như bên | luật 1 khi quá hạn hoặc 3 lần `failed` |
| Không có `timezone_name` | như thường | **`unknown`**: không xác định được "hôm qua" → không nổ, evidence ghi `missing_input=timezone_name` | không ảnh hưởng | không đổi |
| Ngày hôm qua không có dòng | hiển thị "—" | **không nổ** (không có dòng ≠ 0; chỉ nổ "drop" khi có dòng với số nhỏ) | — | — |
| < `spend_baseline_min_days` ngày có dòng | hiển thị số ngày có | không nổ, evidence `baseline_days_available` | — | — |
| `spend_cap_raw` rỗng/`0`/không parse | — | — | không nổ | — |
| Tiền tệ lệch giữa node và insights (`account_currency`) | hiển thị cả hai | không nổ (dữ liệu mâu thuẫn ≠ bằng chứng) | không nổ | `attention` qua `spend_currency_mismatch` |

Không dòng nào trong bảng tạo ra `clear_signals`: không có luật chi tiêu nổ **không** có nghĩa chi
tiêu ổn, chỉ có nghĩa "không phát hiện gì bởi các kiểm tra đã cấu hình" (rule 13 giữ nguyên).

**Alert (rule 16)** — không sửa `alert_rules.py`: `warning` → alert `warning` (ứng viên Telegram theo
chính sách hiện có), `attention` → `info` trong Alert Center. Tiêu đề lấy từ `HealthRule.name`,
`recommended_next_step` của mỗi luật ghi bước **thủ công** ("Mở Ads Manager, đối chiếu chi tiêu
ngày … với …"), không bao giờ gợi ý tạm dừng/đổi ngân sách từ sản phẩm này.

**API (G9)** — cùng quy ước A1 (bearer, scope từ membership, `404` ngoài scope, envelope lỗi):

| Method | Path | Ghi chú |
|---|---|---|
| `GET` | `/ad-accounts/{id}/spend` | quan sát thành công mới nhất (currency, timezone, raw cap/spent/balance **dưới dạng chuỗi**), `freshness`, `reader_source`, `read_as`, `daily[]` (≤ 14 ngày, **chỉ ngày có dòng**), `baseline` (nếu đủ), `disclaimer`. Không gọi Meta |
| `GET` | `/ad-accounts/{id}/spend/observations` | lịch sử quan sát, phân trang, kể cả `failed` với mã |
| `POST` | `/ad-accounts/{id}/spend/refresh` | **owner-only**, một tài khoản, gọi Meta **một lần** vì một người bấm (cùng lý lẽ `run_discovery`), ghi quan sát + audit với actor thật, trả như `GET …/spend`. Chịu rate limit chung (`300/phút/subject`) |
| `GET` | `/spend/summary` | đếm tài khoản theo `SpendFreshness` (4 trạng thái, tách riêng); **tổng theo từng tiền tệ** cho ngày hoàn chỉnh gần nhất, mỗi nhóm kèm `accounts_included` / `accounts_without_row` / `accounts_not_current` — một nhóm thiếu tài khoản vẫn hiện số nhưng gắn `complete: false`; **không có** tổng chung |
| `GET` | `/operations/runs?kind=spend_sweep` | đã có sẵn (`API.md:452`) |

`disclaimer` cố định: *"Chi tiêu là số Meta trả về cho reader đã nêu, tại thời điểm quan sát. Không
phải hoá đơn, không phải số đã đối soát, và không nói gì về việc tài khoản có bị hạn chế hay không."*

**UI (G10)** — tối thiểu, theo mẫu có sẵn:

- `lib/spend.ts`: `SPEND_FRESHNESS_META` theo đúng khuôn `FRESHNESS_META` (`health.ts:48-75`) —
  `current: neutral`, `stale: caution`, `never_observed: neutral`, `not_observable: muted`. **Không
  `positive`**; test như `readiness.ts` đã có.
- Overview: một mục "Spend — ngày hoàn chỉnh gần nhất" dưới "Account health": một card mỗi tiền tệ
  (`VND 12.345.678 · 5/7 tài khoản · 2 chưa có số`), card "Chưa quan sát được: N" liên kết tới bảng
  lọc. Không có card tổng chung.
- Accounts: cột "Spend (hôm qua, giờ TK)" hiện số + mã tiền tệ hoặc "—", kèm badge độ mới; sort theo
  cột này **không** cộng tiền tệ (sort theo `(currency, amount)`).
- Account detail: tab mới **Spend**: card độ mới + reader; bảng 14 ngày (ngày địa phương, số, tiền
  tệ, quan sát lúc); card "Trần và số luỹ kế (chuỗi thô Meta trả)"; nút "Đọc lại từ Meta" (owner)
  với câu nói rõ nó tốn một lần gọi thật. Tab Health hiện luật nhóm `spend` như mọi luật khác.
- Account Health: "Configured checks" tự có 4 luật mới (owner tắt được bằng `PATCH …/rules/{key}`
  đã có).

**Cấu hình** (`core/config.py`, `.env.example`, container `dispatcher` trong compose):
`SPEND_SWEEP_EVERY_N_PASSES=0`, `SPEND_SWEEP_BATCH=10`, `SPEND_OBSERVATION_STALE_AFTER_HOURS=26`,
`SPEND_BASELINE_MIN_DAYS=5`, `SPEND_CHANGE_RATIO_THRESHOLD=0.5`, `SPEND_CHANGE_MIN_AMOUNT_JSON={}`
(theo tiền tệ, vd `{"VND": 500000, "USD": 20}`), `SPEND_CAP_RATIO_THRESHOLD=0.9`. **Container
`dispatcher` phải được cấp `META_ACCESS_TOKEN`, `META_ACCESS_TOKENS_BY_BUSINESS`, `META_BUSINESS_ID`,
`META_GRAPH_API_*`** — vẫn chỉ là cấu hình máy chủ (rule 40), nhưng từ nay nằm ở **hai** container;
`docs/PRODUCTION_ENVIRONMENT.md` phải ghi.

**Test cần có** (đặt tên theo kiểu `tests/test_scheduled_health_sweep.py`):

- `test_s1_spend_provider.py`: real provider với transport stub — hai GET đúng path/fields; **không
  có chuỗi `funding` trong fields**; mỗi mã lỗi Graph → `SpendRead.ok=False` với mã; raw strings giữ
  nguyên; ngày không có dòng không được chèn; fake provider mặc định không bịa.
- `test_s1_spend_sweep.py`: `never_observed` trước `stale`; `not_observable` không bao giờ đến hạn;
  batch bounded; `rate_limited` dừng lượt cho connection đó và phần còn lại vào `due_remaining`;
  một tài khoản `failed` không dừng lượt; mỗi lượt ghi `OperationalRun` với đủ counters (kiểm qua
  `SAFE_SUMMARY_KEYS`); **tắt mặc định**; loop bỏ qua khi cadence 0; `--spend-sweep` chạy một lượt;
  dispatcher không có credential → mọi tài khoản `not_observable`, **0** lần gọi provider.
- `test_s1_spend_rules.py`: từng dòng của bảng suy giảm; ranh giới ngày UTC/`Asia/Ho_Chi_Minh` hai
  phía nửa đêm; baseline thiếu ngày → không nổ; lệch tiền tệ → `attention`; `spend_cap` không parse
  → không nổ; evidence chỉ chứa khoá allowlist; không luật nào phát `unknown` severity (giữ rule 10
  là luật duy nhất); `clear_signals` không bao giờ xuất phát từ dữ liệu chi tiêu.
- `test_s1_spend_api.py`: scope 404; `refresh` owner-only, gọi provider đúng **một** lần, ghi audit
  với actor; `summary` không có tổng chung, nhóm thiếu tài khoản gắn `complete: false`; `GET` không
  gọi provider.
- `test_health_security.py`/`test_alert_security.py`: allowlist module **không đổi**; snapshot/API
  không chứa `funding`; `daily_json` đi qua redactor.
- Frontend: `spend.ts` không có tone `positive`; Accounts không cộng tiền tệ khi sort.
- Migration: upgrade → downgrade → upgrade sạch (bước 5 của playbook).

**Tệp dự kiến đổi**: `core/enums.py` (4 giá trị), `core/config.py`, `models/spend.py` (mới),
`alembic/versions/0016_s1_spend_observations.py` (mới), `services/meta_provider.py` (interface +
fake), `services/meta_real_provider.py` (`read_account_spend`), `services/spend_service.py` (mới:
chọn tài khoản, ghi quan sát, lắp `SpendFacts`), `services/health_rules.py` (+4 luật),
`services/health_service.py` (`_facts`), `services/operations.py` (`SAFE_SUMMARY_KEYS`),
`commands/run_dispatcher.py` (pass + cờ), `api/v1/routers/spend.py` (mới), `schemas/spend.py` (mới),
`docker-compose.production.yml` (env dispatcher), `.env.example`, frontend `lib/spend.ts`,
`pages/account/SpendTab.tsx`, `Accounts.tsx`, `Overview.tsx`, `AccountDetail.tsx`, rồi
`FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`, `HEALTH_RULES_V1.md`,
`META_READ_ONLY_DISCOVERY.md` (§Bounds phải viết lại), `PRODUCTION_ENVIRONMENT.md`.

### 4c. Luật cứng bị chạm — và cách giữ

| Rule | S1 làm gì | Cần sửa luật? |
|---|---|---|
| 1 (không lưu credential) | không có cột/field/response nào mang token; `reader_source` là tên | không |
| 2 (không hard-delete) | bảng quan sát `Archivable`, append-only; **lịch sử lớn dần** (30 TK × 24/ngày ≈ 720 dòng/ngày) — chấp nhận, mỗi dòng nhỏ; archive định kỳ là follow-up | không |
| 3 (audit cùng transaction) | audit theo lượt/workspace + audit cho `refresh`; nằm trong cùng `session_scope` | không, nhưng **đây là một diễn giải** (theo run, không theo dòng) — nêu để người dùng biết |
| 4 / 28 | bảng suy giảm §4b; `no_row` ≠ 0; 4 trạng thái độ mới tách riêng | không |
| 5 | `SPEND_FRESHNESS_META` không có `positive`; test | không |
| 6 | `disclaimer` + `recommended_next_step` không hứa gì về hạn chế | không |
| 9 / 11 | luật nhận số, phát severity phân loại; rollup không có số mới; health không ghi readiness (không ghi `last_synced_at`) | không — nhưng **là lần đầu một luật suy từ số của nền tảng**; đã lập luận ở §2b |
| 13 | không đổi câu `clear_signals` | không |
| 14 / 16 | hành động trên tín hiệu/alert không chạm quan sát | không |
| 15 / 21 | `evaluate_account_safe` sau mỗi quan sát | không |
| 20 (module ra ngoài) | transport không đổi, GET; allowlist test không đổi | không |
| 22 (duyệt riêng cho hành động ra ngoài) | sweep là **đọc**, không deploy/không gửi; nhưng **bật cadence** là lần đầu Meta được gọi tự động → đề nghị coi việc đặt `SPEND_SWEEP_EVERY_N_PASSES>0` trên production là **một quyết định phát hành có tên người duyệt**, ghi vào `TEST_LOG.md` | **không sửa luật**, nhưng ghi thêm một câu vào `META_READ_ONLY_DISCOVERY.md` §Bounds và `CLAUDE.md` mục "Product state" |
| 26 | lỗi chỉ mang mã; `failure_summary` của transport đã an toàn | không |
| 37–39 | `refresh` chịu limiter chung; sweep không qua API | không |
| 40 | `resolve_reader` nguyên vẹn; thêm nơi **đọc** cấu hình (container dispatcher), không thêm nơi lưu | không |
| 41 | tài liệu này đo lại tất cả; `FEATURES.md:728` phải đổi câu sau S1 | — |
| Tiền đề "không timer" (3 tài liệu, không phải rule) | **thay đổi có chủ ý**: một pass, tắt mặc định, bounded, dừng khi `rate_limited`, ghi run, lệnh tay để thử | viết lại 3 chỗ, không để câu cũ đứng cạnh hành vi mới |

Không có hard rule nào cần sửa để làm S1. Nếu người dùng muốn **ghi `last_synced_at`** từ sweep
(câu hỏi §6.6) thì đó là đổi ý nghĩa `data_freshness` của readiness — phải là quyết định riêng.

### 4d. Ngoài phạm vi S1 (nói rõ)

| Không làm | Vì |
|---|---|
| Diễn giải `account_status` / `disable_reason` thành tín hiệu "bị khoá" | Phase 2 (ROADMAP); S1 chỉ lưu chuỗi thô |
| Quy đổi tiền tệ, tổng chung, ngân sách/chi tiêu cấp chiến dịch, CPC/CPA | khác câu hỏi; `FEATURES.md:728` |
| Ngưỡng theo workspace / UI chỉnh ngưỡng | `HEALTH_RULES_V1.md:56` đã hoãn; v1 là `Settings` |
| Đọc/ghi header `X-Business-Use-Case-Usage` | follow-up riêng; S1 chỉ đếm `rate_limited` |
| Tự dừng chiến dịch, đổi cap, bất kỳ ghi nào lên Meta | transport không đổi; rule 20/22 |
| Đọc bằng token khách qua mb-connect | Phase 4 (ROADMAP) — cần sửa rule 40 trước |
| Google Ads / TikTok | Phase 5; nhưng bảng quan sát đặt tên trung lập (`reader_source`, raw strings) để không phải migration lại |
| Gửi Telegram thật | vẫn cần rule 20/22 riêng; S1 chỉ tạo alert như mọi luật |
| Nâng phiên bản Graph | Phase 0; S1 **phụ thuộc** vào kết quả kiểm `v21.0` |

### 4e. Rủi ro

- **Đơn vị của `amount_spent`/`spend_cap`/`balance` chưa kiểm.** Vì thế S1 lưu chuỗi thô và luật
  cap chỉ bật sau lần đọc thật đầu tiên có người xem (ghi vào `TEST_LOG.md` đúng như A10 đã làm).
- **Insights có thể bỏ ngày không phân phối.** Thiết kế đã coi "không dòng" là không biết; nếu Meta
  trả dòng 0 thì 0 là số thật và luật "drop" sẽ nổ đúng.
- **Phiên bản `v21.0`** có thể bị Meta từ chối ngay GET đầu tiên → mọi tài khoản `failed` với
  `invalid_request`; sản phẩm sẽ báo đúng là không đọc được chứ không báo 0 — nhưng S1 vô dụng cho
  tới khi Phase 0 xử lý.
- **Hạn mức thật chưa biết.** Cadence mặc định tắt; người dùng chọn cadence (§6.2) sau lượt tay đầu.
- **Nhiều connection cùng BM** → quy tắc chọn một connection ở §4b; test cố định.
- **Lịch sử lớn dần** → follow-up archive sau N ngày (rule 2: archive, không xoá).

---

## 5. Xác nhận

Không gọi Meta, không gửi Telegram, không deploy, không migration, không đổi mã, không đổi scope/
authorization, không đổi provider thật. Cơ sở dữ liệu dev đang tắt và không được bật để viết tài
liệu này. Provider duy nhất mà bất kỳ đường mã nào có thể chạm vẫn là những gì `a8392b6` có.

---

## 6. Câu hỏi cho người dùng (chỉ những gì thuộc quyền người dùng)

1. **Ngưỡng lệch và mức tối thiểu theo tiền tệ** cho `spend_change_vs_baseline`: đề xuất ±50% so
   với trung vị 5–7 ngày **và** ≥ một mức tuyệt đối theo tiền tệ (ví dụ 500.000 VND / 20 USD). Tài
   khoản của đội dùng những tiền tệ nào? Không có mức tuyệt đối thì luật không nổ cho tiền tệ đó.
2. **Nhịp đọc**: mỗi giờ (≈1.440 gọi/ngày cho 30 TK) hay mỗi 6 giờ (240/ngày)? Sẽ chạy một lượt
   tay trước để xem Meta trả gì về hạn mức rồi mới chốt.
3. **Tài khoản nào trước**: chỉ BM `1993884657458857` (connection `production` đang có) hay cả BM
   thứ hai `109796697343603` (cần token riêng — Phase 0)?
4. **`spend_cap_approaching` ở 90%** có đúng cách đội đặt trần không, hay đội không dùng `spend_cap`
   trên Meta (thì bỏ luật này khỏi S1)?
5. **Đọc kèm `disable_reason`/`account_status` ngay trong S1** (cùng một GET, không luật nào dùng)
   để Phase 2 có sẵn lịch sử — hay để Phase 2 mới đọc? Đề xuất: đọc ngay, lưu thô.
6. **Có cho sweep ghi `AdAccount.last_synced_at` không?** Làm vậy readiness sẽ báo `data_freshness =
   current` cho tài khoản được đọc chi tiêu. Đề xuất: **không** trong S1.
7. **Ai là người duyệt** việc bật `SPEND_SWEEP_EVERY_N_PASSES` trên production lần đầu (tên, ngày) —
   để ghi vào `TEST_LOG.md` như một quyết định có chứng cứ.
8. Có cần hiển thị **ngày hôm nay (chưa hoàn chỉnh)** trên UI không? Đề xuất: hiện tách riêng, gắn
   nhãn "chưa hết ngày", không dùng cho luật.

---

## 7. Quyết định của người dùng (2026-10-26)

| § | Quyết định |
|---|---|
| 4 (thiết kế) | Chọn **thiết kế A**: sweep ghi quan sát theo ngày |
| 6.1 | Ngưỡng **±50%** so với trung vị của **≥5 ngày**. Tiền tệ đang dùng: **VND và USD**. Mức tối thiểu tuyệt đối dùng theo đề xuất: **500.000 VND / 20 USD** (người dùng chỉnh được) |
| 6.2 | Nhịp đọc **mỗi giờ**. Chạy một lượt tay trước để xem phản hồi hạn mức của Meta. Trên production vẫn để **tắt** cho tới khi duyệt theo §6.7 |
| 6.3 | Chỉ BM `1993884657458857`. BM `109796697343603` để Phase 0, khi có token riêng |
| 6.4 | Đội **có dùng `spend_cap`** → giữ `spend_cap_approaching` (≥90%) |
| 6.5–6.6, 6.8 | Chưa hỏi riêng, áp đề xuất: đọc kèm `account_status`/`disable_reason` và lưu thô; **không** ghi `last_synced_at`; hiển thị riêng ngày hôm nay chưa hết, gắn nhãn, không đưa vào luật |
| 6.7 | Người duyệt bật sweep trên production lần đầu: chủ dự án, duyệt riêng khi tới lúc (rule 22). Chưa duyệt |
