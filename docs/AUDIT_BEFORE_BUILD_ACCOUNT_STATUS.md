# Audit Before Build — Tài khoản bị khoá / bị hạn chế (Meta, chỉ đọc) — S2

Ngày: 2026-10-27 · Baseline `6492b3e` (S1) **cộng working tree chưa commit** (xem §0) · **Đây là bản
audit, không phải bản build.** Không một dòng mã sản phẩm nào được sửa để viết tài liệu này; không gọi
Meta, không gửi Telegram, không deploy, không migration.

Đây là MINI-SPEC bước 1–3 theo `MINI_SPEC_PLAYBOOK.md`. Bước 4 (code) chỉ bắt đầu khi người dùng
chốt các câu hỏi ở §6. Khuôn tài liệu theo `docs/AUDIT_BEFORE_BUILD_SPEND.md` (S1); thiết kế A của
S1 là tiền đề: **quan sát đã nằm trong DB trước khi đánh giá sức khoẻ**, và S2 tái dùng đúng đường đó.

---

## 0. Đo được gì, không đo được gì

Rule 41: mọi khẳng định về trạng thái sản phẩm dưới đây là **đo tại thời điểm viết**, kèm cách đo.

| Nguồn | Trạng thái lúc viết | Hệ quả |
|---|---|---|
| Mã nguồn | đọc trực tiếp tại `6492b3e`; `grep` toàn `backend/app`, `frontend/src`, `extension/src` | mọi `file:line` dưới đây là của commit này, trừ chỗ ghi "working tree" |
| Working tree chưa commit | `git status` (2026-10-27): `M CLAUDE.md`, `M backend/app/api/v1/routers/ad_accounts.py`, `M backend/app/services/spend_service.py`, `M docs/VIBEHOST_SUPPORT_REQUEST.md`, `?? backend/tests/test_s1_accounts_list_spend.py` — là follow-up S1 "cột chi tiêu trên danh sách tài khoản" (`list_compact_spend`, `data["spend"]` trong `list_accounts`) | S2 **phụ thuộc** vào việc follow-up này được commit trước (§4b API); tài liệu này không sửa nó |
| Cơ sở dữ liệu dev (`localhost:5434`) | **tắt** — `scripts/dev.sh status`: `backend answering=NO`, `frontend answering=NO` | không đếm được dòng/bảng; theo ghi chú working tree của `CLAUDE.md` (2026-10-26) DB dev đã được dựng lại **rỗng** (0 user, 0 BM, 0 tài khoản) |
| Production (Vibe Host) | **không đo lại hôm nay.** Ghi chú working tree `CLAUDE.md` (đo 2026-10-26, phiên trước): stack `audit-ads` chỉ có project api, `list_env` không có `META_*` lẫn `RUN_DISPATCHER_IN_API` → **production không chạy dispatcher, không có credential Meta, chưa từng chạy sweep nào** | mọi "độ trễ phát hiện" ở §2c là của thiết kế, **không phải** của hệ thống đang chạy |
| Meta Graph API | **không gọi** (rule 22) | mọi điều về hành vi Meta với tài khoản bị khoá đánh dấu **[CHƯA KIỂM]** |
| Tài liệu Meta | đọc **chỉ đọc** `developers.facebook.com/docs/marketing-api/reference/ad-account/` ngày 2026-10-27, hai lần (lần hai yêu cầu trích nguyên văn) | bảng mã §2f là của trang này; **ví dụ trên trang dùng `v26.0`/`v25.0`**, sản phẩm ghim `v21.0` (`core/config.py:85`) → `v21.0` còn được phục vụ không vẫn **[CHƯA KIỂM]** (S1 §2e đã nêu, Phase 0 ROADMAP) |
| Telegram thật | theo `CLAUDE.md` bảng Product state (đo 2026-09-14): chưa từng có dòng `SENT`; DB ấy nay không còn (ghi chú 2026-10-26) | "đường Telegram" ở §2d là đường **trong mã**, chưa có bằng chứng đã gửi thật |

---

## 1. Khoảng trống, nói chính xác

Người dùng xếp "tài khoản bị khoá / vô hiệu" là nỗi đau số 2 (sau chi tiêu, `ROADMAP_COMMERCIAL.md:14`).
Sản phẩm hôm nay biết về trạng thái tài khoản **đúng một điều: người vận hành đã gõ gì vào ô
"Account status"** (`AdAccount.status`, `entities.py:159-161`; form `AccountFormDrawer.tsx:250-251`:
*"Record what you observed. Leave as Unknown if you have not checked."*). Trạng thái **Meta nói** đã
được đọc về và lưu ở **hai nơi** (§2a) nhưng:

- **không luật nào đọc** (`health_rules.py`: chỉ `facts.account.status` ở `:79`, `:124`, `:148`);
- **không màn hình nào hiển thị** (grep `account_status_raw|disable_reason` trong `frontend/src`: chỉ
  khai báo kiểu `lib/types.ts:1133-1134`; `extension/src`: 0 kết quả);
- **không nơi nào đối chiếu** với `AdAccount.status`.

"Theo dõi tài khoản bị khoá" ở đây được hiểu là: **mỗi tài khoản, trạng thái Meta trả về gần nhất là
gì (mã + lý do vô hiệu), quan sát lúc nào, số đó mới đến đâu; khi trạng thái đó chuyển sang "không
hoạt động" thì mở tín hiệu và báo ngay theo chính sách alert có sẵn; khi trở lại thì tín hiệu tự đóng;
và khi Meta nói khác với sổ ghi của đội thì nhắc đội cập nhật sổ** — không bao giờ tự ghi đè sổ, không
bao giờ nói "không bị khoá", không kháng cáo, không hành động thay người.

---

## 2. Bước 1 — Audit: cái gì đã có (kiểm trong mã, không giả định)

### 2a. Mọi nơi trạng thái Meta của tài khoản được đọc / lưu / trả ra hôm nay

| # | Mảnh | Ở đâu | Dùng ở đâu tiếp |
|---|---|---|---|
| 1 | **A10.1 discovery** xin `account_status` (không xin `disable_reason`) | `AD_ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name"` `meta_real_provider.py:79` | `_ad_account_from_row` giữ `account_status` dạng chuỗi vào `DiscoveredAsset.safe_metadata` `:149-153` |
| 2 | …lưu vào `discovered_ad_account_observations.safe_metadata_json` | `meta_discovery.py:250-259` (`:257`) | **không nơi nào đọc ra**: grep `safe_metadata` trong `backend/app/api`, `backend/app/schemas`, `frontend/src` → **0 kết quả**. Reconciliation (`meta_discovery.py:405-487`) chỉ so **id**; giá trị `METADATA_MISMATCH` của `AssetReconciliationStatus` (`enums.py:608`) **có tên, có nhãn frontend** (`DiscoverySection.tsx:30`) nhưng **không bao giờ được sinh** (grep ngoài `enums.py`: chỉ nhãn) |
| 3 | **S1 spend read** xin `account_status,disable_reason` cùng một GET node | `SPEND_ACCOUNT_FIELDS` `meta_real_provider.py:89-91`; đọc vào `base` `:434-448` (`:441-442`), qua `_raw` (`:113-118`: strip, cắt 32 ký tự, `None` giữ `None`) | `SpendRead.account_status_raw / disable_reason_raw` (`meta_provider.py:325-326`) |
| 4 | …**kể cả khi insights thất bại**: node đã trả lời thì `base` vẫn đi kèm `SpendRead(ok=False)` | `meta_real_provider.py:462-471` | `spend_service.read_and_record` ghi `observed_account_status` / `observed_disable_reason` **cho mọi dòng, kể cả `failed`** (`spend_service.py:279-280`, cắt 16 ký tự) |
| 5 | …bảng `ad_account_spend_observations`, cột `observed_account_status`, `observed_disable_reason` `varchar(16)`, chú thích *"Not interpreted in S1"* | `models/spend.py:70-72`; migration `0016_s1_spend_observations.py` | `_view` chép sang `ObservationView.account_status_raw / disable_reason_raw` (`spend_service.py:144-145`; `spend_engine.py:96-97`) |
| 6 | …API trả thô | `routers/spend.py:63-64` trong `latest_observation` của `GET /ad-accounts/{id}/spend` và từng dòng của `GET …/spend/observations`; `API.md:905-906` ví dụ `"1"`/`"0"`, `:956-957`: *"stored for a later spec; S1 interprets neither"* | frontend chỉ **khai báo kiểu** `SpendObservation.account_status_raw / disable_reason_raw` (`lib/types.ts:1133-1134`); `pages/account/SpendTab.tsx` **không render** (grep `account_status`: 0) |
| 7 | `SpendFacts` giữ `latest_success` / `latest_attempt` (có trường thô) nhưng **không có khái niệm trạng thái** và không nhìn quan sát trước đó | `spend_engine.py:139-227`, `:254-345` | `HealthFacts.spend` (`health_rules.py:64-67`) — 4 luật spend không đụng trường này |
| 8 | Fixture test S1 đã gieo `account_status_raw="1"`, `disable_reason_raw="0"` | `tests/s1_spend_helpers.py:100-101` | tiền lệ cho fixture S2 |

