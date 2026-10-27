# Mini-Spec Playbook v2

## 0. Mục đích tài liệu

Tài liệu này định nghĩa **cấu trúc chuẩn cho một MINI-SPEC** — đơn vị thiết kế/triển khai hẹp cho một capability, gate hoặc lớp hardening trong hệ thống.

Mỗi MINI-SPEC phải:
- giải quyết đúng **một** lát cắt rõ ràng,
- có guardrails chặt chẽ (không phá structure hiện có),
- đi kèm audit trước khi build và test sau khi build,
- mô tả outcome quan sát được, không chỉ ý tưởng.

AI/engine khác khi nhận file này phải coi đây là “grammar” chung cho mọi MINI-SPEC trong dự án.

---

## 1. Định nghĩa MINI-SPEC

**MINI-SPEC** là một spec nhỏ, độc lập nhưng gắn trong một Phase lớn hơn.

Đặc điểm:
- Phạm vi rất hẹp (1 capability, 1 gate, 1 lớp UX).
- Thời gian thực hiện: thường trong 1–3 ngày làm việc.
- Kết quả: thay đổi code + schema + API + UX + test tương ứng.
- Không phải PRD/epic; nó là “viên gạch” tinh chỉnh pipeline đã có.

---

## 2. Skeleton chuẩn của MINI-SPEC

Mỗi MINI-SPEC phải tuân theo skeleton sau:

### 2.1. Header

- `ID`: Ví dụ `R4d`, `A2`, `B2`.
- `Name`: Tên rõ ràng, ví dụ `GTM Publish Confirmation & Post‑Publish Observation UX Hardening`.
- `Parent phase`: Phase/chuỗi lớn mà MINI-SPEC này thuộc về.
- `Author` + `Date`: để audit lịch sử.

### 2.2. Context (Bối cảnh bắt buộc)

Liệt kê những thứ **phải hiểu** trước khi động vào code:

- Tài liệu bắt buộc: ví dụ `FEATURES.md`, `ARCH.md`, `API.md`, `TEST_LOG.md`.
- Trạng thái hiện tại của hệ thống liên quan tới MINI-SPEC.
- Các quyết định kiến trúc **phải giữ nguyên**, ví dụ:
  - Không có API platform thật (mọi bằng chứng platform do operator nhập tay).
  - Không được suy quyền publish từ workspace write.
  - Evidence-first, không đoán khi thiếu bằng chứng.

> Agent phải đọc và bám đúng context; không được suy đoán ngoài phạm vi này.

### 2.3. Goal (Mục tiêu phase)

Một đoạn ngắn trả lời đúng **một câu**:

> MINI-SPEC này tồn tại để làm gì?

Ví dụ:

> Biến trạng thái hậu publish thành một rollup trung thực, để operator không bao giờ nhầm “đã publish” với “đã healthy production”.

Không mô tả giải pháp, chỉ outcome.

### 2.4. Constraints (Guardrails bắt buộc)

Danh sách 5–10 ràng buộc không được vi phạm:

- Không rebuild engine/state machine đã có; chỉ harden/wire thêm.
- Không đổi meaning của enum/state cũ.
- Không invent capability khi không có bằng chứng.
- Nếu thiếu bằng chứng → degrade trung thực (`unknown`/`unconfirmed`/`blocked`), không giả pass.
- Không tạo đường tắt bypass gate/approval/confirmation.
- Không bỏ qua audit trail; mọi thay đổi phải truy vết được.

Guardrails là “luật chơi” giúp MINI-SPEC an toàn.

### 2.5. Scope (Phạm vi implementation)

Chia thành các block cố định:

#### A. Domain model

- Entity/enum/state nào cần audit, thêm, sửa.
- Luôn ưu tiên: audit xem **đã có gì**, chỉ thêm đúng phần thiếu.

#### B. Service / Engine

- Rule, provider, state transition nào cần thiết.
- Ví dụ: compute required approvals, map combo state → confirmation rollup.

#### C. API contract

- Endpoint đọc/ghi cần có.
- Payload, response, drill‑down.
- Phải bám style hiện có trong `API.md`, không tự invent pattern mới.

#### D. UI surfaces

- Lát cắt UI tối thiểu để operator hiểu đúng trạng thái:
  - detail view,
  - panel nhỏ trong dashboard,
  - badge/label hiển thị state.
- Không cần dashboard mới nếu view cũ mở rộng được.

#### E. Tests

- Loại test bắt buộc:
  - Unit (rule/state mapping).
  - Integration (HTTP + DB).
  - Regression (bảo vệ invariant).
  - Live verification (nếu có data/pilot thật).

---

## 3. Audit Before Build (trước khi code)

