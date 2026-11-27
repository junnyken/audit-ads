# AdsOps P0 — bàn giao tự deploy qua Vibe Host

Dành cho người vận hành AdsOps. Ngày kiểm tra: 2026-11-26.

## 1. Bản mã và đích triển khai

- Repository: https://github.com/junnyken/audit-ads
- Nhánh phát hành: `fix/p0-hardening-20261126`.
- Commit sửa ứng dụng: `98f68807ab37326a62f42876adf93d151611022c`.
- Commit bàn giao bổ sung chỉ thay đổi tài liệu; khi chọn đầu nhánh mới, mã ứng dụng vẫn là bản sửa trên. Ghi lại SHA đầy đủ của bản thực sự được Vibe Host dựng.
- Không merge vào `main` chỉ để kích hoạt deploy. Không tạo app/stack/DB mới, không import lại stack Compose.

| Thành phần hiện hữu | ID | URL giữ nguyên | Bản quay lại đã nhận diện |
|---|---|---|---|
| Frontend `adsops-frontend` | `cmvqjkc5p063m0i5fzhsrljpo` | https://adsops-app.vibe.tinhgon.xyz | v106, source `3f886e69` |
| Backend `audit-ads-backend` | `cmto42zj408qo0i5fxxjj6xix` | https://audit-ads-backend.vibe1.tinhgon.xyz | v101, source `3f886e69` |
| PostgreSQL `audit-ads-postgresql` | `cmto42zki08qq0i5f8h53j5xv` | Nội bộ, không mở public | Giữ nguyên DB và volume |

Stack backend: `cmto42ubx08q80i5fqw5141dv` (`audit-ads`). Frontend là app riêng, không tạo thêm frontend trong stack này.

Metadata và log build của cả hai app đã được đọc: cùng cấu hình repo trên, nhánh `main`, subdir lần lượt `frontend` và `backend`. Hai log build xác nhận source `3f886e69`. Nhánh phát hành đã tồn tại trên GitHub với đúng SHA sửa ứng dụng. Health readiness và config.js hiện hữu trả HTTP 200; đây không phải bằng chứng patch đã deploy.

## 2. Việc cần làm TRƯỚC khi bấm deploy

1. Mở đúng hai app trong bảng trên. Lưu cấu hình nguồn, phiên bản, image/digest nếu nền tảng hiển thị và phương án rollback có sẵn. Không chép secret vào tài liệu/log.
2. Xác nhận nền tảng còn cho rollback frontend v106 và backend v101. Nếu chỉ có số phiên bản mà không còn artifact hoặc không có cách khôi phục, dừng để chuẩn bị rollback trước.
3. Xác nhận DB và volume gắn backend đúng là dữ liệu AdsOps hiện hữu. Không đổi DATABASE_URL, credential vault key, JWT secret, domain, CORS hoặc dispatcher để làm app khởi động được.
4. Tạo backup bằng chức năng quản trị của DB/hosting hoặc nhờ người vận hành có quyền. Ghi thời gian, vị trí bảo mật, checksum, revision và số lượng bảng. Backup phải mới trong 26 giờ và được chứng minh restore vào DB tách biệt; dọn DB drill sau kiểm tra, không ghi đè DB thật. Không tạo stack beta mới cho drill.
5. Đọc revision/schema bằng truy vấn chỉ đọc bên dưới. Không dùng readiness 200 thay cho kiểm schema.
6. Nếu không thực hiện được backup/restore, schema hoặc rollback, **dừng phát hành**. Đây không phải các mục được miễn vì tự deploy.

### SQL kiểm schema (chạy trong công cụ quản trị đúng PostgreSQL AdsOps)

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT version_num FROM public.alembic_version;
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'users' AND column_name IN
      ('email_verified', 'email_verified_at', 'failed_login_count', 'login_locked_until'))
    OR table_name IN ('email_verification_tokens', 'signup_email_allowlist')
  )
ORDER BY table_name, ordinal_position;
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.users'::regclass
  AND tgname = 'on_users_block_disposable_email'
  AND NOT tgisinternal;