Hai điều rút ra: (1) **dữ liệu S2 cần đã được ghi mỗi lần đọc chi tiêu, không cần thêm trường, không
cần thêm GET** — chính là điều S1 §6.5 chọn "đọc ngay, lưu thô"; (2) kho A10.1 (mảnh 1–2) **không dùng
được** làm nguồn S2: chỉ chạy khi người bấm, theo BM chứ không theo tài khoản theo thời gian, không
có `disable_reason` (§4a, ứng viên C).

### 2b. Trạng thái **người ghi** đi đâu hôm nay (đường "bị khoá" duy nhất đang có)

| Mảnh | Ở đâu |
|---|---|
| Từ vựng `AccountStatus`: `unknown / active / warning / restricted / disabled / archived` — **do người ghi** | `enums.py:30-36` |
| Ghi qua form → `PATCH /ad-accounts/{id}` → `trigger_health(ACCOUNT_MUTATION)` | `AccountFormDrawer.tsx:250-251`; `routers/ad_accounts.py:171-174`; `health_triggers.py:16-23` |
| Luật 1–2 `account_restricted_status` / `account_disabled_status`: `critical`, `source_type=ACCOUNT_STATUS`, evidence `"source": "operator-recorded account status"` | `health_rules.py:123-168`; `HEALTH_RULES_V1.md:13-14` |
| Readiness: `restricted/disabled` → lý do `critical` → `not_ready`; `unknown` → readiness `unknown` | `readiness.py:342-351`, `:395-404` |
| Preflight: `account_status_restricted_or_disabled` → finding `BLOCKING` | `preflight_account_context.py:38-48` |
| Alert snapshot và bảng Account Health mang `account_status` = **registry** | `alert_rules.py:94`; `routers/health.py:121`; `schemas/health.py:110` |
| `HealthSourceType` docstring: *"A manual observation must never look like platform data"* — và S1 đã thêm chiều ngược lại `PROVIDER_OBSERVATION` | `enums.py:183-194` |

Kết luận: **toàn bộ chuỗi "trạng thái → critical → alert → Telegram" đã tồn tại cho trạng thái người
ghi.** S2 không dựng chuỗi mới; S2 cắm một **nguồn thứ hai** vào đúng chuỗi đó, có nhãn nguồn riêng,
và **không** để nguồn thứ hai ghi vào nguồn thứ nhất.

### 2c. Có phát hiện được "đổi trạng thái giữa hai quan sát" chưa, và nhanh đến đâu

**Dữ liệu**: có. Mỗi lượt đọc là một dòng, mã thô nằm trên dòng; `recent_observations` nạp 21 ngày /
tối đa 200 dòng (`spend_service.py:51-53`, `:160-175`); `assemble` xếp mới nhất trước và tách
`successes` (`spend_engine.py:269-271`). Chưa có hàm nào so hai dòng với nhau (grep
`observed_account_status` trong `services/`: chỉ nơi ghi và nơi chép).

**Cơ chế "chuyển trạng thái" đã có sẵn trong engine, không cần luật so hiệu**:

| Sự kiện | Engine làm gì | Ở đâu |
|---|---|---|
| Điều kiện **xuất hiện** (lần đầu thấy mã "không hoạt động") | `sync` mở tín hiệu mới, audit `health_signal.opened` | `health_service.py:318-327`, `:227-270` |
| Điều kiện **còn**, evidence không đổi | chỉ chạm `last_evaluated_at`, giữ `acknowledged` | `:330-336` |
| Evidence **đổi đáng kể** (vd mã 3 → 2) | tín hiệu cũ `superseded`, tín hiệu mới mở; **alert key không đổi** (`health_signal:{account}:{signal_key}`) nên alert được **cập nhật**, chỉ gửi thêm khi **leo severity** | `:338-355`; `alert_rules.py:57-58`; `alert_service.py:338-361`, `:140-141` |
| Điều kiện **biến mất** (mã về `1`) | tín hiệu `resolved`, `resolved_by=NULL`, lý do *"The source condition is no longer true."* → alert `resolved` từ nguồn → **không có tin "đã hồi phục"** (v1) → tin đang chờ gửi bị **huỷ** | `health_service.py:357-378`; `alert_service.py:293-309`, `:365-369`; `ALERT_POLICY_V1.md` §1 dòng "resolved", §4.4, §7; `notification_service.py:392-407` |
| Khoá evidence hay đổi mà điều kiện không đổi | `VOLATILE_EVIDENCE_KEYS` loại khỏi hash (tiền lệ S1: `amount_spent_raw`) | `health_service.py:56-72` |

→ "Trở thành bị khoá kể từ quan sát trước" **= tín hiệu được mở**; "hồi phục" **= tín hiệu tự đóng**.
S2 chỉ cần đưa **mã quan sát trước** vào evidence để người đọc hiểu, không cần máy so hiệu riêng.

**Tốc độ phát hiện theo S1 hiện có** (tính từ thiết kế; production chưa chạy — §0):

| Tham số | Giá trị | Ở đâu |
|---|---|---|
| Vòng dispatcher | `DISPATCHER_INTERVAL_SECONDS=60` | `config.py:123`; `run_dispatcher.py:373-421` |
| Sweep chi tiêu chạy mỗi N vòng | `SPEND_SWEEP_EVERY_N_PASSES=0` (**tắt**); tài liệu vận hành gợi `60` = mỗi giờ | `config.py:151`; `PRODUCTION_ENVIRONMENT.md:91`; `run_dispatcher.py:409-411` |
| Tài khoản **đến hạn** chỉ khi lượt **thành công** gần nhất cũ hơn `SPEND_OBSERVATION_STALE_AFTER_HOURS` | mặc định **26** | `spend_service.py:372-375`; `config.py:158` |
| Mỗi lượt tối đa `SPEND_SWEEP_BATCH` tài khoản / workspace | 10 | `config.py:154`; `run_dispatcher.py:297-300` |
| Đánh giá sức khoẻ **ngay sau mỗi quan sát**, cùng transaction, SAVEPOINT riêng | `evaluate_account_safe(trigger=SPEND_OBSERVATION)` | `run_dispatcher.py:330-334` |
| Đọc tay một tài khoản (owner), ngay lập tức | `POST /ad-accounts/{id}/spend/refresh` | `routers/spend.py:171-206` |

Hệ quả cần nói to: **"mỗi giờ" (quyết định S1 §7/6.2) là nhịp sweep, không phải nhịp đọc mỗi tài
khoản.** Với `26` giờ, một tài khoản đang khoẻ được đọc lại **~1 lần/ngày** → một vụ khoá được thấy
**chậm nhất ~27 giờ** (+ hàng đợi batch). `PRODUCTION_ENVIRONMENT.md:92` đã ghi cách rút: đặt `2` với
sweep hằng giờ → **≤ ~3 giờ**, giá là 30 tài khoản × 2 GET × ~12 lượt/ngày ≈ 720 gọi/ngày (hạn mức thật
**[CHƯA KIỂM]**, S1 §2e). Đây là **quyết định của người dùng** (§6.1), không phải của S2.

