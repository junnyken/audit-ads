param(
    [string]$Version = "4.4.0",
    [string]$MinSupportedVersion = "4.2.0",
    [string]$ExtVersion = "2.10.4"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $desktopDir
$uiDir = Join-Path $desktopDir "DesktopUi"
$projPath = Join-Path $desktopDir "AdsOpsDesktop\AdsOpsDesktop.csproj"
$publishOut = Join-Path $env:TEMP "adsops_publish_v$Version"
$downloadsDir = Join-Path $repoRoot "frontend\public\downloads"

Write-Host "[1/5] Building DesktopUi bundle..."
Push-Location $uiDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "DesktopUi build failed ($LASTEXITCODE)." }
} finally {
    Pop-Location
}

Write-Host "[2/5] Publishing AdsOpsDesktop v$Version single-file win-x64..."
if (Test-Path $publishOut) {
    Remove-Item -Path $publishOut -Recurse -Force -ErrorAction SilentlyContinue
}
dotnet publish $projPath `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=embedded `
    -o $publishOut
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)." }

$exePath = Join-Path $publishOut "AdsOpsDesktop.exe"
if (-not (Test-Path $exePath)) { throw "Published executable missing at $exePath" }

Write-Host "[3/5] Signing Authenticode certificate if available..."
$signed = $false
$cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -like "*AdsOps Pro*" -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
if ($cert) {
    $sig = Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -HashAlgorithm SHA256
    Write-Host "Authenticode status: $($sig.Status) ($($cert.Thumbprint))"
    $signed = ($sig.Status -eq "Valid" -or $sig.Status -eq "UnknownError")
} else {
    Write-Host "No AdsOps Pro cert in Cert:\CurrentUser\My; shipping unsigned SHA-256 build."
}

Write-Host "[4/5] Running AdsOpsDesktop.exe --self-test..."
$testOutFile = Join-Path $env:TEMP "adsops_selftest_v$Version.log"
if (Test-Path $testOutFile) { Remove-Item $testOutFile -Force -ErrorAction SilentlyContinue }
$proc = Start-Process -FilePath $exePath -ArgumentList "--self-test" -Wait -PassThru -NoNewWindow -RedirectStandardOutput $testOutFile
$testExit = $proc.ExitCode
$testText = if (Test-Path $testOutFile) { Get-Content $testOutFile -Raw } else { "" }
if ($testExit -ne 0 -or $testText -notmatch "ADSOPS_DESKTOP_V260_SELFTEST_100_PASS") {
    Write-Host $testText
    throw "AdsOpsDesktop --self-test failed (exit=$testExit)."
}
Write-Host "SELFTEST_EXIT=0 (ADSOPS_DESKTOP_V260_SELFTEST_100_PASS)"

Write-Host "[5/5] Compressing ZIP artifacts & updating manifests..."
New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
$latestZip = Join-Path $downloadsDir "AdsOps-Desktop-Pro-latest.zip"
$legacyZip = Join-Path $downloadsDir "AdsOps-Desktop-Pro-v2.3.zip"

Compress-Archive -Path $exePath -DestinationPath $latestZip -CompressionLevel Optimal -Force
Copy-Item -Path $latestZip -Destination $legacyZip -Force

$zipInfo = Get-Item $latestZip
$sizeMb = [Math]::Round($zipInfo.Length / 1MB, 2)
Write-Host "ZIP size: $sizeMb MB ($($zipInfo.Length) bytes)"
if ($zipInfo.Length -ge 95MB) {
    throw "ZIP size $sizeMb MB exceeds 95 MB GitHub safety limit."
}

$sha = (Get-FileHash -Path $latestZip -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestObj = [ordered]@{
    version = $Version
    min_supported_version = $MinSupportedVersion
    ext_version = $ExtVersion
    authenticode_signed = $signed
    download_url = "https://adsops-app.vibe.tinhgon.xyz/downloads/AdsOps-Desktop-Pro-latest.zip"
    mirror_urls = @(
        "https://adsops-app.vibe.tinhgon.xyz/downloads/AdsOps-Desktop-Pro-latest.zip",
        "https://adsops-app.vibe.tinhgon.xyz/downloads/AdsOps-Desktop-Pro-v2.3.zip"
    )
    sha256 = $sha
    size_bytes = $zipInfo.Length
    published_at = (Get-Date).ToUniversalTime().ToString("O")
    release_notes = "AdsOps Desktop Pro v$Version (Commercial Auth & Forgot-Password Sync, License Expiry/Grace/Read-Only Guard, Desktop Device Limit Support, Portable Master-Passphrase Auto-Backup & Preview, Streaming Self-Updater with .bak Rollback)."
}
$manifestJson = $manifestObj | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $downloadsDir "AdsOps-Desktop-Pro-latest.json"), $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $desktopDir "AdsOps-Desktop-Pro-latest.json"), $manifestJson, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Release v$Version ready! EXE: $exePath | SHA256: $sha"
