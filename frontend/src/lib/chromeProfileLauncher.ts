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

export interface AutoPilotUrlOptions {
  autoSubmit: boolean
  warmupBeforeCreate?: boolean
  autoUploadMedia?: boolean
  autoCloseTab?: boolean
}

export function withAutoSubmitPageUrl(
  rawUrl: string,
  optsOrBool: boolean | AutoPilotUrlOptions,
): string {
  const opts: AutoPilotUrlOptions =
    typeof optsOrBool === 'boolean' ? { autoSubmit: optsOrBool } : optsOrBool
  const base = rawUrl && rawUrl.trim() ? rawUrl.trim() : 'https://www.facebook.com/pages/creation/'
  try {
    const u = new URL(base)
    u.searchParams.set('adsops_auto_submit', opts.autoSubmit ? '1' : '0')
    if (opts.autoUploadMedia) {
      u.searchParams.set('adsops_auto_upload', '1')
    } else {
      u.searchParams.delete('adsops_auto_upload')
    }
    if (opts.autoCloseTab) {
      u.searchParams.set('adsops_auto_close', '1')
    } else {
      u.searchParams.delete('adsops_auto_close')
    }
    if (opts.autoSubmit && opts.warmupBeforeCreate) {
      u.searchParams.set('adsops_warmup_to_create', '1')
      return `https://www.facebook.com/?${u.searchParams.toString()}`
    }
    u.searchParams.delete('adsops_warmup_to_create')
    return u.toString()
  } catch {
    const clean = base.replace(/([?&])adsops_(?:auto_submit|auto_upload|auto_close|warmup_to_create)=[01]/g, '')
    const sep = clean.includes('?') ? '&' : '?'
    const extra = [
      `adsops_auto_submit=${opts.autoSubmit ? '1' : '0'}`,
      opts.autoUploadMedia ? 'adsops_auto_upload=1' : '',
      opts.autoCloseTab ? 'adsops_auto_close=1' : '',
    ]
      .filter(Boolean)
      .join('&')
    return `${clean}${sep}${extra}`
  }
}

export interface HumanKeepAlivePlan {
  steps: string[]
  routeSummary: string
  estimatedSeconds: number
  normalizedTier: 'vault' | 'standard'
}

const KEEPALIVE_STOP_META: Record<string, { label: string; sec: number }> = {
  feed: { label: 'Newsfeed', sec: 14 },
  notif: { label: 'Thông báo', sec: 10 },
  pages: { label: 'Quản lý Trang', sec: 10 },
  profile: { label: 'Trang cá nhân', sec: 9 },
  biz: { label: 'Business Suite (BM)', sec: 14 },
}

export function planHumanKeepAliveRoute(viaTier?: string): HumanKeepAlivePlan {
  const isVault = viaTier === 'vault' || viaTier === 'veteran_xmdt'
  const pool = ['notif', 'pages', 'profile']
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  let steps: string[]
  if (isVault) {
    const sec = pool[0]
    steps = Math.random() < 0.65 ? ['feed', sec, 'biz'] : ['feed', 'biz', sec]
  } else {
    const count = Math.random() < 0.55 ? 1 : 2
    steps = ['feed', ...pool.slice(0, count)]
  }
  const routeSummary = steps.map((s) => KEEPALIVE_STOP_META[s]?.label || s).join(' → ')
  const estimatedSeconds = steps.reduce((acc, s) => acc + (KEEPALIVE_STOP_META[s]?.sec || 10), 0)
  return {
    steps,
    routeSummary,
    estimatedSeconds,
    normalizedTier: isVault ? 'vault' : 'standard',
  }
}

export function buildViaKeepAliveUrl(opts?: {
  autoCloseTab?: boolean
  viaLabel?: string
  viaTier?: string
  routeSteps?: string[]
}): string {
  const normalizedTier = opts?.viaTier === 'vault' || opts?.viaTier === 'veteran_xmdt' ? 'vault' : 'standard'
  const steps =
    Array.isArray(opts?.routeSteps) && opts!.routeSteps.length >= 2
      ? opts!.routeSteps
      : planHumanKeepAliveRoute(opts?.viaTier).steps
  const params = new URLSearchParams({
    adsops_keepalive_session: '1',
    adsops_auto_close: opts?.autoCloseTab === false ? '0' : '1',
    adsops_via_tier: normalizedTier,
    adsops_ka_route: steps.join(','),
  })
  if (opts?.viaLabel?.trim()) {
    params.set('adsops_via_label', opts.viaLabel.trim().slice(0, 60))
  }
  return `https://www.facebook.com/?${params.toString()}`
}