**Đường tối** phải ghi vào bảng suy giảm (§4b): nếu Meta **từ chối đọc** node của tài khoản đã bị khoá
(**[CHƯA KIỂM]**), thì không có dòng thành công mới → tài khoản đến hạn **mỗi lượt** → chuỗi `failed`
→ luật 11 `spend_observation_missing_or_stale` nổ `attention` sau 3 lần (`health_rules.py:440-482`) —
còn mã trạng thái cuối cùng Meta trả vẫn là của lượt thành công cũ. Sản phẩm phải hiện đúng "lần cuối
Meta trả lời: … lúc …, các lượt sau bị từ chối: `permission_missing`", **không** hiện "đang hoạt động".

### 2d. Một thay đổi `account_status` sẽ đi đường alert / Telegram nào

Toàn bộ là mã có sẵn, không thêm module ra ngoài (rule 20):

```
quan sát mới (sweep / refresh)           run_dispatcher.py:315-334 · routers/spend.py:188-204
   └► evaluate_account_safe              health_service.py:641-686 (SAVEPOINT, rule 15)
        └► luật → SignalCandidate(critical)        (S2 thêm)
             └► sync → tín hiệu OPEN + audit       health_service.py:299-379
                  └► snapshot critical             health_service.py:405-442
                       └► derive_alerts_safe       alert_triggers.py:24-59 (SAVEPOINT lồng, rule 21)
                            ├► Alert(critical), key health_signal:{acct}:{signal_key}
                            │    title = rule.name · summary = evidence.message · next step = rule.recommended_next_step
                            │                                   alert_rules.py:24-29, :67-99 · alert_service.py:258-291
                            └► NotificationPlannerService.plan  notification_service.py:177-259
                                 ├► SKIPPED có lý do: no_recipient_configured (mặc định telegram_chat_id=None,
                                 │   alert_service.py:51-65) / policy_disabled / severity_delivery_disabled /
                                 │   alert_suppressed / timezone_not_configured       :210-234
                                 └► PENDING, scheduled_for=now; critical bỏ qua giờ yên lặng
                                     (critical_bypasses_quiet_hours=True mặc định)     :240-246
dispatcher one_pass mỗi 60 s → dispatch_due → _send_one → telegram_transport.send
                                 run_dispatcher.py:61-120 · notification_service.py:516-536, :391-515
mẫu tin a3-v1: severity, title, account, health, readiness, observed, Reason, Next step, link
                                 notification_templates.py:32-62, :125-144
```

Ba điều kiện thực tế để tin **đến tay**: `NOTIFICATION_TRANSPORT=telegram` + `TELEGRAM_BOT_TOKEN`
(server), `telegram_chat_id` trong policy workspace, **và dispatcher đang chạy** — production hiện
**thiếu cả dispatcher** (§0). Mẫu tin **không có ô riêng cho "trạng thái Meta"**: mã + nhãn + lý do vô
hiệu phải nằm trong `evidence.message` (→ `Reason:`) và trong `rule.name` (→ tiêu đề).

Độ trễ đầu-cuối = độ trễ phát hiện (§2c) + ≤ 60 s dispatch + retry (`1,5,15` phút, 3 lần —
`config.py:115-117`).

### 2e. Giao diện hiện có

| Bề mặt | Hiện gì | Ở đâu |
|---|---|---|
| Accounts: cột **Status** = registry, badge `accountStatusTone` (`active` → **xanh**) | `Accounts.tsx:165`, `:213-215`; `readiness.ts:59-72` |
| Account detail: header badge registry + readiness | `AccountDetail.tsx:100-105` |
| Overview tab: hàng "Platform status" = `humanise(account.status)` — **là trạng thái người ghi dù tên hàng nói "Platform"** | `pages/account/OverviewTab.tsx:56-63` |
| Account Health: cột status = registry (`row.account_status`) | `AccountHealth.tsx:247-249`; `routers/health.py:121` |
| Overview page: badge registry | `Overview.tsx:294` |
| Health tab: mỗi tín hiệu in `source {humanise(signal.source_type)}` → tín hiệu `provider_observation` **đã tự được dán nhãn nguồn** | `pages/account/HealthTab.tsx:273` |
| Spend tab: độ mới, 14 ngày, trần/luỹ kế thô, nút "Đọc lại từ Meta", lịch sử quan sát (cột: thời điểm, trạng thái lượt đọc, mã lỗi) — **không có cột trạng thái tài khoản** | `SpendTab.tsx` (grep) |
| "Configured checks": luật mới tự xuất hiện, owner bật/tắt | `AccountHealth.tsx:57-104`; `PATCH /account-health/rules/{key}` |
| Extension: API trả `account.status` (registry) nhưng `AccountIdentity` **không render** nó; `SpendState` render khối spend | `extension_summary.py:64-73` (`:71`), `:97`; `popup/ContextView.tsx:28-52`, `:145-190`; `shared/types.ts:41` |
| Bản đồ màu: `readiness.ts` (rule 5, nơi duy nhất); `FRESHNESS_META` **không bao giờ xanh** | `readiness.ts:12-72`; `health.ts:48-75` |

### 2f. Ngữ nghĩa Meta — chỉ ghi điều kiểm được từ tài liệu chính thức

Nguồn: `https://developers.facebook.com/docs/marketing-api/reference/ad-account/`, đọc 2026-10-27
(chỉ đọc). Trích nguyên văn ở lần đọc thứ hai.

**`account_status`** — kiểu `unsigned int32`, mô tả *"Status of the account:"*

| Mã | Tên Meta | Ghi chú |
|---|---|---|
| 1 | `ACTIVE` | |
| 2 | `DISABLED` | |
| 3 | `UNSETTLED` | |
| 7 | `PENDING_RISK_REVIEW` | |
| 8 | `PENDING_SETTLEMENT` | **thiếu** trong bảng của AdsCommand (`share-projects/ads-manager/lib/connect/meta-assets.ts:31` chỉ có 1,2,3,7,9,100,101) |
| 9 | `IN_GRACE_PERIOD` | |
| 100 | `PENDING_CLOSURE` | |
| 101 | `CLOSED` | |
| 201 | `ANY_ACTIVE` | đọc như **giá trị lọc** khi liệt kê, không phải trạng thái một node — **[CHƯA KIỂM]** node có bao giờ trả 201/202 không. S2 **không** ánh xạ 201 → `active` |
| 202 | `ANY_CLOSED` | như trên |

