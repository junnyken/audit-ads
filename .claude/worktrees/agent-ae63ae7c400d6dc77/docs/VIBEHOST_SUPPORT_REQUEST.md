# Yêu cầu hỗ trợ Vibe Host — frontend không được định tuyến, cụm kẹt "deploying"

Soạn 2026-09-14. Mọi số liệu dưới đây đo trực tiếp qua MCP Vibe Host và `curl`, không suy đoán.

## Tóm tắt

Giao diện (`audit-ads-frontend`) chạy bình thường bên trong nhưng **hostname công khai của nó trả
trang catch-all của nền tảng**. Backend cùng node thì định tuyến đúng. Song song đó, cụm
`audit-ads` **kẹt ở trạng thái `deploying` suốt 7 ngày** và chỉ tạo được 1 trong 3 service mà
plan khai.

## Bằng chứng

**Cụm** `audit-ads` — id `cmto42ubx08q80i5fqw5141dv`

```
status:           "deploying"        ← kẹt
statusVersion:    4
lastReconciledAt: 2026-09-07T10:20:24Z   ← không đổi 7 ngày
updatedAt:        2026-09-07T10:20:24Z
plan.services:    3  (api/backend, web/extension, web/frontend)
projects:         1  (chỉ audit-ads-backend)
```

**Project giao diện** — `audit-ads-frontend`, id `cmtr47hb000g10h5fv7vcdd86`

```
status:        online
lastDeployedAt: 2026-09-14 11:20   (version 4)
url:           audit-ads-app.cmc-1.vibenode.matbao.ai
```

**Đo bằng curl, 2026-09-14:**

| URL | Kết quả |
|---|---|
| `https://audit-ads-app.cmc-1.vibenode.matbao.ai/` | 404 — trả trang `<title>Địa chỉ này chưa phục vụ nội dung · Vibe Host</title>` |
| `https://audit-ads-frontend.cmc-1.vibenode.matbao.ai/` | 404 — cùng trang catch-all |
| `https://audit-ads-backend.cmc-1.vibenode.matbao.ai/health/live` | **200** |
| `https://audit-ads-backend.cmc-1.vibenode.matbao.ai/health/ready` | **200** |

Trang trả về **không phải** giao diện của chúng tôi: `index.html` của ứng dụng có
`lang="en"` và `<title>AdsOps Control Center</title>`, còn thứ đang được phục vụ là
`lang="vi"` với tiêu đề catch-all của Vibe Host. Nghĩa là request không tới được container —
đây là tầng định tuyến, không phải lỗi build hay lỗi mã.

## Nhờ hỗ trợ

1. Kiểm tầng định tuyến/ingress cho project `audit-ads-frontend`
   (`cmtr47hb000g10h5fv7vcdd86`) để hostname `audit-ads-app.cmc-1.vibenode.matbao.ai` trỏ được
   vào container của nó.
2. Gỡ kẹt reconcile của cụm `audit-ads` (`cmto42ubx08q80i5fqw5141dv`), đang `deploying` từ
   2026-09-07.

## Lưu ý khi xử lý

Chúng tôi **cố ý không chạy `deploy_stack`**: plan của cụm vẫn khai service `web` dựng từ thư mục
`extension` với subdomain `audit-ads` — project đó đã bị xoá có chủ ý, và deploy lại nhiều khả
năng dựng lại nó. Nếu phía hỗ trợ cần deploy lại cụm, xin bỏ service `extension` khỏi plan trước.
