param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$MinSupportedVersion = "4.2.0",
    [string]$ExtVersion = "2.11.0"
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
# Candidate creation only. Manual verified promotion is a separate, excluded operation.
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "Actual Windows required." }
Get-Command dotnet, npm, git -ErrorAction Stop | Out-Null
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $desktopDir
$projPath = Join-Path $desktopDir "AdsOpsDesktop\AdsOpsDesktop.csproj"
[xml]$project = Get-Content $projPath -Raw
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or [string]$project.Project.PropertyGroup.Version -cne $Version) { throw "Project version must match Version exactly." }
$sdks = & dotnet --list-sdks
if ($LASTEXITCODE -ne 0 -or -not ($sdks -match '^8\.')) { throw "Installed .NET 8 SDK required." }
$sourceCommit = & git -C $repoRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40,64}$') { throw "Source commit unavailable." }
$sourceDirty = @(& git -C $repoRoot status --porcelain).Count -gt 0
if ($LASTEXITCODE -ne 0) { throw "Source status unavailable." }
$uiDir = Join-Path $desktopDir "DesktopUi"
$uiZip = Join-Path $desktopDir "AdsOpsDesktop\webui_bundle.zip"
# Remove stale outputs before rebuilding; a failed build cannot reuse the old bundle.
if (Test-Path $uiZip) { Remove-Item $uiZip -Force }
$dist = Join-Path $uiDir "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
$buildStarted = [DateTime]::UtcNow
Push-Location $uiDir
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Fresh UI build failed." }
} finally { Pop-Location }
if (-not (Test-Path $uiZip) -or (Get-Item $uiZip).Length -le 0 -or (Get-Item $uiZip).LastWriteTimeUtc -lt $buildStarted) { throw "Fresh UI bundle required." }
$uiHash = (Get-FileHash $uiZip -Algorithm SHA256).Hash.ToLowerInvariant()
$stagingRoot = Join-Path $repoRoot "backend\private_releases"
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
$candidate = Join-Path $stagingRoot ("candidate-$Version-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $candidate | Out-Null
Copy-Item $uiZip (Join-Path $candidate "webui_bundle.zip")
$publishOut = Join-Path $candidate "payload"
& dotnet publish $projPath -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=embedded -o $publishOut
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }
$exePath = Join-Path $publishOut "AdsOpsDesktop.exe"
$exeInfo = Get-Item $exePath
if ($exeInfo.Length -le 0 -or $exeInfo.VersionInfo.ProductVersion -cne $Version) { throw "EXE size/version invalid." }
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*AdsOps Pro*' -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) } | Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) { throw "Existing signing certificate required; unsigned candidates prohibited." }
$sig = Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -HashAlgorithm SHA256
if ($sig.Status -ne 'Valid') { throw "Signing failed." }
$sig = Get-AuthenticodeSignature -FilePath $exePath
if ($sig.Status -ne 'Valid') { throw "Authenticode verification failed." }
$exeHash = (Get-FileHash $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
$testOut = Join-Path $candidate "self-test.log"
$proc = Start-Process -FilePath $exePath -ArgumentList '--self-test' -Wait -PassThru -NoNewWindow -RedirectStandardOutput $testOut
if ($proc.ExitCode -ne 0 -or (Get-Content $testOut -Raw) -notmatch 'ADSOPS_DESKTOP_V260_SELFTEST_100_PASS') { throw "Self-test failed." }
if ((Get-FileHash $exePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $exeHash -or (Get-AuthenticodeSignature $exePath).Status -ne 'Valid') { throw "EXE changed during self-test." }
$zipPath = Join-Path $candidate "AdsOps-Desktop-Pro-candidate.zip"
Compress-Archive -Path $exePath -DestinationPath $zipPath -CompressionLevel Optimal
$zipInfo = Get-Item $zipPath
if ($zipInfo.Length -le 0 -or $zipInfo.Length -ge 95MB) { throw "Candidate ZIP size invalid." }
$manifest = [ordered]@{
    status = 'candidate'; auto_promote = $false; manual_verified_promotion_required = $true
    version = $Version; min_supported_version = $MinSupportedVersion; ext_version = $ExtVersion
    source_commit = $sourceCommit; source_dirty = $sourceDirty; ui_zip_sha256 = $uiHash
    exe_sha256 = $exeHash; exe_size_bytes = (Get-Item $exePath).Length
    sha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant(); size_bytes = $zipInfo.Length
    authenticode_signed = $true; authenticode_status = [string]$sig.Status
    self_test_passed = $true; created_at = [DateTime]::UtcNow.ToString('O')
}
# A manifest appears only after all checks; failures remain incomplete private candidates.
$tempManifest = Join-Path $candidate "candidate.json.tmp"
$manifest | ConvertTo-Json -Depth 4 | Set-Content $tempManifest -Encoding UTF8
Move-Item $tempManifest (Join-Path $candidate "candidate.json")
Write-Host "Private candidate only: $candidate. No stable publication or promotion performed."
