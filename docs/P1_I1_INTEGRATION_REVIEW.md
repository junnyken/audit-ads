# P1-I1 — main integration review notes (in progress)

Dành cho người triển khai/reviewer. 2026-11-26. Chưa phải verified finding report hoặc signoff; workers còn đang hoàn thiện mã.

## Các ranh giới cần kiểm sau handoff

1. Due timestamp wire UTC Z + IANA zone: form chỉnh sửa phải round-trip được bản ghi đã có due ở zone ngoài UTC. Không ép người dùng tự đổi offset khi chỉ sửa metadata khác. Kiểm cả tạo mới, edit không đổi due và DST.
2. Team-member options/query cache: key phải phân biệt user/workspace, không reuse member data sau chuyển workspace/role. Endpoint team trả cấu trúc thật và backend là authority, không mặc định mọi membership active.
3. Reveal lifecycle: plaintext và PIN local only, clear trên close/navigation/auth/entry; in-flight request sau unmount không ghi lại state. Không Tanstack mutation/query cache hoặc raw error object có plaintext trong UI.
4. Error codes: 409 bao gồm duplicate/archived/stale/PIN-not-set nên UI phải phân biệt code hoặc có hướng xử lý chính xác, không gọi mọi 409 là stale. 404 resource missing khác backend unavailable nếu đã có entity.
5. Backend role/seat refresh và locks: context cached không thay row fresh; target assignment changes và revocation need PG tests. SQLite chỉ chứng minh logic/transaction cơ bản, không lock behavior.
6. Migration graph/model parity; offline SQL và source DDL không thay migration PostgreSQL thật.

7. Confirmed source integration gap: backend/app/main.py CORS allow_headers currently excludes If-Match, while new frontend sends it for PATCH/reassign/archive. Main must add If-Match and expose ETag after backend worker handoff (avoid concurrent writes) and test real-origin OPTIONS. Source gap, not a production P1 failure (P1 not deployed).

Những mục trên là checklist đang review, không ghi lỗi chưa tái hiện như kết luận chắc chắn. Sau worker kết thúc, main kiểm cụ thể và ghi test/patch thực nếu có.

## Source resolutions checked by main

- CORS If-Match/ETag fixed and actual-app preflight tested for allowed/untrusted Origin.
- Existing due in UTC Z + non-UTC zone preserved for metadata-only edit; explicit dueForWrite retains submitted valid offset for server validation.
- Eligible-member cache scoped user/workspace/role; owner-only team endpoint replaced by registry-only minimal picker, with backend authorization/exclusion tests. Generic team RBAC unchanged.
- Reveal uses local state and unmount guard; mocked UI tests exercise close/auth/route cleanup, no query/mutation cache or storage.
- Remaining PostgreSQL lock/race/migration and real-browser/viewport/privacy-retention/wording gates are not certified by local tests.
