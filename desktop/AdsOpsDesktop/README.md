# AdsOps Desktop Pro v2.3.1

Ứng dụng Windows bản địa (.NET 8 WPF Dark Mode) thay thế Bridge EXE cũ, cung cấp **Local Bridge + Chrome Launcher + Két DPAPI Local + Hàng đợi Tự động hóa đa Via + Giám sát Sức khỏe, Chi tiêu, Readiness, Client Retainers, Team & Bảo mật Cloud**:

- **Quản lý Đa Via, Quét Live Proxy & Nhập Lô Hàng Loạt (`Ctrl+B`)**: Tách cột `UID|Pass|2FA|Cookie|Mail|Proxy`, tự động lọc bỏ Pass & Mail trước khi đẩy Cloud, lưu Cookie/2FA 100% cục bộ bằng Windows DPAPI, quét Proxy hàng loạt (`POST /api/v1/proxies/check-batch`), lọc `Proxy Chết` và xếp lưới nhiều cửa sổ Chrome Win32 (`2×2` / `3×2` / `2×1`).
- **Két DPAPI Local & Extension Companion `v2.9.5`**: Tự động kiểm tra `c_user` khi mở Profile Chrome mới & nạp sẵn Cookie + 2FA từ Két DPAPI, đẩy Token `EAAB` lên Cloud 1-click, tự đồng bộ Ngưỡng/Limit Billing ngầm qua `POST /sync-billing` (không cần Meta Token), tự động chạy Keep-Alive đồng bộ từ Desktop/Web & đóng tab an toàn khi hoàn tất, điền nhanh 2FA 6 số **chủ động bằng nút bấm** từ `127.0.0.1:17890/totp`.
- **Sức khỏe TKQC, Readiness Board, Signals & Live Audit (`Ctrl+6`)**: Kiểm tra capability Meta Token, xem cột Chi tiêu Hôm nay / 7 ngày & Tổng hợp theo tiền tệ, ghi nhận/xử lý Tín hiệu sức khỏe, chấm điểm Readiness Board, xem Live Audit Log, xuất CSV chuẩn Excel UTF-8 BOM.
- **Fanpage, Business Managers, Meta Pixels, Domain SEO (`Ctrl+4`) & Ngân sách/Team (`Ctrl+7`)**: Tạo BM, Meta Pixel, cấu hình Domain SEO, quản lý hợp đồng Client Retainer, thành viên Team/Seats & tự cập nhật 1-Click (`AdsOps-Desktop-Pro-latest.json`).

## Build & Self-Test

```powershell
dotnet publish c:\Users\trieunt\Documents\Tool\audit-ads\desktop\AdsOpsDesktop\AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained true -o c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release -p:PublishSingleFile=true
c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release\AdsOpsDesktop.exe --self-test
```
