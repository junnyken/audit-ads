# AdsOps — kế hoạch hợp nhất P0–P3 sau redeploy

Ngày lập: 2026-11-26. Độc giả: chủ sản phẩm (PO), BA, người triển khai và main phụ trách vận hành. Đây là kế hoạch thực hiện, không phải chứng nhận hệ thống đã ổn định hay biên bản nghiệm thu P1/P2.

## 1. Đích, nguồn và trạng thái bằng chứng

Giữ UI https://adsops-app.vibe.tinhgon.xyz và API https://audit-ads-backend.vibe1.tinhgon.xyz, dùng hạ tầng và dữ liệu hiện hữu. Không tạo stack/beta/DB mới. Tiếp tục kế hoạch đầy đủ sau redeploy theo nguyên tắc audit trước, tái sử dụng trước, chỉ sửa gap đã xác nhận.

Nguồn đối chiếu: `../ADSOPS_UPGRADE_PLAN_2026-11-26.md`, `MINI_SPEC_PLAYBOOK.md` v2, `docs/P1_EMAIL_SCOPE_DESIGN_2026-11-26.md`, `docs/P1_P2_CHECKPOINT_2026-11-26.md`, `docs/AUDIT_BEFORE_BUILD_P2_CSV.md`; các hard rule trong `CLAUDE.md` tiếp tục áp dụng. Checkpoint cũ ghi v103/v107 và CSV chưa sửa đã được thay thế **ở các điểm tương ứng** bằng bằng chứng main cung cấp dưới đây, không sửa ngược lịch sử tài liệu cũ.

Nhãn dùng xuyên suốt:

- **VERIFIED**: có phép kiểm cụ thể; luôn kèm phạm vi và nguồn, không suy rộng.
- **SOURCE_ONLY**: có code/tài liệu hoặc test nguồn, chưa chứng minh workflow authenticated trên live.
- **UNKNOWN**: chưa có bằng chứng đủ kết luận.
- **NOT_STARTED**: phần mới chưa được triển khai/nghiệm thu.

| Hạng mục | Trạng thái | Bằng chứng và giới hạn |
|---|---|---|
| Revision deploy | VERIFIED | Main kiểm metadata LIVE + build logs: backend v104 lúc 15:51 +07, frontend v108 lúc 15:48 +07 ngày 26/11/2026; cả hai source `f081c19a`. URL hiện hữu giữ nguyên. Không phải phép kiểm lại trong lượt viết tài liệu này. |
| Commit CSV | VERIFIED | `f081c19a9931e0eea0497ae4340f3e4ad4818d58` đã lên remote main theo main xác nhận; thuộc revision deploy trên. Không khẳng định checkout gốc đã đồng bộ: checkout gốc còn ở 98f kèm edits. |
| Regression nguồn | VERIFIED | Main báo 643 tests passed, 20 skipped không đổi; typecheck/build pass; lint 0 lỗi/10 warnings. Đây là kết quả lượt trước, không phải chạy mới hoặc nghiệm thu toàn bộ live. |
| CSV missing-value | SOURCE_ONLY | Patch và component + Blob tests bảo vệ sáu cột tiền/currency; chưa tải CSV bằng phiên đăng nhập live hợp lệ. Các cột khác chưa được chứng nhận. |
| Schema production/parity DB | UNKNOWN | Revision artifact không chứng minh migration/schema đang chạy đúng. |
| Backup, restore drill, artifact rollback khả dụng | UNKNOWN | Chưa có bằng chứng phục hồi hoặc rehearsal; archive mã nguồn không phải backup DB. MCP hiện có không cung cấp SQL/backup. |
| Login, RBAC, cross-workspace trên live | UNKNOWN | Credentials kiểm thử chưa được thiết lập; public health/build không thay thế đăng nhập và phân quyền. |
| Token lộ qua ảnh chụp | UNKNOWN | Đã có sự cố lộ token theo bàn giao; chưa xác minh rotation/revocation. Không chép lại, đọc hay tìm secret. |
| F1 và capability P2 hiện hữu | SOURCE_ONLY | Có luồng F1, overview attention, alerts/freshness, CSV/spend trong nguồn và tài liệu; cần audit workflow/quyền, không xây lại. |
| P1 registry email độc lập | NOT_STARTED | Người dùng đã chọn phạm vi; brief đã có, chưa có mockup clickable, schema/API/UI registry mới hoặc UAT. |
| P3 release tính năng tiếp theo | NOT_STARTED | Redeploy CSV không đồng nghĩa hoàn tất release P1/P2. |