Mỗi MINI-SPEC phải có một section audit:

1. Liệt kê:
   - view/API/state hiện có liên quan,
   - chỗ đã đúng,
   - chỗ sai/mơ hồ/gây hiểu nhầm.
2. Phân loại gap:
   - vocabulary (tên trường/trạng thái),
   - state machine,
   - UX wording,
   - data & permission,
   - observability/metrics.

> MINI-SPEC chỉ được chạm vào **gap đã xác nhận**, không mở rộng phạm vi tùy ý.

---

## 4. Design Choice (Thiết kế được chọn)

Section này chốt **một** hướng:

- Mô tả giải pháp ở mức kiến trúc (component, flow, state).
- Nêu lý do chọn hướng này, lý do bỏ các hướng khác.
- Nêu rõ cách tái sử dụng engine/state cũ:
  - ví dụ: tái dùng framework A2/A16 cho evidence band, không viết framework confidence mới.

> Không liệt kê nhiều phương án để “giữ mở”; MINI-SPEC phải có **phương án duy nhất**.

---

## 5. Test Plan

Chi tiết hóa block Tests:

### 5.1. Unit tests

- Mapping state → rollup.
- Rule logic cốt lõi.
- Kiểm tra guardrails (vd: `can_write != can_publish`).

### 5.2. Integration tests

- HTTP + DB thật với boundary nghiệp vụ rõ ràng.
- Không mock chính cái đang kiểm tra.

### 5.3. Regression tests

- Bảo vệ invariant quan trọng, ví dụ:
  - `publish_executed ≠ synced_confirmed`.
  - CRITICAL thiếu last-known-good → hotfix, không mặc định rollback.

### 5.4. Live verification (nếu có)

- 1–2 run thật trên project pilot / môi trường dev giống production.
- Ghi vào `TEST_LOG.md` những bug thật tìm được + cách fix.

---

## 6. Workstyle (Cách làm việc bắt buộc)

Checklist process cho mọi MINI-SPEC:

1. **Audit trước khi build**:  
   Đọc tài liệu, kiểm tra trạng thái hiện tại, ghi gap.
2. **Build đúng phần thiếu**:  
   Additive-first, reuse-first, không build engine song song.
3. **Không invent vocabulary/enum mới** nếu hệ thống đã có từ tương đương.
4. **Sau khi code xong**:
   - Chạy test suite liên quan.
   - Chạy lint/build (backend + frontend nếu có).
   - Verify migration trên DB sạch.
5. **Cập nhật docs**:
   - `FEATURES.md` (summary capability).
   - `ARCH.md` (kiến trúc).
   - `API.md` (contract).
   - `TEST_LOG.md` (test + bug thật).
6. **Báo cáo kết quả** theo format chuẩn (phần 7).

---

## 7. Mini-Spec Report Format

Sau khi MINI-SPEC hoàn thành, báo cáo nên có cấu trúc:

1. **Summary**
   - 3–5 dòng: phase làm gì, phạm vi.

2. **Audit Before Build**
   - View/API/state đã kiểm tra.
   - Gap cụ thể đã xác nhận.

3. **Design Choice**
   - Phương án được chọn.
   - Lý do.

4. **Changed Files**
   - Backend (services/models).
   - Frontend (UI).
   - Migrations.
   - Docs.

5. **New API/DB/State**
   - Endpoint mới.
   - Field/enum mới.
   - Bất kỳ bảng mới nào.

6. **Tests**
   - Số lượng unit/integration/regression/live.
   - Bug thật tìm được, cách fix.

7. **Live Verification**
   - Pilot run trên môi trường thật (nếu có).
   - Kết luận: behave đúng/khác kỳ vọng.

8. **Remaining Limits / Follow-ups**
   - Những thứ intentionally out-of-scope.
   - Gợi ý MINI-SPEC tiếp theo.

---

## 8. Success Criteria (Tiêu chí thành công)

Mỗi MINI-SPEC phải định nghĩa tiêu chí thành công **quan sát được**, không chung chung:

- Hệ thống làm được thêm X (capability mới, wire mới).
- Hệ thống **không còn** failure mode Y (bug/gap cũ).
- Invariants Z vẫn đúng (guardrails).

Ví dụ:

- Không còn UI nào nói “publish thành công” khi confirmation-status ≠ `publish_executed_healthy`.
- Không còn trường hợp health `healthy` khi evidence band là BLOCKED hoặc WEAK.

---

## 9. Skeleton để sinh MINI-SPEC mới

Khi tạo MINI-SPEC cho capability mới, dùng skeleton sau:

