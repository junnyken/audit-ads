# AdsOps Desktop Pro v2.0 (`AdsOpsDesktop.exe`)

Native `.NET 8.0-windows` WPF + System Tray companion suite for AdsOps:
- **Slate Dark UX/UI** (`ThemeTokens.cs` + `UiComponents.cs`): unified `Segoe Fluent Icons`, WCAG AA `>= 4.5:1` contrast, Windows 11 dark DWM titlebar, tabular right-aligned numbers, honest `—` / `Chưa kiểm` states, Write-Safe confirmation modals
- **6-View Multi-Via & Auto Hub**: `Tổng quan` (KPIs & Actionable Alerts), `Quản lý Đa Via` (Multi-select bulk tools + live 6-digit 2FA OTP copy), `Tự động hóa` (Batch Page Queue runner + Local Daytime/Proxy/IP Cluster guards + Cloud Cron/Telegram), `Fanpage & BM` (Claim BM / Warmup / Check Live), `Tài khoản QC` (Tabular metrics + 1-click Ads Manager), `Két khóa & Cài đặt`
- **Local Zero-Admin Bridge (`127.0.0.1:17890`)**: `/health` (`2.0.0`), `/totp` live 6-digit code lookup, `/local-vault/*`, `/open`, `/browser-event`, plus auto-retirement of legacy `.bat` bridge scripts
- **100% Local DPAPI Vault (`local_secrets_dpapi.json`) & AES-256-GCM Backups (`.adsopsvault`)**: stores raw Cookies & 2FA seeds solely on Windows DPAPI
- **Embedded `AdsOps Companion Pro v2.9.1`** Extension provisioner + Dynamic System Tray with 1-click Copy 2FA Code per Via

## Build & Self-Test

```powershell
dotnet publish AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:DebugType=none -o ..\Release
..\Release\AdsOpsDesktop.exe --self-test
```