## 2. Quyết định đã chốt, mặc định thực hiện và điểm cần chốt

**Đã chốt:** P1 là registry email **độc lập**, Gmail **PERSONAL** và **MICROSOFT**. Microsoft chưa biết personal hay managed thì giữ unknown; không tự coi là Microsoft 365 managed. Không ép email thuộc hồ sơ Facebook và không tạo mailbox giả từ `PersonalAccountReference`.

**Quyền đã được người dùng chọn trong lượt lập kế hoạch:** owner/admin và người được giao phụ trách được xem địa chỉ email đầy đủ trong cùng workspace, qua cơ chế xác nhận phù hợp sẽ audit ở D2; list mặc định che, CSV không chứa địa chỉ đầy đủ. Người dùng khác không tự được reveal. Đây là chính sách đã chốt, không hỏi duyệt lặp; cơ chế kỹ thuật, audit và retention vẫn cần thiết kế/test.

**Mặc định thực hiện:** metadata và bằng chứng thao tác thủ công; owner, nguồn/thời điểm xác nhận, hạn xem lại và hành động tiếp theo. Không password, OTP, cookie, session, TOTP seed, recovery code; không tự đăng nhập provider, OAuth email hoặc đọc mailbox. Không thêm exception credential từ Meta sang email. Nhắc việc do cấu hình quản trị/hạn được chọn, không cam kết thời gian mở khóa cố định. Unknown không xanh; readiness và health tách biệt; acknowledge không resolve.

**Điểm quyết định hẹp:** PO/BA chốt wording và mockup; người phụ trách bảo vệ dữ liệu chốt cách bảo vệ địa chỉ đầy đủ, quyền reveal/export và chính sách lưu giữ trước schema/API; Microsoft personal/managed được ghi theo bằng chứng từng email. Admin vận hành xác nhận đích DB, backup/restore, artifact rollback và xử lý token lộ. Không biến các điểm này thành yêu cầu duyệt lại toàn bộ kế hoạch.

Mọi mutation phải có audit đã che dữ liệu trong cùng transaction, workspace authorization phía server, archive thay hard-delete. Không bật live Meta checks/discovery hoặc gửi thông báo thật chỉ để kiểm thử. Không Chromium/Playwright/Selenium theo hard rule dự án; UI kiểm bằng component/DOM và kiểm thủ công được phép.

## 3. Trình tự, phụ thuộc và cổng

| Thứ tự | Lát cắt | Phụ thuộc / điều kiện ra |
|---|---|---|
| 1 | P0-A — Chốt bằng chứng vận hành còn thiếu | Có inventory schema/backup/rollback/auth và blocker có người xử lý; không gọi P0 hoàn tất khi còn unknown trọng yếu. |
| 2 | P1-D1 — Mockup registry và wording | Có thể làm bằng fixture song song với P0-A, không đụng production; review xong mới thiết kế implementation. |
| 3 | P0-B — Regression an toàn và baseline | Cần tài khoản test hợp lệ, staging chuẩn được xác minh tách production; đóng blocker auth/data-loss trước release. |
| 4 | P1-D2 — Contract metadata/RBAC/audit | Sau P1-D1; chốt privacy/provider/state và audit model hiện hữu. |
| 5 | P1-I1 — Registry dọc tối thiểu | Sau D2 và cổng P0; schema/API/UI trên staging chuẩn, chưa reminder/provider integration. |
| 6 | P1-I2 — Hạn xem lại và runbook thủ công | Sau I1; tái sử dụng nhắc việc hiện hữu nếu phù hợp, không outbound mới mặc định. |
| 7 | P2-A/B/C — Audit rồi harden hiệu quả công việc | Audit nguồn có thể song song; chỉ build gap đã xác nhận, chọn từng slice sau P1 tối thiểu. |
| 8 | P3-R — Release/quan sát tại URL cũ | Từng slice đạt gate riêng; main thực hiện production theo quyền cụ thể. |

