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

## Đo lại 2026-10-05 (21 ngày sau bản soạn đầu)

Mọi mục dưới đây đo trực tiếp qua `curl`, DNS và MCP Vibe Host (`vays3`) hôm nay.

| Mục | Kết quả |
|---|---|
| `audit-ads-app…/`, `audit-ads-frontend…/` | **vẫn 404**, cùng trang catch-all của Vibe Host |
| `audit-ads-backend…/health/live` | 200 |
| DNS của cả hai hostname | `203.171.31.200` — hostname phân giải, request tới được edge nhưng edge không có route |
| Cụm `audit-ads` | **vẫn `deploying`**, `statusVersion: 4`, `lastReconciledAt: 2026-09-07T10:20:24Z` (28 ngày không đổi) |
| Project `audit-ads-frontend` | `status: online`, `version: 4`, `domains: []` |
| Log runtime của frontend (`diagnose_deploy`) | không lỗi; nginx 1.27.5 khởi động 2026-09-14 và 2026-09-21; health check nội bộ trả 200 |

`domains: []` cùng với `plan` của cụm chỉ có 1 trong 3 service được tạo cho thấy edge chưa bao giờ
được cấp route cho hostname của frontend. Container khoẻ nhưng không có đường vào.

**`redeploy_project` cho frontend bị chặn bằng `ENV_REQUIRED`** vì `.env.example` ở gốc repo khai
6 biến rỗng của backend (`BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`, `META_ACCESS_TOKEN`,
`META_BUSINESS_ID`, `META_ACCESS_TOKENS_BY_BUSINESS`, `MIGRATE_ON_START`). Project frontend không
đọc biến nào trong số đó. Chưa redeploy được, nên chưa biết redeploy có tự gắn route hay không.

### Redeploy frontend 2026-10-05 — đã thử, không gỡ được

Sau khi cấp đủ biến, project `audit-ads-frontend` redeploy thành **version 5** (commit `a8392b6`).
Mọi chặng xanh: Build, Run Container, Reverse Proxy Update, SSL Certificate, Health Check ("LIVE —
promote + prod probe 200"). Chính log của nền tảng lại ghi ngay sau đó:

> `[Route] ⚠ sau 30.2s https://audit-ads-app.cmc-1.vibenode.matbao.ai VẪN chưa phục vụ được nội dung (404). App đã khoẻ — vấn đề nằm ở đường công cộng, không phải mã nguồn của bạn.`

Đo bằng curl sau khi xong, và poll 5 phút (20 lần, cách 15 giây) không lần nào ra khác 404:
`audit-ads-app` và `audit-ads-frontend`, các đường `/`, `/index.html`, `/assets/` đều 404, header
`x-vays-catchall: 1`. Vậy đây **không** phải chờ cấp chứng chỉ HTTPS của tên miền mới: hostname
này đã tồn tại từ 2026-09-07. Redeploy riêng project không sửa được; cần nền tảng gắn route.

### Sau khi nền tảng đổi domain sang `*.vibe1.tinhgon.xyz` — đo lại 2026-10-27, lỗi vẫn còn

Project `audit-ads-frontend` (`cmtr47hb000g10h5fv7vcdd86`) redeploy thành **version 6** lúc 17:06 (commit `ee418ca`).

- **Log của nền tảng:**
  - Mọi chặng đều xanh, kể cả *Reverse Proxy Update*, *SSL Certificate* và *Health Check* ("LIVE — promote + prod probe 200").
  - Ngay sau đó log lại ghi:
    > `[Route] ⚠ sau 31.0s https://audit-ads-app.vibe1.tinhgon.xyz VẪN chưa phục vụ được nội dung (404). App đã khoẻ (prod probe 2xx) — vấn đề nằm ở đường công cộng`
- **Đo từ bên ngoài, poll 5 phút (20 lần):**
  - DNS `203.171.31.200`, cùng IP với backend.
  - Chứng chỉ `CN = audit-ads-app.vibe1.tinhgon.xyz` đã cấp đúng.
  - `http://` trả 301 sang `https://`.
  - `https://` trả **404 `text/plain` "404 page not found"** (404 mặc định của Traefik, không phải nginx của app). Cả 20 lần đều như vậy.
- **Đối chứng:** `audit-ads-backend.vibe1.tinhgon.xyz` (cụm `audit-ads`, `cmto42ubx08q80i5fqw5141dv`) trên cùng edge trả **200**.

**Kết luận:** edge đã có chứng chỉ cho hostname nhưng chưa có router trỏ hostname vào container `vays-app-c3c8453f`. Redeploy không tự gắn được. Cần đội nền tảng làm một trong hai việc:
1. gắn router cho `audit-ads-app.vibe1.tinhgon.xyz` vào project `cmtr47hb000g10h5fv7vcdd86`;
2. hoặc đưa project frontend vào cụm `audit-ads`, như kế hoạch của cụm vẫn khai (`web` từ `frontend/`).
