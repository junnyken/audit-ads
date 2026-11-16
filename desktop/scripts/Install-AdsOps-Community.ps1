[CmdletBinding()]
param(
    [switch]$Silent
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exeSource = Join-Path $here "AdsOpsDesktop.exe"
$shaFile = Join-Path $here "SHA256SUMS.txt"

if (-not (Test-Path -LiteralPath $exeSource)) {
    throw "Khong tim thay AdsOpsDesktop.exe trong thu muc giai nen: $here"
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " ADSOPS DESKTOP PRO - TRINH CAI DAT CONG DONG AN TOAN" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Kiem tra toan ven SHA-256 truoc khi cai dat
if (Test-Path -LiteralPath $shaFile) {
    $expectedLine = (Get-Content -Path $shaFile -TotalCount 1).Trim()
    $expectedHash = ($expectedLine -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -Path $exeSource -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -and ($expectedHash -ne $actualHash)) {
        throw "CANH BAO BAO MAT: Ma SHA-256 khong khop! File co the da bi sua doi. Expected=$expectedHash Actual=$actualHash"
    }
    Write-Host "[OK] Da xac minh toan ven SHA-256: $actualHash" -ForegroundColor Green
}

# 2. Go bo Zone.Identifier (Mark-of-the-Web) de giam canh bao SmartScreen
Get-ChildItem -Path $here -File | ForEach-Object {
    try { Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue } catch {}
}

# 3. Dung tien trinh cu (neu dang chay) va copy vao thu muc Programs sach se
Get-Process -Name "AdsOpsDesktop" -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.Kill(); $_.WaitForExit(3000) } catch {}
}

$installDir = Join-Path $env:LOCALAPPDATA "Programs\AdsOpsPro"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$exeDest = Join-Path $installDir "AdsOpsDesktop.exe"
Copy-Item -Path $exeSource -Destination $exeDest -Force

if (Test-Path -LiteralPath $shaFile) {
    Copy-Item -Path $shaFile -Destination (Join-Path $installDir "SHA256SUMS.txt") -Force
}

# 4. Tao Shortcut tren Desktop va Start Menu
try {
    $shell = New-Object -ComObject WScript.Shell
    $desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "AdsOps Desktop Pro.lnk"
    $startMenuDir = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
    $startLnk = Join-Path $startMenuDir "AdsOps Desktop Pro.lnk"
    foreach ($lnkPath in @($desktopLnk, $startLnk)) {
        $sc = $shell.CreateShortcut($lnkPath)
        $sc.TargetPath = $exeDest
        $sc.WorkingDirectory = $installDir
        $sc.Description = "AdsOps Desktop Pro - Quan ly Đa Via, Antidetect & Anti-Checkpoint"
        $sc.Save()
    }
    Write-Host "[OK] Da tao loi tat Desktop & Start Menu." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Khong tao duoc shortcut: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 5. Dang ky giao thuc adsops-chrome:// (HKCU khong can quyen Admin)
try {
    $regBase = "HKCU:\Software\Classes\adsops-chrome"
    New-Item -Path "$regBase\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path $regBase -Name "(Default)" -Value "URL:AdsOps Chrome Protocol"
    Set-ItemProperty -Path $regBase -Name "URL Protocol" -Value ""
    Set-ItemProperty -Path "$regBase\shell\open\command" -Name "(Default)" -Value "`"$exeDest`" `"%1`""
    Write-Host "[OK] Da gan giao thuc adsops-chrome:// an toan (khong can Admin)." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Khong dang ky duoc URI protocol: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 6. Khoi dong ngay AdsOps Desktop Pro
Start-Process -FilePath $exeDest
Write-Host "[THANH CONG] AdsOps Desktop Pro da san sang hoat dong tai: $exeDest" -ForegroundColor Green
if (-not $Silent.IsPresent) {
    Start-Sleep -Seconds 2
}