Không gán ngày hoàn tất/giờ công khi chưa biết quyền, staging, schema và gap thực tế. Người triển khai ước tính sau audit từng slice, ghi giả định và cập nhật khi blocker thay đổi; không dùng thời lượng mẫu trong Playbook làm cam kết.

## 4. P0 — bằng chứng ổn định và khả năng phục hồi

### P0-A — Inventory, an toàn credential và đường phục hồi

- **Audit/việc làm:** main đọc metadata có giới hạn theo định danh app; lập mapping revision → artifact → schema/migration head → DB/volume hiện hữu → owner. Không dump env/config hay dữ liệu. Đối chiếu build f081c19a với manifest; không dùng checkout 98f có edits làm release source.
- **Backup:** admin dùng công cụ vận hành có quyền, cung cấp metadata backup, thời điểm, phạm vi, vị trí bảo vệ và kết quả restore trên staging chuẩn đã xác minh. MCP thiếu SQL/backup là giới hạn thật, không suy diễn “đã backup”. Không tạo DB/stack mới để vượt giới hạn; nếu chưa có staging phù hợp, ghi blocker và tiếp tục thiết kế fixture.
- **Token lộ:** admin/main xử lý revoke/rotate theo loại credential và quyền đã giao, xác nhận bằng metadata đã che và kiểm đường dùng còn hợp lệ; không xin/đưa token vào chat, repo hay báo cáo. Chưa xác minh thì giữ blocker bảo mật.
- **File dự kiến:** runbook `docs/DEPLOY.md` hoặc tài liệu vận hành hiện có sau audit; `TEST_LOG.md` cho bằng chứng; chỉ đọc `backend/alembic/` để đối chiếu lịch sử nếu đúng đường migration thực tế. Không sửa code khi chưa có gap.
- **Test/acceptance:** ghi schema head thực, restore drill và thời gian đo, artifact trước/sau truy xuất được; login test có nguồn cấp quyền hợp lệ; mọi unknown còn lại có owner. P0 chỉ đóng khi các mục trọng yếu có bằng chứng đạt.
- **Rollback:** đây là kiểm tra read-only/restore trên staging phù hợp; không restore đè production, không downgrade schema. Nếu thiếu quyền/công cụ, trả blocker đúng lớp cho main/admin.

### P0-B — Auth, quyền, dữ liệu và regression các sửa lỗi cũ

- **Phụ thuộc:** P0-A xác nhận đích, fixture và quyền. Production chỉ smoke read-only trong phạm vi này; ghi/xóa chỉ trên staging chuẩn đã xác minh. Không chạy test DB có DROP/TRUNCATE với production hoặc chạy nhiều pytest tranh cùng DB.
- **Audit files:** `backend/app/api/v1/routers/facebook_identities.py`, `backend/app/services/facebook_identities.py`, `backend/app/services/meta_graph_transport.py`; tests F1 và quyền hiện hữu. Đối chiếu các finding cũ về token dán tay, ghép theo label/tự unarchive, pagination và lỗi thành rỗng với source f081c19a trước khi kết luận còn lỗi hoặc mở patch mới.
- **Test/acceptance:** login/logout/phiên hết hạn, role đúng/sai, chéo workspace, archive không tự restore, stable-id exact match, upstream timeout/mất quyền/multi-page trả empty/partial/failed trung thực; audit mutation cùng transaction. Không live provider call khi bị cấm; dùng transport fixture cho lỗi upstream. Ghi test chưa chạy và 20 skips theo lý do, không tính skipped là pass.
- **Rollback:** patch nào cũng có artifact trước, regression đối chiếu; không tự kích hoạt endpoint/automation cũ. Release bị chặn nếu auth bypass, rò dữ liệu chéo workspace hoặc nguy cơ mất dữ liệu chưa đóng.

