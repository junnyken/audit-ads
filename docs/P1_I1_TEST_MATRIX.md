# P1-I1 — ma trận kiểm chứng tích hợp

Dành cho reviewer/người kiểm thử, 2026-11-26. Các mục dưới là ca cần chạy, chưa đánh dấu pass.

| Nhóm | Backend | UI/client | Đích bằng chứng |
|---|---|---|---|
| Role | owner/admin all, assigned active buyer only, viewer/auditor deny, inactive roles deny | hidden entry/controls, no fetch on unauthorized page, backend remains authority | SQLite/API + component; PG/staging còn cần |
| Identity | contact normalize/cipher/index, workspace uniqueness including archived, no dot/plus merge | contact intake only, no address edit, masked list/history | crypto/service/API + transient form tests |
| Version | missing/stale If-Match fail, atomic increment | quoted header on PATCH/reassign/archive, 409/428 no false save | route + actual fetch-client test |
| Manual evidence | unknown clears; attestation requires actor/time/owner; no future/server forgery | observation time with explicit offset, due+IANA pair, no provider success label | schema/service + UI validation |
| Reveal | current user PIN, role/seat recheck, audit commit before plaintext, counter failure durable | local transient result/PIN, clear on close/route/auth change; no query cache/export | API transaction + component |
| Privacy | no address/cipher/index/PIN/free text audit/error, no-store | no raw payload logs, no storage/clipboard, safe error messages | schema/error/audit + spies/code review |
| Lifecycle | archive-only, no restore/import/link/reminder/export | archive confirmation, no unsupported actions | service/API + component |
| Recovery | encryption/index key unavailable fail closed, audit failure rollback | 503 distinguish unavailable from empty; safe retry/readback | local tests; live key setup pending |
| Concurrency | duplicate race, lock order, revoked assignee race, stale writes | version stale handling, no duplicate submit | SQLite partial; PG lock/races NOT proven |
| Migration | additive next head, schema/index constraints | not applicable | offline SQL/head; PG rehearsal pending |

Kết quả cuối cùng ghi TEST_LOG.md + P1_I1_EXECUTION_2026-11-26.md bằng số đo thực. Không cộng test trùng thành tổng duy nhất. Không gọi PostgreSQL locks/migration pass từ SQLite.
