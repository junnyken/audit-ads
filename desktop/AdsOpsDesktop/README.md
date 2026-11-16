# AdsOps Desktop Pro v2.4.2

Ứng dụng Windows bản địa (.NET 8 WPF Dark Mode) thay thế Bridge EXE cũ, cung cấp **Local Bridge + Chrome Launcher + Két DPAPI Local + Tùy chỉnh Cụm Proxy (1–50 Via/IP) + Full Backup Di chuyển Máy 5 Lớp (`.adsopsvault`) + Khiên Chống Checkpoint & Cách Ly Đa Khách Hàng**:

- **Tùy chỉnh Cụm Proxy (1–50 Via/IP) & Full Backup Di chuyển Máy `.adsopsvault` (v2.4.2)**: Cho phép tùy chỉnh `Max Via / 1 Proxy` (`1–50`, mặc định `4`), `Max Tạo Page / IP` (`1–20`) và `Nghỉ trùng IP` (`15–300s`) trực tiếp trong **Cài đặt (`Ctrl+8`)**; xuất/nhập trọn gói 5 lớp (`Cookie + 2FA DPAPI`, `Danh sách Via/Proxy/Silo`, `Cài đặt Cụm Proxy`, `Lịch sử Ngâm 72h & Cooldown`, `Phiên Cloud`) bằng mã hóa `AES-256-GCM` sang máy tính mới không cần nhập lại từng tài khoản.
- **Tiện ích AdsOps Companion `v2.9.6` với Tab Riêng `🤖 Automatic & Nuôi`**: Tab riêng hiển thị Trust Score 0–100, kiểm tra khớp GeoIP ↔ Múi giờ/Ngôn ngữ trình duyệt, Real-Time IP Leak Kill-Switch khóa khẩn cấp tab Facebook khi rò rỉ ISP IP, 4 kịch bản nuôi nhân tính (`soak_72h`, `human_organic`, `bm_warmup`, `pre_camp`), tự động làm mới Cookie về Két DPAPI sau `KEEPALIVE_OK` (giữ nguyên 2FA), và chặn nhấn Tạo Page khi đang ngâm 72h/Cooldown.
- **Quản lý Đa Via, Quét Live Proxy & Nhập Lô Hàng Loạt (`Ctrl+B`)**: Tách cột `UID|Pass|2FA|Cookie|Mail|Proxy`, tự động lọc bỏ Pass & Mail trước khi đẩy Cloud, lưu Cookie/2FA 100% cục bộ bằng Windows DPAPI, quét Proxy hàng loạt (`POST /api/v1/proxies/check-batch`), lọc `Proxy Chết` / `Đang Cooldown` / `Trùng Silo` và xếp lưới nhiều cửa sổ Chrome Win32 (`2×2` / `3×2` / `2×1`).
- **Sức khỏe TKQC, Readiness Board, Signals & Live Audit (`Ctrl+6`)**: Kiểm tra capability Meta Token, xem cột Chi tiêu Hôm nay / 7 ngày & Tổng hợp theo tiền tệ, ghi nhận/xử lý Tín hiệu sức khỏe, chấm điểm Readiness Board, xem Live Audit Log, xuất CSV chuẩn Excel UTF-8 BOM.
- **Fanpage, Business Managers, Meta Pixels, Domain SEO (`Ctrl+4`) & Ngân sách/Team (`Ctrl+7`)**: Tạo BM, Meta Pixel, cấu hình Domain SEO, quản lý hợp đồng Client Retainer, thành viên Team/Seats & tự cập nhật 1-Click (`AdsOps-Desktop-Pro-latest.json`).

## Build & Self-Test

```powershell
dotnet publish c:\Users\trieunt\Documents\Tool\audit-ads\desktop\AdsOpsDesktop\AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained false -o c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release -p:PublishSingleFile=true -p:TreatWarningsAsErrors=true
c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release\AdsOpsDesktop.exe --self-test
```
