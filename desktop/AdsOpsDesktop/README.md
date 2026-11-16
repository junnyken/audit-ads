# AdsOps Desktop Pro v2.4.1

Ứng dụng Windows bản địa (.NET 8 WPF Dark Mode) thay thế Bridge EXE cũ, cung cấp **Local Bridge + Chrome Launcher + Két DPAPI Local + Cụm Proxy Dân Cư An Toàn 1:4 + Khiên Chống Checkpoint & Cách Ly Đa Khách Hàng + Hàng đợi Tự động hóa đa Via + Giám sát Sức khỏe, Chi tiêu, Readiness, Client Retainers, Team & Bảo mật Cloud**:

- **Cụm Proxy Dân Cư 1:4 An Toàn & Khiên Chống Checkpoint (v2.4.1)**: Hỗ trợ tối đa 4 Via cùng nhóm trên 1 Proxy dân cư tĩnh (chạy xen kẽ Proxy round-robin, bắt buộc tách Hồ sơ Chrome riêng chống đè Cookie & tăng nghỉ an toàn >=55s giữa 2 Via chung IP), tự khóa Tạo Page 72h khi mới thêm Via hoặc vừa đổi Proxy, chấm điểm Tin cậy Môi trường (`0–100`), phát hiện xung đột Silo Proxy giữa các Khách hàng khác nhau, tự đóng băng `Cooldown 24h` khi gặp `SAFETY_CHALLENGE` hoặc `IP_LEAK_BLOCKED`.
- **Tiện ích AdsOps Companion `v2.9.6` với Tab Riêng `🤖 Automatic & Nuôi`**: Tab riêng hiển thị Trust Score 0–100, kiểm tra khớp GeoIP ↔ Múi giờ/Ngôn ngữ trình duyệt, Real-Time IP Leak Kill-Switch khóa khẩn cấp tab Facebook khi rò rỉ ISP IP, 4 kịch bản nuôi nhân tính (`soak_72h`, `human_organic`, `bm_warmup`, `pre_camp`), tự động làm mới Cookie về Két DPAPI sau `KEEPALIVE_OK` (giữ nguyên 2FA), và chặn nhấn Tạo Page khi đang ngâm 72h/Cooldown.
- **Quản lý Đa Via, Quét Live Proxy & Nhập Lô Hàng Loạt (`Ctrl+B`)**: Tách cột `UID|Pass|2FA|Cookie|Mail|Proxy`, tự động lọc bỏ Pass & Mail trước khi đẩy Cloud, lưu Cookie/2FA 100% cục bộ bằng Windows DPAPI, quét Proxy hàng loạt (`POST /api/v1/proxies/check-batch`), lọc `Proxy Chết` / `Đang Cooldown` / `Trùng Silo` và xếp lưới nhiều cửa sổ Chrome Win32 (`2×2` / `3×2` / `2×1`).
- **Sức khỏe TKQC, Readiness Board, Signals & Live Audit (`Ctrl+6`)**: Kiểm tra capability Meta Token, xem cột Chi tiêu Hôm nay / 7 ngày & Tổng hợp theo tiền tệ, ghi nhận/xử lý Tín hiệu sức khỏe, chấm điểm Readiness Board, xem Live Audit Log, xuất CSV chuẩn Excel UTF-8 BOM.
- **Fanpage, Business Managers, Meta Pixels, Domain SEO (`Ctrl+4`) & Ngân sách/Team (`Ctrl+7`)**: Tạo BM, Meta Pixel, cấu hình Domain SEO, quản lý hợp đồng Client Retainer, thành viên Team/Seats & tự cập nhật 1-Click (`AdsOps-Desktop-Pro-latest.json`).

## Build & Self-Test

```powershell
dotnet publish c:\Users\trieunt\Documents\Tool\audit-ads\desktop\AdsOpsDesktop\AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained false -o c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release -p:PublishSingleFile=true -p:TreatWarningsAsErrors=true
c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release\AdsOpsDesktop.exe --self-test
```