## 5. P1-D1 — MINI-SPEC đầu tiên theo Playbook v2

### Header

- **ID:** P1-D1.
- **Name:** Mockup clickable registry email độc lập và wording bằng chứng thủ công.
- **Parent phase:** P1 — Email & Recovery Operations.
- **Author:** agent lập kế hoạch theo giao việc; người nhận triển khai/reviewer phải ghi danh tính từ môi trường, không tự bịa owner.
- **Date:** 2026-11-26.

### Context

Đọc Playbook v2, `CLAUDE.md`, brief P1 và audit F1 hiện hữu trước build. F1 có owner, encrypted/masked email, PIN reveal và recovery_note nhưng chưa phải registry độc lập. Quyết định Gmail PERSONAL/MICROSOFT và metadata-only đã chốt. P0 auth/restore vẫn chưa biết; D1 dùng fixture hoàn toàn, không cần secret hay production data.

### Goal

Người vận hành tìm được email cần xử lý và hiểu rõ bằng chứng/hành động thủ công tiếp theo qua một luồng mockup có thể review trước khi triển khai dữ liệu thật.

### Constraints

1. Tái sử dụng layout Assets, semantic tokens, primitives; không thêm design system/dashboard/chart mới.
2. Registry độc lập; không sửa meaning của F1 hoặc nhân đôi luồng reveal-email.
3. Fixture minh họa, địa chỉ che; không dữ liệu cá nhân thật hoặc form nhận secret.
4. Provider/loại/trạng thái chưa biết phải hiện chưa xác minh, không suy từ tên miền.
5. Không gọi backend/provider, không OAuth/mailbox/automation.
6. Không sửa navigation production, schema, API, RBAC trong D1.
7. Không server/stack mới trong lát cắt; artifact review tĩnh/clickable, không tiến trình nền vô hạn.
8. Wording mới là đề xuất chờ review; không nói đã an toàn/đăng nhập được/đảm bảo khôi phục.

### Scope A–E

**A. Domain model:** chỉ fixture thể hiện địa chỉ che, provider, loại account, owner, nguồn/thời điểm xác nhận, hạn xem lại, trạng thái, hành động tiếp theo, liên kết tài sản và lịch sử minh họa. Không chốt bảng/enum DB ở D1.

**B. Service/Engine:** tương tác cục bộ lọc → mở panel → sửa metadata minh họa → xem lại → lưu fixture → thấy lịch sử. Hủy không thay đổi; không persistence/network.

**C. API contract:** không endpoint mới; ghi rõ điểm nối dự kiến list/detail/update/history để D2 đối chiếu pattern API hiện hữu, không đặt path giả là API đã có.

**D. UI surfaces:** bảng và panel chi tiết/form. Tái sử dụng token tại `frontend/src/index.css`, layout tham chiếu `frontend/src/pages/Assets.tsx`, `FacebookAccounts.tsx`; primitives table/sheet/field/button/badge/skeleton tại `frontend/src/components/primitives/`. Dùng font Be Vietnam Pro/mono, semantic background/surface/text/border/status/focus có sẵn, theme sáng/tối; không bịa mã màu. Trước triển khai kiểm lại API component, không sao chép nguyên màn.

**E. Tests:** ma trận tương tác, trạng thái và accessibility thủ công/component; không backend integration hoặc live verification trong D1.

### Audit Before Build

Đầu ra bắt buộc trước mã: đề xuất `docs/AUDIT_BEFORE_BUILD_P1_D1.md`, ghi quyết định người dùng, inventory component/token và gap theo Playbook:

| Nhóm gap | Hiện biết / việc xác nhận |
|---|---|
| architecture/data_model | F1 không đại diện registry độc lập; không tái dùng entity sai nghĩa. |
| vocabulary/frontend_UX | Nhãn trạng thái mới chưa duyệt; chưa có clickable mockup đủ trạng thái. |
| security/API | Quyền đã chốt: owner/admin + người phụ trách trong workspace; list che và CSV không chứa full address. Cơ chế reveal/audit vẫn cần D2; mockup không mở đường dữ liệu thật. |
| state_machine | Phân biệt tự xác nhận, chờ xử lý, bị chặn; không coi là state provider. |
| testing/observability/deployment | Chưa QA mockup; không dùng build live CSV để chứng nhận P1. |