**`disable_reason`** — kiểu `unsigned int32`, mô tả *"The reason why the account was disabled. Possible
reasons are:"* `0 NONE · 1 ADS_INTEGRITY_POLICY · 2 ADS_IP_REVIEW · 3 RISK_PAYMENT ·
4 GRAY_ACCOUNT_SHUT_DOWN · 5 ADS_AFC_REVIEW · 6 BUSINESS_INTEGRITY_RAR · 7 PERMANENT_CLOSE ·
8 UNUSED_RESELLER_ACCOUNT · 9 UNUSED_ACCOUNT · 10 UMBRELLA_AD_ACCOUNT ·
11 BUSINESS_MANAGER_INTEGRITY_POLICY · 12 MISREPRESENTED_AD_ACCOUNT · 13 AOAB_DESHARE_LEGAL_ENTITY ·
14 CTX_THREAD_REVIEW · 15 COMPROMISED_AD_ACCOUNT`. Trang **chỉ cho tên**, không giải thích nghĩa.

**Quyền**: trang không nêu quyền để đọc node; chỉ nêu quyền theo trường (`funding_source` cần `MANAGE`
— sản phẩm **không bao giờ xin** trường này, `meta_real_provider.py:84-88`).

**[CHƯA KIỂM]** — phải ghi vào `TEST_LOG.md` ở lần đọc thật đầu tiên có người xem:

1. Tài khoản đã `DISABLED`/`CLOSED`: node `act_<id>` còn trả 200 với token hiện có, hay trả
   `permission_missing`/`invalid_request`? (quyết định đường tối §2c có xảy ra không)
2. `disable_reason` khi `account_status=1`: luôn `0`? Có khi nào ≠ 0 mà status vẫn 1?
3. Edge `insights` của tài khoản bị khoá còn trả dòng không? (ảnh hưởng `SpendRead.ok`, §2a mảnh 4)
4. Có mã nào ngoài bảng trên xuất hiện trong thực tế không (→ kiểm luật `unrecognised`).
5. `v21.0` còn được phục vụ không (Phase 0).
6. Nghĩa thực của từng `disable_reason` — bản dịch tiếng Việt ở §4b là **diễn giải từ tên**, BA duyệt.

**Nguyên tắc suy giảm (rule 4)**: mã **không có** → "không quan sát được trạng thái" (không phải
`unknown`); mã **có mà lạ** → `unknown`; **không bao giờ** suy ra `active` từ thiếu dữ liệu hay mã lạ.

---

## 3. Bước 2 — Khoảng trống và ranh giới (từ vựng của playbook)

| # | Khoảng trống | Loại | Trong S2? |
|---|---|---|---|
| G1 | Không có từ vựng nội bộ cho trạng thái **Meta trả** (tách với `AccountStatus` người ghi) và cho lý do vô hiệu; không có allowlist mã → nhãn | `vocabulary` | có — enum Python thuần, **không cột DB** |
| G2 | `SpendFacts`/`HealthFacts` không có mặt cắt "trạng thái nền tảng" (mã mới nhất, mã trước đó, quan sát nào, mới đến đâu) | `architecture` | có |
| G3 | Không luật nào suy từ `observed_account_status`; không luật đối chiếu Meta ↔ registry | `state_machine` | có — 4 luật |
| G4 | Hành vi khi mã thiếu / lạ / cũ / node trả lời nhưng insights lỗi / Meta từ chối đọc — chưa định nghĩa | `state_machine` | có — bảng suy giảm §4b |
| G5 | Không cột DB cần thêm (0016 đã có hai cột); `HealthRuleDefinition` seed lười | `data_model` | **không cần migration** |
| G6 | API không trả trạng thái **đã diễn giải**; danh sách tài khoản / detail / extension / summary không có khối trạng thái Meta | `API` | có — cộng thêm vào payload có sẵn |
| G7 | UI không có bề mặt nào cho trạng thái Meta; chưa có bản đồ màu; hàng "Platform status" ở Overview tab **đặt tên sai nguồn** | `frontend_UX` | có |
| G8 | Tin Telegram không có ô riêng cho trạng thái Meta → phải đi qua `message`/`rule.name`; câu chữ phải giữ rule 6 | `security` (wording) / `observability` | có — đề xuất câu chữ cho BA (§4b) |
| G9 | Không có bộ đếm sweep cho "bao nhiêu tài khoản đang ở mã không hoạt động" | `observability` | **không** — snapshot/alert đã đếm theo severity; thêm counter cần sửa `SAFE_SUMMARY_KEYS` (`operations.py:27-39`) → follow-up |
| G10 | Ba test ghim `len(HEALTH_RULES) == 14`; chưa có fixture quan sát theo mã trạng thái; chưa có test chuyển trạng thái qua `sync`/alert | `testing` | có |
| G11 | `HEALTH_RULES_V1.md`, `ARCH.md` §4j, `API.md`, `FEATURES.md`, `TEST_LOG.md`, extension i18n chưa biết S2 | `deployment` / tài liệu | có (bước 6) |
| G12 | Độ trễ phát hiện phụ thuộc `SPEND_OBSERVATION_STALE_AFTER_HOURS` và việc **bật sweep trên production** (chưa duyệt, S1 §6.7) | `deployment` | **không sửa gì** — là quyết định vận hành (§6.1, §6.7) |

**Lỗi không liên quan → follow-up, không phải phạm vi:**

- `HEALTH_RULES_V1.md:58-61` "Limitations" vẫn viết *"Every rule reads operator-entered records. Nothing
  here observes an advertising platform"* — **mâu thuẫn với chính `:7-9`** sau S1. Sửa câu khi làm S2 (cùng tệp).
- `pages/account/OverviewTab.tsx:63` hàng tên "Platform status" nhưng giá trị là registry — đổi nhãn
  khi S2 thêm hàng Meta (cùng màn), BA chốt chữ.
- `AssetReconciliationStatus.METADATA_MISMATCH` (`enums.py:608`) và nhãn `DiscoverySection.tsx:30`
  là từ vựng chết; `safe_metadata_json` của discovery chưa nơi nào trả ra. **Không** dùng S2 để hồi
  sinh (lý do §4a-C); ghi nhận.
- `entities.py:34` docstring `_enum` nói "VARCHAR + CHECK"; `0016…py:37,43` (và S1 §2b) cho thấy
  `sa.Enum(native_enum=False, length=48)` **không** sinh CHECK. Cùng lỗi với `ARCH.md:80-81` đã ghi ở S1.
- Extension nhận `account.status` mà không render (`extension_summary.py:71`; `ContextView.tsx:28-52`).
  S2 thêm trạng thái **Meta**; trạng thái người ghi trên extension là việc khác.
- Working tree chưa commit (§0) phải vào trước — S2 nối vào `list_compact_spend`, không viết lại.

---

## 4. Bước 3 — Thiết kế

### 4a. Ba ứng viên (và một biến thể bị bỏ)

| | **A — Diễn giải quan sát S1 (đề xuất)** | B — Sweep riêng "chỉ trạng thái" | C — Dùng kho A10.1 discovery |
|---|---|---|---|
| Cách làm | Module ánh xạ thuần (mã → enum allowlist) + mặt cắt `PlatformStatusFacts` lắp từ quan sát **đã có** + 4 luật; **không GET mới, không transport mới, không migration** | Pass mới 1 GET `act_<id>?fields=account_status,disable_reason` theo nhịp nhanh hơn, ghi quan sát loại mới | So `safe_metadata_json.account_status` của lượt discovery mới nhất với registry |
| Phát hiện nhanh đến đâu | = nhịp đọc S1 (§2c); rút bằng **cấu hình có sẵn** `SPEND_OBSERVATION_STALE_AFTER_HOURS` | nhanh tuỳ nhịp, nhưng **đường gọi Meta thứ hai** theo đồng hồ, bảng/loại quan sát thứ hai, gấp đôi số dòng | **chỉ khi người bấm** (`DiscoveryTrigger` cố ý không có `scheduled`, `enums.py:518-528`) → không phát hiện gì tự động |
| Có `disable_reason`? | có (S1 đã đọc) | có | **không** (`AD_ACCOUNT_FIELDS` không xin) |
| Lịch sử theo tài khoản? | có — mỗi dòng một mốc | có | theo **BM/run**, không phải chuỗi thời gian theo tài khoản |
| Chạm luật cứng | không (bảng §4c) | rule 22 lần nữa (một nhịp gọi tự động mới cần duyệt riêng); hạn mức chưa đo | không, nhưng vô dụng với mục tiêu |
| Kết luận | **chọn** | **bỏ trong S2**; giữ làm follow-up **nếu** lần đo hạn mức thật cho thấy đọc chi tiêu hằng giờ quá đắt mà trạng thái vẫn cần nhanh | **bỏ**: sai đơn vị dữ liệu, không có lý do vô hiệu, không có nhịp |

Biến thể **D — tự ghi `AdAccount.status` từ Meta**: bỏ. Phá tiền lệ *"Discovery never writes to the
registry by itself"* (`FEATURES.md:52-53`), trộn hai nguồn mà `HealthSourceType` cố ý tách
(`enums.py:184`), và vì `AdAccount.status` **lái readiness** (`readiness.py:342-351`) lẫn **chặn
preflight** (`preflight_account_context.py:38-48`) — một phép đọc nền tảng sẽ âm thầm đẩy readiness,
đúng điều rule 11 cấm với health và S1 §6.6 đã từ chối với `last_synced_at`. Thay vào đó: **một hành
động tường minh** do người bấm (§4b-UI).

### 4b. Thiết kế A — chi tiết

**Từ vựng (G1)** — `services/platform_status.py` (mới, thuần, không DB, không clock):

- `PlatformAccountStatus` (`StrEnum`, **không phải cột DB**, suy lúc đọc): `active` (1) · `disabled` (2) ·
  `unsettled` (3) · `pending_risk_review` (7) · `pending_settlement` (8) · `in_grace_period` (9) ·
  `pending_closure` (100) · `closed` (101) · `unknown` (mọi mã khác, kể cả 201/202, chuỗi rỗng, không
  phải số, số âm, quá dài). Hàm `interpret_account_status(raw: str | None) -> PlatformAccountStatus | None`:
  `None` → `None` ("không quan sát được"), còn lại strip → phải toàn chữ số → tra **allowlist**; không có
  → `unknown`. **Không có đường nào từ mã lạ ra `active`** — test ghim.
- `PlatformDisableReason`: 16 tên Meta (`none` … `compromised_ad_account`) + `unknown`; `None` khi thiếu.
  **Chỉ để giải thích**, không bao giờ đổi severity (nghĩa chưa kiểm — §2f mục 6).
- Hai tập hợp **phân loại** (categorical, rule 9): `BLOCKING = {disabled, closed, pending_closure}`,
  `PENDING = {unsettled, pending_settlement, in_grace_period, pending_risk_review}`. Việc `pending_closure`
  ở tập nào là câu hỏi §6.2.
- Không thêm giá trị `HealthCategory`: dùng lại **`account_status`** (cùng câu hỏi "tài khoản ở trạng thái
  gì", khác nguồn) với `source_type=PROVIDER_OBSERVATION` (`enums.py:191-194`); UI đã in nguồn
  (`HealthTab.tsx:273`). Lựa chọn thay thế — category mới `platform_status` — không chọn vì bộ lọc
  category trên Health sẽ tách hai mặt của cùng một câu hỏi; nếu người dùng muốn tách, thêm enum không
  cần migration (§2b S1). Không thêm `HealthSourceType`, `EvaluationTrigger`, `OperationalRunKind`.

**Mặt cắt dữ liệu (G2)** — `PlatformStatusFacts` (frozen dataclass), lắp trong `spend_engine.assemble`
từ **cùng danh sách quan sát** đã nạp (không thêm query trong đường thường):

| Trường | Nguồn | Ghi chú |
|---|---|---|
| `observation_id`, `observed_at`, `observation_status` (`succeeded`/`failed`) | quan sát **mới nhất có `account_status_raw ≠ None`**, bất kể lượt đọc thành công hay không | node trả lời là bằng chứng Meta nói, kể cả khi insights lỗi (§2a mảnh 4). Khác với `latest_success` của spend — cố ý, và evidence ghi rõ `observation_status` |
| `account_status_raw`, `status` | thô + `interpret_account_status` | |
| `disable_reason_raw`, `disable_reason` | thô + enum | |
| `freshness` | `derive_freshness` S1 với `observed_at` của quan sát trên và cùng `stale_after_hours` | 4 trạng thái của `SpendFreshness`, tái dùng; `None` khi không có mã nào |
| `previous_account_status_raw`, `previous_observed_at` | quan sát gần nhất **trước** chuỗi mã hiện tại có mã **khác** (trong cửa sổ 21 ngày / 200 dòng) | để người đọc thấy "trước đó là 1, từ lúc …"; **không** là đầu vào của luật |
| `since_observed_at` | quan sát cũ nhất **liên tiếp** cùng mã trong cửa sổ | cận dưới, có thể cũ hơn thật (cửa sổ) — evidence ghi *"ít nhất từ"* |
| `registry_status` | `AdAccount.status` | cho luật đối chiếu |

Ngoài cửa sổ không có mã nào nhưng DB có dòng cũ hơn: một query dự phòng
`latest_status_answer_any_age` theo đúng khuôn `latest_success_any_age` (`spend_service.py:178-193`) —
để tài khoản rất cũ báo `stale` chứ không "không quan sát được" (rule 28). `HealthFacts` thêm
`platform_status: PlatformStatusFacts | None`, gán trong `_facts` từ `spend.platform_status`
(`health_service.py:543-553`), **không thêm query**.

**Luật sức khoẻ (G3, G4)** — 4 luật `v1`, registry **14 → 18**, severity **cố định mỗi luật**
(`HEALTH_RULES_V1.md:65`), đều `enabled_by_default=True` (đầu vào là mã Meta đã đối chiếu tài liệu,
khác `spend_cap_approaching` chưa rõ đơn vị — câu hỏi §6.8):

| `rule_key` | Category | Severity | Nổ khi | Đóng khi |
|---|---|---|---|---|
| `platform_account_status_blocking` | account_status | **critical** | `platform_status.status ∈ BLOCKING` — **bất kể độ mới** (quan sát cũ nói "đã khoá" vẫn là điều cuối cùng Meta nói; cũ ≠ hồi phục, rule 4/28); evidence mang `freshness` | mã mới nhất ∉ BLOCKING (kể cả về `1`), hoặc không còn mã nào |
| `platform_account_status_pending` | account_status | **warning** | `status ∈ PENDING` | như trên |
| `platform_account_status_unrecognised` | data_quality | **attention** | có mã mà `status == unknown` (201/202, số lạ, chuỗi lạ) | mã về allowlist hoặc không còn mã |
| `platform_vs_recorded_status_mismatch` | account_status | **attention** | quan sát **`current`** và hai lớp đều biết mà **khác nhau**: Meta `active` ↔ registry `restricted/disabled`; Meta BLOCKING/PENDING ↔ registry `active`. Registry `unknown`/`warning`/`archived` → không so (chưa ghi / là nhận định riêng của người ghi). Meta `unknown` → không so | hai bên khớp, hoặc quan sát hết `current` |

Scope: `platform_status` cho ba luật đầu (một tín hiệu / tài khoản / luật; đổi mã trong cùng tập →
supersede, không re-page §2c), `registry` cho luật đối chiếu. Khi `blocking` và `mismatch` cùng nổ là
**hai sự kiện khác nhau** (Meta nói khoá; sổ của đội nói khác) với hai bước tiếp theo khác nhau — không
phải "một sự kiện hai tên" như rule 7 tránh; `attention` không đổi rollup khi đã `critical`.

Evidence (allowlist, qua `redact` như mọi luật): `message`, `account_status_raw`, `platform_status`,
`disable_reason_raw`, `disable_reason`, `observation_id`, `observed_at`, `observation_status`,
`spend_freshness`, `reader_source`, `source: "Meta read-only observation (ad account node)"`, và với luật
đối chiếu `registry_status`. **Thêm vào `VOLATILE_EVIDENCE_KEYS`** (`health_service.py:58-66`):
`previous_account_status_raw`, `previous_observed_at`, `since_observed_at` — chúng trượt theo cửa sổ mà
điều kiện không đổi. `spend_freshness` **không** volatile: `current → stale` là thay đổi đáng ghi
(tín hiệu supersede một lần, alert cập nhật, **không** gửi thêm vì không leo severity — §2c).

Không luật nào phát `unknown` severity (rule 10 vẫn là luật duy nhất); không luật nào tạo
`clear_signals` (rule 13); không ghi `AdAccount`, không ghi readiness (rule 11).

**Bảng suy giảm (rule 4 / 28) — là hợp đồng, test theo từng dòng:**

| Tình huống | `platform_status` | blocking / pending | unrecognised | mismatch | UI badge |
|---|---|---|---|---|---|
| `not_observable` (không BM / connection / reader) | `None` | — | — | — | "—", muted, *"không đọc được"* |
| observable, chưa từng có node trả lời | `None` | — | — | — | "—" (luật 11 S1 lo phần "chưa đọc") |
| Node trả lời nhưng **không có trường** `account_status` | `None` | — | — | — | "—", *"Meta không trả trạng thái"* |
| `"1"`, `current` | `active` | — | — | nổ nếu registry `restricted/disabled` | theo §6.3 |
| `"1"`, `stale` | `active`, `stale` | — | — | **không** (dữ liệu cũ không được lái việc sửa sổ) | neutral + "cũ N giờ" |
| `"2"`, `current`, `disable_reason "3"` | `disabled` | **critical** | — | nổ nếu registry `active` | attention + lý do |
| `"2"` ở dòng `failed` (insights lỗi, node đã trả lời) | `disabled`, `observation_status=failed` | **critical** | — | như trên | như trên, kèm *"lượt đọc chi tiêu lỗi: <code>"* |
| `"2"` cũ, các lượt sau **bị từ chối** (`permission_missing`…) | `disabled`, `stale` | **critical** (evidence `freshness=stale`) + luật 11 `attention` | — | không | *"lần cuối Meta trả lời: Disabled, N giờ trước; các lượt sau bị từ chối"* |
| `"3"/"7"/"8"/"9"` | `unsettled`… | **warning** | — | nổ nếu registry `active` | caution |
| `"100"/"101"` | `pending_closure`/`closed` | **critical** (§6.2) | — | nổ nếu registry `active` | attention |
| `"201"/"202"/"42"/"abc"/`chuỗi dài | `unknown` | — | **attention** | — (không so) | neutral *"mã lạ: …"*, **không bao giờ xanh** |
| `disable_reason` lạ / thiếu | — | không đổi severity | — | — | hiện thô + *"không rõ"* |
| Registry `unknown` / `warning` / archived | như trên | như trên | như trên | **không** | |
| Tài khoản archived | không đánh giá (đường có sẵn `health_service.py:569-595`) | expire | | | |
| Thiếu `timezone_name` / tiền tệ / insights | **không ảnh hưởng** — luật trạng thái không cần ngày địa phương | | | | |

**Alert / Telegram (rule 16, 17)** — **không sửa** `alert_rules.py`, `notification_*`: `critical` →
alert `critical`, ứng viên gửi ngay, bỏ giờ yên lặng theo policy; `warning` → tôn trọng giờ yên lặng;
`attention` → `info` trong Alert Center. Hồi phục → alert `resolved` từ nguồn, **không** có tin (v1,
câu hỏi §6.6). `rule.name` = tiêu đề tin; `evidence.message` = `Reason:`; `recommended_next_step` =
`Next step:` — luôn là bước **thủ công** (mở Ads Manager / Business Settings, kiểm, ghi sự kiện), không
bao giờ "kháng cáo giúp", không bao giờ hứa khôi phục.

**API (G6)** — cộng thêm, cùng quy ước (bearer, scope từ membership, `404` ngoài scope). Không gọi Meta
ở bất kỳ `GET` nào:

| Method | Path | Thêm gì |
|---|---|---|
| `GET` | `/ad-accounts/{id}/spend` | khối `platform_status`: `{status, account_status_raw, disable_reason, disable_reason_raw, observed_at, observation_id, observation_status, freshness, previous: {account_status_raw, status, observed_at} \| null, since_observed_at, disclaimer}`; `null` khi chưa có mã nào |
| `GET` | `/ad-accounts` và `GET /ad-accounts/{id}` | khối gọn `platform_status: {status, account_status_raw, freshness, observed_at}` tính từ **cùng dòng** `list_compact_spend` (working tree) đang lấy — một `DISTINCT ON` mở rộng để lấy dòng mới nhất **có mã** (kể cả `failed`), không thêm query theo tài khoản. **Phụ thuộc** follow-up S1 được commit |
| `GET` | `/spend/summary` | `platform_status_counts: {active, blocking, pending, unknown, none}` — đếm, **không** tổng điểm |
| `GET` | extension context (`extension_summary.build`) | khối `platform_status` cạnh `spend` (`extension_summary.py:97`) |
| `GET/PATCH` | `/account-health/rules` | tự có 4 luật mới (seed lười `health_service.py:86-115`) |

`disclaimer` cố định (đề xuất, BA duyệt): *"Trạng thái là mã Meta trả về cho reader đã nêu, tại thời
điểm quan sát. Không phải quyết định của sản phẩm này, không bảo đảm tài khoản sẽ không bị hạn chế, và
không thay cho việc kiểm tra trong Ads Manager."*

**UI (G7)** — tối thiểu, theo mẫu có sẵn:

- `lib/platformStatus.ts`: `PLATFORM_STATUS_META` — **nơi duy nhất** quyết định màu (rule 5):
  BLOCKING → `attention`; PENDING → `caution`; `unknown` → `neutral`; `None` → `muted` "—";
  `active` → `positive` **chỉ khi `freshness=current`**, còn lại `neutral` (câu hỏi §6.3; phương án thay
  thế: không bao giờ xanh như `FRESHNESS_META`). Nhãn luôn kèm bối cảnh *"theo Meta · <thời điểm>"*.
  Test như `readiness.ts`: không tone `positive` cho `unknown`/`stale`/`None`.
- Accounts: cột mới **"Trạng thái Meta"** cạnh cột Status (đổi nhãn cột cũ thành *"Trạng thái đã ghi"*,
  BA chốt); lọc theo `platform_status`.
- Account detail header: badge thứ hai *"Meta: Disabled · 2 giờ trước"*.
- Overview tab, card "Identity and status": hàng *"Trạng thái đã ghi"* (sửa nhãn hàng hiện tại), hàng mới
  *"Trạng thái Meta"*, *"Lý do vô hiệu"*, *"Quan sát lúc"*, link sang Spend tab (lịch sử). Nút **"Ghi nhận
  trạng thái Meta vào sổ"** (owner/admin) **mở đúng drawer sửa có sẵn**, điền sẵn `status` ánh xạ
  (`disabled → disabled`, `active → active`; các mã khác mở drawer không điền — câu hỏi §6.5). Người bấm
  xác nhận → `PATCH` có sẵn → audit `ad_account.updated` có sẵn. **Không API mới, không ghi tự động.**
- Health tab: tín hiệu mới hiện như mọi tín hiệu, nguồn `provider_observation`.
- Spend tab, bảng lịch sử quan sát: thêm cột *"Trạng thái TK (mã)"*.
- Overview page: card *"Trạng thái Meta: N bị chặn · N chờ xử lý · N mã lạ · N chưa quan sát"* từ
  `/spend/summary`.
- Extension: dòng *"Trạng thái Meta"* trong `OperationalState` (+ độ mới), i18n `en.ts`/`vi.ts`; bump
  phiên bản (đề xuất `0.3.0`, bề mặt mới).

**Cấu hình**: **không có biến mới.** Độ trễ phát hiện điều chỉnh bằng `SPEND_OBSERVATION_STALE_AFTER_HOURS`
có sẵn (§6.1). Bật sweep trên production vẫn là duyệt riêng của S1 §6.7.

**Migration**: **không.** Hai cột đã có (0016). Enum Python mới không là cột. Không thêm giá trị DB enum.
Dòng `health_rule_definitions` seed lười khi đánh giá lần đầu sau deploy — đúng như S1 (10 → 14).

**Bảo mật / wording (G8)**: evidence qua `redact`; tin Telegram chỉ mang mã + nhãn + thời điểm (rule 26);
không module ra ngoài mới (rule 20; `test_only_named_modules_may_make_an_outbound_request` không đổi);
mở rộng `test_no_health_response_claims_safety_or_approval` (`test_health_security.py:178`) để quét cả
khối `platform_status`, nhãn và tin nhắn: không "an toàn", không "không bị khoá", không "sẽ được mở lại".

**Đề xuất câu chữ — BA duyệt (rule 6; quyền wording thuộc BA, DEV đặt khoá i18n, không tự chế):**

| Khoá | EN (đề xuất) | VI (đề xuất) | Ghi chú |
|---|---|---|---|
| `platform_status.active` | Active (Meta) | Đang hoạt động (theo Meta) | luôn kèm thời điểm; không "bình thường", không "an toàn" |
| `platform_status.disabled` | Disabled (Meta) | Bị vô hiệu hoá (theo Meta) | |
| `platform_status.unsettled` | Unsettled balance (Meta) | Chưa thanh toán (theo Meta) | |
| `platform_status.pending_risk_review` | Pending risk review (Meta) | Đang xét duyệt rủi ro (theo Meta) | |
| `platform_status.pending_settlement` | Pending settlement (Meta) | Chờ tất toán (theo Meta) | |
| `platform_status.in_grace_period` | In grace period (Meta) | Trong thời gian ân hạn (theo Meta) | |
| `platform_status.pending_closure` | Pending closure (Meta) | Chờ đóng (theo Meta) | |
| `platform_status.closed` | Closed (Meta) | Đã đóng (theo Meta) | |
| `platform_status.unknown` | Unrecognised status code {code} | Mã trạng thái lạ: {code} | không bao giờ xanh |
| `platform_status.none` | Status not observed | Chưa quan sát được trạng thái | |
| `disable_reason.*` | tên Meta nguyên văn (`RISK_PAYMENT`…) + gloss | *diễn giải từ tên* — vd `risk_payment` "Rủi ro thanh toán", `ads_integrity_policy` "Chính sách quảng cáo", `permanent_close` "Đóng vĩnh viễn", `compromised_ad_account` "Tài khoản bị xâm nhập", `ads_afc_review` "Xét duyệt AFC (Meta không giải thích)"… | **[CHƯA KIỂM]** nghĩa; UI luôn hiện kèm tên gốc |
| luật `blocking` — name | Meta reports the account as not operable | Meta báo tài khoản không hoạt động được | |
| … — message | Meta returned account_status {code} ({label}) on {observed_at}; disable reason {reason}. | Meta trả `account_status` {code} ({nhãn}) lúc {observed_at}; lý do vô hiệu: {reason}. | vào `Reason:` |
| … — next step | Open the account in Ads Manager / Business Settings, read Meta's notice, and record what you find as an account event. | Mở tài khoản trong Ads Manager / Cài đặt doanh nghiệp, đọc thông báo của Meta, ghi lại điều thấy được thành sự kiện tài khoản. | thủ công; không "kháng cáo giúp" |
| luật `pending` — name/next step | Meta reports a pending payment or review state / Check billing or the review notice in Ads Manager… | Meta báo tài khoản đang chờ thanh toán hoặc xét duyệt / Kiểm tra thanh toán hoặc thông báo xét duyệt trong Ads Manager… | không hứa "thanh toán là mở lại" |
| luật `unrecognised` — name | Meta returned a status code this product does not recognise | Meta trả mã trạng thái sản phẩm chưa nhận diện | |
| luật `mismatch` — name/next step | Meta's status differs from the recorded status / Compare both, then update the recorded status if Meta is right — with a note. | Trạng thái Meta khác trạng thái đã ghi / Đối chiếu hai bên; nếu Meta đúng, cập nhật trạng thái đã ghi kèm ghi chú. | |
| `resolution_guidance` (4 luật) | Closes automatically when the latest Meta observation no longer shows this state. This is not a statement that the account is safe or will stay active. | Tự đóng khi quan sát Meta mới nhất không còn trạng thái này. Không phải lời khẳng định tài khoản an toàn hay sẽ tiếp tục hoạt động. | rule 6 |

**Test cần có** (đặt tên theo tiền lệ S1; bảng suy giảm là hợp đồng — mỗi dòng một test cùng tên):

- `test_s2_platform_status_mapping.py` (thuần): từng mã chính thức → đúng enum; `201/202/"42"/"abc"/""/
  None` → `unknown`/`None`; **không đường nào ra `active`** ngoài `"1"`; 16 `disable_reason` + lạ;
  `interpret` không đọc clock, không đọc DB.
- `test_s2_platform_status_rules.py` (thuần, qua `build_candidates`): từng dòng bảng suy giảm;
  `failed`-row-with-code vẫn tính; `stale` vẫn `critical`; mismatch chỉ khi `current`; evidence chỉ khoá
  allowlist; không `unknown` severity; không `clear_signals`; volatile keys đúng; registry **14 → 18**
  (sửa ghim `test_health_api.py:323`, `test_health_engine.py:347`, `test_s1_spend_rules.py:131`).
- `test_s2_platform_status_transitions.py` (DB, fake provider, `spend_env`): quan sát `"1"` → không
  tín hiệu; quan sát `"2"` → tín hiệu mở **trong cùng lượt sweep** + alert `critical` + delivery
  `PENDING` với `critical_bypass` (fake transport, `telegram_chat_id` giả); `"2"`→`"3"` → supersede,
  alert cập nhật, **không** delivery mới; `current → stale` cùng mã → supersede, không delivery mới;
  `"2"`→`"1"` → tín hiệu `resolved` (`resolved_by=NULL`), alert `resolved`, delivery chờ bị `cancelled`,
  **không** tin "hồi phục"; sau `"2"`, ba lượt `permission_missing` → `critical` còn + luật 11
  `attention`; `--spend-sweep` một lượt với fixture `"2"` → `OperationalRun` không đổi khuôn.
- `test_s2_platform_status_api.py`: khối trong `/spend`, danh sách, detail, summary, extension context;
  scope 404; viewer đọc được, không ghi; `GET` không gọi provider (đếm `calls`); không có `funding`;
  response/nhãn/tin không chứa "safe"/"cannot be restricted" (mở rộng test hiện có).
- Frontend: `platformStatus.ts` không `positive` cho `unknown`/`stale`/`None`; cột Accounts render
  "—" đúng chỗ; nút "Ghi nhận" chỉ điền sẵn hai mã, không tự submit. Extension: khối mới + i18n.
- Tài liệu bước 6: `HEALTH_RULES_V1.md` (+4 hàng, sửa §Limitations), `ARCH.md` §4j (+ sơ đồ nhánh),
  `API.md`, `FEATURES.md`, `TEST_LOG.md` (ghi "chưa đọc thật"), `extension` CHANGELOG/manifest.

**Tệp dự kiến đổi**: `services/platform_status.py` (mới), `services/spend_engine.py` (`PlatformStatusFacts`,
`assemble`), `services/spend_service.py` (`_view` giữ nguyên; `latest_status_answer_any_age`;
`list_compact_spend` mở rộng — sau khi working tree commit), `services/health_rules.py` (+4 luật),
`services/health_service.py` (`HealthFacts.platform_status`, `VOLATILE_EVIDENCE_KEYS`),
`api/v1/routers/spend.py`, `api/v1/routers/ad_accounts.py`, `services/extension_summary.py`,
`schemas/extension.py`, tests như trên; frontend `lib/platformStatus.ts` (mới), `lib/types.ts`,
`pages/Accounts.tsx`, `pages/AccountDetail.tsx`, `pages/account/OverviewTab.tsx`, `pages/account/SpendTab.tsx`,
`pages/Overview.tsx`; extension `popup/ContextView.tsx`, `shared/types.ts`, `shared/i18n/{en,vi}.ts`,
`manifest.json`; rồi tài liệu. **Không** đổi: `meta_graph_transport.py`, `meta_real_provider.py`,
`models/*`, `alembic/`, `alert_rules.py`, `notification_*`, `readiness.py`, `preflight_*`.

### 4c. Luật cứng bị chạm — và cách giữ

| Rule | S2 làm gì | Căng? |
|---|---|---|
| 1, 40 | không cột/field/response nào mang credential; `reader_source` là tên | không |
| 2 | không bảng mới; tín hiệu/alert theo lifecycle có sẵn, không xoá | không |
| 3 | tín hiệu/alert/delivery ghi audit trong cùng transaction như mọi đánh giá; hành động "Ghi nhận" đi qua `PATCH` có audit | không |
| 4 / 28 | `None` ≠ `unknown` ≠ `stale`; mã lạ không bao giờ thành `active`; bảng suy giảm | không |
| 5 | màu trong một tệp; `unknown`/`None`/`stale` không xanh | **một quyết định**: `active` + `current` có được xanh không (§6.3) |
| 6 | không câu nào "không bị khoá"/"an toàn"/"sẽ mở lại"; `resolution_guidance` nói rõ; test quét | **căng ở câu chữ**: hồi phục tự đóng tín hiệu dễ bị đọc là "đã ổn" — vì vậy lý do đóng của engine giữ nguyên câu *"The source condition is no longer true."* và UI không thêm chữ nào khác |
| 8, 10 | scope từ membership; dùng `AdAccountRegistryService` có sẵn | không |
| 9 | enum phân loại, đếm theo lớp, không điểm | không |
| 11 | luật trạng thái là **health**; không ghi `AdAccount.status`, `last_synced_at`, readiness; "Ghi nhận" là người bấm | không — nhưng **nêu rõ**: sau khi người ghi nhận, readiness/preflight đổi theo (đường có sẵn), đúng như hôm nay khi gõ tay |
| 12 / 17 | acknowledge không đóng; alert ack không chạm tín hiệu | không |
| 13 | không đổi câu `clear_signals`; `active` không tạo "clear" | không |
| 14 / 16 | hành động trên tín hiệu/alert không chạm quan sát | không |
| 15 / 21 | đánh giá sau quan sát trong SAVEPOINT như S1 | không |
| 20 | không module ra ngoài mới; không sửa transport | không |
| 22 | S2 không gửi, không deploy; "báo ngay" **phụ thuộc** bật sweep (duyệt S1 §6.7, chưa có) và cấu hình Telegram | không sửa luật; ghi rõ phụ thuộc |
| 26 | tin/evidence chỉ mã + nhãn + thời điểm | không |
| 41 | §0 đo lại; production **không đo lại hôm nay** và nói vậy | — |

### 4d. Ngoài phạm vi S2 (nói rõ)

| Không làm | Vì |
|---|---|
| Kháng cáo / gửi yêu cầu xem xét / bất kỳ ghi nào lên Meta | transport GET-only (rule 20); không bao giờ hành động thay người |
| Tự dừng chiến dịch, tự đổi ngân sách, tự ghi `AdAccount.status` | biến thể D bị bỏ; `FEATURES.md:52-53` |
| Sweep "chỉ trạng thái" nhịp nhanh (ứng viên B) | đường gọi tự động mới; chờ số hạn mức thật |
| Tin Telegram "đã hồi phục" | đổi chính sách A3 v1 (§4.4), spec riêng nếu muốn (§6.6) |
| Trạng thái **Business Manager** / hạn chế **hồ sơ cá nhân** / trạng thái campaign-adset-ad / `funding_source_details` / `balance` | khác câu hỏi; trường thanh toán bị cấm đọc (S1) |
| Ngưỡng theo workspace, chỉnh severity trên UI | `HEALTH_RULES_V1.md:65` |
| Google Ads / TikTok | Phase 5; nhưng enum nội bộ đặt tên trung lập (`platform_*`) |
| Nâng `v21.0` | Phase 0; S2 phụ thuộc kết quả |

### 4e. Rủi ro

- **Hành vi Meta với tài khoản đã khoá chưa kiểm** (§2f): nếu node bị từ chối, S2 chỉ giữ "lần cuối Meta
  nói" + luật 11; sản phẩm **không bịa** trạng thái, nhưng người dùng phải hiểu badge "Disabled · 3 ngày
  trước · các lượt sau bị từ chối" (wording). Đo ở lần đọc thật đầu.
- **Độ trễ 27 giờ** với cấu hình mặc định — nếu người dùng không hạ `SPEND_OBSERVATION_STALE_AFTER_HOURS`,
  "báo ngay" chỉ đúng tương đối. Ghi rõ trong `PRODUCTION_ENVIRONMENT.md`.
- **Production chưa có dispatcher / credential** — S2 ship xong vẫn là 0 phát hiện cho tới khi S1 được bật
  theo đúng duyệt.
- **Mã `pending_closure` xếp critical** có thể gây tin ngay trong đêm cho một tài khoản đội chủ động đóng
  — vì thế là câu hỏi §6.2.
- **Nhiều tín hiệu cùng lúc** (blocking + mismatch + luật 11) trên một tài khoản bị khoá: đúng theo
  thiết kế (ba sự kiện), nhưng Alert Center sẽ có 3 dòng; `attention` không gửi Telegram nên tiếng ồn
  ngoài hệ thống chỉ là 1 tin.

---

## 5. Xác nhận

Không gọi Meta, không gửi Telegram, không deploy, không migration, không đổi mã, không đổi scope/
authorization, không đổi provider thật, không chạm working tree đang có. Cơ sở dữ liệu dev đang tắt và
không được bật để viết tài liệu này. Tài liệu Meta chỉ được **đọc**. Bảng mã §2f chép từ trang chính
thức ngày 2026-10-27; mọi diễn giải nghĩa đều đánh dấu [CHƯA KIỂM].

---

## 6. Câu hỏi cho người dùng (chỉ những gì thuộc quyền người dùng)

1. **Độ trễ phát hiện chấp nhận được**: giữ `SPEND_OBSERVATION_STALE_AFTER_HOURS=26` (thấy khoá chậm nhất
   ~27 giờ, ≈ 60 gọi/ngày cho 30 TK) hay hạ xuống `2` (≤ ~3 giờ, ≈ 720 gọi/ngày)? Chỉ chốt sau lượt tay
   đầu tiên đo hạn mức (S1 §6.2). Đề xuất: `2` nếu hạn mức cho phép.
2. **`pending_closure` (100)** xếp `critical` (cùng `disabled`/`closed`) hay `warning` (cùng nhóm chờ)?
   Đề xuất: `critical`.
3. **Badge "Đang hoạt động (theo Meta)"** có được **xanh** khi quan sát còn `current` không, hay không bao
   giờ xanh (như độ mới)? Đề xuất: xanh chỉ khi `current`, luôn kèm thời điểm.
4. **Đối chiếu chiều ngược**: Meta nói `active` (current) mà sổ ghi `restricted/disabled` → có nhắc
   (`attention`) không? Đề xuất: có.
5. **Nút "Ghi nhận trạng thái Meta vào sổ"**: điền sẵn `disabled → disabled`, `active → active`; các mã
   chờ (3/7/8/9) và `closed` điền gì — `warning`? để trống? Đề xuất: để trống, người chọn.
6. **Telegram**: giữ mặc định (critical gửi ngay kể cả giờ yên lặng; warning chờ hết giờ yên lặng;
   attention không gửi)? Có muốn tin **"đã hồi phục"** không (là đổi chính sách A3, spec riêng)?
7. **Người duyệt bật sweep trên production** (tên, ngày) — vẫn đang chờ từ S1 §6.7; S2 không có giá trị
   vận hành cho tới khi có.
8. **Bật sẵn cả 4 luật** khi deploy (đề xuất) hay bật tay như `spend_cap_approaching`?

---

## 7. Quyết định của người dùng

Chốt ngày 2026-10-27:

| § | Quyết định |
|---|---|
| 4 (thiết kế) | Chọn **thiết kế A**: diễn giải quan sát S1, không thêm GET, không thêm transport, không migration |
| 6.1 | Độ trễ phát hiện tối đa **~3 giờ**. Trên production đặt `SPEND_OBSERVATION_STALE_AFTER_HOURS=2`; mặc định trong mã vẫn là 26 |
| 6.2 | `pending_closure` (100) là **critical**, cùng mức `disabled`/`closed` |
| 6.3 | **Không bao giờ dùng màu xanh.** Nhãn "Đang hoạt động (theo Meta)" luôn dùng tone trung tính và luôn kèm thời điểm quan sát |
| 6.8 | **Bật sẵn cả 4 luật** khi deploy |
| 6.4–6.6 | Chưa hỏi riêng, áp đề xuất: có nhắc chiều ngược (`attention`); nút ghi nhận để trống với mã chờ/closed; giữ mặc định Telegram, không gửi tin "đã hồi phục" |
| 6.7 | Chủ dự án đã duyệt bật sweep trên production ngày 2026-10-26 (nói chung cho cả S1). Thực hiện sau khi push và deploy |
