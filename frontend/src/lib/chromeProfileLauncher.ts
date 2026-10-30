import type { FacebookIdentity } from './types'

/**
 * Extracts the Google Chrome `--profile-directory` folder name from a browser profile label.
 * Examples:
 * - "Chrome — Default (Tài Khoản Chính)" -> "Default"
 * - "Chrome — Profile #1 (Tài Khoản Chính)" -> "Profile 1"
 * - "AdsPower — Profile #2 (Via 2)" -> "Profile 2"
 * - "Hidemyacc — Profile #3 (Via XMDT)" -> "Profile 3"
 */
export function resolveChromeProfileDirectory(
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
): string {
  const raw = (browserProfileLabel || '').trim()
  if (!raw) return 'Default'

  if (/\bdefault\b/i.test(raw) || /#0\b/.test(raw)) {
    return 'Default'
  }

  const profileMatch = raw.match(/profile\s*#?\s*(\d+)/i)
  if (profileMatch && profileMatch[1]) {
    return `Profile ${profileMatch[1]}`
  }

  const hashMatch = raw.match(/#\s*(\d+)/)
  if (hashMatch && hashMatch[1]) {
    return `Profile ${hashMatch[1]}`
  }

  if (viaLabel && viaLabel.trim()) {
    return viaLabel.trim()
  }
  return 'Default'
}

/**
 * Formats a concise human-readable badge for the assigned Chrome / Browser profile.
 */
export function formatShortProfileBadge(identity?: FacebookIdentity | null): string | null {
  if (!identity) return null
  const browser = (identity.browser_profile_label || '').trim()
  const via = (identity.label || '').trim()
  if (browser) {
    const profileMatch = browser.match(/profile\s*#?\s*(\d+)/i)
    if (profileMatch?.[1]) {
      return `Profile #${profileMatch[1]}${via ? ` · ${via}` : ''}`
    }
    if (/\bdefault\b/i.test(browser)) {
      return `Default${via ? ` · ${via}` : ''}`
    }
    return browser.length > 28 ? `${browser.slice(0, 26)}…` : browser
  }
  return via || null
}

/**
 * Builds the `adsops-chrome://open?...` custom protocol URL handled by the Windows helper script.
 */
export function buildAdsOpsChromeProtocolUrl(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
): string {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const params = new URLSearchParams({
    profile: profileDir,
    name: (viaLabel || browserProfileLabel || '').trim(),
    url: targetUrl,
  })
  return `adsops-chrome://open?${params.toString()}`
}

/**
 * Builds the fallback Windows Run (`Win + R`) command line for launching Chrome with the target profile.
 */
export function buildWindowsChromeCommand(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
): string {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  return `chrome.exe --profile-directory="${profileDir}" "${targetUrl}"`
}

/**
 * Launches the target URL in the assigned Google Chrome profile on Windows using the `adsops-chrome://`
 * protocol handler, and copies the target URL to the clipboard as a backup.
 */
export function launchInAssignedChromeProfile(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
): void {
  const protocolUrl = buildAdsOpsChromeProtocolUrl(targetUrl, browserProfileLabel, viaLabel)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(targetUrl).catch(() => {
      // Ignore clipboard permission errors
    })
  }
  const anchor = document.createElement('a')
  anchor.href = protocolUrl
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => {
    anchor.remove()
  }, 300)
}

/**
 * Downloads the 1-click Windows installer (`Cai-Dat-Mo-Chrome-Profile-AdsOps.bat`) that registers
 * the `adsops-chrome://` protocol under `HKEY_CURRENT_USER\Software\Classes\adsops-chrome` (no Admin required).
 */
export function downloadWindowsChromeLauncherBat(): void {
  const psScriptLines = [
    'param([string]$RawUri)',
    'if (-not $RawUri) { exit 0 }',
    'try {',
    '  $u = [System.Uri]$RawUri',
    '  $q = $u.Query.TrimStart("?")',
    '  $profileDir = "Default"',
    '  $profileName = ""',
    '  $targetUrl = ""',
    '  foreach ($pair in ($q -split "&")) {',
    '    if (-not $pair) { continue }',
    '    $kv = $pair -split "=", 2',
    '    $k = [System.Uri]::UnescapeDataString($kv[0].Replace("+", " "))',
    '    $v = if ($kv.Length -gt 1) { [System.Uri]::UnescapeDataString($kv[1].Replace("+", " ")) } else { "" }',
    '    if ($k -eq "profile" -and $v) { $profileDir = $v }',
    '    elseif ($k -eq "name" -and $v) { $profileName = $v }',
    '    elseif ($k -eq "url" -and $v) { $targetUrl = $v }',
    '  }',
    '  if (-not ($targetUrl -match "^https://")) { exit 0 }',
    '  $userData = Join-Path $env:LOCALAPPDATA "Google\\Chrome\\User Data"',
    '  $resolvedDir = $profileDir',
    '  $localStatePath = Join-Path $userData "Local State"',
    '  if (Test-Path $localStatePath) {',
    '    try {',
    '      $json = Get-Content $localStatePath -Raw -Encoding UTF8 | ConvertFrom-Json',
    '      $cache = $json.profile.info_cache',
    '      if ($cache) {',
    '        $props = $cache.PSObject.Properties',
    '        $matchedByName = $null',
    '        foreach ($p in $props) {',
    '          $disp = [string]$p.Value.name',
    '          if ($profileName -and $disp -and ($disp -eq $profileName -or $disp -like "*$profileName*" -or $profileName -like "*$disp*")) {',
    '            $matchedByName = $p.Name',
    '            break',
    '          }',
    '        }',
    '        if ($matchedByName -and (Test-Path (Join-Path $userData $matchedByName))) {',
    '          $resolvedDir = $matchedByName',
    '        }',
    '      }',
    '    } catch {}',
    '  }',
    '  if ($resolvedDir -eq "Profile 1" -and -not (Test-Path (Join-Path $userData "Profile 1")) -and (Test-Path (Join-Path $userData "Default"))) {',
    '    $resolvedDir = "Default"',
    '  }',
    '  $chromePaths = @(',
    '    (Join-Path $env:ProgramFiles "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path ${env:ProgramFiles(x86)} "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path $env:LOCALAPPDATA "Google\\Chrome\\Application\\chrome.exe")',
    '  )',
    '  $chromeExe = $chromePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1',
    '  if ($chromeExe) {',
    '    Start-Process -FilePath $chromeExe -ArgumentList @("--profile-directory=$resolvedDir", $targetUrl)',
    '  } else {',
    '    Start-Process "chrome.exe" -ArgumentList @("--profile-directory=$resolvedDir", $targetUrl)',
    '  }',
    '} catch {}',
  ]

  const encodedPs = btoa(unescape(encodeURIComponent(psScriptLines.join('\r\n'))))

  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'echo ====================================================================',
    'echo   CAI DAT BO KET NOI MO DUNG CHROME PROFILE CHO ADSOPS CONTROL CENTER',
    'echo ====================================================================',
    'set "ADSOPS_DIR=%LOCALAPPDATA%\\AdsOps"',
    'if not exist "%ADSOPS_DIR%" mkdir "%ADSOPS_DIR%"',
    'set "PS_FILE=%ADSOPS_DIR%\\open_chrome_profile.ps1"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%PS_FILE%', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPs}')))"`,
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /ve /d "URL:AdsOps Chrome Profile Launcher" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /v "URL Protocol" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"%PS_FILE%\\" \\"%%1\\"" /f >nul',
    'echo.',
    'echo [THANH CONG] Da cai dat xong giao thuc mo dung Google Chrome Profile!',
    'echo Tu bay gio, khi ban bam nut "Mo dung Chrome Profile" tren Web AdsOps,',
    'echo may tinh se tu dong bat dung cua so Chrome cua Via do.',
    'echo.',
    'pause',
  ].join('\r\n')

  const blob = new Blob([batContent], { type: 'application/bat;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'Cai-Dat-Mo-Chrome-Profile-AdsOps.bat'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