Chỉ build gap D1; phát hiện gap API/schema thì ghi cho D2, không tự mở implementation.

### Design Choice

Một registry độc lập theo bố cục Assets, bảng dày dữ liệu + sheet chi tiết; reuse primitives/token và mẫu lịch sử có sẵn. Không dùng dashboard mới hoặc biến F1 thành mailbox vì sai quan hệ nghiệp vụ và dễ mở thêm đường reveal. File dự kiến cho lượt D1: `docs/mockups/p1-email/index.html`, `screens/registry.html`, `screens/detail.html`, cùng fixture/style cục bộ nếu cần; mỗi màn một file nhỏ, liên kết tương tác rõ. Đây là đích đề xuất, chưa được tạo trong lượt kế hoạch này.

Brief trạng thái bắt buộc:

- Loading: skeleton cùng cấu trúc bảng, không hiện “0 email” trước dữ liệu.
- Empty: tách “chưa có email” với “không có kết quả lọc”; có hành động phù hợp.
- Error: giữ filter, thử lại, không thay lỗi bằng danh sách rỗng.
- No-permission: không lộ email/owner bị cấm; minh họa backend deny, không chỉ ẩn nút.
- Partial: đánh dấu trường thiếu và nguồn/thời điểm, không tự suy account type.
- Form: label/focus, validation inline + error summary, hủy, xem lại trước lưu, đọc lại kết quả/lịch sử sau lưu fixture.

Wording **đề xuất, chờ PO/BA và wording review**: “Chưa xác minh”, “Chờ người phụ trách”, “Đã ghi nhận thiết lập”, “Bị chặn”; nguồn “Người phụ trách tự xác nhận”; trợ giúp “Thông tin được ghi nhận thủ công, chưa xác minh bởi Google/Microsoft”; nhắc “Đến hạn xem lại” thay vì “Đã mở khóa”. Các nhãn này chưa phải enum triển khai.

### Test Plan

- **Unit/component:** lọc/mở panel/hủy/xem lại/lưu fixture; unknown không success; loading/error/empty tách biệt. Không viết test chỉ lặp cấu trúc HTML.
- **Integration:** D1 không HTTP+DB; ghi N/A, chuyển thành điều kiện bắt buộc ở I1.
- **Regression:** đối chiếu token/theme, không đổi F1 hoặc navigation production; không có field secret/network call.
- **Live verification:** chưa áp dụng cho fixture; review thủ công clickable ở 375/768/1280px, bàn phím/focus/label/error summary, sáng/tối. Không báo UAT production.

### Workstyle, files, rollback và report

Audit → build đúng D1 → review trạng thái/wording → ghi kết quả. Tham chiếu skill UI theo Playbook nếu khả dụng; nếu thiếu phải ghi giới hạn và đối chiếu checklist, không tuyên bố đã tuân thủ skill chưa đọc. Sau D1, cập nhật `TEST_LOG.md` và brief P1 với link artifact, quyết định, vấn đề còn lại; FEATURES/ARCH/API chỉ cập nhật khi có thay đổi capability/contract thật. Không thay chúng để giả P1 đã tồn tại.

Rollback D1: gỡ artifact mockup và liên kết review; không ảnh hưởng DB/API/production. Báo cáo theo 8 mục Playbook: Summary; Audit Before Build; Design Choice; Changed Files; New API/DB/State (D1: không); Tests; Live Verification (fixture, không live); Remaining Limits/Follow-ups.

### Success Criteria

PO/người triển khai bấm được luồng danh sách → chi tiết → sửa/xem lại/hủy/lưu minh họa; đủ các trạng thái trên, không secret/provider call, unknown không xanh. Wording và privacy decision được ghi rõ chốt/chưa chốt. Chỉ sau review D1 mới mở D2; chưa duyệt phần nào thì giữ điểm đó là blocker, không chặn audit độc lập khác.