ROLLBACK;
```

Head mong đợi: `0026_v52_security_and_verification`; cần đủ bốn cột users và hai bảng trên, trigger tồn tại và được bật. Kết quả khác phải điều tra, không tự sửa version marker.

Commit P0 không thay đổi migrations/models so với `3f886e69`. Nếu DB đã đúng head và schema, **không cần migration**, không bật `MIGRATE_ON_START`. Nếu DB thấp hơn hoặc thiếu cấu trúc, dừng để lập bước migration có backup; không tự bật cờ. Code hiện tại có thể log lỗi migration rồi vẫn khởi động, nên health xanh không chứng minh migrate thành công.

## 3. Chọn mã nguồn và deploy trên app hiện hữu

1. Trong cấu hình nguồn của **cả hai app**, chọn nhánh `fix/p0-hardening-20261126`, giữ nguyên repository và subdir. Nếu Vibe Host có ghim commit, ghim SHA sửa ứng dụng ở mục 1; nếu dùng đầu nhánh tài liệu mới, ghi lại SHA đầy đủ và kiểm diff chỉ thêm tài liệu.
2. Nếu giao diện không hỗ trợ đổi nhánh/commit cho app hiện hữu, nhờ quản trị Vibe Host đổi nguồn. Không bấm redeploy khi app vẫn trỏ `main`; thao tác đó sẽ dựng bản cũ, không phải P0.
3. Sau khi toàn bộ điều kiện mục 2 đạt, deploy backend trước. Xem log source validation để xác nhận SHA đúng bản đã chọn. Chờ health gate hoàn tất và kiểm readiness, schema, đăng nhập trước khi deploy frontend.
4. Deploy frontend trên app frontend hiện hữu. Kiểm log source validation đúng SHA và config.js vẫn trỏ backend trong bảng.
5. Không bật các job discovery/credential sweep, không gửi Telegram, không gọi Meta tạo/sửa tài khoản để thử deploy. Giữ nguyên chính sách vận hành hiện tại.
6. Nếu có auto-deploy khi đổi nguồn, chỉ lưu thay đổi sau khi đã hoàn tất mục 2. Không bấm deploy/retry liên tục khi đang có một lượt dựng.

## 4. Kiểm chứng sau deploy

Từ máy có quyền truy cập, có thể chạy các probe chỉ đọc:

```bash
curl --fail --show-error --max-time 20 https://audit-ads-backend.vibe1.tinhgon.xyz/health/live
curl --fail --show-error --max-time 20 https://audit-ads-backend.vibe1.tinhgon.xyz/health/ready
curl --fail --show-error --max-time 20 https://adsops-app.vibe.tinhgon.xyz/config.js
curl --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}\n' \
  https://audit-ads-backend.vibe1.tinhgon.xyz/api/v1/system/status
```

Kỳ vọng: live/ready 200, ready có database reachable; config.js đúng backend; system/status không đăng nhập trả 401.

Đăng nhập qua giao diện bằng tài khoản thật được cấp; không tạo token/cookie để bỏ qua login. Kiểm Overview, Accounts/T2 và bộ chọn cột, Readiness, Health, Alerts/delivery, Operations, Assets, Settings và Audit Log. Kiểm các số liệu thiếu không biến thành 0/thành công, tiền tệ không bị làm tròn mất dữ liệu; không còn form nhập token Facebook cũ và token Telegram trong Automation. Kiểm tài khoản thiếu quyền bị chặn đúng. Không nhập token/cookie để kiểm thử và không gửi thông báo thật.

Ghi kết quả đạt/chưa đạt, SHA thực dựng, phiên bản mới, revision trước/sau, backup/checksum, restore drill, smoke và phiên bản rollback. Chỉ công bố hoàn tất sau khi kiểm các mục này.

## 5. Nếu phải quay lui

- Dùng chức năng rollback của nền tảng cho **app hiện hữu**: frontend về v106, backend về v101; xác minh artifact vẫn gắn source `3f886e69` trước thao tác. Nếu chỉ một app lỗi, quyết định quay app đó hay cả cặp theo khả năng tương thích; kiểm lại cả cặp.
- Giữ nguyên DB, volume, URL, secret. **Không downgrade schema hoặc restore đè DB** như bước rollback thông thường.
- Kiểm live/ready, đăng nhập, config.js và các trang nghiệp vụ sau rollback. Nếu rollback không có artifact, dừng và nhờ quản trị khôi phục bản đã ghi nhận; không dựng lại từ `main` đang có thể thay đổi mà không ghim commit.
- Script `scripts/rollback.sh` là cho Compose, không phải lệnh rollback Vibe Host; không chạy nó vào một stack cục bộ để thay thế rollback app thật.

## 6. Trạng thái bằng chứng / giới hạn

- Kiểm tra nguồn cũ đã ghi: frontend 641 passed / 0 failed / 20 skipped; backend chọn lọc 91 passed, không phải full PostgreSQL suite; frontend build/typecheck đạt, lint 0 errors/10 warnings; backend ruff đạt. Không chạy lại toàn bộ bộ test khi chỉ bổ sung tài liệu.
- Trong lượt chuẩn bị này: đã xác nhận nguồn GitHub và hai log build, health/config.js; system/status không đăng nhập 401. Chưa có credentials live.
- **Chưa có** bằng chứng schema thực tế, backup thật/restore drill, rollback artifact khả dụng, đăng nhập/RBAC sau deploy. Chưa deploy, chưa migration, chưa đổi nguồn app.
- Gate phát hành vẫn NO-GO cho đến khi các điều kiện vận hành được giải quyết. Xem `P0_RELEASE_GATE_2026-11-26.md`, `RUNBOOK_BACKUP_RESTORE.md`, `RUNBOOK_ROLLBACK.md`.
- P1 email metadata/recovery UI và P2/P3 trong kế hoạch nâng cấp không nằm trong bản P0 này, chưa được báo hoàn tất.
