[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,
    [string]$PfxPath = $env:ADSOPS_SIGN_PFX_PATH,
    [string]$PfxPassword = $env:ADSOPS_SIGN_PFX_PASSWORD,
    [switch]$UseLocalOrgCert
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Khong tim thay file EXE: $ExePath"
}

$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$releaseDir = Split-Path -Parent $resolvedExe
$exeName = Split-Path -Leaf $resolvedExe
$timestampServer = "http://timestamp.digicert.com"
$signedBy = "Unsigned (SHA-256 Verified Only)"

if (-not [string]::IsNullOrWhiteSpace($PfxPath) -and (Test-Path -LiteralPath $PfxPath)) {
    $secPwd = if ([string]::IsNullOrEmpty($PfxPassword)) { $null } else { ConvertTo-SecureString $PfxPassword -AsPlainText -Force }
    $cert = if ($secPwd) {
        New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $secPwd)
    } else {
        New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath)
    }
    $sig = Set-AuthenticodeSignature -FilePath $resolvedExe -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $timestampServer
    if ($sig.Status -eq "HashMismatch") {
        throw "Authenticode signature failed: $($sig.StatusMessage)"
    }
    $signedBy = "$($cert.Subject) [$($sig.Status)]"
} elseif ($UseLocalOrgCert.IsPresent) {
    $subject = "CN=AdsOps Pro Community Publisher, O=AdsOps Agency Control Center"
    $cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
        Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate `
            -Type CodeSigningCert `
            -Subject $subject `
            -FriendlyName "AdsOps Pro Community Code Signing" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddYears(3)
    }
    $cerOut = Join-Path $releaseDir "AdsOps-Community-Publisher.cer"
    Export-Certificate -Cert $cert -FilePath $cerOut -Force | Out-Null
    try { Import-Certificate -FilePath $cerOut -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null } catch {}
    $sig = Set-AuthenticodeSignature -FilePath $resolvedExe -Certificate $cert -HashAlgorithm SHA256
    $signedBy = "$($cert.Subject) [$($sig.Status)] (Public .cer bundled)"
}

$hash = (Get-FileHash -Path $resolvedExe -Algorithm SHA256).Hash.ToLowerInvariant()
$shaFile = Join-Path $releaseDir "SHA256SUMS.txt"
"$hash  $exeName" | Set-Content -Path $shaFile -Encoding ascii

Write-Output "SHA256=$hash"
Write-Output "SIGNATURE=$signedBy"