export function computeSafeViaRestSeconds(baseStaggerSeconds: number): {
  totalSeconds: number
  baseSeconds: number
  jitterSeconds: number
} {
  const baseSeconds = Math.max(18, Math.min(7200, Math.round(baseStaggerSeconds || 22)))
  if (baseSeconds >= 900) {
    const jitterSeconds = 45 + Math.floor(Math.random() * 120)
    return {
      totalSeconds: baseSeconds + jitterSeconds,
      baseSeconds,
      jitterSeconds,
    }
  }
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

export interface LocalBridgeProbeResult {
  online: boolean
  isDesktopApp: boolean
  app: string
  version: string
  extVersion?: string
}

export async function probeLocalDesktopBridge(timeoutMs = 1100): Promise<LocalBridgeProbeResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch('http://127.0.0.1:17890/health', {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) {
      return { online: false, isDesktopApp: false, app: '', version: '' }
    }
    const data = (await resp.json()) as Record<string, unknown>
    const app = typeof data.app === 'string' ? data.app : 'AdsOpsBatBridge'
    const version = typeof data.version === 'string' ? data.version : ''
    const extVersion = typeof data.extVersion === 'string' ? data.extVersion : undefined
    return {
      online: Boolean(data.ok),
      isDesktopApp: app === 'AdsOpsDesktop',
      app,
      version,
      extVersion,
    }
  } catch {
    return { online: false, isDesktopApp: false, app: '', version: '' }
  }
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
    `      Send-Json $res 200 '{"ok":true,"version":"2.9.1"}'`,
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
  viaId = '',
): Array<{ name: string; content: string }> {
  const parsed = parseProxyString(rawProxy)
  const hasProxy = Boolean(parsed?.host)

  const manifestObj = {
    manifest_version: 3,
    name: hasProxy
      ? `AdsOps Companion Pro · ${profileDir} · Proxy ${parsed!.host}:${parsed!.port}`
      : `AdsOps Companion Pro · ${profileDir} (${viaName})`,
    short_name: 'AdsOps Companion Pro',
    version: '2.9.1',
    description:
      'Tiện ích Quản lý TKQC & Hộ Chiếu Via v2.9.1 Pro: Đảo Ấm Cookie Sinh Học Đa Lộ Trình + Tự Dừng Nếu Văng Cookie, Full Auto-Pilot Tạo Fanpage giãn nhịp an toàn + Checkpoint Guard, Anti-Passkey, 2FA, WebRTC Lock & EAAB Token.',
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
    viaId,
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
  const passkeyShieldJs = `// AdsOps Companion Pro v2.9.1 — Anti-Passkey & Windows Hello Blocker (MAIN world @ document_start)
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
  chrome.storage.local.get(["viaId", "viaName", "profileCode", "viaTier", "twoFaSecret", "webrtcShield", "blockPasskey", "passkeyStatus", "proxyRaw", "proxyEnabled", "accounts"], (res) => {
    const init = {
      viaId: res.viaId || DEFAULT_STATE.viaId || "",
      viaName: res.viaName || DEFAULT_STATE.viaName,
      profileCode: res.profileCode || DEFAULT_STATE.profileCode,
      viaTier: res.viaTier || DEFAULT_STATE.viaTier,
      twoFaSecret: res.twoFaSecret ? res.twoFaSecret : DEFAULT_STATE.twoFaSecret,
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

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    chrome.storage.local.remove("adsops_ka_tab_" + tabId, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  const tabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
  const kaKey = tabId !== null ? "adsops_ka_tab_" + tabId : null;

  if (msg.type === "ADSOPS_CLOSE_CURRENT_TAB" && tabId !== null) {
    if (kaKey) {
      chrome.storage.local.remove(kaKey, () => {
        void chrome.runtime.lastError;
      });
    }
    chrome.tabs.remove(tabId, () => {
      void chrome.runtime.lastError;
      try { sendResponse({ ok: true }); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_KEEPALIVE_START" && kaKey) {
    const session = {
      steps: Array.isArray(msg.steps) && msg.steps.length ? msg.steps : ["feed", "notif"],
      stepIdx: 0,
      autoClose: Boolean(msg.autoClose),
      viaTier: msg.viaTier || "standard",
      viaLabel: msg.viaLabel || "",
      routeSummary: msg.routeSummary || "",
      startedAt: Date.now(),
      expiresAt: Date.now() + 240000
    };
    const obj = {};
    obj[kaKey] = session;
    chrome.storage.local.set(obj, () => {
      void chrome.runtime.lastError;
      try { sendResponse({ ok: true, session: session }); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_KEEPALIVE_SYNC" && kaKey) {
    chrome.storage.local.get([kaKey], (res) => {
      void chrome.runtime.lastError;
      const s = res ? res[kaKey] : null;
      if (!s || !s.expiresAt || Date.now() > Number(s.expiresAt)) {
        chrome.storage.local.remove(kaKey, () => {
          void chrome.runtime.lastError;
        });
        try { sendResponse({ active: false }); } catch (e) {}
        return;
      }
      try { sendResponse({ active: true, session: s }); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_KEEPALIVE_ADVANCE" && kaKey) {
    chrome.storage.local.get([kaKey], (res) => {
      void chrome.runtime.lastError;
      const s = res ? res[kaKey] : null;
      if (!s) {
        try { sendResponse({ ok: false }); } catch (e) {}
        return;
      }
      s.stepIdx = (Number(s.stepIdx) || 0) + 1;
      s.expiresAt = Date.now() + 180000;
      const obj = {};
      obj[kaKey] = s;
      chrome.storage.local.set(obj, () => {
        void chrome.runtime.lastError;
        try { sendResponse({ ok: true, session: s }); } catch (e) {}
      });
    });
    return true;
  }

  if (msg.type === "ADSOPS_KEEPALIVE_CLEAR") {
    const finalize = () => {
      if (msg.lastStatus && typeof msg.lastStatus === "object") {
        chrome.storage.local.set({ lastKeepAliveStatus: msg.lastStatus }, () => {
          void chrome.runtime.lastError;
          try { sendResponse({ ok: true }); } catch (e) {}
        });
      } else {
        try { sendResponse({ ok: true }); } catch (e) {}
      }
    };
    if (kaKey) {
      chrome.storage.local.remove(kaKey, () => {
        void chrome.runtime.lastError;
        finalize();
      });
    } else {
      finalize();
    }
    return true;
  }

  if (msg.type === "ADSOPS_REPORT_BROWSER_EVENT") {
    const rawPayload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
    chrome.storage.local.get(["viaId", "viaName", "profileCode", "viaTier"], (st) => {
      void chrome.runtime.lastError;
      const body = Object.assign({}, rawPayload, {
        via_id: rawPayload.via_id || (st && st.viaId) || "",
        via_label: rawPayload.via_label || (st && st.viaName) || "",
        browser_profile: rawPayload.browser_profile || (st && st.profileCode) || "",
        via_tier: rawPayload.via_tier || (st && st.viaTier) || "camp"
      });
      fetch("http://127.0.0.1:17890/browser-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
        .then((r) => r.json().catch(() => ({ ok: r.ok })))
        .then((d) => {
          try { sendResponse({ ok: true, data: d }); } catch (e) {}
        })
        .catch(() => {
          try { sendResponse({ ok: false, offline: true }); } catch (e) {}
        });
    });
    return true;
  }
});
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
      <span>AdsOps Companion v2.9.1 Pro</span>
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

  <!-- SECTION 4: COOKIE EXPORT/IMPORT, KEEP-ALIVE v2.9.1 & TOKEN EXTRACTOR -->
  <details class="card" style="cursor:pointer;">
    <summary class="section-title" style="margin-bottom:0;">4. 🍪 Cookie · ☕ Đảo Ấm v2.9.1 &amp; ⚡ Bắt Token EAAB</summary>
    <div style="margin-top:8px;">
      <div class="btn-row" style="margin-top:0; margin-bottom:6px;">
        <button id="btn-export-cookie" type="button" class="btn btn-primary">🍪 Chép Cookie FB</button>
        <button id="btn-extract-token" type="button" class="btn btn-emerald">⚡ Bắt Token EAAB</button>
      </div>
      <button id="btn-run-keepalive" type="button" class="btn" style="width:100%;margin-bottom:6px;border-color:rgba(245,158,11,0.55);color:#fcd34d;">☕ Đảo Ấm Cookie Như Người Thật (v2.9.1)</button>
      <div id="ka-last-status" style="margin-bottom:6px; font-size:10px; color:#94a3b8;"></div>
      <textarea id="cookie-box" rows="2" class="mono" placeholder="Dán Cookie JSON hoặc c_user=...; xs=... vào đây để đăng nhập Via không cần mật khẩu"></textarea>
      <div class="btn-row">
        <button id="btn-import-cookie" type="button" class="btn">📥 Nạp Cookie vào Chrome này</button>
      </div>
      <div class="btn-row">
        <button id="btn-vault-save" type="button" class="btn btn-emerald" title="Mã hóa DPAPI &amp; lưu Cookie + 2FA vào App Windows AdsOps Desktop Pro trên máy (không gửi lên Cloud)">🔐 Lưu vào Két App Win</button>
        <button id="btn-vault-load" type="button" class="btn btn-primary" title="Lấy Cookie + 2FA từ Két App Windows và nạp thẳng vào Chrome này">📥 Nạp từ Két App Win</button>
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

  const defaultViaMetaJson = JSON.stringify({
    viaId: String(viaId || ''),
    viaName: String(viaName || 'Via Facebook'),
    profileCode: String(profileDir || 'Default'),
    viaTier: String(viaTier || 'camp'),
    twoFaSecret: twoFaSecret.replace(/\s+/g, '').toUpperCase(),
  })

  const popupJs = `const DEFAULT_ACCOUNTS = ${JSON.stringify(bundledAccounts)};
const DEFAULT_VIA_META = ${defaultViaMetaJson};
let currentViaId = DEFAULT_VIA_META.viaId || "";
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

function applyRawCookiesToBrowser(raw) {
  let count = 0;
  const clean = String(raw || "").trim();
  if (!clean) return 0;
  if (clean.startsWith("[")) {
    const arr = JSON.parse(clean);
    if (Array.isArray(arr)) {
      arr.forEach((c) => {
        if (c && c.name && c.value) {
          chrome.cookies?.set({ url: "https://www.facebook.com", domain: ".facebook.com", name: String(c.name), value: String(c.value), path: "/" });
          count++;
        }
      });
    }
    return count;
  }
  clean.split(";").forEach((pair) => {
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
  return count;
}

document.getElementById("btn-import-cookie")?.addEventListener("click", () => {
  const statusEl = document.getElementById("cookie-status");
  const raw = (document.getElementById("cookie-box")?.value || "").trim();
  if (!raw) return;
  try {
    const count = applyRawCookiesToBrowser(raw);
    if (statusEl) {
      statusEl.style.color = "#34d399";
      statusEl.textContent = "✓ Đã nạp " + count + " Cookie! Hãy tải lại tab Facebook.";
    }
  } catch (e) {
    if (statusEl) {
      statusEl.style.color = "#fda4af";
      statusEl.textContent = "Lỗi định dạng Cookie.";
    }
  }
});

document.getElementById("btn-vault-save")?.addEventListener("click", () => {
  const statusEl = document.getElementById("cookie-status");
  const box = document.getElementById("cookie-box");
  chrome.cookies?.getAll({ domain: "facebook.com" }, async (cookies) => {
    const browserCookie = Array.isArray(cookies) && cookies.length > 0
      ? cookies.map((c) => c.name + "=" + c.value).join("; ")
      : "";
    const manualCookie = (box?.value || "").trim();
    const cookieRaw = browserCookie || manualCookie;
    if (browserCookie && box && !manualCookie) box.value = browserCookie;
    const sec = (twofaInput?.value || "").replace(/\\s+/g, "").toUpperCase();
    const vName = (viaInput?.value || DEFAULT_VIA_META.viaName || "Via Facebook").trim();
    const pCode = (profileInput?.value || DEFAULT_VIA_META.profileCode || "Default").trim();
    if (!cookieRaw && !sec) {
      if (statusEl) {
        statusEl.style.color = "#fbbf24";
        statusEl.textContent = "Chưa có Cookie Facebook hoặc Khóa 2FA để lưu.";
      }
      return;
    }
    try {
      const resp = await fetch("http://127.0.0.1:17890/local-vault/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          via_id: currentViaId || "",
          via_label: vName,
          profile_dir: pCode,
          cookie_raw: cookieRaw,
          two_fa_secret: sec
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        if (statusEl) {
          statusEl.style.color = "#34d399";
          statusEl.textContent = "🔐 Đã mã hóa DPAPI & lưu Cookie + 2FA vào Két App Windows!";
        }
      } else {
        if (statusEl) {
          statusEl.style.color = "#fda4af";
          statusEl.textContent = "Lỗi lưu Két App Windows.";
        }
      }
    } catch (e) {
      if (statusEl) {
        statusEl.style.color = "#fda4af";
        statusEl.textContent = "⚠️ Chưa bật App Windows AdsOps Desktop Pro (127.0.0.1:17890).";
      }
    }
  });
});

document.getElementById("btn-vault-load")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("cookie-status");
  const box = document.getElementById("cookie-box");
  const vName = (viaInput?.value || DEFAULT_VIA_META.viaName || "").trim();
  const pCode = (profileInput?.value || DEFAULT_VIA_META.profileCode || "Default").trim();
  try {
    const qs = new URLSearchParams({
      via_id: currentViaId || "",
      profile: pCode,
      name: vName
    });
    const resp = await fetch("http://127.0.0.1:17890/local-vault/get?" + qs.toString());
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      if (statusEl) {
        statusEl.style.color = "#fda4af";
        statusEl.textContent = "Không đọc được Két App Windows.";
      }
      return;
    }
    if (!data.found) {
      if (statusEl) {
        statusEl.style.color = "#fbbf24";
        statusEl.textContent = "Chưa có bản lưu Cookie/2FA cho Via này trong Két App Windows.";
      }
      return;
    }
    if (data.two_fa_secret) {
      if (twofaInput) twofaInput.value = data.two_fa_secret;
      chrome.storage?.local?.set({ twoFaSecret: data.two_fa_secret }, () => tickOtp());
    }
    if (data.cookie_raw) {
      if (box) box.value = data.cookie_raw;
      const n = applyRawCookiesToBrowser(data.cookie_raw);
      if (statusEl) {
        statusEl.style.color = "#34d399";
        statusEl.textContent = "✓ Đã nạp " + n + " Cookie" + (data.two_fa_secret ? " + 2FA" : "") + " từ Két App Windows! Hãy tải lại tab FB.";
      }
    } else if (data.two_fa_secret) {
      if (statusEl) {
        statusEl.style.color = "#34d399";
        statusEl.textContent = "✓ Đã nạp Khóa 2FA từ Két App Windows (chưa có Cookie lưu sẵn).";
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.style.color = "#fda4af";
      statusEl.textContent = "⚠️ Chưa bật App Windows AdsOps Desktop Pro (127.0.0.1:17890).";
    }
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
  chrome.storage.local.get(["viaId", "viaName", "profileCode", "viaTier", "twoFaSecret", "passkeyStatus", "proxyRaw", "proxyEnabled", "accounts", "lastKeepAliveStatus"], (res) => {
    currentViaId = res.viaId || DEFAULT_VIA_META.viaId || "";
    if (viaInput) viaInput.value = res.viaName || DEFAULT_VIA_META.viaName || "";
    if (profileInput) profileInput.value = res.profileCode || DEFAULT_VIA_META.profileCode || "Default";
    if (tierSelect) tierSelect.value = res.viaTier || DEFAULT_VIA_META.viaTier || "camp";
    if (twofaInput) twofaInput.value = res.twoFaSecret || DEFAULT_VIA_META.twoFaSecret || "";
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
    const kaEl = document.getElementById("ka-last-status");
    if (kaEl && res.lastKeepAliveStatus) {
      const st = res.lastKeepAliveStatus;
      if (st.state === "LOGGED_OUT") {
        kaEl.textContent = "⚠️ Cảnh báo: Via bị văng phiên đăng nhập — cần Nạp Cookie / Điền 2FA!";
        kaEl.style.color = "#fda4af";
      } else if (st.state === "CHALLENGE") {
        kaEl.textContent = "🛑 Tạm dừng đảo ấm do xác minh (" + (st.detail || "Checkpoint") + ")";
        kaEl.style.color = "#fda4af";
      } else if (st.state === "OK") {
        kaEl.textContent = "☕ Đã đảo ấm: " + (st.routeSummary || "Cookie khỏe");
        kaEl.style.color = "#6ee7b7";
      }
    }
    updateBadge(Boolean(res.proxyEnabled), res.proxyRaw || "");
    if (Array.isArray(res.accounts) && res.accounts.length > 0) {
      renderAccounts(res.accounts);
    }
    tickOtp();
  });
}

document.getElementById("btn-run-keepalive")?.addEventListener("click", () => {
  const tier = (tierSelect?.value === "vault") ? "vault" : "standard";
  const viaNm = (viaInput?.value || "Via").trim().slice(0, 50);
  chrome.tabs?.create({
    url: "https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_via_tier=" + encodeURIComponent(tier) + "&adsops_via_label=" + encodeURIComponent(viaNm)
  });
});

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
    'HƯỚNG DẪN CÀI ĐẶT TIỆN ÍCH GOOGLE CHROME (ADSOPS COMPANION v2.9.1 PRO - FULL AUTO PAGE + ANTI-PASSKEY)',
    '===================================================================================',
    'Bước 1: Giải nén file .zip này ra một thư mục cố định (ví dụ: Desktop\\AdsOps-Chrome-Extension).',
    'Bước 2: Mở trình duyệt Google Chrome của Via -> gõ vào thanh địa chỉ: chrome://extensions',
    'Bước 3: Bật công tắc "Chế độ dành cho nhà phát triển" (Developer mode) ở góc trên bên phải.',
    'Bước 4: Bấm nút "Tải tiện ích đã giải nén" (Load unpacked) ở góc trên bên trái -> Chọn thư mục vừa giải nén.',
    'Bước 5: Bấm biểu tượng mảnh ghép trên góc phải Chrome -> Bấm nút Ghim (Pin) cạnh "AdsOps Companion Pro".',
  ].join('\r\n')

  const contentJs = `// AdsOps Companion Pro v2.9.1 — Full Auto-Pilot Page Creator + Safety Guard + Anti-Passkey + HUD
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
  let autoCloseScheduled = false;
  let autoCloseCancelled = false;
  let warmupStarted = false;
  let keepAliveSyncChecked = false;
  let mediaUploadAttempted = false;
  let lastMediaAttachedAt = 0;

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

  function scheduleSafeTabAutoClose(delayMs) {
    if (pageAutoPilotHalted || autoCloseCancelled || autoCloseScheduled) return;
    if (detectSafetyChallenge() || detectLoggedOutSession()) return;
    autoCloseScheduled = true;
    const hud = document.getElementById("adsops-floating-hud");
    if (hud && !document.getElementById("adsops-hud-keep-tab")) {
      const keepBtn = document.createElement("button");
      keepBtn.id = "adsops-hud-keep-tab";
      keepBtn.textContent = "✋ Giữ tab";
      keepBtn.title = "Hủy tự động đóng Tab để tiếp tục xem trên trình duyệt này";
      keepBtn.style.cssText =
        "background:rgba(245,158,11,0.28);border:1px solid #fbbf24;color:#fef3c7;padding:2px 7px;border-radius:999px;cursor:pointer;font-size:10px;font-weight:800;";
      keepBtn.addEventListener("click", () => {
        autoCloseCancelled = true;
        keepBtn.remove();
        setHudPageStatus("✋ Đã giữ nguyên Tab theo yêu cầu của bạn", "#fde68a");
      });
      const closeBtn = document.getElementById("adsops-hud-close");
      if (closeBtn) {
        hud.insertBefore(keepBtn, closeBtn);
      } else {
        hud.appendChild(keepBtn);
      }
    }
    const secLeft = Math.max(4, Math.round((delayMs || 9000) / 1000));
    setHudPageStatus("🧹 Xong an toàn — Tự đóng Tab sau " + secLeft + "s (bấm Giữ tab nếu cần)", "#34d399");
    setTimeout(() => {
      if (pageAutoPilotHalted || autoCloseCancelled) return;
      if (detectSafetyChallenge() || detectLoggedOutSession()) return;
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "ADSOPS_CLOSE_CURRENT_TAB" });
      }
    }, delayMs || 9000);
  }

  function buildUniqueBrandPngFile(width, height, titleText, subText, isCover, fileName) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        const palettes = [
          ["#0f172a", "#1e3a8a", "#38bdf8"],
          ["#064e3b", "#047857", "#6ee7b7"],
          ["#3b0764", "#6d28d9", "#c4b5fd"],
          ["#7c2d12", "#c2410c", "#fdba74"],
          ["#111827", "#be123c", "#fda4af"],
          ["#164e63", "#0e7490", "#67e8f9"],
        ];
        const pal = palettes[Math.floor(Math.random() * palettes.length)];
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, pal[0]);
        grad.addColorStop(1, pal[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        ctx.globalAlpha = 0.14;
        ctx.fillStyle = pal[2];
        ctx.beginPath();
        ctx.arc(width * (0.2 + Math.random() * 0.2), height * 0.25, Math.min(width, height) * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(width * (0.75 + Math.random() * 0.15), height * 0.78, Math.min(width, height) * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        const cleanTitle = (titleText || "Brand Studio").trim();
        const words = cleanTitle.split(/\s+/).filter(Boolean);
        const initials = words.length >= 2
          ? (words[0][0] + words[1][0]).toUpperCase()
          : cleanTitle.slice(0, 2).toUpperCase();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#f8fafc";

        if (!isCover) {
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(width / 2, height * 0.44, 170, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = "800 150px system-ui, -apple-system, Segoe UI, sans-serif";
          ctx.fillText(initials, width / 2, height * 0.45);
          ctx.font = "700 34px system-ui, -apple-system, Segoe UI, sans-serif";
          ctx.fillText(cleanTitle.length > 26 ? cleanTitle.slice(0, 24) + "..." : cleanTitle, width / 2, height * 0.78);
        } else {
          ctx.font = "800 66px system-ui, -apple-system, Segoe UI, sans-serif";
          ctx.fillText(cleanTitle.length > 38 ? cleanTitle.slice(0, 36) + "..." : cleanTitle, width / 2, height * 0.44);
          ctx.globalAlpha = 0.88;
          ctx.font = "600 32px system-ui, -apple-system, Segoe UI, sans-serif";
          const catLine = (subText || "Thương hiệu chính hãng · Tư vấn tận tâm").split("(")[0].trim();
          ctx.fillText(catLine, width / 2, height * 0.63);
          ctx.globalAlpha = 1;
        }

        const imgData = ctx.getImageData(0, 0, Math.min(24, width), Math.min(24, height));
        for (let i = 0; i < 16; i++) {
          const pxIdx = (Math.floor(Math.random() * 256) % (imgData.data.length / 4)) * 4;
          imgData.data[pxIdx] = (imgData.data[pxIdx] + ((i % 3) + 1)) % 255;
          imgData.data[pxIdx + 1] = (imgData.data[pxIdx + 1] + ((i * 2 + 3) % 7)) % 255;
        }
        ctx.putImageData(imgData, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            resolve(new File([blob], fileName, { type: "image/png", lastModified: Date.now() }));
          },
          "image/png",
          0.95,
        );
      } catch (e) {
        resolve(null);
      }
    });
  }

  function tryAutoAttachUniqueMedia() {
    if (pageAutoPilotHalted || mediaUploadAttempted) return;
    let shouldUpload = false;
    let alreadyUploaded = false;
    let pName = "";
    let pCat = "";
    try {
      shouldUpload = sessionStorage.getItem("adsops_autopilot_upload") === "1";
      alreadyUploaded = sessionStorage.getItem("adsops_media_uploaded") === "1";
      pName = sessionStorage.getItem("adsops_autopilot_pname") || "";
      pCat = sessionStorage.getItem("adsops_autopilot_pcat") || "";
    } catch (e) {}
    if (!shouldUpload || alreadyUploaded) return;

    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((inp) => {
      const acc = (inp.getAttribute("accept") || "").toLowerCase();
      return !acc || acc.includes("image");
    });
    if (fileInputs.length === 0) return;

    mediaUploadAttempted = true;
    try { sessionStorage.setItem("adsops_media_uploaded", "1"); } catch (e) {}

    const assignFileToInput = (inp, file) => {
      if (!inp || !file || typeof DataTransfer === "undefined") return false;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch (e) {
        return false;
      }
    };

    const stamp = Math.floor(Date.now() % 100000);
    buildUniqueBrandPngFile(800, 800, pName || "Brand Page", pCat, false, "avatar-" + stamp + ".png").then((avFile) => {
      if (!avFile || pageAutoPilotHalted) return;
      assignFileToInput(fileInputs[0], avFile);
      lastMediaAttachedAt = Date.now();
      setHudPageStatus("🖼️ [Auto v2.9.1] Đã tự gắn Avatar độc bản (chống trùng Hash)...", "#38bdf8");

      if (fileInputs.length > 1) {
        setTimeout(() => {
          if (pageAutoPilotHalted) return;
          buildUniqueBrandPngFile(1640, 624, pName || "Brand Page", pCat, true, "cover-" + stamp + ".png").then((cvFile) => {
            if (!cvFile || pageAutoPilotHalted) return;
            assignFileToInput(fileInputs[1], cvFile);
            lastMediaAttachedAt = Date.now();
            setHudPageStatus("🖼️ [Auto v2.9.1] Đã tự gắn đủ Avatar + Cover độc bản!", "#34d399");
          });
        }, randDelay(950, 1550));
      }
    });
  }

  function detectLoggedOutSession() {
    const path = (window.location.pathname || "").toLowerCase();
    if (/^\\/login(?:\\.php|\\/|$)/.test(path) || path.startsWith("/recover")) {
      return "Màn hình đăng nhập (văng Cookie)";
    }
    const hasPass = Boolean(document.querySelector('input[name="pass"][type="password"]'));
    const hasLoginForm = Boolean(
      document.querySelector('form#login_form, #loginform, button[name="login"], input[name="email"]'),
    );
    if (hasPass && hasLoginForm) {
      return "Form đăng nhập FB (cần nạp lại Cookie / 2FA)";
    }
    return "";
  }

  function clearKeepAliveSessionBg(lastStatus) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: "ADSOPS_KEEPALIVE_CLEAR", lastStatus: lastStatus || null }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {}
    }
  }

  function reportBrowserEventBg(eventType, extra) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
      const data = extra && typeof extra === "object" ? extra : {};
      let draftId = "";
      let viaId = "";
      let pName = "";
      try {
        draftId = sessionStorage.getItem("adsops_draft_page_id") || "";
        viaId = sessionStorage.getItem("adsops_via_id") || "";
        pName = sessionStorage.getItem("adsops_autopilot_pname") || "";
      } catch (e) {}
      const dedupeSeed = [
        eventType,
        data.external_page_id || draftId || "",
        data.detail || data.route_summary || "",
      ].join("|");
      const dedupeKey = "adsops_ev_v29_" + dedupeSeed.slice(0, 120);
      try {
        if (sessionStorage.getItem(dedupeKey)) return;
        sessionStorage.setItem(dedupeKey, String(Date.now()));
      } catch (e) {}
      const payload = Object.assign(
        {
          event_type: eventType,
          page_id: draftId,
          via_id: viaId,
          page_name: pName,
          page_url: window.location.href,
        },
        data,
      );
      chrome.runtime.sendMessage({ type: "ADSOPS_REPORT_BROWSER_EVENT", payload: payload }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  function extractCreatedFacebookPageId() {
    try {
      const curHref = String(window.location.href || "");
      if (!curHref.includes("/pages/creation")) {
        const urlPats = [
          /[?&]id=(\\d{5,30})/i,
          /profile\\.php\\?id=(\\d{5,30})/i,
          /asset_id=(\\d{5,30})/i,
          /page_id=(\\d{5,30})/i,
          /facebook\\.com\\/(?:pages\\/[^\\/?#]+\\/)?(\\d{6,30})(?:[\\/?#]|$)/i,
        ];
        for (const pat of urlPats) {
          const m = curHref.match(pat);
          if (m && m[1]) return m[1];
        }
      }
      const links = document.querySelectorAll('a[href*="profile.php?id="], a[href*="asset_id="], a[href*="page_id="]');
      for (const a of links) {
        const h = a.getAttribute("href") || "";
        const m = h.match(/(?:profile\\.php\\?id=|asset_id=|page_id=)(\\d{6,30})/i);
        if (m && m[1]) return m[1];
      }
      const scripts = document.scripts || [];
      for (let i = 0; i < Math.min(scripts.length, 45); i += 1) {
        const txt = scripts[i] && scripts[i].textContent ? scripts[i].textContent : "";
        if (!txt || (!txt.includes("pageID") && !txt.includes("page_id") && !txt.includes("additional_profile_id") && !txt.includes("delegate_page"))) {
          continue;
        }
        const scPats = [
          /"pageID"\\s*:\\s*"(\\d{6,30})"/,
          /"page_id"\\s*:\\s*"(\\d{6,30})"/,
          /"additional_profile_id"\\s*:\\s*"(\\d{6,30})"/,
          /"delegate_page"\\s*:\\s*\\{\\s*"id"\\s*:\\s*"(\\d{6,30})"/,
        ];
        for (const pat of scPats) {
          const m = txt.match(pat);
          if (m && m[1]) return m[1];
        }
      }
    } catch (e) {}
    return "";
  }

  function tryReportCreatedPage(forceIfOffCreation) {
    try {
      const hrefNow = String(window.location.href || "");
      if (hrefNow.includes("/pages/creation")) return;
      const draftId = sessionStorage.getItem("adsops_draft_page_id") || "";
      const pNameSaved = sessionStorage.getItem("adsops_autopilot_pname") || "";
      if (!draftId && !pNameSaved) return;
      const extPid = extractCreatedFacebookPageId();
      if (extPid || forceIfOffCreation) {
        reportBrowserEventBg("PAGE_CREATED", {
          external_page_id: extPid,
          page_url: hrefNow,
          page_name: pNameSaved,
        });
      }
    } catch (e) {}
  }

  function haltForLoggedOutCookie(reason) {
    pageAutoPilotHalted = true;
    autoCloseCancelled = true;
    try {
      sessionStorage.removeItem("adsops_autopilot_until");
    } catch (e) {}
    clearKeepAliveSessionBg({ state: "LOGGED_OUT", detail: reason, at: new Date().toISOString() });
    reportBrowserEventBg("COOKIE_LOGGED_OUT", { detail: reason, page_url: window.location.href });
    setHudPageStatus("⚠️ [Văng Cookie] " + reason + " — Đã giữ nguyên Tab để bạn Nạp Cookie / Điền 2FA!", "#fbbf24");
  }

  function startBiometricReadingLoop(statusLabel) {
    setHudPageStatus(statusLabel, "#38bdf8");
    let stopped = false;
    let timerId = null;
    let downCount = 0;

    const tick = () => {
      if (stopped || pageAutoPilotHalted) return;
      const chLoop = detectSafetyChallenge();
      if (chLoop) {
        stopped = true;
        haltAutoPilotForSafety(chLoop);
        return;
      }
      const loLoop = detectLoggedOutSession();
      if (loLoop) {
        stopped = true;
        haltForLoggedOutCookie(loLoop);
        return;
      }

      let delta;
      let nextWait;
      if (downCount >= 2 && Math.random() < 0.22) {
        delta = -randDelay(85, 165);
        nextWait = randDelay(2600, 4600);
        downCount = 0;
      } else if (Math.random() < 0.42) {
        delta = randDelay(145, 265);
        nextWait = randDelay(1800, 3100);
        downCount += 1;
      } else {
        delta = randDelay(230, 450);
        nextWait = randDelay(3900, 7600);
        downCount += 1;
      }

      try {
        window.scrollBy({ top: delta, behavior: "smooth" });
      } catch (e) {
        window.scrollBy(0, delta);
      }
      timerId = setTimeout(tick, nextWait);
    };

    timerId = setTimeout(tick, randDelay(1200, 2300));
    return {
      stop: () => {
        stopped = true;
        if (timerId) clearTimeout(timerId);
      },
    };
  }

  const KA_STOPS = {
    feed: { label: "Newsfeed", url: "https://www.facebook.com/", minMs: 11000, maxMs: 16000 },
    notif: { label: "Thông báo", url: "https://www.facebook.com/notifications", minMs: 7500, maxMs: 11500 },
    pages: { label: "Quản lý Trang", url: "https://www.facebook.com/pages/?category=your_pages", minMs: 7500, maxMs: 11500 },
    profile: { label: "Trang cá nhân", url: "https://www.facebook.com/me", minMs: 7000, maxMs: 10500 },
    biz: { label: "Business Suite (BM)", url: "https://business.facebook.com/latest/home", minMs: 11500, maxMs: 15500 },
  };

  function pickFallbackKeepAliveSteps(tier) {
    const pool = ["notif", "pages", "profile"];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    if (tier === "vault" || tier === "veteran_xmdt") {
      return Math.random() < 0.65 ? ["feed", pool[0], "biz"] : ["feed", "biz", pool[0]];
    }
    return Math.random() < 0.55 ? ["feed", pool[0]] : ["feed", pool[0], pool[1]];
  }

  function runKeepAliveStep(session) {
    if (!session || pageAutoPilotHalted) return;
    setTimeout(() => {
      if (pageAutoPilotHalted) return;
      const chInit = detectSafetyChallenge();
      if (chInit) {
        haltAutoPilotForSafety(chInit);
        return;
      }
      const loInit = detectLoggedOutSession();
      if (loInit) {
        haltForLoggedOutCookie(loInit);
        return;
      }

      const steps = Array.isArray(session.steps) && session.steps.length ? session.steps : ["feed", "notif"];
      const idx = Math.max(0, Math.min(steps.length - 1, Number(session.stepIdx) || 0));
      const code = steps[idx] || "feed";
      const stopMeta = KA_STOPS[code] || KA_STOPS.feed;
      const waitMs = randDelay(stopMeta.minMs, stopMeta.maxMs);

      const reader = startBiometricReadingLoop(
        "☕ [Đảo Ấm v2.9.1 · Bước " + (idx + 1) + "/" + steps.length + "] Đang đọc " + stopMeta.label + " tự nhiên (" + Math.round(waitMs / 1000) + "s)..."
      );

      setTimeout(() => {
        reader.stop();
        if (pageAutoPilotHalted) return;
        const chEnd = detectSafetyChallenge();
        if (chEnd) {
          haltAutoPilotForSafety(chEnd);
          return;
        }
        const loEnd = detectLoggedOutSession();
        if (loEnd) {
          haltForLoggedOutCookie(loEnd);
          return;
        }

        if (idx + 1 < steps.length) {
          const nextCode = steps[idx + 1];
          const nextMeta = KA_STOPS[nextCode] || KA_STOPS.notif;
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: "ADSOPS_KEEPALIVE_ADVANCE" }, () => {
              void chrome.runtime.lastError;
              window.location.href = nextMeta.url;
            });
          } else {
            window.location.href = nextMeta.url;
          }
        } else {
          const summary = session.routeSummary || "Cookie khỏe";
          clearKeepAliveSessionBg({ state: "OK", routeSummary: summary, at: new Date().toISOString() });
          reportBrowserEventBg("KEEPALIVE_OK", {
            route_summary: summary,
            duration_sec: Math.max(15, Math.round((Date.now() - (Number(session.startedAt) || Date.now())) / 1000)),
          });
          setHudPageStatus("☕ [v2.9.1] Đã đảo ấm sinh học hoàn tất (" + summary + ")!", "#34d399");
          if (session.autoClose) {
            scheduleSafeTabAutoClose(randDelay(7500, 10500));
          }
        }
      }, waitMs);
    }, 950);
  }

  function handleSessionWarmupAndKeepAlive() {
    if (pageAutoPilotHalted || warmupStarted) return;
    let urlObj;
    try {
      urlObj = new URL(window.location.href);
    } catch (e) {
      return;
    }
    const isWarmupToCreate = urlObj.searchParams.get("adsops_warmup_to_create") === "1";
    const isKeepAliveStart = urlObj.searchParams.get("adsops_keepalive_session") === "1";

    if (isWarmupToCreate) {
      warmupStarted = true;
      setTimeout(() => {
        if (pageAutoPilotHalted) return;
        const chInit = detectSafetyChallenge();
        if (chInit) {
          haltAutoPilotForSafety(chInit);
          return;
        }
        const loInit = detectLoggedOutSession();
        if (loInit) {
          haltForLoggedOutCookie(loInit);
          return;
        }
        const waitMs = randDelay(12500, 17500);
        const reader = startBiometricReadingLoop("🌿 [Auto v2.9.1] Đang đọc lướt Newsfeed sinh học " + Math.round(waitMs / 1000) + "s trước khi tạo Page...");
        setTimeout(() => {
          reader.stop();
          if (pageAutoPilotHalted) return;
          const chEnd = detectSafetyChallenge();
          if (chEnd) {
            haltAutoPilotForSafety(chEnd);
            return;
          }
          const loEnd = detectLoggedOutSession();
          if (loEnd) {
            haltForLoggedOutCookie(loEnd);
            return;
          }
          urlObj.searchParams.delete("adsops_warmup_to_create");
          window.location.href = window.location.origin + "/pages/creation/?" + urlObj.searchParams.toString();
        }, waitMs);
      }, 900);
      return;
    }

    if (isKeepAliveStart) {
      warmupStarted = true;
      const wantClose = urlObj.searchParams.get("adsops_auto_close") !== "0";
      const viaTier = urlObj.searchParams.get("adsops_via_tier") || "standard";
      const viaLabel = urlObj.searchParams.get("adsops_via_label") || "";
      const rawRoute = (urlObj.searchParams.get("adsops_ka_route") || "")
        .split(",")
        .map((s) => s.trim())
        .filter((k) => Boolean(KA_STOPS[k]));
      const steps = rawRoute.length >= 2 ? rawRoute : pickFallbackKeepAliveSteps(viaTier);
      const routeSummary = steps.map((k) => (KA_STOPS[k] ? KA_STOPS[k].label : k)).join(" → ");
      const localSession = {
        steps: steps,
        stepIdx: 0,
        autoClose: wantClose,
        viaTier: viaTier,
        viaLabel: viaLabel,
        routeSummary: routeSummary,
      };
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: "ADSOPS_KEEPALIVE_START",
            steps: steps,
            autoClose: wantClose,
            viaTier: viaTier,
            viaLabel: viaLabel,
            routeSummary: routeSummary,
          },
          (res) => {
            void chrome.runtime.lastError;
            runKeepAliveStep((res && res.session) || localSession);
          },
        );
      } else {
        runKeepAliveStep(localSession);
      }
      return;
    }

    if (!keepAliveSyncChecked && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      keepAliveSyncChecked = true;
      try {
        chrome.runtime.sendMessage({ type: "ADSOPS_KEEPALIVE_SYNC" }, (res) => {
          void chrome.runtime.lastError;
          if (res && res.active && res.session && !warmupStarted && !pageAutoPilotHalted) {
            warmupStarted = true;
            runKeepAliveStep(res.session);
          }
        });
      } catch (e) {}
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
    autoCloseCancelled = true;
    try {
      sessionStorage.removeItem("adsops_autopilot_until");
    } catch (e) {}
    clearKeepAliveSessionBg({ state: "CHALLENGE", detail: reason, at: new Date().toISOString() });
    reportBrowserEventBg("SAFETY_CHALLENGE", { detail: reason, page_url: window.location.href });
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
    tryReportCreatedPage(false);
    if (!until || Date.now() > until) return;

    const challenge = detectSafetyChallenge();
    if (challenge) {
      haltAutoPilotForSafety(challenge);
      return;
    }

    tryAutoAttachUniqueMedia();
    if (lastMediaAttachedAt && Date.now() - lastMediaAttachedAt < 2800) return;

    const triggerFinishAutoClose = () => {
      tryReportCreatedPage(true);
      try {
        if (sessionStorage.getItem("adsops_autopilot_close") === "1" && !pageAutoPilotHalted) {
          scheduleSafeTabAutoClose(randDelay(8000, 11000));
        }
      } catch (e) {}
    };

    if (clicks >= 6) {
      tryReportCreatedPage(true);
      try { sessionStorage.removeItem("adsops_autopilot_until"); } catch (e) {}
      setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "✅ Đã tạo Fanpage & xong các bước tự động!", "#34d399");
      triggerFinishAutoClose();
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
      tryReportCreatedPage(true);
      try { sessionStorage.removeItem("adsops_autopilot_until"); } catch (e) {}
      setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "✅ Đã tạo & hoàn tất Fanpage tự động!", "#34d399");
      triggerFinishAutoClose();
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
    if (url.includes("adsops_warmup_to_create=1") || url.includes("adsops_keepalive_session=1")) return;
    if (!url.includes("/pages/creation") && !url.includes("adsops_page_name=")) return;
    try {
      const u = new URL(url);
      const pName = u.searchParams.get("adsops_page_name") || "";
      const pCat = u.searchParams.get("adsops_page_cat") || "";
      const pBio = u.searchParams.get("adsops_page_bio") || "";
      const batchStep = u.searchParams.get("adsops_batch_step") || "";
      const autoSubmit = u.searchParams.get("adsops_auto_submit") === "1";
      const autoUpload = u.searchParams.get("adsops_auto_upload") === "1";
      const autoClose = u.searchParams.get("adsops_auto_close") === "1";
      const draftPageId = u.searchParams.get("adsops_draft_page_id") || "";
      const viaIdParam = u.searchParams.get("adsops_via_id") || "";
      if (!pName && !pCat && !pBio) return;
      try {
        if (draftPageId) sessionStorage.setItem("adsops_draft_page_id", draftPageId);
        if (viaIdParam) sessionStorage.setItem("adsops_via_id", viaIdParam);
        if (pName) sessionStorage.setItem("adsops_autopilot_pname", pName);
        if (pCat) sessionStorage.setItem("adsops_autopilot_pcat", pCat);
      } catch (e) {}

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
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.9.1] Đang nhập tự nhiên theo nhịp người thật...", "#38bdf8");
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
          if (!createBtn.dataset.adsopsHooked) {
            createBtn.dataset.adsopsHooked = "1";
            createBtn.addEventListener("click", () => {
              try {
                sessionStorage.setItem("adsops_autopilot_until", String(Date.now() + 90000));
                sessionStorage.setItem("adsops_autopilot_started_at", String(Date.now()));
                sessionStorage.setItem("adsops_autopilot_clicks", "0");
                if (pName) sessionStorage.setItem("adsops_autopilot_pname", pName);
                if (draftPageId) sessionStorage.setItem("adsops_draft_page_id", draftPageId);
                if (viaIdParam) sessionStorage.setItem("adsops_via_id", viaIdParam);
              } catch (e) {}
            });
          }
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
          sessionStorage.setItem("adsops_autopilot_upload", autoUpload ? "1" : "0");
          sessionStorage.setItem("adsops_autopilot_close", autoClose ? "1" : "0");
          sessionStorage.setItem("adsops_autopilot_pname", pName || "");
          sessionStorage.setItem("adsops_autopilot_pcat", pCat || "");
          sessionStorage.setItem("adsops_media_uploaded", "0");
        } catch (e) {}
        createBtn.click();
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.9.1] Đã bấm Tạo Trang — Đang hoàn tất bước phụ...", "#38bdf8");
      };

      setTimeout(() => tryAutoClickCreate(true), tFinal);
    } catch (e) {}
  }

  setTimeout(() => {
    injectFloatingHud();
    handlePasskeyDom();
    handleSessionWarmupAndKeepAlive();
    handlePageCreationDom();
    handlePageOnboardingWizard();
  }, 900);
  setInterval(() => {
    scanBillingDom();
    handleSessionWarmupAndKeepAlive();
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
  viaId = '',
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
      viaId,
    ),
  )
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Chrome-Extension-v2.9.1-${slug}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface ViaExtensionBundleSpec {
  viaId?: string
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
    'TRON BO TIEN ICH ADSOPS COMPANION v2.9.1 PRO CHO TOAN BO DAN VIA',
    '================================================================',
    `Tong so thu muc Extension da dong goi: ${items.length} Via`,
    '',
    'Cach cai nhanh:',
    '1. Giai nen file .zip nay ra mot thu muc co dinh (VD: Desktop\AdsOps-Extensions-v2.9.1).',
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
        spec.viaId || '',
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
  a.download = `AdsOps-Tron-Bo-Extension-v2.9.1-${items.length}Via.zip`
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