```text
[MINI-SPEC ID] — [Tên capability]

Context:
- [tài liệu bắt buộc]
- [trạng thái hiện tại]
- [quyết định kiến trúc phải giữ nguyên]

Goal:
- [1 câu outcome duy nhất]

Constraints (Guardrails):
1. [...]
2. [...]
3. [...]
4. If missing evidence → degrade to [unknown/unconfirmed/blocked].
5. No bypass of [gate/approval/confirmation].

Scope:
A. Domain model: [...]
B. Services/engine: [...]
C. API contract: [...]
D. UI surfaces: [...]
E. Tests: [...]

Audit Before Build:
- [view/API/state đã kiểm tra]
- [gap cụ thể]

Design Choice:
- [phương án chọn]
- [lý do, cách reuse code cũ]

Test Plan:
- Unit: [...]
- Integration: [...]
- Regression: [...]
- Live verification: [...]

Success Criteria:
- [điều kiện 1]
- [điều kiện 2]
- [điều kiện 3]
```

---

## 10. Cách dùng Playbook với AI / tool khác

Khi khởi động một tool/agent mới:

1. Gửi kèm file `MINI_SPEC_PLAYBOOK.md` để nó hiểu grammar chung.
2. Trong prompt, yêu cầu rõ:  
   "Hãy sinh MINI-SPEC cho capability X theo đúng Playbook này."
3. Bắt agent điền đầy đủ skeleton (Context, Goal, Constraints, Scope, Audit, Design, Test Plan, Success Criteria).
4. Chỉ sau khi MINI-SPEC hoàn chỉnh, mới cho phép agent đề xuất thay đổi code/API/UX.

Playbook này mục tiêu là biến AI thành **kỹ sư spec**, không chỉ là người viết nội dung — giữ được cấu trúc MINI-SPEC chặt chẽ và mở rộng được sang các tool khác (Finance, OpticOdds, GTM, Ads, GA4, v.v.).
```

---

## 13. Luật riêng của AdsOps Control Center (giữ từ bản v1)

Playbook v2 ở trên là khung chung. Với dự án này, các luật dưới đây áp dụng thêm cho mọi MINI-SPEC
và **không được nới** bởi khung chung. `CLAUDE.md` (42 hard rules) vẫn là nguồn cao nhất.

- Mỗi MINI-SPEC có `docs/AUDIT_BEFORE_BUILD_<ID>.md` trước khi viết mã. Quyết định của người dùng
  ghi vào chính tệp đó.
- Phân loại gap theo: `vocabulary`, `architecture`, `data_model`, `state_machine`, `API`,
  `frontend_UX`, `security`, `observability`, `testing`, `deployment`.
- MINI-SPEC tiếp theo chỉ được **đề xuất**, không tự bắt đầu.
- Mọi việc UI/UX theo skill `ui-ux-resource-navigator` (`~/.claude/skills/ui-ux-resource-navigator/SKILL.md`):
  token trước, đủ trạng thái tải/rỗng/lỗi/không quyền/một phần, checklist mục 9 trước khi giao.

### Standing guardrails (all MINI-SPECs)

- Evidence-first: missing evidence is never positive evidence.
- Never claim an account cannot be restricted, or that an ad is guaranteed approval.
- Never store passwords, cookies, sessions, session/access/refresh tokens, credentials, or raw
  proxy authentication secrets — reject and redact them.
- Never hard-delete a domain entity; archive with `archived_at` and keep audit history.
- Every mutation writes a redacted, immutable audit record in the same transaction.
- Enforce workspace authorization server-side on every endpoint.
- No Chromium / Playwright / Selenium / fingerprinting / cookie handling / proxy rotation.
- `unknown` and `not_ready` are never rendered with success styling, and neither is `unknown`
  health.
- Readiness and health stay separate concepts in the model, the API and the UI. Neither may be
  reduced to a numeric score, and neither may be worded as safety, approval or immunity.
- Acknowledging an issue is not resolving it, at any layer.
- No outbound message may carry a secret, a raw provider response, a stack trace or an unusable
  link, and no credential may live anywhere but server configuration — except a Meta reader credential that the product obtained from Meta's own login flow, held encrypted in the O4 vault exactly as CLAUDE.md rules 1 and 40 allow (approved by the owner 2026-10-27).
- Deployment and a first outbound message are irreversible external actions. They are separate
  stages with separate approvals, and neither happens because a spec was accepted.
- Report what was measured, not what the previous report claimed. When the environment cannot
  prove something, say exactly what is missing instead of narrowing the claim quietly.
- Identity is matched exactly or not at all. A confident wrong answer is worse than "I don't
  know", and "ambiguous" is a correct answer.
- A client that runs on someone else's page is the least trusted thing in the system. Give it
  its own credential, its own allowlist and its own expiry, and check every claim it makes.