## 6. P1 tiếp theo — các lát cắt triển khai hẹp

| Slice | Việc làm và file dự kiến | Test / nghiệm thu | Phụ thuộc và rollback |
|---|---|---|---|
| P1-D2 — Contract registry | Audit `backend/app/models/`, `schemas/`, router/service F1, workspace access, strict payload và audit hiện hữu. Viết audit + MINI-SPEC riêng trước code; chốt uniqueness trong workspace, owner/link tài sản, provider/type unknown, evidence timestamps, archive, quyền mask/reveal/export. Endpoint/table cụ thể chỉ đặt sau audit. | Contract examples allowlist, validation/rejection secret, role matrix và state transition; không nhận provider verification giả. PO/privacy chốt full-address policy; D1 wording được phản ánh nhất quán. | Sau D1; không DB write. Rollback tài liệu contract về bản đã review; không tạo entity trùng F1. |
| P1-I1 — Registry dọc tối thiểu | Thêm model/schema/service/router và migration additive đúng pattern sau D2; frontend Email list/detail/form cùng client API/test trong cấu trúc hiện hữu. Không tích hợp provider, reminder hay đường reveal mới chưa được chốt. | Unit validation/state; HTTP+DB thật staging; cross-workspace/role deny cho list/detail/update/archive/history/export nếu có; immutable redacted audit cùng transaction, rollback transaction khi audit fail; migration DB sạch ở đích kiểm thử đã xác minh và dữ liệu staging hiện có; UI đủ trạng thái. | Sau D2 + gate P0. Rollback artifact code; schema additive giữ lại, không tự downgrade/xóa dữ liệu. Tắt entry point theo config chuẩn nếu đã có, không giả định feature flag tồn tại. |
| P1-I2 — Xem lại và hướng dẫn thủ công | Audit scheduler/alert hiện hữu trước nối reminder; thêm cấu hình admin, timezone/due time và chống trùng; runbook Google/Microsoft hướng dẫn người dùng tự thao tác trang chính thức, ghi kết quả metadata. Không outbound thật hoặc gửi lần đầu mặc định. | Unit timezone/hạn/unknown/idempotency; integration quyền cấu hình; reminder không đổi health/recovery thành thành công; không hardcode số ngày mở khóa; UAT dữ liệu test được dọn. | Sau I1. Nếu engine không phù hợp, nêu gap để chốt slice riêng, không viết engine song song. Rollback cấu hình/lịch mới theo runbook, giữ lịch sử/audit. |

Mỗi slice có `docs/AUDIT_BEFORE_BUILD_<ID>.md` trước mã, ghi quyết định và báo cáo Playbook. Tài liệu này không tự khởi chạy các slice sau; lệnh tiếp tục thực hiện trong cùng phạm vi được giữ nguyên, nhưng không suy ra quyền production hoặc tích hợp mới.

## 7. P2 — audit capability có sẵn rồi mới nâng cấp

