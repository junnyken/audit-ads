# AdsOps Desktop Pro v1.1 (`AdsOpsDesktop.exe`)

Native `.NET 8.0-windows` WinForms companion application for AdsOps:
- User-space HTTP bridge (`127.0.0.1:17890`) with CORS + Private Network Access headers and automatic retirement of legacy `.bat` bridge scripts
- Chrome Profile launcher supporting Standard (`--profile-directory`) and 100% Isolated (`--user-data-dir`) modes
- Embedded `AdsOps Companion Pro v2.9.1` Extension auto-provisioner with real Ad Account & 2FA bundling (`DEFAULT_ACCOUNTS` + `DEFAULT_STATE`)
- 100% local DPAPI-encrypted Cookie & 2FA Vault (`local_secrets_dpapi.json`) synced over loopback `127.0.0.1:17890/local-vault/*` and included inside PBKDF2-SHA256 + AES-256-GCM `.adsopsvault` backups
- 2-way browser event relay (`PAGE_CREATED`, `COOKIE_LOGGED_OUT`, `SAFETY_CHALLENGE`, `KEEPALIVE_OK`)
- Dynamic System Tray quick-launch menu per Via and overdue Keep-Alive runner (`08:30–22:00`)

## Build & Self-Test

```powershell
dotnet publish AdsOpsDesktop.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:DebugType=none -o ..\Release
..\Release\AdsOpsDesktop.exe --self-test
```
