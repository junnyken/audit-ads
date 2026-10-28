# AUDIT BEFORE BUILD — Slice F3: Tự biết ai có quyền trong BM (`business_users`)

**Ngày audit:** 2026-10-28  
**Phạm vi:** Slice F3 trong `docs/PLAN_AGENCY_V2.md` — Quét `GET /{business-id}/business_users` (`fields=id,name,role`), đối soát với hồ sơ Facebook (`PersonalAccountReference`) và liên kết BM (`PersonalAccountBusinessLink`), gợi ý khớp tên để người vận hành xác nhận nối 1 chạm, và phát cảnh báo sớm khi có người lạ vào BM hoặc Admin bị gỡ/hạ quyền.

---

## 1. Hiện trạng (What Exists)

1. **Meta Discovery (A10.1 / O1.1 / O3):**
   - `RealMetaBusinessProvider` (`backend/app/services/meta_real_provider.py`) hiện đã đọc `GET /{business-id}` (`identify_business_manager`), `owned_ad_accounts` + `client_ad_accounts` (`discover_ad_accounts`), và `adspixels` (`discover_pixels`).
   - `MetaDiscoveryService` (`backend/app/services/meta_discovery.py`) lưu `BusinessManagerDiscoveryRun`, `DiscoveredAdAccountObservation`, `DiscoveredPixelObservation` và thực hiện đối soát (`reconcile_ad_accounts`, `reconcile_pixels`).
   - `DiscoverySweepService` (`backend/app/services/discovery_sweep.py`) chạy định kỳ cho các kết nối `production` đã bật `auto_discovery_enabled`.
2. **Hồ sơ Facebook & Liên kết BM (Slice F1 & F2):**
   - `PersonalAccountReference` (`backend/app/models/entities.py`) lưu hồ sơ Facebook cá nhân của đội vận hành (`label`, `owner_member_id`, `two_factor_method`, `recovery_note`, `vault_reference`).
   - `PersonalAccountBusinessLink` lưu liên kết N-N giữa `PersonalAccountReference` và `BusinessManager` kèm `role` (`admin` / `employee` / `unknown`).
   - Slice F2 đã gắn `facebook_identities` và `remediation_checklist` vào cảnh báo (`Alert`) và tin nhắn Telegram.

---

## 2. Khoảng trống cần lấp trong Slice F3 (Gaps)

1. **Chưa đọc danh sách người có quyền trong BM từ Meta (`business_users`):**
   - Khi BM bị thêm người lạ hoặc một Admin bị gỡ quyền (dấu hiệu sớm nhất khi BM bị chiếm quyền), hệ thống hiện chưa phát hiện được vì chưa đọc `GET /{business-id}/business_users`.
2. **Chưa có đối soát & xác nhận nối `business_user` ↔ `PersonalAccountReference`:**
   - Meta trả về `business_user` (`id` là mã người dùng theo phạm vi BM, `name`, `role`).
   - Theo **Rule 31 (`CLAUDE.md`)**, hệ thống **không bao giờ tự động gán (auto-link)** bằng tên hiển thị (`name`). Nếu tên trùng với hồ sơ Facebook nội bộ (`PersonalAccountReference.label` hoặc tên nhân sự giữ), hệ thống chỉ được **gợi ý (`suggested_identity`)** để người vận hành bấm **"Xác nhận nối"** (lưu `external_business_user_id` cố định vào `PersonalAccountBusinessLink`).
3. **Chưa có cảnh báo sớm khi quyền BM thay đổi bất thường (`bm_user_access_drift`):**
   - Cần tự động mở cảnh báo (`Alert`) và gửi thông báo Telegram ngay khi phát hiện:
     - **Người lạ trong BM (`unlinked_users`):** Có `business_user` trong BM chưa được xác nhận nối với bất kỳ `PersonalAccountReference` nào (`CRITICAL` nếu giữ quyền `ADMIN`, `WARNING` nếu giữ quyền khác).
     - **Admin bị gỡ hoặc hạ quyền (`removed_admins`):** Một `business_user` từng là `ADMIN` (theo liên kết `PersonalAccountBusinessLink` đã xác nhận hoặc lần quét `COMPLETE` liền trước) không còn trong danh sách `business_users` hoặc bị hạ xuống quyền thấp hơn (`CRITICAL`).
   - Khi người vận hành đã xác nhận nối đầy đủ các thành viên hợp lệ và không còn lệch quyền Admin, cảnh báo phải tự động đóng (`auto-resolve`).