| Slice | Audit/reuse và files | Test / acceptance | Rollback / dependency |
|---|---|---|---|
| P2-A — Attention và alerts/freshness | `frontend/src/pages/Overview.tsx`, `backend/app/services/alert_rules.py`, `alert_service.py`, `alert_triggers.py`, router alerts; đối chiếu đường attention hiện có. Chỉ bổ sung gap ưu tiên/drill-down/quyền đã tái hiện. Không dashboard/health engine mới. | `u1b.overview-accounts.test.tsx`, alerts component/API/security/engine tests; never/stale/current tách biệt, ack không resolve, unknown không xanh, role/scope đúng và drill-down có đích dùng được. | Audit có thể sớm; build sau slice được chọn. Hoàn nguyên patch UI/rule, giữ audit, không bật gửi thật. |
| P2-B — CSV chứng minh và audit các cột còn lại | `frontend/src/pages/Accounts.tsx`, `frontend/src/test/accounts-csv.test.tsx`, `accounts-spend.test.tsx`; tái dùng export hiện hữu. Không làm lại patch missing-value đã deploy. Audit từng cột metadata (ví dụ bm_verified), permission/masking và spreadsheet formula risk riêng trước sửa. | Xác nhận live authenticated CSV khi có credential đúng quyền; sáu cột thiếu/currency → —, zero/raw precision thật giữ nguyên; fallback currency, BOM/CRLF/quoting/header/số cột. Các cột chưa audit ghi chưa certified; component/Blob không thay live. Formula hardening cần slice audit riêng, không tự gộp. | Patch f081c19a đã có; nhiệm vụ kế tiếp là bằng chứng và gap còn lại. Nếu rollback CSV, main chọn artifact trước; phải ghi nguy cơ tái xuất 0/VND giả, không coi rollback là sửa dữ liệu. Không migration. |
| P2-C — Spend/reporting có căn cứ | `frontend/src/lib/spend.ts`, `backend/app/services/spend_service.py`, `spend_engine.py`, router spend và tests S1; kiểm source/currency/window/freshness trước đề xuất report workspace. Không cộng khác tiền tệ hoặc tạo metric engine mới. | Tests spend API/rules/accounts-list-spend; thiếu khác zero; latest complete day/timezone; scope, export parity. Đo thao tác người dùng trước/sau rồi PO chọn gap giảm công việc thật. | Sau audit P2 và P1 tối thiểu; không auto pause/scale ads. Rollback patch/report, giữ raw evidence và schema additive nếu có. |

Chỉ mở lát cắt cải tiến khi có trigger và lỗi/nhu cầu quan sát được. Danh mục thị trường từ kế hoạch gốc chỉ là gợi ý câu hỏi reporting, không chứng minh đối thủ tốt hơn hoặc cấp quyền sao chép/tự động truy cập.

## 8. Mapping test và đo hiệu năng

| ID | Phạm vi bằng chứng cần thu | Áp dụng / tiêu chí |
|---|---|---|
| T0 | Metadata artifact/schema/backup/restore/rollback | P0-A/P3; ghi revision, đích, thời điểm, kết quả và thời lượng đo; thiếu mục nào thì gate mục đó chưa đạt. |
| T1 | Auth/RBAC và isolation | P0-B/I1/P3; phiên hợp lệ/hết hạn, vai trò, chéo workspace; server deny và không rò payload. Không inject token để bỏ qua login. |
| T2 | Metadata/privacy/audit | D2/I1; không secret ở request/response/log/export; mutation + redacted audit atomic; archive/history và unknown đúng nghĩa. |
| T3 | Mockup/UI | D1/I1; đủ trạng thái, filter/form, keyboard, 375/768/1280, theme; review wording trước production UI. |
| T4 | CSV/spend/freshness/alerts | P2; map vào các file test ở mục 7; thêm authenticated smoke khi đủ quyền. Không gọi toàn bộ cột pass từ test bảy fallback. |
| T5 | Regression/build | Mỗi code slice: suite liên quan, lint/typecheck/build theo script repo; migration test khi có migration. Ghi warning/skip thật, không xóa test cho xanh. |
| T6 | UAT và vận hành | I1/I2/P3; staging chuẩn tách production, fixture có nhãn, dọn dữ liệu test; production read-only smoke, không destructive tests/migration trong kế hoạch này. |

Chưa có số p95, uptime dài hạn, restore time hoặc rollback time được đo trong bằng chứng đầu vào. HTTP 200 tại một thời điểm và build thành công không chứng minh ổn định. Trước/sau mỗi slice cần ghi environment, revision, endpoint/tác vụ, số mẫu, cửa sổ thời gian, tải/concurrency, warm/cold, error rate, p50/p95 và call upstream có loại trừ hay không. Benchmark/load chỉ trên đích kiểm thử được xác minh, không tự load-test production. Mốc p95 <500ms, rollback <1 phút hay quan sát 7 ngày trong kế hoạch gốc là mục tiêu cần thẩm định, không phải cam kết hoặc kết quả; PO/vận hành chốt ngưỡng sau baseline thực.

## 9. P3-R — release tại URL cũ và đường lùi

