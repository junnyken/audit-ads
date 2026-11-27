# P1-D2 — checklist review contract

Dành cho PO/BA và reviewer kỹ thuật, 2026-11-26.

Contract chính: P1_EMAIL_REGISTRY_CONTRACT.md. Đây là checklist review, không phải test đã chạy.

- [ ] Tách rõ capability hiện hữu và endpoint/model PROPOSED, không đổi nghĩa F1.
- [ ] Workspace từ membership/session, không từ body/query tự cấp quyền.
- [ ] Owner/admin + assignee active được reveal bằng PIN của chính người xem; role hạn chế không tự được nâng quyền do assignment.
- [ ] List/detail/search/history/export không lộ full address/ciphertext/index/PIN.
- [ ] Tạo/sửa/reassign/archive có matrix rõ; assignee không tự reassign hoặc tự cấp quyền.
- [ ] Địa chỉ là contact, không email password; nêu rõ exception validator/reveal nào cần sửa có chủ đích.
- [ ] Mã hóa tập trung vault, khóa thiếu/sai fail closed; index chống trùng có domain separation/version và không plain hash.
- [ ] Uniqueness/canonicalization không tự gộp Gmail dấu chấm/plus, không âm thầm restore archived.
- [ ] Missing/null/unset có nghĩa rõ; unknown không thành false/success; due UTC và manual evidence không provider verified.
- [ ] Audit redacted trước/sau theo allowlist, atomic; reveal có audit thành công trước response; PIN thất bại xử lý transaction đúng.
- [ ] Stale write/concurrent create/reassign-vs-reveal có test, không chỉ optimistic UI.
- [ ] Pagination/filter/order/error envelope theo repo, không secret trong lỗi.
- [ ] Không mailbox OAuth/provider login/notifications mới/DB link tài sản ngoài scope.
- [ ] Migration additive và rehearsal staging đúng đích; production cần gate backup/schema/rollback/login chưa bị miễn.
- [ ] Wording/mockup/manual QA chưa ký thì ghi rõ, không dùng 4 DOM tests thay toàn bộ UAT.

Các mục chỉ được đánh dấu đạt sau review có bằng chứng. Không phát sinh production write từ checklist này.
