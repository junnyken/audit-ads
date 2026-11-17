# RUNBOOK — Nạp thử extension trong Chrome thật (UAT A5)

Trạng thái: **chưa từng thực hiện.** Extension A5 chưa bao giờ chạy trong một trình duyệt.
Đây là việc còn treo duy nhất của A5, và là lượt kiểm chứ không phải MINI-SPEC mới.

Mục tiêu: xác nhận allowlist route trong `extension/src/shared/validation.ts` khớp với URL
Meta **thật sự phục vụ hôm nay**, và extension nhận ra đúng account.

---

## 0. Trở ngại về hạ tầng — đọc trước

Workspace này là Cloud IDE chạy trên máy chủ. **Chrome chạy trên máy của bạn, không chạy ở
đây.** Nên hai thứ phải đi qua ranh giới đó:

| Thứ | Ở đâu | Vấn đề |
|---|---|---|
| `extension/dist/` | Máy chủ workspace | Phải tải về máy bạn thì Chrome mới nạp được |
| API (`127.0.0.1:8000`) | Máy chủ workspace | Máy bạn **không** gọi tới được |

Extension chỉ chấp nhận địa chỉ `https://`, trừ `localhost` (xem `isUsableDashboardUrl`).
Vậy API phải có một địa chỉ HTTPS máy bạn gọi được. Ba đường:

- **(a) Chạy toàn bộ dự án trên máy bạn.** API ở `http://localhost:8000` được extension chấp
  nhận. Sạch nhất, không đụng gì tới hạ tầng, nhưng bạn phải dựng Postgres + backend tại máy.
- **(b) Đưa API ra một địa chỉ tạm `*.b.matbao.ai`** qua `mb-route` (skill `/local-dev`).
  Nhanh nhất. **Đây là hành vi phơi dịch vụ ra ngoài — cần bạn duyệt rõ ràng** (quy tắc 22
  trong `CLAUDE.md`), và nên là scope nội bộ/allowlist IP chứ không public.
- **(c) SSH port-forward** từ máy bạn vào workspace, rồi dùng `http://localhost:8000`.
  Không phơi gì ra ngoài, nhưng cần bạn thao tác SSH tại máy.

Chưa chọn đường nào thì UAT không bắt đầu được.

---

## 1. Trước khi nạp — thu URL thật (làm được NGAY, không cần hạ tầng)

Đây là phần giá trị nhất và rẻ nhất. Không cần API, không cần nạp extension.

Mở Ads Manager như bạn vẫn làm, bấm qua các màn hình, **copy nguyên văn URL** trên thanh địa
chỉ ở mỗi màn: chiến dịch, nhóm quảng cáo, quảng cáo, danh sách tài khoản, thanh toán, cài đặt
tài khoản. Dán vào đây:

```bash
cd extension
npm run check-urls -- "<url 1>" "<url 2>" ...
# hoặc dán nhiều dòng:
npm run check-urls    # rồi paste, Ctrl-D
```

Công cụ import thẳng `src/shared/validation.ts` — đúng đoạn mã chạy trong content script — nên
kết quả là điều extension **thật sự** sẽ làm.

Dòng `✗` = allowlist còn thiếu. Gửi lại nguyên văn URL đó để sửa `PATH_RULES`.

> URL Ads Manager thường chứa `access_token`/`business_id` trên query string. Công cụ này chỉ
> đọc tham số `act` và bỏ toàn bộ phần còn lại; nó không gọi mạng và không lưu gì. Dù vậy, nếu
> bạn ngại, cứ xoá phần sau dấu `&` đầu tiên trừ `act=` trước khi dán.

## 2. Nạp extension

1. Tải `extension/dist/` về máy bạn (nén lại cho gọn: `cd extension && zip -r dist.zip dist`).
2. Chrome → `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn `dist/`.
3. Chrome hiện **ID** của extension. **Ghi lại và gửi cho tôi** — dạng 32 chữ cái.

## 3. Cấu hình CORS (bắt buộc, nếu không mọi lệnh gọi sẽ hỏng)

Backend chỉ chấp nhận origin có trong danh sách. Origin của extension là
`chrome-extension://<ID ở bước 2>`. Thêm vào `CORS_ORIGINS` rồi khởi động lại API:

```
CORS_ORIGINS=http://localhost:5173,chrome-extension://<ID>
```

ID chỉ tồn tại sau bước 2, nên bước này **không thể làm trước**.

## 4. Kết nối

Trang Options của extension → nhập địa chỉ API (theo đường đã chọn ở mục 0) → email + mật khẩu
tài khoản dashboard → Connect. Extension đổi lấy token loại `extension` rồi **quên mật khẩu**.

## 5. Những điều cần quan sát và ghi lại

| Kiểm | Đạt khi |
|---|---|
| Mở trang chiến dịch của tài khoản ĐÃ đăng ký | popup hiện đúng tên tài khoản đó |
| Mở tài khoản CHƯA đăng ký | trạng thái `unknown`, không đoán bừa |
| Bấm chuyển qua lại giữa các tài khoản | context đổi theo, không kẹt ở tài khoản cũ |
| Mở trang không phải Ads Manager | `unsupported_page` |
| Ghi một ghi chú | xuất hiện trong timeline A1 trên dashboard, có audit row |
| Thu hồi phiên từ dashboard → thao tác tiếp | bị chặn **ngay**, không đợi hết hạn |

Ghi kết quả thật vào `TEST_LOG.md`. Không đạt thì ghi không đạt.

## 6. Điều KHÔNG làm trong lượt này

Không deploy. Không gửi tin Telegram thật. Không đăng lên Chrome Web Store. Không thao tác gì
trên Ads Manager qua extension — nó không có khả năng đó và không được thêm vào.
