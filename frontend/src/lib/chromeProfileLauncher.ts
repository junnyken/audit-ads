import type { FacebookIdentity } from './types'

export interface RealChromeProfile {
  folder: string
  name: string
  email: string
  gaia_name: string
  label: string
}

export const WORKSTATION_REAL_CHROME_PROFILES: RealChromeProfile[] = [
  {
    folder: 'Default',
    name: 'trieu',
    email: 'thientrieu753@gmail.com',
    gaia_name: 'trieu nguyen thien',
    label: 'Chrome — Default · trieu (thientrieu753@gmail.com)',
  },
  {
    folder: 'Profile 1',
    name: 'tt',
    email: 'duchungducvb@gmail.com',
    gaia_name: 'Hung Duc',
    label: 'Chrome — Profile 1 · tt (duchungducvb@gmail.com)',
  },
  {
    folder: 'Profile 3',
    name: 'Thiên Triều',
    email: 'trieunguyen.home9x@gmail.com',
    gaia_name: 'Triều Thiên',
    label: 'Chrome — Profile 3 · Thiên Triều (trieunguyen.home9x@gmail.com)',
  },
  {
    folder: 'Profile 4',
    name: 'MATBAO',
    email: 'marcommatbao@gmail.com',
    gaia_name: 'MATBAO MARCOM',
    label: 'Chrome — Profile 4 · MATBAO (marcommatbao@gmail.com)',
  },
  {
    folder: 'Profile 5',
    name: 'Matbao-invoice',
    email: 'mifihoadondientuantoan@gmail.com',
    gaia_name: 'Matbao-invoice Hóa đơn điện tử an toàn',
    label: 'Chrome — Profile 5 · Matbao-invoice (mifihoadondientuantoan@gmail.com)',
  },
  {
    folder: 'Profile 6',
    name: 'Test',
    email: 'quangtrkk7344@noigame.dpdns.org',
    gaia_name: 'tai ngo',
    label: 'Chrome — Profile 6 · Test (quangtrkk7344@noigame.dpdns.org)',
  },
  {
    folder: 'Profile 7',
    name: 'Utra Google',
    email: 'thientrieuadmin@tbsupellex.com',
    gaia_name: 'Triều Thiên',
    label: 'Chrome — Profile 7 · Utra Google (thientrieuadmin@tbsupellex.com)',
  },
  {
    folder: 'Profile 8',
    name: 'Test Utraviw',
    email: 'tranngoc123@tbsupellex.com',
    gaia_name: 'Trần Ngọc',
    label: 'Chrome — Profile 8 · Test Utraviw (tranngoc123@tbsupellex.com)',
  },
  {
    folder: 'Profile 9',
    name: 'matbao.com',
    email: 'thinhlq@matbao.com',
    gaia_name: 'Thinh Lam Quang',
    label: 'Chrome — Profile 9 · matbao.com (thinhlq@matbao.com)',
  },
  {
    folder: 'Profile 10',
    name: 'Lâm Quang',
    email: 'lamquangthinh3006@gmail.com',
    gaia_name: 'Lâm Quang Thịnh',
    label: 'Chrome — Profile 10 · Lâm Quang (lamquangthinh3006@gmail.com)',
  },
  {
    folder: 'Profile 11',
    name: 'thu',
    email: 'thientrieu.gr1@gmail.com',
    gaia_name: 'Vũ ngọc Triều',
    label: 'Chrome — Profile 11 · thu (thientrieu.gr1@gmail.com)',
  },
  {
    folder: 'Profile 12',
    name: 'trtr',
    email: '',
    gaia_name: '',
    label: 'Chrome — Profile 12 · trtr',
  },
  {
    folder: 'Profile 13',
    name: 'VPN',
    email: 'shopheiyo@gmail.com',
    gaia_name: 'Trung Trần Đức',
    label: 'Chrome — Profile 13 · VPN (shopheiyo@gmail.com)',
  },
  {
    folder: 'Profile 14',
    name: 'Test video',
    email: '',
    gaia_name: '',
    label: 'Chrome — Profile 14 · Test video',
  },
]

export async function fetchRealLocalChromeProfiles(): Promise<RealChromeProfile[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const resp = await fetch('http://127.0.0.1:17890/chrome-profiles', {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (resp.ok) {
      const data = (await resp.json()) as { ok?: boolean; profiles?: RealChromeProfile[] }
      if (Array.isArray(data.profiles) && data.profiles.length > 0) {
        return data.profiles
      }
    }
  } catch {
    // Fallback to workstation profile snapshot
  }
  return WORKSTATION_REAL_CHROME_PROFILES
}

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

  const lower = raw.toLowerCase()
  for (const p of WORKSTATION_REAL_CHROME_PROFILES) {
    if (p.email && lower.includes(p.email.toLowerCase())) {
      return p.folder
    }
    if (p.name && p.name.length >= 2 && lower.includes(p.name.toLowerCase())) {
      return p.folder
    }
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

export function formatShortProfileBadge(identity?: FacebookIdentity | null): string | null {
  if (!identity) return null
  const browser = (identity.browser_profile_label || '').trim()
  const via = (identity.label || '').trim()
  if (browser) {
    const clean = browser.replace(/^Chrome\s*—\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '')
    return clean.length > 26 ? `${clean.slice(0, 24)}…` : clean
  }
  return via || null
}

export interface ParsedProxyInfo {
  scheme: string
  host: string
  port: number
  user: string
  pass: string
}

export function parseProxyString(raw?: string | null): ParsedProxyInfo | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null

  const mUrl = s.match(
    /^(?:(http|https|socks5):\/\/)?(?:([^:\s/@]+):([^@\s/]+)@)?([A-Za-z0-9.-]+\.[A-Za-z0-9.-]+):(\d{1,5})$/i,
  )
  if (mUrl) {
    const port = Number(mUrl[5])
    if (port >= 1 && port <= 65535) {
      return {
        scheme: (mUrl[1] || 'http').toLowerCase(),
        user: mUrl[2] || '',
        pass: mUrl[3] || '',
        host: mUrl[4].toLowerCase(),
        port,
      }
    }
  }

  const mColon4 = s.match(/^([A-Za-z0-9.-]+\.[A-Za-z0-9.-]+):(\d{1,5}):([^:\s]+):([^\s]+)$/)
  if (mColon4) {
    const port = Number(mColon4[2])
    if (port >= 1 && port <= 65535) {
      return {
        scheme: 'http',
        host: mColon4[1].toLowerCase(),
        port,
        user: mColon4[3],
        pass: mColon4[4],
      }
    }
  }

  const mColon2 = s.match(/^([A-Za-z0-9.-]+\.[A-Za-z0-9.-]+):(\d{1,5})$/)
  if (mColon2) {
    const port = Number(mColon2[2])
    if (port >= 1 && port <= 65535) {
      return {
        scheme: 'http',
        host: mColon2[1].toLowerCase(),
        port,
        user: '',
        pass: '',
      }
    }
  }

  return null
}

export function normalizeProxyKey(raw?: string | null): string {
  const p = parseProxyString(raw)
  return p ? `${p.scheme}://${p.host.toLowerCase()}:${p.port}` : ''
}

/**
 * Generates and downloads a ready-to-import Proxy SwitchyOmega `.bak` configuration file
 * for the specified proxy string (`IP:Port:User:Pass` or `IP:Port`).
 */
export function downloadSwitchyOmegaConfig(rawProxy: string, viaLabel?: string): boolean {
  const parsed = parseProxyString(rawProxy)
  if (!parsed) return false
  const profileKey = `+Via_${(viaLabel || 'AdsOps').replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const omegaConfig: Record<string, unknown> = {
    '-addConditionsToBottom': false,
    '-confirmDeletion': true,
    '-downloadInterval': 1440,
    '-enableQuickSwitch': false,
    '-MonitorWebRequests': true,
    '-quickSwitchProfiles': [],
    '-refreshOnProfileChange': true,
    '-revertProxyChanges': false,
    '-showExternalProfile': true,
    '-showInspectMenu': true,
    '-startupProfileName': profileKey.slice(1),
    schemaVersion: 2,
    [profileKey]: {
      bypassList: [
        { conditionType: 'BypassCondition', pattern: '127.0.0.1' },
        { conditionType: 'BypassCondition', pattern: '[::1]' },
        { conditionType: 'BypassCondition', pattern: 'localhost' },
      ],
      color: '#1d4ed8',
      fallbackProxy: {
        host: parsed.host,
        port: parsed.port,
        scheme: parsed.scheme,
      },
      ...(parsed.user && parsed.pass
        ? {
            auth: {
              fallbackProxy: {
                username: parsed.user,
                password: parsed.pass,
              },
            },
          }
        : {}),
      name: profileKey.slice(1),
      profileType: 'FixedProfile',
      revision: '1',
    },
  }
  const blob = new Blob([JSON.stringify(omegaConfig, null, 2)], {
    type: 'application/json;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `SwitchyOmega-${profileKey.slice(1)}-${parsed.host}.bak`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}

export function withAutoSubmitPageUrl(rawUrl: string, autoSubmit: boolean): string {
  const base = rawUrl && rawUrl.trim() ? rawUrl.trim() : 'https://www.facebook.com/pages/creation/'
  try {
    const u = new URL(base)
    u.searchParams.set('adsops_auto_submit', autoSubmit ? '1' : '0')
    return u.toString()
  } catch {
    const clean = base.replace(/([?&])adsops_auto_submit=[01]/g, '')
    const sep = clean.includes('?') ? '&' : '?'
    return `${clean}${sep}adsops_auto_submit=${autoSubmit ? '1' : '0'}`
  }
}

export function computeSafeViaRestSeconds(baseStaggerSeconds: number): {
  totalSeconds: number
  baseSeconds: number
  jitterSeconds: number
} {
  const baseSeconds = Math.max(18, Math.min(120, Math.round(baseStaggerSeconds || 22)))
  const minJitter = baseSeconds > 25 ? 5 : 4
  const jitterSpan = baseSeconds > 25 ? 8 : 7
  const jitterSeconds = minJitter + Math.floor(Math.random() * jitterSpan)
  return {
    totalSeconds: baseSeconds + jitterSeconds,
    baseSeconds,
    jitterSeconds,
  }
}

export function buildAdsOpsChromeProtocolUrl(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
  proxyLabel?: string | null,
): string {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const params = new URLSearchParams({
    profile: profileDir,
    name: (browserProfileLabel || viaLabel || '').trim(),
    proxy: (proxyLabel || '').trim(),
    url: targetUrl,
  })
  return `adsops-chrome://open?${params.toString()}`
}

export async function launchInAssignedChromeProfile(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
  proxyLabel?: string | null,
): Promise<'bridge' | 'protocol'> {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const nameHint = (browserProfileLabel || viaLabel || '').trim()
  const cleanProxy = (proxyLabel || '').trim()

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(targetUrl).catch(() => {})
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1400)
    const resp = await fetch('http://127.0.0.1:17890/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profileDir,
        name: nameHint,
        proxy: cleanProxy,
        url: targetUrl,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (resp.ok) {
      return 'bridge'
    }
  } catch {
    // Fallback to adsops-chrome:// protocol
  }

  const protocolUrl = buildAdsOpsChromeProtocolUrl(targetUrl, browserProfileLabel, viaLabel, cleanProxy)
  const anchor = document.createElement('a')
  anchor.href = protocolUrl
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => {
    anchor.remove()
  }, 300)
  return 'protocol'
}

