# AdsOps Desktop Pro v1.0 (`AdsOpsDesktop.exe`)

Native `.NET 8.0-windows` WinForms companion application for AdsOps:
- User-space HTTP bridge (`127.0.0.1:17890`) with CORS + Private Network Access headers
- Chrome Profile launcher supporting Standard (`--profile-directory`) and 100% Isolated (`--user-data-dir`) modes
- Embedded `AdsOps Companion Pro v2.9.0` Extension auto-provisioner
- 2-way browser event relay (`PAGE_CREATED`, `COOKIE_LOGGED_OUT`, `SAFETY_CHALLENGE`, `KEEPALIVE_OK`)
- Daytime (`08:30–22:00`) Keep-Alive scheduler with pre-launch live proxy validation
- Windows DPAPI JWT storage and PBKDF2-SHA256 + AES-256-GCM `.adsopsvault` backup/restore

## Build & Self-Test

```powershell
dotnet publish AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:DebugType=none -o ..\Release
..\Release\AdsOpsDesktop.exe --self-test
```
