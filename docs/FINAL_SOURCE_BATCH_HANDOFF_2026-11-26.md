# AdsOps — bàn giao batch sửa lỗi và tiếp tục plan

Dành cho chủ sản phẩm và người triển khai. 2026-11-26. **Không deploy / không production migration** theo chỉ đạo người dùng sẽ deploy sau.

## 1. Phần source đã hoàn tất trong batch

### Ba lỗi tái hiện

- CSV formula-like text: bảo vệ tiền tố công thức kể cả whitespace/control. Cột số raw hợp lệ giữ số âm, zero, độ chính xác; unknown emdash, BOM/CRLF/quoting giữ nguyên. Test Blob actual; chưa mở Excel/LibreOffice thật.
- CSV thiếu trang: xuất toàn bộ kết quả server filters + platform/quick/card client filters, fetch fresh từ page1 tuần tự. Giới hạn10000; lỗi/page/count không nhất quán/ID trùng thì không download file partial. Busy/cancel/error và chặn late download sau đổi auth/route/filter/unmount. Không immutable-snapshot guarantee khi tổng ổn định mà dữ liệu đổi.
- Response form cũ đóng form mới: mounted instance + synchronous submit guard trong EntryForm/AdminAction. Late success invalidates đúng original authscope nhưng không onSaved/error/close form mới. Gửi request rồi đóng không đồng nghĩa undo server mutation.

### P1-I2 tiếp theo

- Registry-specific config API GET/PATCH /api/v1/email-registry/reminder-policy, owner/admin active, strict boolean lưu AlertPolicy, mặc định false; no env feature flag.
- attention=true trên list: overdue active/nonarchived theo request UTC, scope buyerassigned/owneradmin, order due/id, count trước paging. Không tạo reminder rows/deliveries lặp hoặc thay manual evidence/health.
- UI toggle đọc lại server, error không giả false; attention filter/page reset và authscope cache.
- Migration additive0028 sau0027; generic notification policy RBAC/team/dispatcher/transport không bị mở rộng, không Telegram/provider calls.

## 2. Kết quả main tự chạy cuối cùng

| Kiểm tra | Kết quả |
|---|---|
| Backend isolated SQLite/API registry + reminder | 100 passed,35.58s, exit0 |
| Ruff backend app +2standalone tests | All checks passed |
| Full frontend | 706 passed /20skipped,50passed/1skipped files,74.32s,exit0 |
| Typecheck / production build | pass |
| ESLint |0errors/10existing Hooks warnings |
| Migration graph | single head0028_email_registry_reminders |
| Offline SQL0026:head | generated successfully through0027/0028; no DB connection/migration |
| Whitespace | git diff --check passed |

Không cộng focused60 vào full706, không tính skipped thành pass. Initial combined44pass2fail do old mock chưa biết reminder-policy; sửa fixture actual shape, không assertion weakening. Negative lifecycle control removed guards ->2failed then restored source; fixed31Email tests passed before reminder integration. CSV worker71917d... reported15focused and protection negative control; main reviewed helper/tests and final full suite includes them. Reminder worker68d43... ended codex_turn_failed; main independently reviewed/tested, no worker success claimed.

## 3. Source/files chính

frontend/src/lib/accountsCsv.ts; pages/Accounts.tsx; components/email-registry/EntryForm.tsx,Detail.tsx,ReminderPolicy.tsx; pages/Emails.tsx; i18n/accountsExport.ts,emailRegistry.ts; tests/accounts-csv.test.tsx,email-registry.test.tsx,email-reminders.test.tsx.
Backend AlertPolicy new bool, email_registry model/schema/service/router +0027/0028,100tests fixture in-memory. Previous P1-I1 privacy404/cors/keys still included in working source.

## 4. Hướng deploy sau — chưa được thực thi

1. Review nguồn/commit sạch, giữ preexisting desktop/generated/settings ngoài commit; không git add-A.
2. Xác minh đích staging, DB/schema/volume, backup restore/artifact rollback; cấp tài khoản role kiểm thử qua cấu hình an toàn. Không tạo stack thứ hai hoặc suy staging từ domain.
3. Provision dedicated index key+vault đúng quy trình, không đổi vault key cũ tùy tiện hoặc lấy JWT fallback. Không gửi secret qua chat/repo.
4. Rehearse PostgreSQL migration0027+0028 và concurrency/RBAC/audit test. **Áp dụng cả migration trước code đọc AlertPolicy mới**, defaultoff không thay thế schema.
5. Browser/manual375/768/1280/keyboard/wording, real spreadsheet compatibility và authenticated CSV; kiểm provider runbook Microsoft nguồn hiện hành.
6. Phát hành cùng app/URL sau gate; source batch không tự cấp quyền migration/deploy. Rollback artifact tương thích, giữ schema/data/audit, không downgrade/drop/restore đè mặc định.

## 5. Toàn plan: giới hạn còn lại

P0 operational evidence, staging/UAT, secure key lifecycle/retention/token rotation chưa có bằng chứng. P2 real-workflow/performance/time-saving metrics chưa đo, không bịa số hoặc dựng report engine trùng. Reminder in-app đã source-complete; outbound/recurring delivery/provider integration không nằm trong slice, không giả đã có. P3 deploy được người dùng để sau, chưa thực hiện. Vì vậy **source batch đã hoàn tất kiểm local; toàn bộ plan chưa thể ký nghiệm thu vận hành**.

Không commit/push/production writes, không stack/DB/server mới được tạo trong batch. Tất cả thay đổi ở workspace để bàn giao, chưa nằm trên main remote.