export function downloadWindowsChromeLauncherBat(): void {
  const psScriptLines = [
    'param([string]$RawUri)',
    'if (-not $RawUri) { exit 0 }',
    'try {',
    '  $u = [System.Uri]$RawUri',
    '  $q = $u.Query.TrimStart("?")',
    '  $profileDir = "Default"',
    '  $targetUrl = ""',
    '  foreach ($pair in ($q -split "&")) {',
    '    if (-not $pair) { continue }',
    '    $kv = $pair -split "=", 2',
    '    $k = [System.Uri]::UnescapeDataString($kv[0].Replace("+", " "))',
    '    $v = if ($kv.Length -gt 1) { [System.Uri]::UnescapeDataString($kv[1].Replace("+", " ")) } else { "" }',
    '    if ($k -eq "profile" -and $v) { $profileDir = $v }',
    '    elseif ($k -eq "url" -and $v) { $targetUrl = $v }',
    '  }',
    '  if (-not ($profileDir -match "^[a-zA-Z0-9 _.-]+$")) { $profileDir = "Default" }',
    '  if (-not ($targetUrl -match "^https://")) { exit 0 }',
    '  $chromePaths = @(',
    '    (Join-Path $env:ProgramFiles "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path ${env:ProgramFiles(x86)} "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path $env:LOCALAPPDATA "Google\\Chrome\\Application\\chrome.exe")',
    '  )',
    '  $chromeExe = $chromePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1',
    '  if ($chromeExe) {',
    '    Start-Process -FilePath $chromeExe -ArgumentList @("--profile-directory=$profileDir", $targetUrl)',
    '  } else {',
    '    Start-Process "chrome.exe" -ArgumentList @("--profile-directory=$profileDir", $targetUrl)',
    '  }',
    '} catch {}',
  ]

  const bridgePsLines = [
    '$listener = New-Object System.Net.HttpListener',
    '$listener.Prefixes.Add("http://127.0.0.1:17890/")',
    'try { $listener.Start() } catch { exit 0 }',
    'function Find-ChromeExe {',
    '  $paths = @(',
    '    (Join-Path $env:ProgramFiles "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path ${env:ProgramFiles(x86)} "Google\\Chrome\\Application\\chrome.exe"),',
    '    (Join-Path $env:LOCALAPPDATA "Google\\Chrome\\Application\\chrome.exe")',
    '  )',
    '  return ($paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1)',
    '}',
    'function Send-Json([System.Net.HttpListenerResponse]$res, [int]$code, [string]$jsonText) {',
    '  $res.StatusCode = $code',
    '  $res.ContentType = "application/json; charset=utf-8"',
    '  $res.Headers["Access-Control-Allow-Origin"] = "*"',
    '  $res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"',
    '  $res.Headers["Access-Control-Allow-Headers"] = "Content-Type"',
    '  $res.Headers["Access-Control-Allow-Private-Network"] = "true"',
    '  $bytes = [Text.Encoding]::UTF8.GetBytes($jsonText)',
    '  $res.ContentLength64 = $bytes.Length',
    '  $res.OutputStream.Write($bytes, 0, $bytes.Length)',
    '  $res.OutputStream.Close()',
    '}',
    'while ($listener.IsListening) {',
    '  try {',
    '    $ctx = $listener.GetContext()',
    '    $req = $ctx.Request',
    '    $res = $ctx.Response',
    '    if ($req.HttpMethod -eq "OPTIONS") {',
    '      $res.StatusCode = 204',
    '      $res.Headers["Access-Control-Allow-Origin"] = "*"',
    '      $res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"',
    '      $res.Headers["Access-Control-Allow-Headers"] = "Content-Type"',
    '      $res.Headers["Access-Control-Allow-Private-Network"] = "true"',
    '      $res.OutputStream.Close()',
    '      continue',
    '    }',
    '    $path = $req.Url.AbsolutePath.TrimEnd("/")',
    '    if ($path -eq "/health" -and $req.HttpMethod -eq "GET") {',
    `      Send-Json $res 200 '{"ok":true,"version":"2.6.0"}'`,
    '      continue',
    '    }',
    '    if ($path -eq "/chrome-profiles" -and $req.HttpMethod -eq "GET") {',
    '      $lsPath = Join-Path $env:LOCALAPPDATA "Google\\Chrome\\User Data\\Local State"',
    '      $outList = @()',
    '      if (Test-Path $lsPath) {',
    '        try {',
    '          $rawLs = [IO.File]::ReadAllText($lsPath, [Text.Encoding]::UTF8) | ConvertFrom-Json',
    '          $cache = $rawLs.profile.info_cache',
    '          if ($cache) {',
    '            foreach ($prop in $cache.PSObject.Properties) {',
    '              $folder = [string]$prop.Name',
    '              $info = $prop.Value',
    '              $pName = [string]$info.name',
    '              $pEmail = [string]$info.user_name',
    '              $pGaia = [string]$info.gaia_name',
    '              $lbl = "Chrome - $folder"',
    '              if ($pName) { $lbl += " - $pName" }',
    '              if ($pEmail) { $lbl += " ($pEmail)" }',
    '              $outList += @{ folder = $folder; name = $pName; email = $pEmail; gaia_name = $pGaia; label = $lbl }',
    '            }',
    '          }',
    '        } catch {}',
    '      }',
    '      $payload = @{ ok = $true; profiles = $outList } | ConvertTo-Json -Depth 4 -Compress',
    '      Send-Json $res 200 $payload',
    '      continue',
    '    }',
    '    if ($path -eq "/open" -and $req.HttpMethod -eq "POST") {',
    '      $sr = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)',
    '      $bodyText = $sr.ReadToEnd()',
    '      $sr.Close()',
    '      $data = $bodyText | ConvertFrom-Json',
    '      $prof = [string]$data.profile',
    '      if (-not ($prof -match "^[a-zA-Z0-9 _.-]+$")) { $prof = "Default" }',
    '      $targetUrl = [string]$data.url',
    '      if (-not ($targetUrl -match "^https://")) {',
    `        Send-Json $res 400 '{"ok":false,"error":"Invalid target URL"}'`,
    '        continue',
    '      }',
    '      $chromeExe = Find-ChromeExe',
    '      if ($chromeExe) {',
    '        Start-Process -FilePath $chromeExe -ArgumentList @("--profile-directory=$prof", $targetUrl)',
    '      } else {',
    '        Start-Process "chrome.exe" -ArgumentList @("--profile-directory=$prof", $targetUrl)',
    '      }',
    `      Send-Json $res 200 '{"ok":true}'`,
    '      continue',
    '    }',
    `    Send-Json $res 404 '{"ok":false}'`,
    '  } catch {}',
    '}',
  ]

  const vbsLines = [
    'Set sh = CreateObject("WScript.Shell")',
    'psPath = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\\AdsOps\\adsops_local_bridge.ps1")',
    'q = Chr(34)',
    'sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & q & psPath & q, 0, False',
  ]

  const encodedPs = btoa(unescape(encodeURIComponent(psScriptLines.join('\r\n'))))
  const encodedBridge = btoa(unescape(encodeURIComponent(bridgePsLines.join('\r\n'))))
  const encodedVbs = btoa(unescape(encodeURIComponent(vbsLines.join('\r\n'))))

  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'set "ADSOPS_DIR=%LOCALAPPDATA%\\AdsOps"',
    'if not exist "%ADSOPS_DIR%" mkdir "%ADSOPS_DIR%"',
    'set "PS_FILE=%ADSOPS_DIR%\\open_chrome_profile.ps1"',
    'set "BRIDGE_PS=%ADSOPS_DIR%\\adsops_local_bridge.ps1"',
    'set "BRIDGE_VBS=%ADSOPS_DIR%\\start_adsops_bridge.vbs"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%PS_FILE%', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPs}')))"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%BRIDGE_PS%', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedBridge}')))"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText('%BRIDGE_VBS%', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedVbs}')))"`,
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /ve /d "URL:AdsOps Chrome Profile Launcher" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome" /v "URL Protocol" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\adsops-chrome\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"%PS_FILE%\\" \\"%%1\\"" /f >nul',
    'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "AdsOpsChromeBridge" /t REG_SZ /d "wscript.exe \\"%BRIDGE_VBS%\\"" /f >nul',
    'wscript.exe "%BRIDGE_VBS%"',
    'echo [THANH CONG] Da cai dat Giao thuc adsops-chrome:// va Cau noi ngam 127.0.0.1:17890!',
    'echo Bay gio ban co the bam "Chay Full Automatic" truc tiep tren Web ma khong bi hoi xac nhan!',
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

