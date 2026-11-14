# AdsOps Desktop Pro v2.2

Ứng dụng Windows bản địa (.NET 8 WPF Dark Mode) thay thế Bridge EXE cũ, cung cấp **Local Bridge + Chrome Launcher + Két DPAPI Local + Hàng đợi Tự động hóa đa Via + Giám sát Sức khỏe, Chi tiêu, Bot Telegram & Bảo mật Cloud**:

- **Quản lý Đa Via & Nhập Lô Hàng Loạt (`Ctrl+B`)**: Tách cột `UID|Pass|2FA|Cookie|Mail|Proxy`, tự động lọc bỏ Pass & Mail trước khi đẩy Cloud, lưu Cookie/2FA 100% cục bộ bằng Windows DPAPI, tự chia `Profile N` chưa trùng và cảnh báo trùng IP Proxy.
- **Két DPAPI Local & Extension Companion `v2.9.3`**: Tự động kiểm tra `c_user` khi mở Profile Chrome mới & nạp sẵn Cookie + 2FA từ Két DPAPI, đẩy Token `EAAB` lên Cloud 1-click, tự đóng cửa sổ Chrome Keep-Alive khi hoàn tất an toàn, điền nhanh 2FA 6 số **chủ động bằng nút bấm** từ `127.0.0.1:17890/totp`.
- **Sức khỏe TKQC, Chi tiêu & Meta Token Hub (`Ctrl+6`)**: Kiểm tra capability Meta Token, xem cột Chi tiêu Hôm nay / 7 ngày & Tổng hợp theo tiền tệ, làm mới Chi tiêu từng TKQC, chấm điểm Pre-flight chiến dịch nháp và xuất CSV chuẩn Excel UTF-8 BOM.
- **Giám sát Phiên Chrome Active, Tạm ẩn Cảnh báo, Bot Telegram & Phiên Thiết Bị Cloud**: Theo dõi Chrome PID & RAM, tạm ẩn cảnh báo 24h, cấu hình Bot Telegram cảnh báo tức thời và quản lý/thu hồi phiên đăng nhập Cloud.

## Build & Self-Test

```powershell
dotnet publish c:\Users\trieunt\Documents\Tool\audit-ads\desktop\AdsOpsDesktop\AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained true -o c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release -p:PublishSingleFile=true
c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release\AdsOpsDesktop.exe --self-test
```