1. Main chốt immutable revision từ cây nguồn sạch phù hợp, kiểm artifact FE/BE và schema compatibility. Không build từ checkout gốc 98f có edits chỉ vì live đã lên f081c19a.
2. Kiểm gate P0, T0–T6 liên quan, mockup/wording P1 và quyền vận hành. Schema/restore/rollback/login chưa biết thì không ký P0/release có rủi ro tương ứng.
3. Staging chuẩn dùng lại phải có đích DB/volume được xác minh. Nếu không có đích phù hợp hoặc thiếu quyền thì ghi blocker; không dựng beta/DB mới hoặc dùng production làm DB test.
4. Production write/deploy/config/migration chỉ main thực hiện theo phạm vi quyền cụ thể. Kế hoạch này không cấp quyền migration phá hủy, schema downgrade hay restore đè DB. Nếu slice cần migration, chuẩn bị file additive và rehearsal; việc thực thi production là bước vận hành riêng có backup trước, không nằm trong lượt lập tài liệu.
5. Giữ URL và stack hiện hữu; đọc lại version/config đã che, health và smoke đăng nhập/quyền khi có credential hợp lệ. Không bật Meta scheduler, provider automation hay first outbound notification theo suy diễn.
6. Nếu smoke fail: dừng rollout, lưu bằng chứng đã che; main quay artifact tương thích trước theo runbook. Không tự downgrade schema/restore DB. Nếu artifact cũ không tương thích schema, không rollback mù; giữ trạng thái hạn chế tính năng theo cấu hình được duyệt và xử lý theo runbook đã diễn tập.
7. Quan sát lỗi/auth/freshness và tác vụ đã chọn trong cửa sổ vận hành được thống nhất; ghi thời gian/kết quả thật. Chỉ đóng slice khi acceptance có bằng chứng, còn giới hạn ghi rõ trong TEST_LOG/report.

## 10. Blocker hiện tại và hành động kế tiếp

| Blocker | Người/đầu mối xử lý theo vai, chưa gán tên | Điều kiện gỡ |
|---|---|---|
| Chưa rõ schema/backup/restore/artifact rollback | Main + admin hosting/DB hiện hữu | Metadata và restore/rehearsal trên đích hợp lệ; MCP không thể thay chức năng SQL/backup không có. |
| Credentials kiểm thử chưa thiết lập | Main + admin cấp tài khoản đúng vai | Credential qua kênh cấu hình an toàn, không gửi secret trong chat; login/RBAC có kết quả thật. |
| Rotation token lộ chưa xác minh | Main + người quản lý credential | Bằng chứng revoke/rotate và kiểm kết nối đã che; chưa có thì giữ UNKNOWN. |
| P1 chưa có clickable mockup/wording review | Người triển khai D1 + PO/BA reviewer | Artifact đủ trạng thái, quyết định wording/privacy và giới hạn còn lại được ghi. |
| Microsoft type / cơ chế bảo vệ full address | PO + người phụ trách tài sản/privacy + người triển khai | Type theo bằng chứng hoặc unknown; triển khai quyền owner/admin + người phụ trách đã chốt, list che/CSV không full address; cơ chế bảo vệ và retention được review trước implementation. |
| CSV chưa live authenticated; các cột khác chưa certified | Người kiểm thử + main có quyền | T4 live có phạm vi cụ thể và audit từng gap, không tái khẳng định P2 hoàn tất. |

**Hành động đầu tiên tiếp theo:** mở P1-D1 bằng audit token/component có mục tiêu và tạo mockup clickable fixture như mục 5, đồng thời main thu bằng chứng P0-A còn thiếu qua admin hiện hữu. Đây là bước thiết kế có thể thực hiện mà không chờ secret, không yêu cầu blanket approval và không ghi production. Khi bàn giao, nêu artifact review cụ thể rồi chỉ xin quyết định về wording/privacy còn thiếu.

Lượt lập kế hoạch này chỉ ghi tệp tài liệu này; không sửa code/tài liệu khác, không commit/push/deploy, không chạy server hay test. Các số kiểm chứng và metadata live ở trên là bằng chứng main cung cấp, không phải phép đo mới của lượt này.