export function launchChromeWithExtensionPreview(
  targetUrl: string,
  browserProfileLabel?: string | null,
  identityLabel?: string | null,
  networkLabel?: string | null,
): void {
  launchInAssignedChromeProfile(targetUrl, browserProfileLabel, identityLabel, networkLabel)
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

export function buildStoreZip(files: Array<{ name: string; content: string | Uint8Array }>): Blob {
  const encoder = new TextEncoder()
  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name)
    const dataBytes = typeof f.content === 'string' ? encoder.encode(f.content) : f.content
    const crc = crc32(dataBytes)
    return { nameBytes, dataBytes, crc }
  })

  let offset = 0
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []

  for (const e of entries) {
    const localHeader = new Uint8Array(30 + e.nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 flag
    lv.setUint16(8, 0, true) // store
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x5421, true)
    lv.setUint32(14, e.crc, true)
    lv.setUint32(18, e.dataBytes.length, true)
    lv.setUint32(22, e.dataBytes.length, true)
    lv.setUint16(26, e.nameBytes.length, true)
    lv.setUint16(28, 0, true)
    localHeader.set(e.nameBytes, 30)
    localParts.push(localHeader, e.dataBytes)

    const centralHeader = new Uint8Array(46 + e.nameBytes.length)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x5421, true)
    cv.setUint32(16, e.crc, true)
    cv.setUint32(20, e.dataBytes.length, true)
    cv.setUint32(24, e.dataBytes.length, true)
    cv.setUint16(28, e.nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    centralHeader.set(e.nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + e.dataBytes.length
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  return new Blob([...localParts, ...centralParts, eocd] as unknown as BlobPart[], { type: 'application/zip' })
}

export interface BatchChromePageTask {
  page_name: string
  via_label: string
  browser_profile: string
  launch_url: string
}

export function downloadBatchPageCreationBat(
  tasks: BatchChromePageTask[],
  staggerSeconds = 22,
  autoSubmit = true,
): void {
  if (!Array.isArray(tasks) || tasks.length === 0) return
  const safeStagger = Math.max(18, Math.min(120, Math.round(staggerSeconds)))
  const lines: string[] = [
    '@echo off',
    'chcp 65001 >nul',
    'title AdsOps Batch Via Page Creator (An Toan Chong Checkpoint)',
    'set "CHROME_EXE="',
    'if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"',
    'if "%CHROME_EXE%"=="" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"',
    'if "%CHROME_EXE%"=="" if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"',
    'if "%CHROME_EXE%"=="" (',
    '  echo [LOI] Khong tim thay Google Chrome tren may tinh nay.',
    '  pause',
    '  exit /b 1',
    ')',
    `echo ========================================================================`,
    `echo   ADSOPS BATCH PAGE CREATOR - TONG ${tasks.length} VIA (CACH NHAU ${safeStagger} GIAY/VIA)`,
    `echo ========================================================================`,
    '',
  ]

  tasks.forEach((task, idx) => {
    const profileDir = resolveChromeProfileDirectory(task.browser_profile, task.via_label)
    const safeVia = String(task.via_label || 'Via').replace(/["%^&|<>]/g, '')
    const safePage = String(task.page_name || 'Fanpage').replace(/["%^&|<>]/g, '')
    const safeProf = String(profileDir || 'Default').replace(/"/g, '')
    const targetLaunchUrl = withAutoSubmitPageUrl(
      String(task.launch_url || 'https://www.facebook.com/pages/creation/'),
      autoSubmit,
    )
    const safeUrl = targetLaunchUrl.replace(/%/g, '%%')
    const waitSec = safeStagger + ((idx * 3 + 5) % 8)

    lines.push(`echo [${idx + 1}/${tasks.length}] Mo Via: ${safeVia} (${safeProf}) -^> Page: ${safePage}`)
    lines.push(`start "" "%CHROME_EXE%" --profile-directory="${safeProf}" "${safeUrl}"`)
    if (idx < tasks.length - 1) {
      lines.push(`echo   ^> Dang nghi an toan ${waitSec} giay chong mo dong loat...`)
      lines.push(`timeout /t ${waitSec} /nobreak >nul`)
    }
    lines.push('')
  })

  lines.push('echo.')
  lines.push('echo [HOAN TAT] Da mo toan bo Ho so Chrome Via. Kiem tra thong tin da tu dien va bam "Tao Trang" tren tung tab!')
  lines.push('pause')

  const batContent = lines.join('\r\n')
  const blob = new Blob([batContent], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Tao-Page-Hang-Loat-${tasks.length}Via.bat`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface ExtensionBundledAccount {
  name: string
  external_account_id: string
  status: string
  currency: string
  balance_raw?: string | null
  billing_threshold_raw?: string | null
  next_bill_date?: string | null
  meta_daily_limit_raw?: string | null
  payment_card_display?: string | null
  business_legal_name?: string | null
  bm_name?: string | null
}

export function buildExtensionFilesForVia(
  folderRoot = 'AdsOps-Chrome-Extension',
  viaName = 'Tài Khoản Chính',
  profileDir = 'Default',
  rawProxy = '',
  bundledAccounts: ExtensionBundledAccount[] = [],
  twoFaSecret = '',
  viaTier: 'vault' | 'camp' | 'standby' = 'camp',
): Array<{ name: string; content: string }> {
  const parsed = parseProxyString(rawProxy)
  const hasProxy = Boolean(parsed?.host)

  const manifestObj = {
    manifest_version: 3,
    name: hasProxy
      ? `AdsOps Companion Pro · ${profileDir} · Proxy ${parsed!.host}:${parsed!.port}`
      : `AdsOps Companion Pro · ${profileDir} (${viaName})`,
    short_name: 'AdsOps Companion Pro',
    version: '2.6.0',
    description:
      'Tiện ích Quản lý TKQC & Hộ Chiếu Via v2.6 Pro: Full Auto-Pilot Tạo Fanpage giãn nhịp an toàn + dừng khẩn cấp khi gặp Checkpoint/CAPTCHA, Chặn & Tự Xoá Passkey, 2FA, WebRTC Lock, Cookie & EAAB Token.',
    permissions: [
      'proxy',
      'privacy',
      'cookies',
      'storage',
      'tabs',
      'activeTab',
      'scripting',
      'webRequest',
      'webRequestAuthProvider',
    ],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    action: {
      default_title: `AdsOps Companion Pro (${viaName})`,
      default_popup: 'popup.html',
    },
    content_scripts: [
      {
        matches: [
          'https://*.facebook.com/*',
          'https://accountscenter.facebook.com/*',
          'https://business.facebook.com/*',
          'https://adsmanager.facebook.com/*',
        ],
        js: ['passkey_shield.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        matches: [
          'https://*.facebook.com/*',
          'https://accountscenter.facebook.com/*',
          'https://business.facebook.com/*',
          'https://adsmanager.facebook.com/*',
        ],
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
  }

  const defaultStateJson = JSON.stringify({
    viaName,
    profileCode: profileDir,
    viaTier,
    twoFaSecret: twoFaSecret.replace(/\s+/g, '').toUpperCase(),
    webrtcShield: true,
    blockPasskey: true,
    passkeyStatus: 'clean',
    proxyRaw: parsed ? `${parsed.host}:${parsed.port}${parsed.user ? `:${parsed.user}:${parsed.pass}` : ''}` : '',
    proxyEnabled: hasProxy,
    accounts: bundledAccounts,
  })

  // Runs in MAIN world at document_start BEFORE Facebook's scripts load:
  // Completely blocks Windows Hello / WebAuthn / Passkey popup from ever appearing!
  const passkeyShieldJs = `// AdsOps Companion Pro v2.6 — Anti-Passkey & Windows Hello Blocker (MAIN world @ document_start)
(function() {
  try {
    if (window.PublicKeyCredential) {
      try {
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function() {
          return Promise.resolve(false);
        };
        window.PublicKeyCredential.isConditionalMediationAvailable = function() {
          return Promise.resolve(false);
        };
      } catch (e) {}
    }
    if (navigator.credentials) {
      const origGet = navigator.credentials.get ? navigator.credentials.get.bind(navigator.credentials) : null;
      navigator.credentials.get = function(options) {
        if (options && options.publicKey) {
          return Promise.reject(new DOMException("Passkey prompt blocked by AdsOps Anti-Passkey Shield", "NotAllowedError"));
        }
        return origGet ? origGet(options) : Promise.resolve(null);
      };
      navigator.credentials.create = function(options) {
        if (options && options.publicKey) {
          return Promise.reject(new DOMException("Passkey creation blocked by AdsOps Anti-Passkey Shield", "NotAllowedError"));
        }
        return Promise.reject(new DOMException("Blocked by AdsOps", "NotAllowedError"));
      };
    }
  } catch (err) {}
})();
`

  const backgroundJs = `const DEFAULT_STATE = ${defaultStateJson};
let currentAuth = { user: "", pass: "" };

function parseProxy(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const mAt = s.match(/^(?:(http|https|socks5):\\/\\/)?([^:\\s]+):([^@\\s]+)@(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{2,5})$/i);
  if (mAt) return { scheme: (mAt[1] || "http").toLowerCase(), user: mAt[2], pass: mAt[3], host: mAt[4], port: parseInt(mAt[5], 10) };
  const m4 = s.match(/(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{2,5}):([^:\\s]+):([^\\s]+)/);
  if (m4) return { scheme: "http", host: m4[1], port: parseInt(m4[2], 10), user: m4[3], pass: m4[4] };
  const m2 = s.match(/(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{2,5})/);
  if (m2) return { scheme: "http", host: m2[1], port: parseInt(m2[2], 10), user: "", pass: "" };
  return null;
}

function applyWebRtcShield(enabled) {
  if (!chrome.privacy || !chrome.privacy.network || !chrome.privacy.network.webRTCIPHandlingPolicy) return;
  if (enabled) {
    chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp" }, () => {});
  } else {
    chrome.privacy.network.webRTCIPHandlingPolicy.clear({}, () => {});
  }
}

function applyProxyState(state) {
  const enabled = Boolean(state && state.proxyEnabled);
  const webrtcShield = state && state.webrtcShield !== undefined ? Boolean(state.webrtcShield) : true;
  applyWebRtcShield(webrtcShield || enabled);

  const parsed = enabled ? parseProxy(state.proxyRaw) : null;
  if (parsed) {
    currentAuth = { user: parsed.user || "", pass: parsed.pass || "" };
    const config = {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: parsed.scheme, host: parsed.host, port: parsed.port },
        bypassList: ["localhost", "127.0.0.1"]
      }
    };
    chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {});
    chrome.action.setBadgeText({ text: "PRX" });
    chrome.action.setBadgeBackgroundColor({ color: "#15803d" });
  } else {
    currentAuth = { user: "", pass: "" };
    chrome.proxy.settings.clear({ scope: "regular" }, () => {});
    const badge = (state && state.profileCode) ? String(state.profileCode).replace("Profile ", "P").slice(0, 4).toUpperCase() : "VIA";
    chrome.action.setBadgeText({ text: badge });
    chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["viaName", "profileCode", "viaTier", "twoFaSecret", "webrtcShield", "blockPasskey", "passkeyStatus", "proxyRaw", "proxyEnabled", "accounts"], (res) => {
    const init = {
      viaName: res.viaName || DEFAULT_STATE.viaName,
      profileCode: res.profileCode || DEFAULT_STATE.profileCode,
      viaTier: res.viaTier || DEFAULT_STATE.viaTier,
      twoFaSecret: res.twoFaSecret !== undefined ? res.twoFaSecret : DEFAULT_STATE.twoFaSecret,
      webrtcShield: res.webrtcShield !== undefined ? Boolean(res.webrtcShield) : true,
      blockPasskey: res.blockPasskey !== undefined ? Boolean(res.blockPasskey) : true,
      passkeyStatus: res.passkeyStatus || "clean",
      proxyRaw: res.proxyRaw !== undefined ? res.proxyRaw : DEFAULT_STATE.proxyRaw,
      proxyEnabled: res.proxyEnabled !== undefined ? Boolean(res.proxyEnabled) : DEFAULT_STATE.proxyEnabled,
      accounts: Array.isArray(res.accounts) && res.accounts.length > 0 ? res.accounts : DEFAULT_STATE.accounts
    };
    chrome.storage.local.set(init, () => applyProxyState(init));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    chrome.storage.local.get(["viaName", "profileCode", "webrtcShield", "proxyRaw", "proxyEnabled"], (res) => applyProxyState(res));
  }
});

chrome.webRequest.onAuthRequired.addListener(
  () => (currentAuth.user && currentAuth.pass ? { authCredentials: { username: currentAuth.user, password: currentAuth.pass } } : {}),
  { urls: ["<all_urls>"] },
  ["blocking"]
);
`

  const popupHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { width: 425px; background: #0f172a; color: #f8fafc; padding: 12px; font-size: 12px; }
  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 9px; margin-bottom: 9px; border-bottom: 1px solid #1e293b; }
  .brand { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 13px; color: #f8fafc; }
  .logo { width: 22px; height: 22px; border-radius: 6px; background: #2563eb; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
  .status-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #3b82f6; background: rgba(37,99,235,0.18); color: #93c5fd; }
  .status-pill.active { border-color: #22c55e; background: rgba(34,197,94,0.18); color: #86efac; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
  .kpi-box { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; }
  .kpi-lbl { font-size: 10px; color: #94a3b8; }
  .kpi-val { font-size: 12px; font-weight: 800; color: #f8fafc; margin-top: 2px; font-family: ui-monospace, Consolas, monospace; }
  .acc-list { max-height: 170px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; }
  .acc-item { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 7px 8px; }
  .acc-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
  .acc-name { font-weight: 700; font-size: 11.5px; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px; }
  .badge { font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; }
  .badge-ok { background: rgba(16,185,129,0.18); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.35); }
  .badge-warn { background: rgba(245,158,11,0.18); color: #fcd34d; border: 1px solid rgba(245,158,11,0.35); }
  .badge-err { background: rgba(244,63,94,0.18); color: #fda4af; border: 1px solid rgba(244,63,94,0.35); }
  .acc-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px; font-size: 10.5px; color: #cbd5e1; }
  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .row { display: grid; grid-template-columns: 1fr 95px; gap: 6px; margin-bottom: 6px; }
  input, select, textarea { width: 100%; border: 1px solid #475569; border-radius: 6px; padding: 5px 7px; font-size: 11.5px; color: #f8fafc; background: #0f172a; }
  .btn-row { display: flex; gap: 6px; margin-top: 6px; }
  .btn { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #f8fafc; font-weight: 600; font-size: 11px; cursor: pointer; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .btn:hover { background: #334155; }
  .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-emerald { background: #059669; border-color: #059669; color: #fff; }
  .btn-emerald:hover { background: #047857; }
  .btn-danger { background: rgba(225,29,72,0.22); border-color: rgba(244,63,94,0.5); color: #fda4af; }
  .btn-danger:hover { background: rgba(225,29,72,0.35); }
  .ip-bar { display: flex; align-items: center; justify-content: space-between; padding-top: 6px; margin-top: 6px; border-top: 1px dashed #334155; font-size: 11px; color: #cbd5e1; }
  .ip-val { font-family: ui-monospace, Consolas, monospace; font-weight: 700; color: #34d399; }
  .otp-box { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px 9px; }
  .otp-code { font-family: ui-monospace, Consolas, monospace; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; color: #34d399; }
  .detected-box { background: rgba(37,99,235,0.16); border: 1px solid #3b82f6; border-radius: 6px; padding: 7px 8px; margin-bottom: 8px; font-size: 11px; display: none; }
  .mini-links { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .link-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-weight: 600; font-size: 10.5px; text-decoration: none; }
  .link-item:hover { background: #334155; }
  .link-item.alert { border-color: rgba(244,63,94,0.45); color: #fda4af; }
  .link-item.bill { border-color: rgba(59,130,246,0.45); color: #93c5fd; }
  .msg { font-size: 10.5px; color: #4ade80; font-weight: 600; display: none; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <span class="logo">AO</span>
      <span>AdsOps Companion v2.6 Pro</span>
    </div>
    <span id="proxy-badge" class="status-pill">MẠNG GỐC</span>
  </div>

  <div id="fb-detected" class="detected-box">
    <div style="font-weight:700; color:#93c5fd; margin-bottom:3px;">⚡ Phát hiện tab Meta đang mở:</div>
    <div id="fb-detected-text" class="mono" style="color:#f8fafc; margin-bottom:5px;"></div>
    <div class="btn-row" style="margin-top:0;">
      <button id="btn-copy-id" class="btn btn-primary" type="button">Sao chép ID</button>
      <a id="btn-open-dashboard" class="btn" href="https://adsops-app.vibe.tinhgon.xyz/accounts" target="_blank">Mở Web AdsOps ↗</a>
    </div>
  </div>

  <!-- SECTION 1: VIA PASSPORT, TIER, WEBRTC & ANTI-PASSKEY SHIELD -->
  <div class="card">
    <div class="section-title">
      <span>1. Định danh Via · Chặn Passkey &amp; Khóa WebRTC</span>
      <span id="save-msg" class="msg">Đã lưu!</span>
    </div>
    <div class="row">
      <input id="via-name" type="text" placeholder="Tên Via" />
      <input id="profile-code" type="text" class="mono" placeholder="Default" />
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:6px;">
      <select id="via-tier" style="flex:1; font-weight:700;">
        <option value="vault">🛡️ Lớp 1: Via Tổng (Chỉ giữ BM - CẤM LÊN CAMP)</option>
        <option value="camp">🚀 Lớp 2: Via Lên Camp (Chạy Ads khách)</option>
        <option value="standby">🌱 Lớp 3: Via Dự Phòng (Ngâm sẵn &gt; 7 ngày)</option>
      </select>
      <span class="badge badge-ok" title="Đã khóa UDP STUN chống lộ IP Wifi gốc">🛡️ WebRTC Lock</span>
    </div>

    <!-- ANTI-PASSKEY SHIELD & 1-CLICK AUTO DELETE PASSKEY -->
    <div style="background:#0f172a; border:1px solid #334155; border-radius:6px; padding:6px 8px; margin-bottom:4px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:5px;">
        <span style="font-size:11px; font-weight:700; color:#e2e8f0;">🚫 Khiên Chặn Passkey (Windows Hello):</span>
        <span id="passkey-badge" class="badge badge-ok">ĐANG CHẶN 100%</span>
      </div>
      <div style="display:flex; gap:5px;">
        <button id="btn-nuke-passkey" type="button" class="btn btn-danger" title="Mở Account Center và tự động quét + bấm Xoá sạch Passkey của Via này">
          🗑️ 1 Chạm Quét &amp; Tự Xoá Passkey
        </button>
        <button id="btn-bypass-login-passkey" type="button" class="btn" title="Đang bị kẹt ở màn hình đòi Passkey? Bấm để tự chuyển sang nhập 6 số 2FA">
          ⚡ Bỏ qua Passkey → 2FA
        </button>
      </div>
    </div>

    <div class="ip-bar" style="margin-top:2px; padding-top:4px;">
      <span>IP Public thực tế của Chrome này:</span>
      <span id="live-ip" class="ip-val">Đang kiểm tra...</span>
    </div>
  </div>

  <!-- SECTION 2: LIVE 2FA 6-DIGIT OTP & AUTO-FILL -->
  <div class="card">
    <div class="section-title">
      <span>2. 🔑 Mã 2FA 6 số trực tiếp &amp; Tự điền</span>
      <span id="otp-timer" class="mono" style="color:#34d399;">30s</span>
    </div>
    <div class="otp-box">
      <span id="otp-code" class="otp-code">--- ---</span>
      <div style="display:flex; gap:4px;">
        <button id="btn-copy-otp" type="button" class="btn btn-primary" style="padding:4px 8px;">📋 Copy</button>
        <button id="btn-fill-otp" type="button" class="btn btn-emerald" style="padding:4px 8px;" title="Tự điền mã 6 số vào ô 2FA trên tab Facebook đang mở">⚡ Tự điền FB</button>
      </div>
    </div>
    <details style="margin-top:5px;">
      <summary style="font-size:10px; color:#94a3b8; cursor:pointer;">Cài đặt / Đổi Khóa 2FA Base32 của Via này</summary>
      <div style="display:flex; gap:5px; margin-top:5px;">
        <input id="twofa-secret" type="text" class="mono" placeholder="Dán chuỗi Secret 2FA (VD: JBSWY3DPEHPK3PXP)" />
        <button id="btn-save-2fa" type="button" class="btn btn-primary" style="flex:0 0 65px;">Lưu</button>
      </div>
    </details>
  </div>

  <!-- SECTION 3: AD ACCOUNTS & BILLING -->
  <div class="card">
    <div class="section-title">
      <span>3. Danh sách TKQC thuộc Via này</span>
      <span id="acc-count-label" class="mono" style="color:#93c5fd;"></span>
    </div>
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-lbl">Hoạt động</div>
        <div id="kpi-active" class="kpi-val" style="color:#34d399;">0</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-lbl">Nợ / Hạn chế</div>
        <div id="kpi-restricted" class="kpi-val" style="color:#fbbf24;">0</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-lbl">Tổng dư nợ</div>
        <div id="kpi-debt" class="kpi-val" style="color:#f87171;">0 ₫</div>
      </div>
    </div>
    <div id="acc-list" class="acc-list"></div>
  </div>

  <!-- SECTION 4: COOKIE EXPORT/IMPORT & TOKEN EXTRACTOR -->
  <details class="card" style="cursor:pointer;">
    <summary class="section-title" style="margin-bottom:0;">4. 🍪 Xuất/Nhập Cookie &amp; ⚡ Bắt Token EAAB (Chống CP 956)</summary>
    <div style="margin-top:8px;">
      <div class="btn-row" style="margin-top:0; margin-bottom:6px;">
        <button id="btn-export-cookie" type="button" class="btn btn-primary">🍪 Chép Cookie FB</button>
        <button id="btn-extract-token" type="button" class="btn btn-emerald">⚡ Bắt Token EAAB</button>
      </div>
      <textarea id="cookie-box" rows="2" class="mono" placeholder="Dán Cookie JSON hoặc c_user=...; xs=... vào đây để đăng nhập Via không cần mật khẩu"></textarea>
      <div class="btn-row">
        <button id="btn-import-cookie" type="button" class="btn">📥 Nạp Cookie vào Chrome này</button>
      </div>
      <div id="cookie-status" style="margin-top:4px; font-size:10.5px; color:#34d399;"></div>
    </div>
  </details>

  <!-- SECTION 5: PROXY CONFIG -->
  <details class="card" style="cursor:pointer;">
    <summary class="section-title" style="margin-bottom:0;">5. 🌐 Cấu hình Proxy IPv4 riêng (IP:Port:User:Pass)</summary>
    <div style="margin-top:8px;">
      <input id="proxy-raw" type="text" class="mono" placeholder="103.145.67.89:8080:user:pass (để trống = mạng gốc)" />
      <div class="btn-row">
        <button id="btn-save-enable" type="button" class="btn btn-primary">Lưu &amp; Bật Proxy + Khóa WebRTC</button>
        <button id="btn-disable-proxy" type="button" class="btn">Tắt Proxy</button>
      </div>
    </div>
  </details>

  <div class="mini-links">
    <a class="link-item alert" href="https://business.facebook.com/accountquality" target="_blank">
      <span>🛡️ Kháng nghị &amp; Xoá bài lỗi</span><span>↗</span>
    </a>
    <a class="link-item bill" href="https://business.facebook.com/billing_hub/accounts" target="_blank">
      <span>💳 Billing Hub Meta</span><span>↗</span>
    </a>
    <a class="link-item" href="https://adsmanager.facebook.com/adsmanager/manage/campaigns" target="_blank">
      <span>📊 Ads Manager</span><span>↗</span>
    </a>
    <a class="link-item" href="https://adsops-app.vibe.tinhgon.xyz/operations-guide" target="_blank">
      <span>📖 Công thức Chống Die</span><span>↗</span>
    </a>
  </div>

  <script src="popup.js"></script>
</body>
</html>`

  const popupJs = `const DEFAULT_ACCOUNTS = ${JSON.stringify(bundledAccounts)};
const viaInput = document.getElementById("via-name");
const profileInput = document.getElementById("profile-code");
const tierSelect = document.getElementById("via-tier");
const twofaInput = document.getElementById("twofa-secret");
const proxyInput = document.getElementById("proxy-raw");
const badge = document.getElementById("proxy-badge");
const passkeyBadge = document.getElementById("passkey-badge");
const saveMsg = document.getElementById("save-msg");
const liveIp = document.getElementById("live-ip");
const otpCodeEl = document.getElementById("otp-code");
const otpTimerEl = document.getElementById("otp-timer");
let currentOtpRaw = "";

// 1-Click Open Account Center & Auto-Delete Passkey
document.getElementById("btn-nuke-passkey")?.addEventListener("click", () => {
  chrome.tabs?.create({
    url: "https://accountscenter.facebook.com/password_and_security/passkeys?adsops_auto_delete_passkey=1"
  });
});

// 1-Click Bypass Passkey Login Screen -> Switch to 2FA 6-digit Authenticator
document.getElementById("btn-bypass-login-passkey")?.addEventListener("click", () => {
  chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.scripting?.executeScript({
      target: { tabId },
      func: () => {
        const keywords = [
          "thử cách khác", "try another way", "sử dụng phương thức khác",
          "use another method", "ứng dụng xác thực", "authentication app",
          "lúc khác", "not now", "bỏ qua", "skip"
        ];
        const els = Array.from(document.querySelectorAll('div[role="button"], button, a, span'));
        for (const kw of keywords) {
          const match = els.find((el) => (el.textContent || "").trim().toLowerCase() === kw || (el.textContent || "").trim().toLowerCase().includes(kw));
          if (match) {
            match.click();
          }
        }
      }
    });
  });
});

// RFC-6238 TOTP in pure Web Crypto
function base32ToBytes(b32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(b32 || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!cleaned) return new Uint8Array(0);
  let bits = "";
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val >= 0) bits += val.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

async function computeTotp(secret) {
  const keyBytes = base32ToBytes(secret);
  if (!keyBytes.length) return "";
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

async function tickOtp() {
  const sec = (twofaInput?.value || "").trim();
  const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (otpTimerEl) otpTimerEl.textContent = rem + "s";
  if (!sec) {
    currentOtpRaw = "";
    if (otpCodeEl) otpCodeEl.textContent = "Chưa gắn 2FA";
    return;
  }
  try {
    const code = await computeTotp(sec);
    currentOtpRaw = code;
    if (otpCodeEl) otpCodeEl.textContent = code ? code.slice(0, 3) + " " + code.slice(3) : "Khóa lỗi";
  } catch (e) {
    if (otpCodeEl) otpCodeEl.textContent = "Khóa lỗi";
  }
}

setInterval(tickOtp, 1000);

document.getElementById("btn-save-2fa")?.addEventListener("click", () => {
  const sec = (twofaInput?.value || "").replace(/\\s+/g, "").toUpperCase();
  if (twofaInput) twofaInput.value = sec;
  chrome.storage?.local?.set({ twoFaSecret: sec }, () => {
    flashSaved();
    tickOtp();
  });
});

document.getElementById("btn-copy-otp")?.addEventListener("click", () => {
  if (!currentOtpRaw) return;
  navigator.clipboard.writeText(currentOtpRaw);
  const btn = document.getElementById("btn-copy-otp");
  if (btn) {
    btn.textContent = "✓ Đã chép";
    setTimeout(() => { btn.textContent = "📋 Copy"; }, 1400);
  }
});

document.getElementById("btn-fill-otp")?.addEventListener("click", () => {
  if (!currentOtpRaw) return;
  navigator.clipboard.writeText(currentOtpRaw);
  chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.scripting?.executeScript({
      target: { tabId },
      func: (code) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input[name*="code"], input[autocomplete="one-time-code"]'));
        const target = inputs.find((el) => el && el.offsetParent !== null);
        if (target) {
          target.focus();
          target.value = code;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      args: [currentOtpRaw]
    });
  });
});

tierSelect?.addEventListener("change", () => {
  chrome.storage?.local?.set({ viaTier: tierSelect.value }, () => flashSaved());
});

// Cookie Export / Import & EAAB Token Extractor
document.getElementById("btn-export-cookie")?.addEventListener("click", () => {
  const statusEl = document.getElementById("cookie-status");
  const box = document.getElementById("cookie-box");
  chrome.cookies?.getAll({ domain: "facebook.com" }, (cookies) => {
    if (!cookies || !cookies.length) {
      if (statusEl) statusEl.textContent = "Không tìm thấy Cookie Facebook trên Profile này.";
      return;
    }
    const semi = cookies.map((c) => c.name + "=" + c.value).join("; ");
    if (box) box.value = semi;
    navigator.clipboard.writeText(semi);
    if (statusEl) statusEl.textContent = "✓ Đã sao chép " + cookies.length + " Cookie Facebook vào bộ nhớ tạm!";
  });
});

document.getElementById("btn-import-cookie")?.addEventListener("click", () => {
  const statusEl = document.getElementById("cookie-status");
  const raw = (document.getElementById("cookie-box")?.value || "").trim();
  if (!raw) return;
  let count = 0;
  try {
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw);
      arr.forEach((c) => {
        if (c.name && c.value) {
          chrome.cookies?.set({ url: "https://www.facebook.com", domain: ".facebook.com", name: c.name, value: c.value, path: "/" });
          count++;
        }
      });
    } else {
      raw.split(";").forEach((pair) => {
        const idx = pair.indexOf("=");
        if (idx > 0) {
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (name && value) {
            chrome.cookies?.set({ url: "https://www.facebook.com", domain: ".facebook.com", name, value, path: "/" });
            count++;
          }
        }
      });
    }
    if (statusEl) statusEl.textContent = "✓ Đã nạp " + count + " Cookie! Hãy tải lại tab Facebook.";
  } catch (e) {
    if (statusEl) statusEl.textContent = "Lỗi định dạng Cookie.";
  }
});

document.getElementById("btn-extract-token")?.addEventListener("click", () => {
  const statusEl = document.getElementById("cookie-status");
  const box = document.getElementById("cookie-box");
  chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.scripting?.executeScript({
      target: { tabId },
      func: () => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/EAA[A-Za-z0-9]{40,350}/);
        return m ? m[0] : "";
      }
    }, (results) => {
      const tok = results?.[0]?.result || "";
      if (tok) {
        if (box) box.value = tok;
        navigator.clipboard.writeText(tok);
        if (statusEl) statusEl.textContent = "✓ Đã bắt & sao chép Token Meta (" + tok.slice(0, 10) + "...)!";
      } else {
        if (statusEl) statusEl.textContent = "Hãy mở tab Ads Manager hoặc BM rồi bấm lại để bắt Token.";
      }
    });
  });
});

function fmtMoney(raw, curr) {
  const n = Number(raw) || 0;
  if (curr === "USD") return n.toLocaleString("en-US") + " USD";
  return n.toLocaleString("vi-VN") + " ₫";
}

function renderAccounts(accs) {
  const listEl = document.getElementById("acc-list");
  const countEl = document.getElementById("acc-count-label");
  const kpiActive = document.getElementById("kpi-active");
  const kpiRestr = document.getElementById("kpi-restricted");
  const kpiDebt = document.getElementById("kpi-debt");
  if (!listEl) return;

  const items = Array.isArray(accs) && accs.length > 0 ? accs : DEFAULT_ACCOUNTS;
  if (countEl) countEl.textContent = items.length + " TKQC";

  let activeCount = 0;
  let restrCount = 0;
  let totalDebt = 0;

  listEl.innerHTML = "";
  items.forEach((a) => {
    const st = String(a.status || "");
    const bal = Number(a.balance_raw || 0) || 0;
    if (a.currency !== "USD") totalDebt += bal;
    if (st === "active") activeCount++;
    else if (st === "restricted") restrCount++;

    const badgeCls = st === "active" ? "badge badge-ok" : st === "restricted" ? "badge badge-warn" : "badge badge-err";
    const badgeTxt = st === "active" ? "Hoạt động" : st === "restricted" ? "Nợ cước" : "Đã đóng";
    const actId = String(a.external_account_id || "").replace(/^act_/i, "");
    const cardTxt = a.payment_card_display || "Chưa gắn thẻ";
    const threshTxt = a.billing_threshold_raw ? " · Ngưỡng: " + fmtMoney(a.billing_threshold_raw, a.currency) : "";
    const dslTxt = a.meta_daily_limit_raw ? " · GH ngày: " + fmtMoney(a.meta_daily_limit_raw, a.currency) : "";

    const div = document.createElement("div");
    div.className = "acc-item";
    div.innerHTML =
      '<div class="acc-top">' +
        '<span class="acc-name" title="' + (a.name || actId) + '">' + (a.name || actId) + ' <span class="mono" style="color:#94a3b8;font-weight:400;">(' + actId + ')</span></span>' +
        '<span class="' + badgeCls + '">' + badgeTxt + '</span>' +
      '</div>' +
      '<div class="acc-meta">' +
        '<span>Dư nợ: <strong class="mono" style="color:' + (bal > 0 ? '#fbbf24' : '#f8fafc') + ';">' + fmtMoney(bal, a.currency) + '</strong>' + threshTxt + dslTxt + '</span>' +
        '<span class="mono" style="color:#93c5fd;">💳 ' + cardTxt + '</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-top:4px;border-top:1px dashed #1e293b;font-size:10px;">' +
        '<span style="color:#94a3b8;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (a.business_legal_name || a.bm_name || "BM Meta") + '</span>' +
        '<span style="display:flex;gap:6px;">' +
          '<a href="https://business.facebook.com/billing_hub/accounts/details?act=' + actId + '" target="_blank" style="color:#60a5fa;text-decoration:none;font-weight:700;">Billing ↗</a>' +
          '<a href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + actId + '" target="_blank" style="color:#34d399;text-decoration:none;font-weight:700;">Ads ↗</a>' +
        '</span>' +
      '</div>';
    listEl.appendChild(div);
  });

  if (kpiActive) kpiActive.textContent = String(activeCount);
  if (kpiRestr) kpiRestr.textContent = String(restrCount);
  if (kpiDebt) kpiDebt.textContent = totalDebt.toLocaleString("vi-VN") + " ₫";
}

function refreshIp() {
  if (!liveIp) return;
  liveIp.textContent = "Đang kiểm tra...";
  fetch("https://api.ipify.org?format=json")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ip) liveIp.textContent = d.ip;
    })
    .catch(() => {
      liveIp.textContent = "Không kết nối được";
    });
}

function updateBadge(enabled, raw) {
  if (!badge) return;
  if (enabled && raw && raw.trim()) {
    badge.textContent = "ĐANG BỌC PROXY";
    badge.className = "status-pill active";
  } else {
    badge.textContent = "MẠNG GỐC";
    badge.className = "status-pill";
  }
}

function flashSaved() {
  if (!saveMsg) return;
  saveMsg.style.display = "inline";
  setTimeout(() => {
    saveMsg.style.display = "none";
  }, 1800);
}

renderAccounts(DEFAULT_ACCOUNTS);

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(["viaName", "profileCode", "viaTier", "twoFaSecret", "passkeyStatus", "proxyRaw", "proxyEnabled", "accounts"], (res) => {
    if (viaInput) viaInput.value = res.viaName || "${viaName.replace(/"/g, '\\"')}";
    if (profileInput) profileInput.value = res.profileCode || "${profileDir.replace(/"/g, '\\"')}";
    if (tierSelect) tierSelect.value = res.viaTier || "${viaTier}";
    if (twofaInput) twofaInput.value = res.twoFaSecret || "${twoFaSecret.replace(/\s+/g, '').toUpperCase()}";
    if (proxyInput) proxyInput.value = res.proxyRaw || "";
    if (passkeyBadge) {
      if (res.passkeyStatus === "detected") {
        passkeyBadge.textContent = "⚠️ CÓ PASSKEY - BẤM XOÁ NGAY";
        passkeyBadge.className = "badge badge-err";
      } else if (res.passkeyStatus === "deleted") {
        passkeyBadge.textContent = "✅ ĐÃ XOÁ SẠCH PASSKEY";
        passkeyBadge.className = "badge badge-ok";
      }
    }
    updateBadge(Boolean(res.proxyEnabled), res.proxyRaw || "");
    if (Array.isArray(res.accounts) && res.accounts.length > 0) {
      renderAccounts(res.accounts);
    }
    tickOtp();
  });
}

document.getElementById("btn-save-enable")?.addEventListener("click", () => {
  const raw = (proxyInput?.value || "").trim();
  const state = {
    viaName: (viaInput?.value || "").trim() || "Via Facebook",
    profileCode: (profileInput?.value || "").trim() || "Default",
    viaTier: tierSelect?.value || "camp",
    proxyRaw: raw,
    proxyEnabled: Boolean(raw),
    webrtcShield: true
  };
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set(state, () => {
      updateBadge(state.proxyEnabled, state.proxyRaw);
      flashSaved();
      setTimeout(refreshIp, 600);
    });
  }
});

document.getElementById("btn-disable-proxy")?.addEventListener("click", () => {
  const state = {
    viaName: (viaInput?.value || "").trim() || "Via Facebook",
    profileCode: (profileInput?.value || "").trim() || "Default",
    proxyRaw: (proxyInput?.value || "").trim(),
    proxyEnabled: false
  };
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set(state, () => {
      updateBadge(false, "");
      flashSaved();
      setTimeout(refreshIp, 600);
    });
  }
});

if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs?.[0]?.url || "";
    const actMatch = url.match(/(?:act=|act_)(\\d{6,25})/i);
    const bmMatch = url.match(/business_id=(\\d{6,25})/i);
    if (actMatch || bmMatch) {
      const box = document.getElementById("fb-detected");
      const txt = document.getElementById("fb-detected-text");
      const copyBtn = document.getElementById("btn-copy-id");
      const parts = [];
      const primaryId = actMatch ? actMatch[1] : bmMatch[1];
      if (bmMatch) parts.push("BM ID: " + bmMatch[1]);
      if (actMatch) parts.push("TKQC ID: " + actMatch[1]);
      if (box && txt) {
        txt.textContent = parts.join(" · ");
        box.style.display = "block";
      }
      copyBtn?.addEventListener("click", () => {
        navigator.clipboard.writeText(primaryId);
        copyBtn.textContent = "Đã chép: " + primaryId;
      });
    }
  });
}

refreshIp();
tickOtp();`

  const readmeTxt = [
    'HƯỚNG DẪN CÀI ĐẶT TIỆN ÍCH GOOGLE CHROME (ADSOPS COMPANION v2.6 PRO - FULL AUTO PAGE + ANTI-PASSKEY)',
    '===================================================================================',
    'Bước 1: Giải nén file .zip này ra một thư mục cố định (ví dụ: Desktop\\AdsOps-Chrome-Extension).',
    'Bước 2: Mở trình duyệt Google Chrome của Via -> gõ vào thanh địa chỉ: chrome://extensions',
    'Bước 3: Bật công tắc "Chế độ dành cho nhà phát triển" (Developer mode) ở góc trên bên phải.',
    'Bước 4: Bấm nút "Tải tiện ích đã giải nén" (Load unpacked) ở góc trên bên trái -> Chọn thư mục vừa giải nén.',
    'Bước 5: Bấm biểu tượng mảnh ghép trên góc phải Chrome -> Bấm nút Ghim (Pin) cạnh "AdsOps Companion Pro".',
  ].join('\r\n')

  const contentJs = `// AdsOps Companion Pro v2.6 — Full Auto-Pilot Page Creator + Safety Guard + Anti-Passkey + HUD
(function() {
  let lastSyncedAct = "";
  let autoDeletePasskeyTriggered = false;

  // 1. Auto-Skip "Create a passkey" upsell modals & Auto-Detect / Auto-Delete Passkeys in Account Center
  function handlePasskeyDom() {
    const url = window.location.href;
    const bodyText = (document.body ? document.body.innerText : "").toLowerCase();

    // A) If Facebook shows a "Create a passkey / Tạo khóa truy cập" upsell popup after login -> auto-dismiss it!
    if (
      (bodyText.includes("tạo khóa truy cập") || bodyText.includes("create a passkey") || bodyText.includes("đăng nhập nhanh hơn bằng khóa truy cập")) &&
      !url.includes("accountscenter.facebook.com")
    ) {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button, span'));
      const skipBtn = buttons.find((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return t === "lúc khác" || t === "bỏ qua" || t === "not now" || t === "skip";
      });
      if (skipBtn) {
        skipBtn.click();
      }
    }

    // B) If on login screen and stuck on "Sign in with a passkey / Đăng nhập bằng khóa truy cập"
    if (
      bodyText.includes("đăng nhập bằng khóa truy cập") ||
      bodyText.includes("sign in with a passkey") ||
      bodyText.includes("sử dụng khóa truy cập của bạn")
    ) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ passkeyStatus: "detected" });
      }
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button, a, span'));
      const tryOtherBtn = buttons.find((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return t === "thử cách khác" || t === "try another way" || t === "sử dụng phương thức khác" || t === "use another method";
      });
      if (tryOtherBtn) {
        tryOtherBtn.click();
      }
    }

    // C) If inside Meta Accounts Center Passkeys page (accountscenter.facebook.com/password_and_security/passkeys)
    if (url.includes("accountscenter.facebook.com") && (url.includes("passkey") || bodyText.includes("khóa truy cập") || bodyText.includes("passkey"))) {
      const clickable = Array.from(document.querySelectorAll('div[role="button"], button, a, span'));
      const deleteButtons = clickable.filter((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute && (el.getAttribute("aria-label") || "")).toLowerCase();
        return (
          t === "xóa" || t === "gỡ" || t === "delete" || t === "remove" ||
          aria.includes("xóa khóa truy cập") || aria.includes("delete passkey") || aria.includes("remove passkey")
        );
      });

      const hasExistingPasskey =
        deleteButtons.length > 0 ||
        bodyText.includes("khóa truy cập của bạn") ||
        bodyText.includes("your passkeys");

      if (hasExistingPasskey && deleteButtons.length > 0) {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ passkeyStatus: "detected" });
        }
        const hudStatus = document.getElementById("adsops-hud-passkey-status");
        if (hudStatus) {
          hudStatus.textContent = "⚠️ Phát hiện Passkey! Đang tự động xóa...";
          hudStatus.style.color = "#fda4af";
        }
        // If opened via 1-Click Auto-Delete button (?adsops_auto_delete_passkey=1) or user clicked HUD delete
        if (url.includes("adsops_auto_delete_passkey=1") && !autoDeletePasskeyTriggered) {
          autoDeletePasskeyTriggered = true;
          deleteButtons[0].click();
          setTimeout(() => {
            const allBtns = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button, button, div[role="button"]'));
            const confirmBtn = allBtns.find((b) => {
              const txt = (b.textContent || "").trim().toLowerCase();
              return txt === "xóa" || txt === "gỡ" || txt === "delete" || txt === "remove" || txt === "xác nhận" || txt === "tiếp tục";
            });
            if (confirmBtn) {
              confirmBtn.click();
              if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ passkeyStatus: "deleted" });
              }
            }
          }, 900);
        }
      } else if (url.includes("passkey")) {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ passkeyStatus: "deleted" });
        }
        const hudStatus = document.getElementById("adsops-hud-passkey-status");
        if (hudStatus) {
          hudStatus.textContent = "✅ Sạch Passkey";
          hudStatus.style.color = "#6ee7b7";
        }
      }
    }
  }

  function injectFloatingHud() {
    if (document.getElementById("adsops-floating-hud")) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(["viaName", "profileCode", "viaTier", "proxyEnabled", "passkeyStatus"], (res) => {
      if (document.getElementById("adsops-floating-hud")) return;
      const viaName = res.viaName || "Via Facebook";
      const profileCode = res.profileCode || "Default";
      const tier = res.viaTier || "camp";
      const isVault = tier === "vault";
      const isStandby = tier === "standby";

      const hud = document.createElement("div");
      hud.id = "adsops-floating-hud";
      hud.style.cssText = [
        "position:fixed",
        "bottom:14px",
        "left:14px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:6px 11px",
        "border-radius:999px",
        "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
        "font-size:11.5px",
        "font-weight:700",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
        "backdrop-filter:blur(8px)",
        isVault
          ? "background:rgba(127,29,29,0.94);color:#fef2f2;border:1.5px solid #f87171;"
          : isStandby
          ? "background:rgba(120,53,15,0.94);color:#fffbeb;border:1.5px solid #fbbf24;"
          : "background:rgba(15,23,42,0.92);color:#f8fafc;border:1.5px solid #38bdf8;"
      ].join(";");

      const roleText = isVault
        ? "🛡️ LỚP 1: VIA TỔNG (CẤM BẤM LÊN CAMP!)"
        : isStandby
        ? "🌱 LỚP 3: VIA DỰ PHÒNG (ĐANG NGÂM)"
        : "🚀 LỚP 2: VIA LÊN CAMP";

      hud.innerHTML =
        '<span>' + roleText + '</span>' +
        '<span style="opacity:0.45;">|</span>' +
        '<span style="font-family:monospace;">' + viaName + ' (' + profileCode + ')</span>' +
        '<span style="opacity:0.45;">|</span>' +
        '<span id="adsops-hud-passkey-status" style="color:#6ee7b7;font-size:10.5px;">🚫 Đã khóa Passkey</span>' +
        '<a href="https://accountscenter.facebook.com/password_and_security/passkeys?adsops_auto_delete_passkey=1" style="background:rgba(244,63,94,0.28);border:1px solid #f87171;color:#fecdd3;padding:2px 7px;border-radius:999px;text-decoration:none;font-size:10px;font-weight:800;" title="Mở trang tự động quét & xóa sạch Passkey trong Account Center">🗑️ Tự Xoá Passkey</a>' +
        '<button id="adsops-hud-close" title="Ẩn thanh nhắc nhở này" style="margin-left:2px;background:transparent;border:none;color:inherit;cursor:pointer;font-weight:900;font-size:12px;">✕</button>';

      document.body.appendChild(hud);
      document.getElementById("adsops-hud-close")?.addEventListener("click", () => {
        hud.remove();
      });
    });
  }

  function scanBillingDom() {
    injectFloatingHud();
    handlePasskeyDom();
    const url = window.location.href;
    if (!url.includes("billing_hub") && !url.includes("account_billing")) return;
    const actMatch = url.match(/(?:act=|asset_id=)(\\d{6,25})/i);
    if (!actMatch) return;
    const actId = actMatch[1];
    const bodyText = document.body ? document.body.innerText : "";
    if (!bodyText || bodyText.length < 100) return;

    const threshMatch = bodyText.match(/(?:Số dư của bạn đạt|Payment threshold)[\\s\\n:]*([0-9.,]+)\\s*(?:₫|VND|USD|\\$)/i);
    const dateMatch = bodyText.match(/(?:Và vào ngày này|And on this date)[\\s\\n:]*([^\\n]{5,30})/i);
    const dslMatch = bodyText.match(/(?:Giới hạn chi tiêu hàng ngày \\(do Meta đặt\\)|Daily spending limit)[\\s\\n:]*([0-9.,]+)\\s*(?:₫|VND|USD|\\$)/i);
    const cardMatch = bodyText.match(/(Visa|Mastercard)\\s*[·•*\\-.\\s]{2,8}\\s*(\\d{4})/i);

    const threshRaw = threshMatch ? threshMatch[1].replace(/[.,\\s]/g, "") : null;
    const nextDate = dateMatch ? dateMatch[1].trim() : null;
    const dslRaw = dslMatch ? dslMatch[1].replace(/[.,\\s]/g, "") : null;
    const cardDisp = cardMatch ? (cardMatch[1] + " ···· " + cardMatch[2]) : null;

    if (!threshRaw && !nextDate && !dslRaw) return;
    const syncKey = [actId, threshRaw, nextDate, dslRaw, cardDisp].join("|");
    if (syncKey === lastSyncedAct) return;
    lastSyncedAct = syncKey;

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["accounts"], (res) => {
        const list = Array.isArray(res.accounts) ? res.accounts : [];
        const updated = list.map((a) => {
          if (String(a.external_account_id || "").replace(/^act_/i, "") === actId) {
            return Object.assign({}, a, {
              billing_threshold_raw: threshRaw || a.billing_threshold_raw,
              next_bill_date: nextDate || a.next_bill_date,
              meta_daily_limit_raw: dslRaw || a.meta_daily_limit_raw,
              payment_card_display: cardDisp || a.payment_card_display
            });
          }
          return a;
        });
        chrome.storage.local.set({ accounts: updated });
      });
    }
  }
  let pageCreateAutoFilled = false;
  let pageAutoPilotHalted = false;
  let pageWizardPending = false;
  let lastWizardClickAt = 0;

  function randDelay(minMs, maxMs) {
    return minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs + 1));
  }

  function setHudPageStatus(msg, color) {
    const hudStatus = document.getElementById("adsops-hud-passkey-status");
    if (hudStatus) {
      hudStatus.textContent = msg;
      hudStatus.style.color = color || "#34d399";
    }
  }

  function detectSafetyChallenge() {
    const href = (window.location.href || "").toLowerCase();
    if (
      href.includes("/checkpoint") ||
      href.includes("/challenge") ||
      href.includes("two_step_verification") ||
      href.includes("/recover") ||
      href.includes("captcha")
    ) {
      return "URL xác minh/checkpoint";
    }
    const captchaIframe = document.querySelector(
      'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="arkoselabs"]',
    );
    if (captchaIframe) {
      return "CAPTCHA";
    }
    const txt = (document.body ? document.body.innerText : "").toLowerCase();
    const blockPhrases = [
      "xác minh bạn là con người",
      "verify you are human",
      "bạn đã tạo quá nhiều trang",
      "you have created too many pages",
      "bạn hiện không thể tạo",
      "bạn không thể tạo trang",
      "you can't create a page right now",
      "tài khoản của bạn tạm thời bị chặn",
      "your account is temporarily restricted",
    ];
    for (const phrase of blockPhrases) {
      if (txt.includes(phrase)) {
        return phrase;
      }
    }
    return "";
  }

  function haltAutoPilotForSafety(reason) {
    pageAutoPilotHalted = true;
    try {
      sessionStorage.removeItem("adsops_autopilot_until");
    } catch (e) {}
    setHudPageStatus("🛑 Cảnh báo FB (" + reason + ") — Đã tự dừng Auto để bảo vệ Via!", "#fca5a5");
  }

  function findVisiblePageButtons() {
    return Array.from(document.querySelectorAll('div[role="button"], button, a[role="button"]')).filter((b) => {
      if (b.closest("#adsops-floating-hud")) return false;
      const rect = b.getBoundingClientRect();
      return rect.width > 16 && rect.height > 12;
    });
  }

  function handlePageOnboardingWizard() {
    if (pageAutoPilotHalted || pageWizardPending) return;
    let until = 0;
    let startedAt = 0;
    let clicks = 0;
    let batchStep = "";
    try {
      until = Number(sessionStorage.getItem("adsops_autopilot_until") || "0");
      startedAt = Number(sessionStorage.getItem("adsops_autopilot_started_at") || "0");
      clicks = Number(sessionStorage.getItem("adsops_autopilot_clicks") || "0");
      batchStep = sessionStorage.getItem("adsops_autopilot_batch") || "";
    } catch (e) {}
    if (!until || Date.now() > until) return;

    const challenge = detectSafetyChallenge();
    if (challenge) {
      haltAutoPilotForSafety(challenge);
      return;
    }

    if (clicks >= 6) {
      try { sessionStorage.removeItem("adsops_autopilot_until"); } catch (e) {}
      setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "✅ Đã tạo Fanpage & xong các bước tự động!", "#34d399");
      return;
    }

    const urlLower = (window.location.href || "").toLowerCase();
    const bodyLower = (document.body ? document.body.innerText : "").toLowerCase();
    const isOnboarding =
      urlLower.includes("/pages/creation") ||
      bodyLower.includes("hoàn tất thiết lập trang") ||
      bodyLower.includes("finish setting up your page") ||
      bodyLower.includes("tùy chỉnh trang") ||
      bodyLower.includes("customize your page") ||
      bodyLower.includes("xây dựng đối tượng") ||
      bodyLower.includes("build your page audience") ||
      bodyLower.includes("mời bạn bè") ||
      bodyLower.includes("invite friends") ||
      bodyLower.includes("kết nối whatsapp") ||
      bodyLower.includes("connect whatsapp");

    if (!isOnboarding && startedAt && Date.now() - startedAt > 10000) {
      try { sessionStorage.removeItem("adsops_autopilot_until"); } catch (e) {}
      setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "✅ Đã tạo & hoàn tất Fanpage tự động!", "#34d399");
      return;
    }

    if (Date.now() - lastWizardClickAt < 3600) return;

    const btns = findVisiblePageButtons();
    const matchBtnByWords = (words) =>
      btns.find((b) => {
        if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
        const txt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
        return words.some((w) => txt === w || txt.startsWith(w + " "));
      });

    const skipBtn = matchBtnByWords(["bỏ qua", "skip", "lúc khác", "not now"]);
    const nextOrDoneBtn = matchBtnByWords(["xong", "done", "hoàn tất", "finish", "tiếp", "next"]);
    const targetBtn = skipBtn || (isOnboarding ? nextOrDoneBtn : null);
    if (!targetBtn) return;

    pageWizardPending = true;
    const waitMs = randDelay(450, 1250);
    setTimeout(() => {
      pageWizardPending = false;
      if (pageAutoPilotHalted) return;
      const ch2 = detectSafetyChallenge();
      if (ch2) {
        haltAutoPilotForSafety(ch2);
        return;
      }
      targetBtn.style.outline = "2px solid #38bdf8";
      targetBtn.click();
      lastWizardClickAt = Date.now();
      const nextCount = clicks + 1;
      try {
        sessionStorage.setItem("adsops_autopilot_clicks", String(nextCount));
      } catch (e) {}
      setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto] Đã qua bước thiết lập #" + nextCount + "...", "#38bdf8");
    }, waitMs);
  }

  function handlePageCreationDom() {
    if (pageAutoPilotHalted || pageCreateAutoFilled) return;
    const url = window.location.href;
    if (!url.includes("/pages/creation") && !url.includes("adsops_page_name=")) return;
    try {
      const u = new URL(url);
      const pName = u.searchParams.get("adsops_page_name") || "";
      const pCat = u.searchParams.get("adsops_page_cat") || "";
      const pBio = u.searchParams.get("adsops_page_bio") || "";
      const batchStep = u.searchParams.get("adsops_batch_step") || "";
      const autoSubmit = u.searchParams.get("adsops_auto_submit") === "1";
      if (!pName && !pCat && !pBio) return;

      const challenge = detectSafetyChallenge();
      if (challenge) {
        haltAutoPilotForSafety(challenge);
        return;
      }

      const setNativeValue = (el, val) => {
        if (!el || !val) return false;
        el.focus();
        const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) {
          desc.set.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };

      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea'));
      if (inputs.length === 0) return;

      let nameEl = null;
      let catEl = null;
      let bioEl = null;
      for (const el of inputs) {
        const label = ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase();
        if (!nameEl && (label.includes("tên trang") || label.includes("page name") || inputs.indexOf(el) === 0)) {
          nameEl = el;
        } else if (!catEl && (label.includes("hạng mục") || label.includes("category") || inputs.indexOf(el) === 1)) {
          catEl = el;
        } else if (!bioEl && (el.tagName === "TEXTAREA" || label.includes("tiểu sử") || label.includes("mô tả") || label.includes("bio"))) {
          bioEl = el;
        }
      }

      if (!nameEl && !catEl && !bioEl) return;
      pageCreateAutoFilled = true;

      const tName = randDelay(650, 1150);
      const tCat = tName + randDelay(950, 1550);
      const tCatOpt = randDelay(750, 1200);
      const tBio = tCat + tCatOpt + randDelay(1100, 1750);
      const tFinal = tBio + randDelay(1900, 2850);

      if (autoSubmit) {
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.6] Đang nhập tự nhiên theo nhịp người thật...", "#38bdf8");
      }

      if (pName && nameEl && !nameEl.value) {
        setTimeout(() => {
          if (!pageAutoPilotHalted) setNativeValue(nameEl, pName);
        }, tName);
      }
      if (pCat && catEl && !catEl.value) {
        const cleanCat = pCat.split("(")[0].trim();
        setTimeout(() => {
          if (pageAutoPilotHalted) return;
          setNativeValue(catEl, cleanCat);
          setTimeout(() => {
            if (pageAutoPilotHalted) return;
            const opt = document.querySelector('ul[role="listbox"] li, div[role="listbox"] div[role="option"], li[role="option"]');
            if (opt) opt.click();
          }, tCatOpt);
        }, tCat);
      }
      if (pBio && bioEl && !bioEl.value) {
        setTimeout(() => {
          if (!pageAutoPilotHalted) setNativeValue(bioEl, pBio);
        }, tBio);
      }

      const tryAutoClickCreate = (allowRetry) => {
        if (pageAutoPilotHalted) return;
        const chSubmit = detectSafetyChallenge();
        if (chSubmit) {
          haltAutoPilotForSafety(chSubmit);
          return;
        }
        const submitBtns = findVisiblePageButtons();
        const createBtn = submitBtns.find((b) => {
          const txt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
          return txt === "tạo trang" || txt === "create page";
        });
        if (!createBtn) {
          setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "⚠️ Không tìm thấy nút Tạo Trang — Hãy kiểm tra thủ công", "#fcd34d");
          return;
        }
        createBtn.style.outline = "3px solid #10b981";
        createBtn.style.boxShadow = "0 0 18px rgba(16,185,129,0.75)";
        if (!autoSubmit) {
          setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🌱 Đã tự điền chuẩn kỹ thuật! Kiểm tra 1s rồi bấm Tạo Trang", "#34d399");
          return;
        }

        const isDisabled = Boolean(createBtn.disabled) || createBtn.getAttribute("aria-disabled") === "true";
        if (isDisabled) {
          if (allowRetry) {
            const retryOpt = document.querySelector('ul[role="listbox"] li, div[role="listbox"] div[role="option"], li[role="option"]');
            if (retryOpt) retryOpt.click();
            setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "⏳ Đợi Facebook xác nhận Tên & Hạng mục...", "#fcd34d");
            setTimeout(() => tryAutoClickCreate(false), 2600);
          } else {
            setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "⚠️ Nút Tạo Trang chưa sáng (Tên bị trùng/chờ duyệt) — Kiểm tra tay giúp nhé", "#fcd34d");
          }
          return;
        }

        lastWizardClickAt = Date.now();
        try {
          sessionStorage.setItem("adsops_autopilot_until", String(Date.now() + 90000));
          sessionStorage.setItem("adsops_autopilot_started_at", String(Date.now()));
          sessionStorage.setItem("adsops_autopilot_clicks", "0");
          sessionStorage.setItem("adsops_autopilot_batch", batchStep || "");
        } catch (e) {}
        createBtn.click();
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.6] Đã bấm Tạo Trang — Đang hoàn tất bước phụ...", "#38bdf8");
      };

      setTimeout(() => tryAutoClickCreate(true), tFinal);
    } catch (e) {}
  }

  setTimeout(() => {
    injectFloatingHud();
    handlePasskeyDom();
    handlePageCreationDom();
    handlePageOnboardingWizard();
  }, 900);
  setInterval(() => {
    scanBillingDom();
    handlePageCreationDom();
    handlePageOnboardingWizard();
  }, 2200);
})();`

  return [
    { name: `${folderRoot}/manifest.json`, content: JSON.stringify(manifestObj, null, 2) },
    { name: `${folderRoot}/passkey_shield.js`, content: passkeyShieldJs },
    { name: `${folderRoot}/background.js`, content: backgroundJs },
    { name: `${folderRoot}/content.js`, content: contentJs },
    { name: `${folderRoot}/popup.html`, content: popupHtml },
    { name: `${folderRoot}/popup.js`, content: popupJs },
    { name: `${folderRoot}/HUONG-DAN-CAI-DAT.txt`, content: readmeTxt },
  ]
}

export function downloadChromeExtensionZip(
  viaName = 'Tài Khoản Chính',
  profileDir = 'Default',
  rawProxy = '',
  bundledAccounts: ExtensionBundledAccount[] = [],
  twoFaSecret = '',
  viaTier: 'vault' | 'camp' | 'standby' = 'camp',
): void {
  const slug = profileDir.replace(/[^a-zA-Z0-9_-]/g, '-')
  const zipBlob = buildStoreZip(
    buildExtensionFilesForVia(
      'AdsOps-Chrome-Extension',
      viaName,
      profileDir,
      rawProxy,
      bundledAccounts,
      twoFaSecret,
      viaTier,
    ),
  )
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Chrome-Extension-v2.6-${slug}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface ViaExtensionBundleSpec {
  viaName: string
  profileDir: string
  rawProxy: string
  bundledAccounts: ExtensionBundledAccount[]
  twoFaSecret: string
  viaTier: 'vault' | 'camp' | 'standby'
}

export function downloadAllViasExtensionsBundleZip(items: ViaExtensionBundleSpec[]): void {
  if (!Array.isArray(items) || items.length === 0) return
  const allFiles: Array<{ name: string; content: string | Uint8Array }> = []
  const guideLines: string[] = [
    'TRON BO TIEN ICH ADSOPS COMPANION v2.6 PRO CHO TOAN BO DAN VIA',
    '================================================================',
    `Tong so thu muc Extension da dong goi: ${items.length} Via`,
    '',
    'Cach cai nhanh:',
    '1. Giai nen file .zip nay ra mot thu muc co dinh (VD: Desktop\AdsOps-Extensions-v2.6).',
    '2. Mo Chrome cua tung Via -> chrome://extensions -> Bat Developer mode -> Load unpacked -> chon dung thu muc ten cua Via do ben duoi:',
    '',
  ]

  items.forEach((spec, idx) => {
    const slug = spec.profileDir.replace(/[^a-zA-Z0-9_-]/g, '-')
    const folderName = `${String(idx + 1).padStart(2, '0')}-${slug}-${spec.viaName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 28)}`
    guideLines.push(`  - [${idx + 1}] Via "${spec.viaName}" (${spec.profileDir}) -> Thu muc: ${folderName}`)
    allFiles.push(
      ...buildExtensionFilesForVia(
        folderName,
        spec.viaName,
        spec.profileDir,
        spec.rawProxy,
        spec.bundledAccounts,
        spec.twoFaSecret,
        spec.viaTier,
      ),
    )
  })

  allFiles.unshift({
    name: 'HUONG-DAN-CAI-NHANH-DAN-VIA.txt',
    content: guideLines.join('\r\n'),
  })

  const zipBlob = buildStoreZip(allFiles)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Tron-Bo-Extension-v2.6-${items.length}Via.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const ANTI_HASH_PALETTES = [
  ['#0f172a', '#059669', '#ecfdf5'],
  ['#1e1b4b', '#4f46e5', '#eef2ff'],
  ['#4c0519', '#e11d48', '#fff1f2'],
  ['#082f49', '#0284c7', '#f0f9ff'],
  ['#14532d', '#16a34a', '#f0fdf4'],
  ['#451a03', '#d97706', '#fffbeb'],
]

async function renderUniquePngBytes(
  width: number,
  height: number,
  pageName: string,
  category: string,
  palette: string[],
  isCover: boolean,
  seedOffset: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return new Uint8Array(0)

  const [bgDark, accent, lightText] = palette
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, bgDark)
  grad.addColorStop(1, accent)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  // Subtle decorative geometry shifted uniquely per Page
  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(width * (isCover ? 0.85 : 0.78) + (seedOffset % 37), height * 0.28 + (seedOffset % 23), width * 0.24, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(width * 0.16, height * 0.82 - (seedOffset % 19), width * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const cleanTitle = (pageName || 'Brand Page').trim()
  const initials =
    cleanTitle
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'FB'

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (!isCover) {
    // 800x800 crisp monogram Avatar + short label
    ctx.strokeStyle = lightText
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.arc(width / 2, height * 0.44, 170, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = lightText
    ctx.font = '800 150px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.fillText(initials, width / 2, height * 0.45)

    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, sans-serif'
    const shortLine = cleanTitle.length > 28 ? `${cleanTitle.slice(0, 26)}…` : cleanTitle
    ctx.fillText(shortLine, width / 2, height * 0.78)
  } else {
    // 1640x624 Cover banner with title & category subtitle
    ctx.fillStyle = lightText
    ctx.font = '800 66px system-ui, -apple-system, Segoe UI, sans-serif'
    const mainTitle = cleanTitle.length > 42 ? `${cleanTitle.slice(0, 40)}…` : cleanTitle
    ctx.fillText(mainTitle, width / 2, height * 0.44)

    ctx.globalAlpha = 0.88
    ctx.font = '600 34px system-ui, -apple-system, Segoe UI, sans-serif'
    const subCat = (category || 'Thương hiệu chính hãng · Tư vấn tận tâm').split('(')[0].trim()
    ctx.fillText(subCat, width / 2, height * 0.62)
  }

  // Anti-Hash micro-pixel jitter (16 randomized corner pixels with +-1 RGB delta so MD5/SHA256 is 100% unique)
  const imgData = ctx.getImageData(0, 0, Math.min(32, width), Math.min(32, height))
  for (let i = 0; i < 16; i++) {
    const pxIdx = (Math.floor(Math.random() * 256) % (imgData.data.length / 4)) * 4
    imgData.data[pxIdx] = (imgData.data[pxIdx] + ((i % 3) + 1)) % 255
    imgData.data[pxIdx + 1] = (imgData.data[pxIdx + 1] + ((seedOffset + i) % 5)) % 255
  }
  ctx.putImageData(imgData, 0, 0)

  return new Promise<Uint8Array>((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(new Uint8Array(0))
          return
        }
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
      },
      'image/png',
      0.95,
    )
  })
}

export async function downloadUniquePageMediaZip(
  pages: Array<{ page_name: string; category?: string }>,
): Promise<void> {
  if (!Array.isArray(pages) || pages.length === 0) return
  const zipEntries: Array<{ name: string; content: string | Uint8Array }> = [
    {
      name: 'HUONG-DAN-SU-DUNG-ANH-CHONG-TRUNG-HASH.txt',
      content: [
        'BO ANH AVATAR (800x800) & ANH BIA COVER (1640x624) DOC BAN CHONG QUET TRUNG LAP',
        '===============================================================================',
        'Moi bo anh trong file .zip nay duoc ve lai va bien doi ma hash (pixel jitter) rieng biet cho tung Fanpage.',
        'Ban chi can tai len Facebook tuong ung voi tung Page sau khi tao xong de tang do Trust tu nhien.',
      ].join('\r\n'),
    },
  ]

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i]
    const palette = ANTI_HASH_PALETTES[(i + Math.floor(Math.random() * ANTI_HASH_PALETTES.length)) % ANTI_HASH_PALETTES.length]
    const slug = (pg.page_name || `page-${i + 1}`)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || `page-${i + 1}`

    const seed = Math.floor(Math.random() * 1000) + i * 31
    const avatarBytes = await renderUniquePngBytes(800, 800, pg.page_name, pg.category || '', palette, false, seed)
    const coverBytes = await renderUniquePngBytes(1640, 624, pg.page_name, pg.category || '', palette, true, seed + 17)

    const prefix = String(i + 1).padStart(2, '0')
    zipEntries.push({ name: `${prefix}-${slug}/${prefix}-${slug}-Avatar-800x800.png`, content: avatarBytes })
    zipEntries.push({ name: `${prefix}-${slug}/${prefix}-${slug}-Cover-1640x624.png`, content: coverBytes })
  }

  const zipBlob = buildStoreZip(zipEntries)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Bo-Anh-Avatar-Cover-DocBan-${pages.length}Page.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const downloadChromeExtensionPackageBat = downloadChromeExtensionZip
