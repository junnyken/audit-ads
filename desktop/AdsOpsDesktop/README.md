# AdsOps Desktop Pro v2.1

Ứng dụng Windows bản địa (.NET 8 WPF Dark Mode) thay thế Bridge EXE cũ, cung cấp **Local Bridge + Chrome Launcher + Két DPAPI Local + Hàng đợi Tự động hóa đa Via + Giám sát Sức khỏe & Token**:

- **Quản lý Đa Via & Nhập Lô Hàng Loạt (`Ctrl+B`)**: Tách cột `UID|Pass|2FA|Cookie|Mail|Proxy`, tự động lọc bỏ Pass & Mail trước khi đẩy Cloud, lưu Cookie/2FA 100% cục bộ bằng Windows DPAPI, tự chia `Profile N` chưa trùng và cảnh báo trùng IP Proxy.
- **Két DPAPI Local & Extension Companion `v2.9.2`**: Truyền Cookie & Proxy riêng từng Via, điền nhanh 2FA 6 số **chủ động bằng nút bấm** từ `127.0.0.1:17890/totp` (chỉ hoạt động trên màn hình nhập mã xác thực hợp lệ, tuyệt đối không vượt CAPTCHA).
- **Sức khỏe TKQC, Meta Token & Pre-flight Hub (`Ctrl+6`)**: Kiểm tra capability Meta Token, xem trạng thái Critical/Warning/Clear từng TKQC, chấm điểm Pre-flight chiến dịch nháp và xuất báo cáo CSV chuẩn Excel UTF-8 BOM.
- **Bảng Lệnh Nhanh (`Ctrl+K` / `Ctrl+P`) & Phím tắt**: Điều hướng `Ctrl+1..7`, `Ctrl+B` Nhập lô, `Ctrl+N` Thêm Via, `F5` Đồng bộ Cloud, chạy nền System Tray.

## Build & Self-Test

```powershell
dotnet publish c:\Users\trieunt\Documents\Tool\audit-ads\desktop\AdsOpsDesktop\AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained true -o c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release -p:PublishSingleFile=true
c:\Users\trieunt\Documents\Tool\audit-ads\desktop\Release\AdsOpsDesktop.exe --self-test
```