---

## 3. Thiết kế chi tiết (Design & Guardrails)

### 3.1. Cạnh Graph API & Allowlist trường (`Rule 1`)
- **Edge:** `GET /{business-id}/business_users` (`BUSINESS_USER_EDGES = ("business_users",)`).
- **Allowlist fields:** `BUSINESS_USER_FIELDS = "id,name,role"`.
- **Tuyệt đối không** yêu cầu hoặc lưu `email`, `pending_email`, token, cookie, hay thông tin nhạy cảm khác (tuân thủ nghiêm ngặt Rule 1).

### 3.2. Schema & Migration (`0020_f3_business_users`)
- Bảng `business_manager_discovery_runs`:
  - Thêm `business_user_required_edges_json` (`JSON`), `business_user_coverage_json` (`JSON`), `business_user_coverage_status` (`CoverageStatus`, mặc định `NOT_ATTEMPTED`).
- Bảng mới `discovered_business_user_observations`:
  - Lưu từng người dùng quan sát được trong một lần quét BM (`workspace_id`, `business_manager_discovery_run_id`, `provider_business_manager_id`, `external_user_id`, `display_name`, `role`, `source_edge`, `safe_metadata_json`, `observed_at`, timestamps).
- Bảng `personal_account_business_links`:
  - Thêm cột `external_business_user_id` (`String(120)`, nullable) để ghi nhận mã `business_user.id` cố định sau khi người vận hành xác nhận nối.

### 3.3. Đối soát, Gợi ý & Xác nhận nối (`MetaDiscoveryService`)
- `reconcile_business_users(run)` trả về danh sách đối soát:
  - `status = "linked"`: Đã có `PersonalAccountBusinessLink` hoạt động của BM này với `external_business_user_id == obs.external_user_id`.
  - `status = "unlinked"`: Chưa xác nhận nối với hồ sơ Facebook nào trong BM này ("Người lạ / Chưa xác nhận"). Nếu tìm thấy `PersonalAccountReference` trong workspace có tên khớp (`label` hoặc tên nhân sự giữ trùng với `display_name`, hoặc đã nối với BM này nhưng chưa gắn `external_business_user_id`), trả về `suggested_identity` để người vận hành xác nhận 1 chạm.
  - `status = "missing_from_latest_discovery"` (hoặc `admin_demoted`): Admin đã xác nhận (hoặc Admin ở lần quét `COMPLETE` trước) bị mất khỏi BM hoặc bị hạ quyền khi lần quét hiện tại có `business_user_coverage_status == COMPLETE`.
- Endpoint xác nhận nối:
  - `POST /api/v1/meta-connections/{connection_id}/discoveries/{run_id}/business-user-links`
  - Body: `{"external_user_id": "...", "personal_account_reference_id": "...", "role": "admin" | "employee" | "unknown" | null}`
  - Tạo hoặc cập nhật `PersonalAccountBusinessLink` giữa hồ sơ Facebook và `BusinessManager` tương ứng của lần quét, gán `external_business_user_id`, ghi `AuditLog` (`personal_account_reference.business_user_confirmed`), và đánh giá lại cảnh báo lệch quyền BM.

### 3.4. Cảnh báo & Thông báo Telegram (`bm_user_access_drift`)
- `evaluate_business_user_drift_alert(run, connection)`:
  - Chạy sau khi `run_discovery`, `DiscoverySweepService._sweep`, và sau khi `confirm_business_user_link`.
  - Mở/cập nhật `Alert` với `alert_key = f"bm_user_drift:{connection.id}:{bm_ref}"`, `source_entity_type = "business_manager_user_drift"`, `rule_key = "bm_user_access_drift"`.
  - Gắn `login_identities` của BM đó (ưu tiên Admin giữ BM) và `remediation_checklist` của rule `bm_user_access_drift` vào cả API chi tiết cảnh báo lẫn tin nhắn Telegram.
