import type { FacebookIdentity } from './types'

export interface RealChromeProfile {
  folder: string
  name: string
  email: string
  gaia_name: string
  label: string
}

// Real Chrome profiles are read exclusively from the user's running Windows Local Bridge (:17890).
export const WORKSTATION_REAL_CHROME_PROFILES: RealChromeProfile[] = []

const BRIDGE_TOKEN_STORAGE_KEY = 'adsops_bridge_token'

export function getLocalBridgeToken(): string {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem(BRIDGE_TOKEN_STORAGE_KEY) || '').trim() : ''
  } catch {
    return ''
  }
}

export function setLocalBridgeToken(token: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    const clean = (token || '').trim()
    if (clean) localStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, clean)
    else localStorage.removeItem(BRIDGE_TOKEN_STORAGE_KEY)
  } catch {
    // Ignore restricted storage
  }
}

function buildWebBridgeHeaders(extra?: Record<string, string>): Record<string, string> {
  const tok = getLocalBridgeToken()
  return {
    ...(extra || {}),
    ...(tok ? { 'X-AdsOps-Bridge-Token': tok } : {}),
  }
}

export async function fetchRealLocalChromeProfiles(): Promise<RealChromeProfile[]> {
  try {
    const baseUrl = await resolveLocalBridgeBaseUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const resp = await fetch(`${baseUrl}/chrome-profiles`, {
      method: 'GET',
      headers: buildWebBridgeHeaders(),
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

  if (/\bguest\s*profile\b/i.test(raw)) {
    return 'Guest Profile'
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

export type WarmupMode = 'soak_72h' | 'human_organic' | 'bm_warmup' | 'pre_camp'

export interface HumanKeepAlivePlan {
  steps: string[]
  routeSummary: string
  estimatedSeconds: number
  normalizedTier: 'vault' | 'standard'
  mode: WarmupMode
}

const KEEPALIVE_STOP_META: Record<string, { label: string; sec: number }> = {
  feed: { label: 'Newsfeed', sec: 14 },
  watch: { label: 'Watch Video', sec: 13 },
  notif: { label: 'Thông báo', sec: 10 },
  pages: { label: 'Quản lý Trang', sec: 10 },
  profile: { label: 'Trang cá nhân', sec: 9 },
  biz: { label: 'Business Suite (BM)', sec: 14 },
}

export function planHumanKeepAliveRoute(
  viaTier?: string,
  mode: WarmupMode = 'human_organic',
): HumanKeepAlivePlan {
  const isVault = viaTier === 'vault' || viaTier === 'veteran_xmdt'
  const effectiveMode: WarmupMode = mode || 'human_organic'
  const pool = ['notif', 'watch', 'pages', 'profile']
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  let steps: string[]
  if (effectiveMode === 'soak_72h') {
    steps = ['feed', 'notif']
  } else if (effectiveMode === 'bm_warmup') {
    steps = ['feed', 'notif', 'biz']
  } else if (effectiveMode === 'pre_camp') {
    steps = ['feed', 'pages']
  } else if (isVault) {
    const sec = pool[0]
    steps = Math.random() < 0.65 ? ['feed', sec, 'biz'] : ['feed', 'biz', sec]
  } else {
    const count = Math.random() < 0.5 ? 1 : 2
    steps = ['feed', ...pool.slice(0, count)]
  }
  const routeSummary = steps.map((s) => KEEPALIVE_STOP_META[s]?.label || s).join(' → ')
  const estimatedSeconds = steps.reduce((acc, s) => acc + (KEEPALIVE_STOP_META[s]?.sec || 10), 0)
  return {
    steps,
    routeSummary,
    estimatedSeconds,
    normalizedTier: isVault ? 'vault' : 'standard',
    mode: effectiveMode,
  }
}

export function buildViaKeepAliveUrl(opts?: {
  autoCloseTab?: boolean
  viaLabel?: string
  viaTier?: string
  routeSteps?: string[]
  warmupMode?: WarmupMode
}): string {
  const normalizedTier = opts?.viaTier === 'vault' || opts?.viaTier === 'veteran_xmdt' ? 'vault' : 'standard'
  const effectiveMode: WarmupMode = opts?.warmupMode || 'human_organic'
  const steps =
    Array.isArray(opts?.routeSteps) && opts!.routeSteps.length >= 2
      ? opts!.routeSteps
      : planHumanKeepAliveRoute(opts?.viaTier, effectiveMode).steps
  const params = new URLSearchParams({
    adsops_keepalive_session: '1',
    adsops_auto_close: opts?.autoCloseTab === false ? '0' : '1',
    adsops_via_tier: normalizedTier,
    adsops_ka_mode: effectiveMode,
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

export const LOCAL_BRIDGE_CANDIDATE_PORTS = [17890, 17891, 17892, 17893, 17894] as const

export interface LocalBridgeProbeResult {
  online: boolean
  isDesktopApp: boolean
  app: string
  version: string
  extVersion?: string
  port?: number
}

let cachedBridgePort: number | null = null
let cachedBridgeAtMs = 0

export function resetLocalBridgePortCache(): void {
  cachedBridgePort = null
  cachedBridgeAtMs = 0
}

export async function probeLocalDesktopBridge(timeoutMs = 1100): Promise<LocalBridgeProbeResult> {
  const orderedPorts = cachedBridgePort
    ? [cachedBridgePort, ...LOCAL_BRIDGE_CANDIDATE_PORTS.filter((p) => p !== cachedBridgePort)]
    : [...LOCAL_BRIDGE_CANDIDATE_PORTS]

  for (const port of orderedPorts) {
    try {
      const controller = new AbortController()
      const perPortMs = Math.max(250, Math.min(timeoutMs, 650))
      const timer = setTimeout(() => controller.abort(), perPortMs)
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!resp.ok) {
        continue
      }
      const data = (await resp.json()) as Record<string, unknown>
      const app = typeof data.app === 'string' ? data.app : ''
      if (!data.ok || (app !== 'AdsOpsDesktop' && app !== 'AdsOpsBatBridge')) {
        continue
      }
      const version = typeof data.version === 'string' ? data.version : ''
      const extVersion = typeof data.extVersion === 'string' ? data.extVersion : undefined
      cachedBridgePort = port
      cachedBridgeAtMs = Date.now()
      return {
        online: true,
        isDesktopApp: app === 'AdsOpsDesktop',
        app,
        version,
        extVersion,
        port,
      }
    } catch {
      // Port not listening or timed out; try next candidate
    }
  }
  cachedBridgePort = null
  cachedBridgeAtMs = 0
  return { online: false, isDesktopApp: false, app: '', version: '' }
}

export async function resolveLocalBridgeBaseUrl(): Promise<string> {
  if (cachedBridgePort && Date.now() - cachedBridgeAtMs < 20_000) {
    return `http://127.0.0.1:${cachedBridgePort}`
  }
  const probe = await probeLocalDesktopBridge(700)
  return `http://127.0.0.1:${probe.port || 17890}`
}

export type AntidetectEngineKey =
  | 'chrome_native'
  | 'adspower'
  | 'dolphin_anty'
  | 'hidemyacc'
  | 'genlogin'
  | 'gologin'

export const ANTIDETECT_ENGINE_OPTIONS: Array<{ key: AntidetectEngineKey; label: string }> = [
  { key: 'chrome_native', label: 'Chrome Gốc (Khiên WebRTC)' },
  { key: 'adspower', label: 'AdsPower (:50325)' },
  { key: 'dolphin_anty', label: 'Dolphin{anty} (:3001)' },
  { key: 'hidemyacc', label: 'Hidemyacc (:12368)' },
  { key: 'genlogin', label: 'Genlogin (:55550)' },
  { key: 'gologin', label: 'GoLogin Orbita (:36912)' },
]

export function normalizeAntidetectEngine(raw?: string | null): AntidetectEngineKey {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'adspower') return 'adspower'
  if (s === 'dolphin' || s === 'dolphin_anty' || s === 'dolphin-anty') return 'dolphin_anty'
  if (s === 'hidemyacc') return 'hidemyacc'
  if (s === 'genlogin') return 'genlogin'
  if (s === 'gologin' || s === 'orbita') return 'gologin'
  return 'chrome_native'
}

export function getAntidetectEngineLabel(raw?: string | null): string {
  const k = normalizeAntidetectEngine(raw)
  return {
    chrome_native: 'Chrome Gốc',
    adspower: 'AdsPower',
    dolphin_anty: 'Dolphin{anty}',
    hidemyacc: 'Hidemyacc',
    genlogin: 'Genlogin',
    gologin: 'GoLogin',
  }[k]
}

export function parseAntidetectFromNotes(notesRaw?: string | null): {
  engine: AntidetectEngineKey
  profileId: string
  cleanNotes: string
} {
  const raw = String(notesRaw || '')
  const engM = raw.match(/\[ADENG:([a-z0-9_-]+)\]/i)
  const idM = raw.match(/\[ADID:([^\]]+)\]/i)
  const engine = normalizeAntidetectEngine(engM?.[1])
  const profileId = (idM?.[1] || '').trim()
  const cleanNotes = raw
    .replace(/\[ADENG:[a-z0-9_-]+\]/gi, '')
    .replace(/\[ADID:[^\]]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { engine, profileId, cleanNotes }
}

export function canMemberLaunchVia(
  userRole?: string | null,
  currentMemberId?: string | null,
  viaOwnerMemberId?: string | null,
): { allowed: boolean; reason: string } {
  const role = (userRole || '').trim().toLowerCase()
  if (role === 'viewer' || role === 'auditor') {
    return {
      allowed: false,
      reason: `Vai trò ${role} chỉ có quyền xem/kiểm toán, không được phép mở trình duyệt Via.`,
    }
  }
  const ownerId = (viaOwnerMemberId || '').trim()
  if (ownerId && role !== 'owner' && role !== 'admin') {
    if (!currentMemberId || ownerId.toLowerCase() !== currentMemberId.trim().toLowerCase()) {
      return {
        allowed: false,
        reason: 'Via này đã phân công riêng cho thành viên khác phụ trách.',
      }
    }
  }
  return { allowed: true, reason: '' }
}

export interface WorkstationMemoryTelemetry {
  total_physical_mb: number
  available_physical_mb: number
  memory_load_percent: number
  recommended_max_concurrent: number
}

export interface WorkstationSessionItem {
  session_id: string
  pid: number | null
  via_id: string
  via_label: string
  profile_dir: string
  alive: boolean
  ram_mb: number
  cpu_percent?: number
  antidetect_engine?: string
  status_text: string
}

export interface AntidetectBenchmarkItem {
  Online: boolean
  Engine: string
  BaseUrl: string
  Message: string
  ProfileCount: number
  LatencyMs: number
}

export async function fetchWorkstationTelemetry(timeoutMs = 1500): Promise<{
  ok: boolean
  active_count: number
  sessions: WorkstationSessionItem[]
  workstation_memory?: WorkstationMemoryTelemetry
}> {
  try {
    const baseUrl = await resolveLocalBridgeBaseUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(`${baseUrl}/chrome-sessions`, {
      method: 'GET',
      headers: buildWebBridgeHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return { ok: false, active_count: 0, sessions: [] }
    return (await resp.json()) as {
      ok: boolean
      active_count: number
      sessions: WorkstationSessionItem[]
      workstation_memory?: WorkstationMemoryTelemetry
    }
  } catch {
    return { ok: false, active_count: 0, sessions: [] }
  }
}

export async function fetchAntidetectBenchmark(timeoutMs = 7000): Promise<{
  ok: boolean
  recommended_engine: AntidetectEngineKey
  probes: AntidetectBenchmarkItem[]
  workstation_memory?: WorkstationMemoryTelemetry
} | null> {
  try {
    const baseUrl = await resolveLocalBridgeBaseUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(`${baseUrl}/antidetect/benchmark`, {
      method: 'GET',
      headers: buildWebBridgeHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return null
    return (await resp.json()) as {
      ok: boolean
      recommended_engine: AntidetectEngineKey
      probes: AntidetectBenchmarkItem[]
      workstation_memory?: WorkstationMemoryTelemetry
    }
  } catch {
    return null
  }
}

export async function launchInAssignedChromeProfile(
  targetUrl: string,
  browserProfileLabel?: string | null,
  viaLabel?: string | null,
  proxyLabel?: string | null,
  extra?: {
    viaId?: string | null
    antidetectEngine?: string | null
    antidetectProfileId?: string | null
  },
): Promise<'bridge' | 'protocol'> {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const nameHint = (browserProfileLabel || viaLabel || '').trim()
  const cleanProxy = (proxyLabel || '').trim()

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(targetUrl).catch(() => {})
  }

  try {
    const baseUrl = await resolveLocalBridgeBaseUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1400)
    const resp = await fetch(`${baseUrl}/open`, {
      method: 'POST',
      headers: buildWebBridgeHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        via_id: extra?.viaId || undefined,
        profile: profileDir,
        name: nameHint,
        proxy: cleanProxy,
        url: targetUrl,
        antidetect_engine: extra?.antidetectEngine || undefined,
        antidetect_profile_id: extra?.antidetectProfileId || undefined,
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
    `      Send-Json $res 200 '{"ok":true,"version":"2.9.6"}'`,
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

export interface ExtensionStewardshipMeta {
  clientGroup?: string
  warmupPhase?: string
  warmupStartIso?: string
  soakHoursRemaining?: number
  defaultWarmupMode?: WarmupMode
  soakQuarantineEnabled?: boolean
  ipKillSwitch?: boolean
  autoVaultCookieRefresh?: boolean
  cooldownUntilMs?: number
  cooldownReason?: string
  trustScore?: number
  bridgeToken?: string
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
  extraMeta?: ExtensionStewardshipMeta,
): Array<{ name: string; content: string }> {
  const parsed = parseProxyString(rawProxy)
  const hasProxy = Boolean(parsed?.host)
  const meta = extraMeta || {}
  const clientGroup = (meta.clientGroup || '').trim()
  const warmupPhase = meta.warmupPhase || 'trusted'
  const warmupStartIso = meta.warmupStartIso || ''
  const soakHoursRemaining = Number(meta.soakHoursRemaining || 0) || 0
  const defaultWarmupMode: WarmupMode = meta.defaultWarmupMode || (warmupPhase === '72h_lock' ? 'soak_72h' : 'human_organic')
  const soakQuarantineEnabled = meta.soakQuarantineEnabled !== false
  const ipKillSwitch = meta.ipKillSwitch !== false
  const autoVaultCookieRefresh = meta.autoVaultCookieRefresh !== false
  const cooldownUntilMs = Number(meta.cooldownUntilMs || 0) || 0
  const cooldownReason = (meta.cooldownReason || '').trim()
  const trustScore = Number.isFinite(meta.trustScore) ? Number(meta.trustScore) : (hasProxy ? 75 : 50)
  const bridgeToken = (meta.bridgeToken || getLocalBridgeToken() || '').trim()

  const manifestObj = {
    manifest_version: 3,
    name: hasProxy
      ? `AdsOps Companion Pro · ${profileDir} · Proxy ${parsed!.host}:${parsed!.port}`
      : `AdsOps Companion Pro · ${profileDir} (${viaName})`,
    short_name: 'AdsOps Companion Pro',
    version: '2.10.1',
    description:
      'Tiện ích Quản lý TKQC & Hộ Chiếu Via v2.10.1 Pro: Tự động sao lưu Cookie về Két DPAPI, Đa Engine Antidetect, Benchmark & Auto-Failover, Zero-Trust Bridge Token, IP-Timezone Guard, Ngâm 72h.',
    permissions: [
      'proxy',
      'privacy',
      'cookies',
      'storage',
      'tabs',
      'activeTab',
      'scripting',
      'alarms',
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
    clientGroup,
    warmupPhase,
    warmupStartIso,
    soakHoursRemaining,
    defaultWarmupMode,
    soakQuarantineEnabled,
    ipKillSwitch,
    autoVaultCookieRefresh,
    cooldownUntilMs,
    cooldownReason,
    trustScore,
    bridgeToken,
  })

  // Runs in MAIN world at document_start BEFORE Facebook's scripts load:
  // Completely blocks Windows Hello / WebAuthn / Passkey popup from ever appearing!
  const passkeyShieldJs = `// AdsOps Companion Pro v2.10.1 — Anti-Passkey & Windows Hello Blocker (MAIN world @ document_start)
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

function getBridgeHeaders(extraHeaders, cb) {
  chrome.storage.local.get(["bridgeToken", "bridgeTokenManual"], (bt) => {
    void chrome.runtime.lastError;
    const fb = typeof DEFAULT_STATE !== "undefined" ? DEFAULT_STATE : {};
    const tok = (bt && bt.bridgeTokenManual) || (fb && fb.bridgeToken) || (bt && bt.bridgeToken) || "";
    const out = Object.assign({}, extraHeaders || {});
    if (tok) out["X-AdsOps-Bridge-Token"] = String(tok).trim();
    cb(out);
  });
}

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

let lastVaultBootstrapAt = 0;
let vaultBootstrapInFlight = false;
let lastPassiveCookieHarvestAt = 0;

function parseAndSetFacebookCookies(raw) {
  let count = 0;
  const clean = String(raw || "").trim();
  if (!clean || !chrome.cookies || !chrome.cookies.set) return 0;
  if (clean.startsWith("[")) {
    try {
      const arr = JSON.parse(clean);
      if (Array.isArray(arr)) {
        arr.forEach((c) => {
          if (c && c.name && c.value) {
            chrome.cookies.set(
              {
                url: "https://www.facebook.com",
                domain: ".facebook.com",
                name: String(c.name),
                value: String(c.value),
                path: "/",
                secure: true
              },
              () => {
                void chrome.runtime.lastError;
              }
            );
            count++;
          }
        });
      }
      return count;
    } catch (e) {
      return 0;
    }
  }
  clean.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name && value) {
        chrome.cookies.set(
          {
            url: "https://www.facebook.com",
            domain: ".facebook.com",
            name: name,
            value: value,
            path: "/",
            secure: true
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
        count++;
      }
    }
  });
  return count;
}

function ensureVaultCookiesBootstrapped(force) {
  if (vaultBootstrapInFlight) return;
  const now = Date.now();
  if (!force && now - lastVaultBootstrapAt < 30000) return;
  if (!chrome.cookies || !chrome.cookies.getAll) return;

  vaultBootstrapInFlight = true;
  lastVaultBootstrapAt = now;

  chrome.cookies.getAll({ domain: "facebook.com" }, (cookies) => {
    void chrome.runtime.lastError;
    const hasUser = Array.isArray(cookies) && cookies.some((c) => c && c.name === "c_user" && c.value);
    if (hasUser) {
      vaultBootstrapInFlight = false;
      if (Date.now() - lastPassiveCookieHarvestAt > 600000) {
        lastPassiveCookieHarvestAt = Date.now();
        refreshVaultCookieToDesktop("passive_bootstrap", false);
      }
      return;
    }
    chrome.storage.local.get(["viaId", "viaName", "profileCode", "twoFaSecret"], async (st) => {
      void chrome.runtime.lastError;
      try {
        const viaId = (st && st.viaId) || DEFAULT_STATE.viaId || "";
        const vName = (st && st.viaName) || DEFAULT_STATE.viaName || "";
        const pCode = (st && st.profileCode) || DEFAULT_STATE.profileCode || "Default";
        const qs = new URLSearchParams({
          via_id: String(viaId || ""),
          profile: String(pCode || "Default"),
          name: String(vName || "")
        });
        const hdrs = await new Promise((resolve) => getBridgeHeaders({}, resolve));
        const resp = await fetch("http://127.0.0.1:17890/local-vault/get?" + qs.toString(), {
          cache: "no-store",
          headers: hdrs
        });
        if (!resp.ok) return;
        const payload = await resp.json().catch(() => null);
        if (!payload || !payload.ok || !payload.found) return;
        if (payload.two_fa_secret && (!st || !st.twoFaSecret)) {
          chrome.storage.local.set({ twoFaSecret: String(payload.two_fa_secret) }, () => {
            void chrome.runtime.lastError;
          });
        }
        if (payload.cookie_raw) {
          const injected = parseAndSetFacebookCookies(payload.cookie_raw);
          if (injected > 0) {
            chrome.storage.local.set(
              { lastVaultBootstrapStatus: { ok: true, count: injected, at: Date.now() } },
              () => {
                void chrome.runtime.lastError;
              }
            );
          }
        }
      } catch (e) {
        // Desktop bridge offline: bo qua im lang
      } finally {
        vaultBootstrapInFlight = false;
      }
    });
  });
}

let ipGuardInFlight = false;
let lastIpGuardAt = 0;
let ipLeakLockedAt = 0;
let proxyFailStreak = 0;

function reportBrowserEventToDesktop(rawPayload, sender, onDone) {
  chrome.storage.local.get(["viaId", "viaName", "profileCode", "viaTier"], (st) => {
    void chrome.runtime.lastError;
    const fb = typeof DEFAULT_STATE !== "undefined" ? DEFAULT_STATE : {};
    const body = Object.assign({}, rawPayload || {}, {
      via_id: (rawPayload && rawPayload.via_id) || (st && st.viaId) || fb.viaId || "",
      via_label: (rawPayload && rawPayload.via_label) || (st && st.viaName) || fb.viaName || "",
      browser_profile: (rawPayload && rawPayload.browser_profile) || (st && st.profileCode) || fb.profileCode || "",
      via_tier: (rawPayload && rawPayload.via_tier) || (st && st.viaTier) || fb.viaTier || "camp"
    });
    getBridgeHeaders({ "Content-Type": "application/json" }, (hdrs) => {
      fetch("http://127.0.0.1:17890/browser-event", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body)
      })
        .then((r) => r.json().catch(() => ({ ok: r.ok })))
        .then((d) => {
          if (d && d.close_sender_window && sender && sender.tab && typeof sender.tab.id === "number") {
            const sTabId = sender.tab.id;
            const sWinId = sender.tab.windowId;
            setTimeout(() => {
              if (typeof sWinId === "number") {
                chrome.tabs.query({ windowId: sWinId }, (winTabs) => {
                  void chrome.runtime.lastError;
                  if (Array.isArray(winTabs) && winTabs.length <= 2 && chrome.windows && chrome.windows.remove) {
                    chrome.windows.remove(sWinId, () => {
                      void chrome.runtime.lastError;
                    });
                  } else {
                    chrome.tabs.remove(sTabId, () => {
                      void chrome.runtime.lastError;
                    });
                  }
                });
              } else {
                chrome.tabs.remove(sTabId, () => {
                  void chrome.runtime.lastError;
                });
              }
            }, 600);
          }
          if (typeof onDone === "function") onDone({ ok: true, data: d });
        })
        .catch(() => {
          if (typeof onDone === "function") onDone({ ok: false, offline: true });
        });
    });
  });
}

function refreshVaultCookieToDesktop(source, force, onDone) {
  if (!chrome.cookies || !chrome.cookies.getAll) {
    if (typeof onDone === "function") onDone({ ok: false, reason: "no_cookies_api" });
    return;
  }
  chrome.storage.local.get(["viaId", "viaName", "profileCode", "autoVaultCookieRefresh"], (st) => {
    void chrome.runtime.lastError;
    const enabled = force || (st && st.autoVaultCookieRefresh !== undefined ? Boolean(st.autoVaultCookieRefresh) : true);
    if (!enabled) {
      if (typeof onDone === "function") onDone({ ok: false, skipped: true });
      return;
    }
    chrome.cookies.getAll({ domain: "facebook.com" }, async (cookies) => {
      void chrome.runtime.lastError;
      if (!Array.isArray(cookies) || !cookies.length) {
        if (typeof onDone === "function") onDone({ ok: false, reason: "empty" });
        return;
      }
      const hasUser = cookies.some((c) => c && c.name === "c_user" && c.value);
      const hasXs = cookies.some((c) => c && c.name === "xs" && c.value);
      if (!hasUser || !hasXs) {
        if (typeof onDone === "function") onDone({ ok: false, reason: "missing_session_cookies" });
        return;
      }
      const cookieRaw = cookies.map((c) => c.name + "=" + c.value).join("; ");
      const fb = typeof DEFAULT_STATE !== "undefined" ? DEFAULT_STATE : {};
      try {
        const hdrs = await new Promise((resolve) => getBridgeHeaders({ "Content-Type": "application/json" }, resolve));
        const resp = await fetch("http://127.0.0.1:17890/local-vault/save", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({
            via_id: (st && st.viaId) || fb.viaId || "",
            via_label: (st && st.viaName) || fb.viaName || "Via Facebook",
            profile_dir: (st && st.profileCode) || fb.profileCode || "Default",
            cookie_raw: cookieRaw,
            two_fa_secret: ""
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data && data.ok) {
          const tsIso = new Date().toISOString();
          chrome.storage.local.set({ lastVaultCookieRefreshAt: tsIso, lastVaultCookieRefreshSource: source || "auto" }, () => {
            void chrome.runtime.lastError;
          });
          if (typeof onDone === "function") onDone({ ok: true, count: cookies.length, refreshedAt: tsIso });
          return;
        }
      } catch (e) {}
      if (typeof onDone === "function") onDone({ ok: false, offline: true });
    });
  });
}

function buildIpLeakLockdownUrl(reason, liveIp) {
  const safeReason = String(reason || "Phát hiện rò rỉ IP Proxy").replace(/[<>]/g, "");
  const safeIp = String(liveIp || "Không rõ").replace(/[<>]/g, "");
  const html =
    '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>AdsOps Kill-Switch</title></head>' +
    '<body style="margin:0;background:#111827;color:#f8fafc;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">' +
    '<div style="max-width:520px;background:#1f2937;border:2px solid #f43f5e;border-radius:14px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,0.45);">' +
    '<h2 style="margin:0 0 8px 0;color:#fda4af;">🚨 ADSOPS KILL-SWITCH ĐÃ KHÓA PHIÊN</h2>' +
    '<p style="margin:0 0 10px 0;font-size:14px;line-height:1.5;color:#e2e8f0;">' + safeReason + '</p>' +
    '<div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;font-family:Consolas,monospace;font-size:12px;color:#fbbf24;margin-bottom:12px;">IP phát hiện: ' + safeIp + ' · Cooldown tự động: 24 giờ</div>' +
    '<p style="margin:0;font-size:12px;color:#94a3b8;">Hệ thống đã chặn toàn bộ tab Facebook để tránh Meta gắn cờ đổi IP / Checkpoint hàng loạt. Hãy kiểm tra lại Proxy trong Popup Extension hoặc AdsOps Desktop Pro trước khi mở lại.</p>' +
    '</div></body></html>';
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function triggerIpLeakLockdown(reason, liveIp) {
  const now = Date.now();
  if (ipLeakLockedAt && now - ipLeakLockedAt < 30000) return;
  ipLeakLockedAt = now;
  const cooldownUntilMs = now + 24 * 3600 * 1000;
  const statusObj = { state: "IP_LEAK", detail: reason, at: new Date().toISOString() };
  chrome.storage.local.set(
    {
      ipLeakHalted: true,
      ipLeakReason: reason,
      ipLeakAt: now,
      cooldownUntilMs: cooldownUntilMs,
      cooldownReason: reason,
      lastKeepAliveStatus: statusObj
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
  if (chrome.tabs && chrome.tabs.query && chrome.tabs.update) {
    const lockUrl = buildIpLeakLockdownUrl(reason, liveIp);
    chrome.tabs.query(
      { url: ["https://*.facebook.com/*", "https://business.facebook.com/*", "https://adsmanager.facebook.com/*"] },
      (tabs) => {
        void chrome.runtime.lastError;
        if (Array.isArray(tabs)) {
          tabs.forEach((t) => {
            if (t && typeof t.id === "number") {
              chrome.storage.local.remove("adsops_ka_tab_" + t.id, () => {
                void chrome.runtime.lastError;
              });
              chrome.tabs.update(t.id, { url: lockUrl }, () => {
                void chrome.runtime.lastError;
              });
            }
          });
        }
      }
    );
  }
  reportBrowserEventToDesktop({
    event_type: "IP_LEAK_BLOCKED",
    detail: reason + (liveIp ? " (IP: " + liveIp + ")" : "")
  });
}

function checkProxyIpLeakGuard(source, force, onDone) {
  if (ipGuardInFlight) {
    if (typeof onDone === "function") onDone({ ok: false, busy: true });
    return;
  }
  const now = Date.now();
  if (!force && now - lastIpGuardAt < 25000) {
    if (typeof onDone === "function") onDone({ ok: true, throttled: true });
    return;
  }
  if (typeof fetch !== "function") {
    if (typeof onDone === "function") onDone({ ok: false, reason: "no_fetch" });
    return;
  }

  ipGuardInFlight = true;
  lastIpGuardAt = now;

  chrome.storage.local.get(["proxyEnabled", "proxyRaw", "ipKillSwitch", "baselineDirectIp", "lastVerifiedProxyIp"], async (st) => {
    void chrome.runtime.lastError;
    try {
      const enabled = Boolean(st && st.proxyEnabled);
      const killSwitchOn = st && st.ipKillSwitch !== undefined ? Boolean(st.ipKillSwitch) : true;
      const parsed = enabled ? parseProxy((st && st.proxyRaw) || "") : null;

      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 6000);
      let liveIp = "";
      try {
        const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: ctrl.signal });
        clearTimeout(tmo);
        if (r && r.ok) {
          const d = await r.json().catch(() => null);
          liveIp = d && d.ip ? String(d.ip).trim() : "";
        }
      } catch (err) {
        clearTimeout(tmo);
        liveIp = "";
      }

      if (!enabled || !parsed) {
        proxyFailStreak = 0;
        if (liveIp && !enabled) {
          chrome.storage.local.set({ baselineDirectIp: liveIp }, () => {
            void chrome.runtime.lastError;
          });
        }
        if (typeof onDone === "function") onDone({ ok: true, proxyEnabled: false, liveIp });
        return;
      }

      if (!killSwitchOn) {
        proxyFailStreak = 0;
        if (typeof onDone === "function") onDone({ ok: true, killSwitch: false, liveIp });
        return;
      }

      if (!liveIp) {
        proxyFailStreak += 1;
        if (proxyFailStreak >= 2 && chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ url: ["https://*.facebook.com/*"] }, (fbTabs) => {
            void chrome.runtime.lastError;
            if (Array.isArray(fbTabs) && fbTabs.length > 0) {
              triggerIpLeakLockdown("Đứt kết nối Proxy IPv4 liên tiếp (" + parsed.host + ":" + parsed.port + ")", "");
            }
          });
        }
        if (typeof onDone === "function") onDone({ ok: false, liveIp: "", streak: proxyFailStreak });
        return;
      }

      proxyFailStreak = 0;
      const baseIp = (st && st.baselineDirectIp) ? String(st.baselineDirectIp).trim() : "";
      const verifiedProxyIp = (st && st.lastVerifiedProxyIp) ? String(st.lastVerifiedProxyIp).trim() : "";

      if (baseIp && liveIp === baseIp) {
        triggerIpLeakLockdown("Rò rỉ IP thật về mạng gốc (" + liveIp + ") khi đang bật Proxy " + parsed.host, liveIp);
        if (typeof onDone === "function") onDone({ ok: false, leaked: true, liveIp });
        return;
      }

      if (verifiedProxyIp && parsed.host === verifiedProxyIp && liveIp !== verifiedProxyIp) {
        triggerIpLeakLockdown("IP ra bị đổi bất thường từ " + verifiedProxyIp + " sang " + liveIp, liveIp);
        if (typeof onDone === "function") onDone({ ok: false, leaked: true, liveIp });
        return;
      }

      if (!verifiedProxyIp && (!baseIp || liveIp !== baseIp)) {
        chrome.storage.local.set({ lastVerifiedProxyIp: liveIp, ipLeakHalted: false }, () => {
          void chrome.runtime.lastError;
        });
      }
      if (typeof onDone === "function") onDone({ ok: true, leaked: false, liveIp, source });
    } finally {
      ipGuardInFlight = false;
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(
    [
      "viaId",
      "viaName",
      "profileCode",
      "viaTier",
      "twoFaSecret",
      "webrtcShield",
      "blockPasskey",
      "passkeyStatus",
      "proxyRaw",
      "proxyEnabled",
      "accounts",
      "clientGroup",
      "warmupPhase",
      "warmupStartIso",
      "soakHoursRemaining",
      "defaultWarmupMode",
      "soakQuarantineEnabled",
      "ipKillSwitch",
      "autoVaultCookieRefresh",
      "cooldownUntilMs",
      "cooldownReason",
      "trustScore"
    ],
    (res) => {
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
        accounts: Array.isArray(res.accounts) && res.accounts.length > 0 ? res.accounts : DEFAULT_STATE.accounts,
        clientGroup: res.clientGroup !== undefined ? res.clientGroup : (DEFAULT_STATE.clientGroup || ""),
        warmupPhase: res.warmupPhase || DEFAULT_STATE.warmupPhase || "trusted",
        warmupStartIso: res.warmupStartIso || DEFAULT_STATE.warmupStartIso || "",
        soakHoursRemaining: res.soakHoursRemaining !== undefined ? Number(res.soakHoursRemaining) : Number(DEFAULT_STATE.soakHoursRemaining || 0),
        defaultWarmupMode: res.defaultWarmupMode || DEFAULT_STATE.defaultWarmupMode || "human_organic",
        soakQuarantineEnabled: res.soakQuarantineEnabled !== undefined ? Boolean(res.soakQuarantineEnabled) : (DEFAULT_STATE.soakQuarantineEnabled !== false),
        ipKillSwitch: res.ipKillSwitch !== undefined ? Boolean(res.ipKillSwitch) : (DEFAULT_STATE.ipKillSwitch !== false),
        autoVaultCookieRefresh: res.autoVaultCookieRefresh !== undefined ? Boolean(res.autoVaultCookieRefresh) : (DEFAULT_STATE.autoVaultCookieRefresh !== false),
        cooldownUntilMs: res.cooldownUntilMs !== undefined ? Number(res.cooldownUntilMs) : Number(DEFAULT_STATE.cooldownUntilMs || 0),
        cooldownReason: res.cooldownReason !== undefined ? res.cooldownReason : (DEFAULT_STATE.cooldownReason || ""),
        trustScore: res.trustScore !== undefined ? Number(res.trustScore) : Number(DEFAULT_STATE.trustScore || 0),
        bridgeToken: DEFAULT_STATE.bridgeToken || res.bridgeToken || ""
      };
      chrome.storage.local.set(init, () => {
        applyProxyState(init);
        ensureVaultCookiesBootstrapped(true);
        checkProxyIpLeakGuard("install", false);
      });
    }
  );
  if (chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create("adsops_ip_guard", { periodInMinutes: 1 });
  }
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm && alarm.name === "adsops_ip_guard") {
    checkProxyIpLeakGuard("alarm", false);
  }
});

setInterval(() => {
  checkProxyIpLeakGuard("interval", false);
}, 38000);

chrome.runtime.onStartup?.addListener(() => {
  ensureVaultCookiesBootstrapped(true);
  checkProxyIpLeakGuard("startup", false);
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  const url = (changeInfo && changeInfo.url) || (tab && tab.url) || "";
  if (url && url.indexOf("facebook.com") !== -1 && (changeInfo.status === "loading" || Boolean(changeInfo.url))) {
    ensureVaultCookiesBootstrapped(false);
    checkProxyIpLeakGuard("nav", false);
  }
  if (url && url.indexOf("facebook.com") !== -1 && changeInfo.status === "complete") {
    if (Date.now() - lastPassiveCookieHarvestAt > 600000) {
      lastPassiveCookieHarvestAt = Date.now();
      refreshVaultCookieToDesktop("tab_complete", false);
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes && (changes.proxyRaw || changes.proxyEnabled)) {
      chrome.storage.local.remove(["lastVerifiedProxyIp", "ipLeakHalted"], () => {
        void chrome.runtime.lastError;
      });
    }
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
      kaMode: msg.kaMode || "human_organic",
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

  if (msg.type === "ADSOPS_GET_LOCAL_TOTP") {
    const computeLocalTotp = async (rawSecret) => {
      const clean = String(rawSecret || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
      if (clean.length < 8) return null;
      let bits = "";
      for (let i = 0; i < clean.length; i++) {
        const val = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(clean[i]);
        if (val >= 0) bits += val.toString(2).padStart(5, "0");
      }
      const bytes = new Uint8Array(Math.floor(bits.length / 8));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      }
      if (!bytes.length) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      const counter = Math.floor(nowSec / 30);
      const rem = 30 - (nowSec % 30);
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setUint32(0, Math.floor(counter / 0x100000000), false);
      view.setUint32(4, counter >>> 0, false);
      const key = await crypto.subtle.importKey("raw", bytes.buffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
      const offset = sig[sig.length - 1] & 0x0f;
      const bin = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
      const code = String(bin % 1000000).padStart(6, "0");
      return { ok: true, source: "local", code, formatted: code.slice(0, 3) + " " + code.slice(3), seconds_remaining: rem };
    };

    chrome.storage.local.get(["viaId", "viaName", "profileCode", "twoFaSecret"], async (st) => {
      void chrome.runtime.lastError;
      const fallbackState = typeof DEFAULT_STATE !== "undefined" ? DEFAULT_STATE : {};
      const viaId = (st && st.viaId) || fallbackState.viaId || "";
      const viaName = (st && st.viaName) || fallbackState.viaName || "";
      const profileCode = (st && st.profileCode) || fallbackState.profileCode || "";
      const localSecret = (st && st.twoFaSecret) || fallbackState.twoFaSecret || "";

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const qs = new URLSearchParams({ via_id: viaId, profile: profileCode, name: viaName }).toString();
        const hdrs = await new Promise((resolve) => getBridgeHeaders({}, resolve));
        const resp = await fetch("http://127.0.0.1:17890/totp?" + qs, { headers: hdrs, signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data && data.ok && data.found && data.code) {
            try { sendResponse({ ok: true, source: "desktop", code: data.code, formatted: data.formatted, seconds_remaining: data.seconds_remaining }); } catch (e) {}
            return;
          }
        }
      } catch (e) {}

      try {
        const localRes = await computeLocalTotp(localSecret);
        if (localRes) {
          try { sendResponse(localRes); } catch (e) {}
          return;
        }
      } catch (e) {}

      try { sendResponse({ ok: false, error: "Chua co Secret 2FA trong Ket Local hoac Extension." }); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_SYNC_BILLING") {
    const rawPayload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
    chrome.storage.local.get(["viaId", "viaName", "profileCode"], (st) => {
      void chrome.runtime.lastError;
      const body = Object.assign({}, rawPayload, {
        via_id: rawPayload.via_id || (st && st.viaId) || "",
        via_label: rawPayload.via_label || (st && st.viaName) || "",
        browser_profile: rawPayload.browser_profile || (st && st.profileCode) || ""
      });
      getBridgeHeaders({ "Content-Type": "application/json" }, (hdrs) => {
        fetch("http://127.0.0.1:17890/sync-billing", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify(body)
        })
          .then((r) => r.json().catch(() => ({ ok: r.ok })))
          .then((d) => {
            try { sendResponse(d); } catch (e) {}
          })
          .catch(() => {
            try { sendResponse({ ok: false }); } catch (e) {}
          });
      });
    });
    return true;
  }

  if (msg.type === "ADSOPS_AUTO_REFRESH_VAULT_COOKIE") {
    refreshVaultCookieToDesktop(msg.source || "manual_msg", Boolean(msg.force), (res) => {
      try { sendResponse(res); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_CHECK_IP_GUARD") {
    checkProxyIpLeakGuard("popup_check", true, (res) => {
      try { sendResponse(res); } catch (e) {}
    });
    return true;
  }

  if (msg.type === "ADSOPS_REPORT_BROWSER_EVENT") {
    const rawPayload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
    const evUpper = String(rawPayload.event_type || "").toUpperCase();
    if (evUpper === "KEEPALIVE_OK") {
      refreshVaultCookieToDesktop("keepalive_ok", false);
    } else if (evUpper === "SAFETY_CHALLENGE") {
      chrome.storage.local.set(
        {
          cooldownUntilMs: Date.now() + 24 * 3600 * 1000,
          cooldownReason: String(rawPayload.detail || "Phát hiện Checkpoint / CAPTCHA")
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }
    reportBrowserEventToDesktop(rawPayload, sender, (out) => {
      try { sendResponse(out); } catch (e) {}
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
  body { width: 432px; background: #0f172a; color: #f8fafc; padding: 12px; font-size: 12px; }
  .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #1e293b; gap: 6px; }
  .brand { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 13px; color: #f8fafc; }
  .logo { width: 22px; height: 22px; border-radius: 6px; background: #2563eb; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
  .status-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #3b82f6; background: rgba(37,99,235,0.18); color: #93c5fd; }
  .status-pill.active { border-color: #22c55e; background: rgba(34,197,94,0.18); color: #86efac; }
  .tabs-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 9px; background: #0b1120; padding: 4px; border-radius: 8px; border: 1px solid #1e293b; }
  .tab-btn { padding: 6px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: #94a3b8; font-weight: 700; font-size: 11px; cursor: pointer; transition: all 0.15s; }
  .tab-btn:hover { color: #e2e8f0; background: rgba(30,41,59,0.65); }
  .tab-btn.active { background: #1e293b; color: #f8fafc; border-color: #3b82f6; box-shadow: 0 2px 6px rgba(0,0,0,0.28); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
  .kpi-box { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; }
  .kpi-lbl { font-size: 10px; color: #94a3b8; }
  .kpi-val { font-size: 12px; font-weight: 800; color: #f8fafc; margin-top: 2px; font-family: ui-monospace, Consolas, monospace; }
  .acc-list { max-height: 165px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; }
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
  input[type="text"], select, textarea { width: 100%; border: 1px solid #475569; border-radius: 6px; padding: 5px 7px; font-size: 11.5px; color: #f8fafc; background: #0f172a; }
  .btn-row { display: flex; gap: 6px; margin-top: 6px; }
  .btn { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #f8fafc; font-weight: 600; font-size: 11px; cursor: pointer; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .btn:hover { background: #334155; }
  .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-emerald { background: #059669; border-color: #059669; color: #fff; }
  .btn-emerald:hover { background: #047857; }
  .btn-amber { background: rgba(217,119,6,0.22); border-color: rgba(245,158,11,0.55); color: #fcd34d; }
  .btn-amber:hover { background: rgba(217,119,6,0.36); }
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
  .meter-track { width: 100%; height: 7px; border-radius: 999px; background: #0f172a; border: 1px solid #334155; overflow: hidden; margin: 5px 0; }
  .meter-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2563eb, #10b981); width: 0%; transition: width 0.25s; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px dashed rgba(51,65,85,0.7); font-size: 11px; color: #e2e8f0; cursor: pointer; }
  .toggle-row:last-child { border-bottom: none; padding-bottom: 0; }
  .toggle-row input[type="checkbox"] { width: 15px; height: 15px; accent-color: #10b981; cursor: pointer; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <span class="logo">AO</span>
      <span>AdsOps Companion v2.10.1 Pro</span>
    </div>
    <div style="display:flex; align-items:center; gap:5px;">
      <span id="hdr-trust-badge" class="badge badge-ok" title="Điểm Tin Cậy Môi Trường">🛡️ --/100</span>
      <span id="proxy-badge" class="status-pill">MẠNG GỐC</span>
    </div>
  </div>

  <div class="tabs-nav">
    <button id="tab-btn-manage" type="button" class="tab-btn active">🛡️ Quản trị &amp; Két</button>
    <button id="tab-btn-auto" type="button" class="tab-btn">🤖 Automatic &amp; Nuôi</button>
  </div>

  <!-- TAB 1: QUAN TRI & KET -->
  <div id="tab-panel-manage" class="tab-panel active">
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

    <!-- SECTION 4: COOKIE EXPORT/IMPORT, DPAPI VAULT & TOKEN EXTRACTOR -->
    <details class="card" style="cursor:pointer;">
      <summary class="section-title" style="margin-bottom:0;">4. 🍪 Cookie · Két DPAPI &amp; ⚡ Bắt Token EAAB</summary>
      <div style="margin-top:8px;">
        <div class="btn-row" style="margin-top:0; margin-bottom:6px;">
          <button id="btn-export-cookie" type="button" class="btn btn-primary">🍪 Chép Cookie FB</button>
          <button id="btn-extract-token" type="button" class="btn btn-emerald">⚡ Bắt Token EAAB</button>
        </div>
        <button id="btn-jump-auto" type="button" class="btn btn-amber" style="width:100%; margin-bottom:6px;">🤖 Mở Tab Automatic &amp; Đảo Ấm Sinh Học v2.10.1 →</button>
        <textarea id="cookie-box" rows="2" class="mono" placeholder="Dán Cookie JSON hoặc c_user=...; xs=... vào đây để đăng nhập Via không cần mật khẩu"></textarea>
        <div class="btn-row">
          <button id="btn-import-cookie" type="button" class="btn">📥 Nạp Cookie vào Chrome này</button>
        </div>
        <div class="btn-row">
          <button id="btn-push-token-cloud" type="button" class="btn btn-primary" title="Tự động bắt Token EAAB trên tab Ads Manager / Meta Business (hoặc lấy từ ô phía trên) rồi đẩy thẳng lên Cloud qua AdsOps Desktop Pro">☁️ Đẩy Token EAAB lên Cloud</button>
        </div>
        <div class="btn-row">
          <button id="btn-vault-save" type="button" class="btn btn-emerald" title="Mã hóa DPAPI &amp; lưu Cookie + 2FA vào App Windows AdsOps Desktop Pro trên máy (không gửi lên Cloud)">🔐 Lưu vào Két App Win</button>
          <button id="btn-vault-load" type="button" class="btn btn-primary" title="Lấy Cookie + 2FA từ Két App Windows và nạp thẳng vào Chrome này">📥 Nạp từ Két App Win</button>
        </div>
        <div id="cookie-status" style="margin-top:4px; font-size:10.5px; color:#34d399;"></div>
        <div style="margin-top:6px; padding-top:6px; border-top:1px dashed #334155;">
          <div style="font-size:10px; color:#94a3b8; margin-bottom:4px;">🛡️ Mã Zero-Trust Bridge Token (tự điền khi mở từ App Windows):</div>
          <div style="display:flex; gap:5px;">
            <input id="bridge-token-input" type="text" class="mono" placeholder="Dán X-AdsOps-Bridge-Token nếu cài thủ công .zip" />
            <button id="btn-save-bridge-token" type="button" class="btn btn-primary" style="flex:0 0 76px;">Lưu Token</button>
          </div>
        </div>
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
  </div>

  <!-- TAB 2: AUTOMATIC & NUOI TRUST CHONG CHECKPOINT -->
  <div id="tab-panel-auto" class="tab-panel">
    <!-- TRUST SCORE & CLIENT SILO -->
    <div class="card">
      <div class="section-title">
        <span>1. 🛡️ Chỉ Số Tin Cậy Môi Trường &amp; Silo</span>
        <span id="auto-trust-score" class="mono" style="color:#34d399; font-weight:800;">-- / 100</span>
      </div>
      <div class="meter-track"><div id="auto-trust-bar" class="meter-fill"></div></div>
      <div id="auto-trust-detail" style="font-size:10.5px; color:#cbd5e1; margin-top:4px;">Đang đánh giá môi trường thiết bị...</div>
      <div style="display:flex; justify-content:space-between; gap:6px; margin-top:6px; padding-top:5px; border-top:1px dashed #334155; font-size:10px; color:#94a3b8;">
        <span id="auto-client-silo">Silo: Chưa gắn nhóm khách</span>
        <span id="auto-vault-refresh-at">Cookie Két: Chờ làm mới</span>
      </div>
    </div>

    <!-- 72H SOAK QUARANTINE & COOLDOWN -->
    <div class="card">
      <div class="section-title">
        <span>2. 🫧 Ngâm Thiết Bị Mới 72h &amp; Cooldown</span>
        <span id="auto-soak-badge" class="badge badge-ok">SẴN SÀNG</span>
      </div>
      <div class="meter-track"><div id="auto-soak-bar" class="meter-fill" style="background:linear-gradient(90deg,#f59e0b,#10b981);"></div></div>
      <div id="auto-soak-desc" style="font-size:10.5px; color:#cbd5e1;">Đang kiểm tra tuổi thiết bị Chrome / Proxy...</div>
      <div id="auto-cooldown-box" style="display:none; margin-top:7px; padding:7px 8px; border-radius:6px; background:rgba(244,63,94,0.16); border:1px solid rgba(244,63,94,0.45);">
        <div id="auto-cooldown-text" style="font-size:10.5px; color:#fecdd3; font-weight:700;">❄️ Via đang Cooldown bảo vệ</div>
        <button id="btn-clear-cooldown" type="button" class="btn btn-danger" style="margin-top:5px; width:100%;">🔓 Gỡ Cooldown Thủ Công</button>
      </div>
    </div>

    <!-- GEOIP & TIMEZONE GUARD -->
    <div class="card">
      <div class="section-title">
        <span>3. 🌍 Đối Chiếu GeoIP Proxy ↔ Múi Giờ/Ngôn Ngữ</span>
        <button id="btn-recheck-geo" type="button" class="btn" style="flex:0 0 auto; padding:2px 7px; font-size:10px;">🩺 Quét lại</button>
      </div>
      <div id="auto-geo-status" style="font-size:10.5px; color:#cbd5e1; line-height:1.4;">Đang đối chiếu IP ra với Múi giờ &amp; Ngôn ngữ trình duyệt...</div>
    </div>

    <!-- 4-MODE BIO WARMUP ENGINE -->
    <div class="card">
      <div class="section-title">
        <span>4. ☕ Automatic Đảo Ấm Sinh Học (4 Chế Độ)</span>
        <span style="font-size:9.5px; color:#fcd34d;">v2.10.1</span>
      </div>
      <select id="ka-mode-select" style="margin-bottom:6px; font-weight:600;">
        <option value="human_organic">☕ Đảo Ấm Sinh Học (Feed → Watch / Thông báo / Profile)</option>
        <option value="soak_72h">🫧 Ngâm Thiết Bị Mới &lt;72h (Chỉ Feed &amp; Thông báo thụ động)</option>
        <option value="bm_warmup">🏢 Vào BM An Toàn (Lướt Feed &amp; Thông báo trước BM)</option>
        <option value="pre_camp">🚀 Khởi Động Trước Tạo Page / Lên Camp</option>
      </select>
      <button id="btn-run-keepalive" type="button" class="btn btn-amber" style="width:100%; margin-bottom:5px;">☕ Chạy Đảo Ấm Ngay (Theo Chế Độ Đã Chọn)</button>
      <button id="btn-open-bm-safe" type="button" class="btn btn-emerald" style="width:100%; margin-bottom:5px;">🏢 Vào BM An Toàn (Chống Deep-Link)</button>
      <div id="ka-last-status" style="font-size:10px; color:#94a3b8; line-height:1.35;">Chưa có phiên Đảo Ấm gần đây.</div>
    </div>

    <!-- 3 AUTO PROTECTION SHIELDS -->
    <div class="card" style="margin-bottom:2px;">
      <div class="section-title">
        <span>5. 🔐 Công Tắc Khiên Bảo Vệ Tự Động</span>
      </div>
      <label class="toggle-row">
        <span>🚨 Kill-Switch Chống Rò Rỉ IP Proxy (38s + Tab)</span>
        <input id="chk-ip-killswitch" type="checkbox" checked />
      </label>
      <label class="toggle-row">
        <span>⏳ Khóa Tạo Page Tự Động Khi Ngâm &lt; 72h</span>
        <input id="chk-soak-lock" type="checkbox" checked />
      </label>
      <label class="toggle-row">
        <span>🔄 Tự Lưu Cookie Tươi Vào Két DPAPI Sau Đảo Ấm</span>
        <input id="chk-auto-vault-cookie" type="checkbox" checked />
      </label>
    </div>
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
    clientGroup,
    warmupPhase,
    warmupStartIso,
    soakHoursRemaining,
    defaultWarmupMode,
    soakQuarantineEnabled,
    ipKillSwitch,
    autoVaultCookieRefresh,
    cooldownUntilMs,
    cooldownReason,
    trustScore,
    bridgeToken,
  })

  const popupJs = `const DEFAULT_ACCOUNTS = ${JSON.stringify(bundledAccounts)};
const DEFAULT_VIA_META = ${defaultViaMetaJson};
let currentViaId = DEFAULT_VIA_META.viaId || "";
const viaInput = document.getElementById("via-name");
const profileInput = document.getElementById("profile-code");
const tierSelect = document.getElementById("via-tier");
const twofaInput = document.getElementById("twofa-secret");
const proxyInput = document.getElementById("proxy-raw");
const bridgeTokenInput = document.getElementById("bridge-token-input");
const badge = document.getElementById("proxy-badge");
const passkeyBadge = document.getElementById("passkey-badge");
const saveMsg = document.getElementById("save-msg");
const liveIp = document.getElementById("live-ip");
const otpCodeEl = document.getElementById("otp-code");
const otpTimerEl = document.getElementById("otp-timer");
let currentOtpRaw = "";

async function getPopupBridgeHeaders(extraHeaders) {
  const out = Object.assign({}, extraHeaders || {});
  let tok = (bridgeTokenInput && bridgeTokenInput.value ? bridgeTokenInput.value.trim() : "") || "";
  if (!tok && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const st = await new Promise((resolve) => {
        chrome.storage.local.get(["bridgeToken", "bridgeTokenManual"], (r) => resolve(r || {}));
      });
      tok = (st && st.bridgeTokenManual) || (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.bridgeToken : "") || (st && st.bridgeToken) || "";
    } catch (e) {}
  }
  if (!tok) {
    tok = (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.bridgeToken : "") || "";
  }
  if (tok) out["X-AdsOps-Bridge-Token"] = String(tok).trim();
  return out;
}

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

let _desktopTotpCache = null;
let _lastDesktopTotpFetch = 0;

async function tickOtp() {
  const sec = (twofaInput?.value || "").trim();
  const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (otpTimerEl) otpTimerEl.textContent = rem + "s";
  if (!sec) {
    const nowMs = Date.now();
    if (!_desktopTotpCache || nowMs - _lastDesktopTotpFetch > 5000) {
      _lastDesktopTotpFetch = nowMs;
      try {
        const qs = new URLSearchParams({
          via_id: typeof currentViaId !== "undefined" ? currentViaId : "",
          profile: (typeof profileInput !== "undefined" ? profileInput?.value : "") || "",
          name: (typeof viaInput !== "undefined" ? viaInput?.value : "") || ""
        }).toString();
        const r = await fetch("http://127.0.0.1:17890/totp?" + qs, {
          headers: await getPopupBridgeHeaders()
        });
        if (r.ok) {
          const d = await r.json();
          if (d && d.ok && d.found && d.code) {
            _desktopTotpCache = { code: d.code, formatted: d.formatted, fetchedAt: nowMs, rem: d.seconds_remaining || rem };
          }
        }
      } catch (e) {}
    }
    if (_desktopTotpCache && nowMs - _desktopTotpCache.fetchedAt < 25000) {
      currentOtpRaw = _desktopTotpCache.code;
      if (otpCodeEl) otpCodeEl.textContent = _desktopTotpCache.formatted || currentOtpRaw;
      const calcRem = Math.max(1, _desktopTotpCache.rem - Math.floor((nowMs - _desktopTotpCache.fetchedAt) / 1000));
      if (otpTimerEl) otpTimerEl.textContent = calcRem + "s (Két)";
      return;
    }
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
      const hdrs = await getPopupBridgeHeaders({ "Content-Type": "application/json" });
      const resp = await fetch("http://127.0.0.1:17890/local-vault/save", {
        method: "POST",
        headers: hdrs,
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
          statusEl.textContent = resp.status === 401 ? "⚠️ Sai / thiếu Zero-Trust Bridge Token." : "Lỗi lưu Két App Windows.";
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
    const resp = await fetch("http://127.0.0.1:17890/local-vault/get?" + qs.toString(), {
      headers: await getPopupBridgeHeaders()
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      if (statusEl) {
        statusEl.style.color = "#fda4af";
        statusEl.textContent = resp.status === 401 ? "⚠️ Sai / thiếu Zero-Trust Bridge Token." : "Không đọc được Két App Windows.";
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

document.getElementById("btn-push-token-cloud")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("cookie-status");
  const box = document.getElementById("cookie-box");
  const typed = (box?.value || "").trim();
  let tok = typed.startsWith("EAA") && typed.length >= 40 ? typed : "";

  if (!tok && chrome.tabs && chrome.scripting) {
    tok = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (!tabId) {
          resolve("");
          return;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: () => {
              const html = document.documentElement.innerHTML;
              const m = html.match(/EAA[A-Za-z0-9]{40,350}/);
              return m ? m[0] : "";
            }
          },
          (results) => {
            void chrome.runtime.lastError;
            resolve(results?.[0]?.result || "");
          }
        );
      });
    });
  }

  if (!tok) {
    if (statusEl) {
      statusEl.style.color = "#fbbf24";
      statusEl.textContent = "Hãy dán Token EAAB vào ô trên hoặc mở tab Ads Manager / BM rồi bấm lại.";
    }
    return;
  }

  if (box) box.value = tok;
  if (statusEl) {
    statusEl.style.color = "#93c5fd";
    statusEl.textContent = "⏳ Đang đẩy Token EAAB lên AdsOps Cloud...";
  }

  const vName = (viaInput?.value || (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.viaName : "") || "Via Facebook").trim();
  const pCode = (profileInput?.value || (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.profileCode : "") || "Default").trim();

  try {
    const hdrs = await getPopupBridgeHeaders({ "Content-Type": "application/json" });
    const resp = await fetch("http://127.0.0.1:17890/auto-connect-token", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        access_token: tok,
        browser_profile_label: pCode || vName,
        via_label: vName,
        via_id: typeof currentViaId !== "undefined" ? currentViaId : ""
      })
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok && d.ok) {
      if (statusEl) {
        statusEl.style.color = "#34d399";
        statusEl.textContent = "☁️ Đã đẩy Token lên Cloud thành công!" + (d.label ? " (" + d.label + ")" : "");
      }
    } else {
      if (statusEl) {
        statusEl.style.color = "#fda4af";
        statusEl.textContent = d.error || ("Không đẩy được Token lên Cloud (HTTP " + resp.status + ").");
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.style.color = "#fda4af";
      statusEl.textContent = "⚠️ Chưa bật App Windows AdsOps Desktop Pro (127.0.0.1:17890).";
    }
  }
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

function switchPopupTab(tabName) {
  const isAuto = tabName === "auto";
  const btnM = document.getElementById("tab-btn-manage");
  const btnA = document.getElementById("tab-btn-auto");
  const panelM = document.getElementById("tab-panel-manage");
  const panelA = document.getElementById("tab-panel-auto");
  if (btnM) btnM.classList.toggle("active", !isAuto);
  if (btnA) btnA.classList.toggle("active", isAuto);
  if (panelM) panelM.classList.toggle("active", !isAuto);
  if (panelA) panelA.classList.toggle("active", isAuto);
}

document.getElementById("tab-btn-manage")?.addEventListener("click", () => switchPopupTab("manage"));
document.getElementById("tab-btn-auto")?.addEventListener("click", () => switchPopupTab("auto"));
document.getElementById("btn-jump-auto")?.addEventListener("click", () => switchPopupTab("auto"));

function computeSoakMetrics(st) {
  const iso = (st && st.warmupStartIso) || (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.warmupStartIso : "") || "";
  const phaseRaw = (st && st.warmupPhase) || (typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META.warmupPhase : "trusted") || "trusted";
  let ageHours = 72;
  if (iso) {
    const parsedMs = Date.parse(iso);
    if (!Number.isNaN(parsedMs)) {
      ageHours = Math.max(0, (Date.now() - parsedMs) / 3600000);
    }
  } else if (phaseRaw === "72h_lock") {
    const rem = Number((st && st.soakHoursRemaining) || DEFAULT_VIA_META.soakHoursRemaining || 48);
    ageHours = Math.max(0, 72 - rem);
  }
  const remHours = iso ? Math.max(0, 72 - ageHours) : (phaseRaw === "72h_lock" ? Number((st && st.soakHoursRemaining) || DEFAULT_VIA_META.soakHoursRemaining || 48) : 0);
  const inSoak = remHours > 0 || phaseRaw === "72h_lock";
  return { inSoak, ageHours: Math.round(ageHours), remHours: Math.ceil(remHours), phase: phaseRaw };
}

function renderStewardshipPanel(st) {
  const s = st || {};
  const fb = typeof DEFAULT_VIA_META !== "undefined" ? DEFAULT_VIA_META : {};
  const proxyOn = Boolean(s.proxyEnabled && s.proxyRaw);
  const twoFaOk = Boolean((s.twoFaSecret || fb.twoFaSecret || "").trim());
  const soak = computeSoakMetrics(s);
  const now = Date.now();
  const cdUntil = Number(s.cooldownUntilMs || 0);
  const inCd = cdUntil > now;
  const leakHalted = Boolean(s.ipLeakHalted);
  const killOn = s.ipKillSwitch !== undefined ? Boolean(s.ipKillSwitch) : (fb.ipKillSwitch !== false);

  let score = Number(s.trustScore || fb.trustScore || 0);
  if (!score) {
    score = (proxyOn ? 25 : 0) + (soak.inSoak ? 10 : 25) + 15 + (twoFaOk ? 15 : 5) + (inCd || leakHalted ? 0 : 20);
  } else if (inCd || leakHalted) {
    score = Math.max(15, score - 25);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const hdrBadge = document.getElementById("hdr-trust-badge");
  const scoreEl = document.getElementById("auto-trust-score");
  const barEl = document.getElementById("auto-trust-bar");
  const detailEl = document.getElementById("auto-trust-detail");
  const siloEl = document.getElementById("auto-client-silo");
  const refreshEl = document.getElementById("auto-vault-refresh-at");

  if (hdrBadge) {
    hdrBadge.textContent = "🛡️ " + score + "/100";
    hdrBadge.className = "badge " + (score >= 80 ? "badge-ok" : score >= 55 ? "badge-warn" : "badge-err");
  }
  if (scoreEl) {
    scoreEl.textContent = score + " / 100";
    scoreEl.style.color = score >= 80 ? "#34d399" : score >= 55 ? "#fbbf24" : "#fda4af";
  }
  if (barEl) {
    barEl.style.width = score + "%";
  }
  if (detailEl) {
    const parts = [];
    parts.push(proxyOn ? "Proxy: Đã bọc" : "Mạng gốc (-25đ)");
    parts.push(soak.inSoak ? "Ngâm <72h (-15đ)" : "Thiết bị >=72h");
    parts.push(killOn ? "Kill-Switch BẬT" : "Kill-Switch TẮT");
    detailEl.textContent = parts.join(" · ");
  }
  const grp = (s.clientGroup || fb.clientGroup || "").trim();
  if (siloEl) siloEl.textContent = grp ? "Silo: " + grp : "Silo: Dùng chung Workspace";
  if (refreshEl) {
    if (s.lastVaultCookieRefreshAt) {
      const dt = new Date(s.lastVaultCookieRefreshAt);
      refreshEl.textContent = "Cookie Két: " + dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    } else {
      refreshEl.textContent = "Cookie Két: Sẵn sàng";
    }
  }

  const soakBadge = document.getElementById("auto-soak-badge");
  const soakBar = document.getElementById("auto-soak-bar");
  const soakDesc = document.getElementById("auto-soak-desc");
  const pct = soak.inSoak ? Math.max(8, Math.min(99, Math.round(((72 - soak.remHours) / 72) * 100))) : 100;
  if (soakBar) soakBar.style.width = pct + "%";
  if (soakBadge) {
    if (soak.inSoak) {
      soakBadge.textContent = "NGÂM CÒN " + soak.remHours + "H";
      soakBadge.className = "badge badge-warn";
    } else {
      soakBadge.textContent = "ĐỦ 72H TRUSTED";
      soakBadge.className = "badge badge-ok";
    }
  }
  if (soakDesc) {
    soakDesc.textContent = soak.inSoak
      ? "Thiết bị/Proxy mới đang ở vùng ngâm (" + pct + "%). Khuyến nghị chỉ Đảo Ấm thụ động, hạn chế tạo Page/đổi BM."
      : "Thiết bị đã qua 72h làm quen IP/Profile. Đủ điều kiện chạy Đảo Ấm & BM/Tạo Page giãn nhịp.";
  }

  const cdBox = document.getElementById("auto-cooldown-box");
  const cdText = document.getElementById("auto-cooldown-text");
  if (cdBox && cdText) {
    if (inCd || leakHalted) {
      const minsLeft = Math.max(1, Math.round((cdUntil - now) / 60000));
      const hrsLeft = (minsLeft / 60).toFixed(1);
      cdText.textContent =
        (leakHalted ? "🚨 Đã khóa Kill-Switch IP: " : "❄️ Đang Cooldown: ") +
        (s.cooldownReason || s.ipLeakReason || "Bảo vệ chống Checkpoint") +
        (inCd ? " (còn ~" + hrsLeft + "h)" : "");
      cdBox.style.display = "block";
    } else {
      cdBox.style.display = "none";
    }
  }
}

function recheckGeoAlignment() {
  const geoEl = document.getElementById("auto-geo-status");
  if (!geoEl) return;
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const navLang = navigator.language || "en-US";
  geoEl.textContent = "⏳ Đang đối chiếu IP ra với múi giờ " + localTz + "...";
  geoEl.style.color = "#93c5fd";

  fetch("https://ipwho.is/")
    .then((r) => r.json())
    .then((d) => {
      if (!d || d.success === false || !d.ip) throw new Error("ipwho fallback");
      const ipTz = (d.timezone && d.timezone.id) ? String(d.timezone.id) : "";
      const cc = String(d.country_code || "");
      const city = String(d.city || "");
      const tzMatch = !ipTz || ipTz.toLowerCase() === localTz.toLowerCase() || (cc === "VN" && localTz === "Asia/Ho_Chi_Minh");
      if (tzMatch) {
        geoEl.style.color = "#6ee7b7";
        geoEl.textContent = "✅ Khớp môi trường: IP " + d.ip + " (" + city + ", " + cc + ") · Múi giờ " + (ipTz || localTz) + " · Lang " + navLang;
      } else {
        geoEl.style.color = "#fcd34d";
        geoEl.textContent = "⚠️ Lệch Múi Giờ: Proxy IP ở " + city + " (" + cc + " · " + ipTz + ") nhưng Chrome đang chạy " + localTz + "!";
      }
      chrome.runtime?.sendMessage?.({ type: "ADSOPS_CHECK_IP_GUARD" }, () => {
        void chrome.runtime?.lastError;
      });
    })
    .catch(() => {
      geoEl.style.color = "#cbd5e1";
      geoEl.textContent = "Múi giờ Chrome: " + localTz + " · Ngôn ngữ: " + navLang + " (Bấm Quét lại nếu Proxy chậm)";
    });
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(
    [
      "viaId",
      "viaName",
      "profileCode",
      "viaTier",
      "twoFaSecret",
      "passkeyStatus",
      "proxyRaw",
      "proxyEnabled",
      "accounts",
      "lastKeepAliveStatus",
      "clientGroup",
      "warmupPhase",
      "warmupStartIso",
      "soakHoursRemaining",
      "defaultWarmupMode",
      "soakQuarantineEnabled",
      "ipKillSwitch",
      "autoVaultCookieRefresh",
      "cooldownUntilMs",
      "cooldownReason",
      "ipLeakHalted",
      "ipLeakReason",
      "trustScore",
      "lastVaultCookieRefreshAt",
      "bridgeToken",
      "bridgeTokenManual"
    ],
    (res) => {
      currentViaId = res.viaId || DEFAULT_VIA_META.viaId || "";
      if (viaInput) viaInput.value = res.viaName || DEFAULT_VIA_META.viaName || "";
      if (profileInput) profileInput.value = res.profileCode || DEFAULT_VIA_META.profileCode || "Default";
      if (tierSelect) tierSelect.value = res.viaTier || DEFAULT_VIA_META.viaTier || "camp";
      if (twofaInput) twofaInput.value = res.twoFaSecret || DEFAULT_VIA_META.twoFaSecret || "";
      if (proxyInput) proxyInput.value = res.proxyRaw || "";
      if (bridgeTokenInput) bridgeTokenInput.value = res.bridgeTokenManual || DEFAULT_VIA_META.bridgeToken || res.bridgeToken || "";
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
        } else if (st.state === "IP_LEAK") {
          kaEl.textContent = "🚨 Kill-Switch đã khóa vì rò rỉ/đứt Proxy IP (" + (st.detail || "IP Leak") + ")";
          kaEl.style.color = "#fda4af";
        } else if (st.state === "OK") {
          kaEl.textContent = "☕ Đã đảo ấm: " + (st.routeSummary || "Cookie khỏe");
          kaEl.style.color = "#6ee7b7";
        }
      }
      const modeSel = document.getElementById("ka-mode-select");
      const chkIp = document.getElementById("chk-ip-killswitch");
      const chkSoak = document.getElementById("chk-soak-lock");
      const chkAutoVault = document.getElementById("chk-auto-vault-cookie");
      if (modeSel) {
        modeSel.value = res.defaultWarmupMode || DEFAULT_VIA_META.defaultWarmupMode || ((res.warmupPhase === "72h_lock") ? "soak_72h" : "human_organic");
      }
      if (chkIp) chkIp.checked = res.ipKillSwitch !== undefined ? Boolean(res.ipKillSwitch) : (DEFAULT_VIA_META.ipKillSwitch !== false);
      if (chkSoak) chkSoak.checked = res.soakQuarantineEnabled !== undefined ? Boolean(res.soakQuarantineEnabled) : (DEFAULT_VIA_META.soakQuarantineEnabled !== false);
      if (chkAutoVault) chkAutoVault.checked = res.autoVaultCookieRefresh !== undefined ? Boolean(res.autoVaultCookieRefresh) : (DEFAULT_VIA_META.autoVaultCookieRefresh !== false);

      updateBadge(Boolean(res.proxyEnabled), res.proxyRaw || "");
      renderStewardshipPanel(res);
      if (Array.isArray(res.accounts) && res.accounts.length > 0) {
        renderAccounts(res.accounts);
      }
      tickOtp();
    }
  );
}

function resolveRouteByMode(mode, tier) {
  if (mode === "soak_72h") return "feed,notif";
  if (mode === "bm_warmup") return "feed,notif,biz";
  if (mode === "pre_camp") return "feed,pages";
  return tier === "vault" ? "feed,notif,biz" : "feed,watch,notif";
}

document.getElementById("ka-mode-select")?.addEventListener("change", (ev) => {
  const val = ev?.target?.value || "human_organic";
  chrome.storage?.local?.set({ defaultWarmupMode: val }, () => flashSaved());
});
document.getElementById("chk-ip-killswitch")?.addEventListener("change", (ev) => {
  chrome.storage?.local?.set({ ipKillSwitch: Boolean(ev?.target?.checked) }, () => flashSaved());
});
document.getElementById("chk-soak-lock")?.addEventListener("change", (ev) => {
  chrome.storage?.local?.set({ soakQuarantineEnabled: Boolean(ev?.target?.checked) }, () => flashSaved());
});
document.getElementById("chk-auto-vault-cookie")?.addEventListener("change", (ev) => {
  chrome.storage?.local?.set({ autoVaultCookieRefresh: Boolean(ev?.target?.checked) }, () => flashSaved());
});
document.getElementById("btn-recheck-geo")?.addEventListener("click", () => recheckGeoAlignment());

document.getElementById("btn-clear-cooldown")?.addEventListener("click", () => {
  chrome.storage?.local?.set(
    { cooldownUntilMs: 0, cooldownReason: "", ipLeakHalted: false, ipLeakReason: "" },
    () => {
      flashSaved();
      chrome.storage.local.get(null, (all) => renderStewardshipPanel(all));
    }
  );
});

document.getElementById("btn-run-keepalive")?.addEventListener("click", () => {
  const tier = (tierSelect?.value === "vault") ? "vault" : "standard";
  const viaNm = (viaInput?.value || "Via").trim().slice(0, 50);
  const mode = document.getElementById("ka-mode-select")?.value || "human_organic";
  const route = resolveRouteByMode(mode, tier);
  chrome.tabs?.create({
    url:
      "https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_via_tier=" +
      encodeURIComponent(tier) +
      "&adsops_via_label=" +
      encodeURIComponent(viaNm) +
      "&adsops_ka_mode=" +
      encodeURIComponent(mode) +
      "&adsops_ka_route=" +
      encodeURIComponent(route)
  });
});

document.getElementById("btn-open-bm-safe")?.addEventListener("click", () => {
  const tier = (tierSelect?.value === "vault") ? "vault" : "standard";
  const viaNm = (viaInput?.value || "Via").trim().slice(0, 50);
  chrome.tabs?.create({
    url:
      "https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_via_tier=" +
      encodeURIComponent(tier) +
      "&adsops_via_label=" +
      encodeURIComponent(viaNm) +
      "&adsops_ka_mode=bm_warmup&adsops_ka_route=feed,notif,biz"
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
    webrtcShield: true,
    ipLeakHalted: false
  };
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set(state, () => {
      updateBadge(state.proxyEnabled, state.proxyRaw);
      flashSaved();
      setTimeout(() => {
        refreshIp();
        recheckGeoAlignment();
      }, 600);
    });
  }
});

document.getElementById("btn-disable-proxy")?.addEventListener("click", () => {
  const state = {
    viaName: (viaInput?.value || "").trim() || "Via Facebook",
    profileCode: (profileInput?.value || "").trim() || "Default",
    proxyRaw: (proxyInput?.value || "").trim(),
    proxyEnabled: false,
    ipLeakHalted: false
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

document.getElementById("btn-save-bridge-token")?.addEventListener("click", () => {
  const val = (bridgeTokenInput?.value || "").trim();
  const statusEl = document.getElementById("cookie-status");
  chrome.storage?.local?.set({ bridgeTokenManual: val }, () => {
    flashSaved();
    if (statusEl) {
      statusEl.style.color = val ? "#34d399" : "#fbbf24";
      statusEl.textContent = val ? "🛡️ Đã lưu X-AdsOps-Bridge-Token bảo mật cho Extension!" : "Đã xóa Token thủ công (dùng Token mặc định từ App Win).";
    }
  });
});

refreshIp();
tickOtp();
recheckGeoAlignment();`

  const readmeTxt = [
    'HƯỚNG DẪN CÀI ĐẶT TIỆN ÍCH GOOGLE CHROME (ADSOPS COMPANION v2.9.7 PRO - ZERO-TRUST & ANTI-CHECKPOINT)',
    '========================================================================================================',
    'Bước 1: Giải nén file .zip này ra một thư mục cố định (ví dụ: Desktop\\AdsOps-Chrome-Extension).',
    'Bước 2: Mở trình duyệt Google Chrome của Via -> gõ vào thanh địa chỉ: chrome://extensions',
    'Bước 3: Bật công tắc "Chế độ dành cho nhà phát triển" (Developer mode) ở góc trên bên phải.',
    'Bước 4: Bấm nút "Tải tiện ích đã giải nén" (Load unpacked) ở góc trên bên trái -> Chọn thư mục vừa giải nén.',
    'Bước 5: Bấm biểu tượng mảnh ghép trên góc phải Chrome -> Bấm nút Ghim (Pin) cạnh "AdsOps Companion Pro".',
  ].join('\r\n')

  const contentJs = `// AdsOps Companion Pro v2.9.7 — Anti-Checkpoint + 4-Mode Warmup + Auto Page Creator + Passkey Shield + HUD
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
        '<a href="https://accountscenter.facebook.com/password_and_security/passkeys?adsops_auto_delete_passkey=1" style="background:rgba(244,63,94,0.28);border:1px solid #f87171;color:#fecdd3;padding:2px 7px;border-radius:999px;text-decoration:none;font-size:10px;font-weight:800;" title="Mở trang tự động quét & xóa sạch Passkey trong Account Center">🗑️ Tự Xoá Passkey</a> +
        '<button id="adsops-hud-auto-invite" type="button" style="background:rgba(16,185,129,0.26);border:1px solid #34d399;color:#d1fae5;padding:2px 8px;border-radius:999px;cursor:pointer;font-size:10px;font-weight:800;" title="Tự động mời những người đã bày tỏ cảm xúc với bài viết theo dõi Fanpage (Meta Business Suite / Bài đăng)">👥 Mời Follow Tự Động</button>'' +
        '<button id="adsops-hud-close" title="Ẩn thanh nhắc nhở này" style="margin-left:2px;background:transparent;border:none;color:inherit;cursor:pointer;font-weight:900;font-size:12px;">✕</button>';

      document.body.appendChild(hud);
      document.getElementById("adsops-hud-close")?.addEventListener("click", () => {
        hud.remove();
      });
      document.getElementById("adsops-hud-auto-invite")?.addEventListener("click", () => {
        try {
          sessionStorage.setItem("adsops_auto_invite_active", "1");
          sessionStorage.setItem("adsops_auto_invite_started_at", String(Date.now()));
          sessionStorage.setItem("adsops_auto_invite_count", "0");
          sessionStorage.setItem("adsops_auto_invite_max", "25");
          sessionStorage.removeItem("adsops_auto_invite_opened_modal");
        } catch (e) {}
        setHudPageStatus("🤝 [Auto-Invite] Đang quét người bày tỏ cảm xúc để gửi lời mời theo dõi...", "#34d399");
        handlePageReactorAutoInviteDom();
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
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          type: "ADSOPS_SYNC_BILLING",
          payload: {
            external_account_id: actId,
            billing_threshold_raw: threshRaw,
            next_bill_date: nextDate,
            meta_daily_limit_raw: dslRaw,
            payment_card_display: cardDisp
          }
        });
      } catch (e) {}
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
      setHudPageStatus("🖼️ [Auto v2.10.1] Đã tự gắn Avatar độc bản (chống trùng Hash)...", "#38bdf8");

      if (fileInputs.length > 1) {
        setTimeout(() => {
          if (pageAutoPilotHalted) return;
          buildUniqueBrandPngFile(1640, 624, pName || "Brand Page", pCat, true, "cover-" + stamp + ".png").then((cvFile) => {
            if (!cvFile || pageAutoPilotHalted) return;
            assignFileToInput(fileInputs[1], cvFile);
            lastMediaAttachedAt = Date.now();
            setHudPageStatus("🖼️ [Auto v2.10.1] Đã tự gắn đủ Avatar + Cover độc bản!", "#34d399");
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
    feed: { label: "Cuộn Newsfeed", url: "https://www.facebook.com/", minMs: 11000, maxMs: 16000 },
    scroll_feed: { label: "Cuộn Newsfeed", url: "https://www.facebook.com/", minMs: 11000, maxMs: 16000 },
    watch: { label: "Xem Reels & Watch", url: "https://www.facebook.com/watch/?adsops_ka_hop=1", minMs: 10500, maxMs: 15000 },
    watch_reels: { label: "Xem Reels & Watch", url: "https://www.facebook.com/watch/?adsops_ka_hop=1", minMs: 10500, maxMs: 15000 },
    react_feed_post: { label: "Thả Like/Tim bài Feed", url: "https://www.facebook.com/?adsops_react_feed=1", minMs: 8500, maxMs: 12500, microAction: "like_post" },
    visit_internal_fanpage: { label: "Nuôi chéo Fanpage nội bộ", url: "https://www.facebook.com/pages/?category=your_pages&adsops_cross_page=1", minMs: 11500, maxMs: 16000, microAction: "like_post" },
    view_photo_post: { label: "Xem ảnh & đọc bình luận", url: "https://www.facebook.com/?adsops_view_post=1", minMs: 9500, maxMs: 13500 },
    notif: { label: "Đọc Thông báo", url: "https://www.facebook.com/notifications", minMs: 7500, maxMs: 11500 },
    read_notifications: { label: "Đọc Thông báo", url: "https://www.facebook.com/notifications", minMs: 7500, maxMs: 11500 },
    search_keyword: { label: "Tìm kiếm từ khóa", url: "https://www.facebook.com/search/top/?q=xu%20huong", minMs: 9000, maxMs: 13000 },
    pages: { label: "Quản lý Trang", url: "https://www.facebook.com/pages/?category=your_pages", minMs: 7500, maxMs: 11500 },
    profile: { label: "Xem Trang cá nhân", url: "https://www.facebook.com/me", minMs: 7500, maxMs: 11000 },
    visit_own_profile: { label: "Xem Trang cá nhân", url: "https://www.facebook.com/me", minMs: 7500, maxMs: 11000 },
    browse_marketplace: { label: "Dạo Marketplace", url: "https://www.facebook.com/marketplace/", minMs: 9500, maxMs: 13500 },
    browse_groups: { label: "Lướt Nhóm (Groups)", url: "https://www.facebook.com/groups/feed/", minMs: 9500, maxMs: 13500 },
    mbs_like_comments_and_invite: { label: "Thả Tim Comment & Mời Follow", url: "https://business.facebook.com/latest/home?adsops_auto_invite_followers=1&adsops_like_comments=1", minMs: 12000, maxMs: 16500 },
    biz: { label: "Business Suite (BM)", url: "https://business.facebook.com/latest/home", minMs: 11500, maxMs: 15500 },
  };

  function performNaturalLikeMicroAction(maxLikes) {
    try {
      const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]')).filter((el) => {
        if (el.getAttribute("aria-pressed") === "true") return false;
        const lbl = ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")).trim().toLowerCase();
        if (lbl !== "thích" && lbl !== "like") return false;
        const r = el.getBoundingClientRect();
        return r.width > 18 && r.height > 14 && r.top > 90 && r.bottom < window.innerHeight - 40;
      });
      const toClick = candidates.slice(0, Math.max(1, maxLikes || 1));
      toClick.forEach((btn, i) => {
        setTimeout(() => {
          triggerReactSafeClick(btn);
        }, i * 650);
      });
      return toClick.length;
    } catch (e) {
      return 0;
    }
  }

  function pickFallbackKeepAliveSteps(tier, mode) {
    if (mode === "soak_72h") return ["feed", "notif"];
    if (mode === "bm_warmup") return ["feed", "notif", "biz"];
    if (mode === "pre_camp") return ["feed", "pages"];
    const pool = ["notif", "watch", "pages", "profile"];
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
        "☕ [Đảo Ấm v2.10.1 · Bước " + (idx + 1) + "/" + steps.length + "] Đang đọc " + stopMeta.label + " tự nhiên (" + Math.round(waitMs / 1000) + "s)..."
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
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            try {
              chrome.runtime.sendMessage({ type: "ADSOPS_AUTO_REFRESH_VAULT_COOKIE", source: "keepalive_ok" }, () => {
                void chrome.runtime.lastError;
              });
            } catch (e) {}
          }
          setHudPageStatus("☕ [v2.10.1] Đã đảo ấm sinh học & làm mới Két Cookie (" + summary + ")!", "#34d399");
          if (session.autoClose && session.kaMode !== "bm_warmup") {
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
    const isPreAdsWarmup = urlObj.searchParams.get("adsops_preads_warmup") === "1";
    if (isPreAdsWarmup) {
      warmupStarted = true;
      const targetAdsUrl = urlObj.searchParams.get("adsops_preads_target") || "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
      const sec = Math.max(8, Math.min(90, parseInt(urlObj.searchParams.get("adsops_preads_sec") || "20", 10) || 20));
      setTimeout(() => {
        if (pageAutoPilotHalted) return;
        const waitMs = randDelay((sec - 2) * 1000, (sec + 2) * 1000);
        const reader = startBiometricReadingLoop("🛡️ [Bước đệm Chống Checkpoint] Đang lướt Newsfeed tự nhiên " + Math.round(waitMs / 1000) + "s trước khi vào Ads Manager / BM...");
        setTimeout(() => {
          reader.stop();
          if (pageAutoPilotHalted) return;
          window.location.href = targetAdsUrl;
        }, waitMs);
      }, 700);
      return;
    }

    const crossPageParam = urlObj.searchParams.get("adsops_cross_page_url") || "";
    if (crossPageParam && crossPageParam.startsWith("https://")) {
      KA_STOPS.visit_internal_fanpage.url = crossPageParam;
    }

    const isWarmupToCreate = urlObj.searchParams.get("adsops_warmup_to_create") === "1";
    const isKeepAliveStart = urlObj.searchParams.get("adsops_keepalive_session") === "1" || urlObj.searchParams.get("adsops_keepalive") === "1";

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
        const reader = startBiometricReadingLoop("🌿 [Auto v2.10.1] Đang đọc lướt Newsfeed sinh học " + Math.round(waitMs / 1000) + "s trước khi tạo Page...");
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
      const rawAutoClose = urlObj.searchParams.get("adsops_auto_close") ?? urlObj.searchParams.get("autoclose");
      const wantClose = rawAutoClose !== "0";
      const viaTier = urlObj.searchParams.get("adsops_via_tier") || "standard";
      const viaLabel = urlObj.searchParams.get("adsops_via_label") || "";
      const kaMode = urlObj.searchParams.get("adsops_ka_mode") || "human_organic";
      const rawRoute = (urlObj.searchParams.get("adsops_ka_route") || "")
        .split(",")
        .map((s) => s.trim())
        .filter((k) => Boolean(KA_STOPS[k]));
      const steps = rawRoute.length >= 2 ? rawRoute : pickFallbackKeepAliveSteps(viaTier, kaMode);
      const routeSummary = steps.map((k) => (KA_STOPS[k] ? KA_STOPS[k].label : k)).join(" → ");
      const localSession = {
        steps: steps,
        stepIdx: 0,
        autoClose: wantClose,
        viaTier: viaTier,
        viaLabel: viaLabel,
        kaMode: kaMode,
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
            kaMode: kaMode,
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
    if (url.includes("adsops_warmup_to_create=1") || url.includes("adsops_keepalive_session=1") || url.includes("adsops_keepalive=1")) return;
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

      let autoSubmitBlockedReason = "";
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["warmupPhase", "soakQuarantineEnabled", "cooldownUntilMs", "ipLeakHalted"], (st) => {
          void chrome.runtime?.lastError;
          if (!st) return;
          if (st.ipLeakHalted) {
            autoSubmitBlockedReason = "Kill-Switch IP đang khóa";
          } else if (Number(st.cooldownUntilMs || 0) > Date.now()) {
            autoSubmitBlockedReason = "Via đang Cooldown 24h chống Checkpoint";
          } else if (st.warmupPhase === "72h_lock" && st.soakQuarantineEnabled !== false) {
            autoSubmitBlockedReason = "Thiết bị mới đang ngâm < 72h";
          }
        });
      }

      if (autoSubmit) {
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.10.1] Đang nhập tự nhiên theo nhịp người thật...", "#38bdf8");
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
        if (autoSubmit && autoSubmitBlockedReason) {
          setHudPageStatus(
            (batchStep ? "[Lô " + batchStep + "] " : "") +
              "🫧 [Khiên Bảo Vệ] " +
              autoSubmitBlockedReason +
              " — Đã điền sẵn nhưng khóa bấm Tạo Trang tự động!",
            "#fbbf24",
          );
          return;
        }
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
        setHudPageStatus((batchStep ? "[Lô " + batchStep + "] " : "") + "🤖 [Auto v2.10.1] Đã bấm Tạo Trang — Đang hoàn tất bước phụ...", "#38bdf8");
      };

      setTimeout(() => tryAutoClickCreate(true), tFinal);
    } catch (e) {}
  }

  // v2.10.1: User-clicked 1-tap 6-digit 2FA autofill from Desktop DPAPI Vault / local secret (strictly blocked on CAPTCHA pages)
  function handleTwoFactorAssistDom() {
    try {
      const url = (window.location.href || "").toLowerCase();
      const bodyText = (document.body ? document.body.innerText : "").toLowerCase();

      if (
        document.querySelector('iframe[src*="captcha"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], [id*="captcha"], [class*="captcha"]') ||
        bodyText.includes("captcha") ||
        bodyText.includes("verify you are human") ||
        bodyText.includes("xác minh bạn là con người")
      ) {
        return;
      }

      const is2faScreen =
        url.includes("two_step_verification") ||
        url.includes("approvals_code") ||
        url.includes("checkpoint") ||
        bodyText.includes("mã đăng nhập") ||
        bodyText.includes("ứng dụng xác thực") ||
        bodyText.includes("authentication app") ||
        bodyText.includes("6-digit") ||
        bodyText.includes("6 chữ số");
      if (!is2faScreen) return;

      const findCodeInput = () => {
        const direct = document.querySelector('input[name="approvals_code"], input[autocomplete="one-time-code"]');
        if (direct && direct.offsetParent !== null && !direct.disabled && !direct.readOnly) return direct;
        const candidates = Array.from(document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])'));
        return candidates.find((el) => {
          if (!el || el.offsetParent === null || el.disabled || el.readOnly) return false;
          const nm = ((el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
          if (nm.includes("email") || nm.includes("pass") || nm.includes("search") || nm.includes("tìm")) return false;
          return nm.includes("code") || nm.includes("mã") || nm.includes("2fa") || nm.includes("otp") || el.maxLength === 6 || el.maxLength === 8 || candidates.length === 1;
        }) || null;
      };

      const inputEl = findCodeInput();
      if (!inputEl) return;
      if (document.getElementById("adsops-2fa-fill-btn")) return;

      const btn = document.createElement("button");
      btn.id = "adsops-2fa-fill-btn";
      btn.type = "button";
      btn.textContent = "🔑 Điền nhanh 2FA 6 số";
      btn.style.cssText =
        "margin-top:8px;margin-bottom:4px;display:inline-flex;align-items:center;gap:6px;" +
        "padding:7px 14px;border-radius:8px;border:1px solid #3b82f6;background:#1d4ed8;" +
        "color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.28);z-index:99999;";

      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        btn.disabled = true;
        btn.textContent = "⏳ Đang lấy mã 2FA...";
        chrome.runtime.sendMessage({ type: "ADSOPS_GET_LOCAL_TOTP" }, (res) => {
          void chrome.runtime.lastError;
          btn.disabled = false;
          if (!res || !res.ok || !res.code) {
            btn.style.background = "#b45309";
            btn.style.borderColor = "#f59e0b";
            btn.textContent = "⚠️ Chưa có Secret 2FA (mở App Win để gắn)";
            return;
          }
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(inputEl, res.code);
            else inputEl.value = res.code;
            inputEl.focus();
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(res.code).catch(() => {});
            }
            btn.style.background = "#047857";
            btn.style.borderColor = "#10b981";
            btn.textContent = "✅ Đã điền " + (res.formatted || res.code) + " (" + (res.seconds_remaining || 30) + "s)";
          } catch (e) {
            btn.textContent = "Mã: " + res.code;
          }
        });
      });

      const host = inputEl.parentElement && inputEl.parentElement.parentElement ? inputEl.parentElement.parentElement : (inputEl.parentElement || document.body);
      host.appendChild(btn);
    } catch (e) {}
  }


  let pageInvitePending = false;
  let lastPageInviteClickAt = 0;
  let lastReportedReactorCount = -1;

  function triggerReactSafeClick(el) {
    if (!el) return;
    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.click();
    } catch (e) {
      try { el.click(); } catch (e2) {}
    }
  }

  function scanAndReportPendingReactorCountDom() {
    try {
      const url = window.location.href || "";
      if (!url.includes("business.facebook.com")) return;
      const u = new URL(url);
      const assetId = u.searchParams.get("asset_id") || "";
      const candidates = Array.from(document.querySelectorAll("div, span, h2, h3, h4, p")).filter((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return (
          (t.includes("tiếp cận những người đã bày tỏ cảm xúc") ||
            t.includes("reach people who reacted to your content") ||
            t.includes("bày tỏ cảm xúc và bình luận về nội dung")) &&
          t.length < 280
        );
      });
      if (candidates.length === 0) return;
      for (const node of candidates) {
        let container = node.parentElement;
        for (let depth = 0; depth < 6 && container; depth++) {
          const texts = Array.from(container.querySelectorAll("span, div"))
            .map((x) => (x.textContent || "").trim())
            .filter((t) => /^\d{1,4}$/.test(t));
          if (texts.length > 0) {
            const cnt = parseInt(texts[0], 10);
            if (!isNaN(cnt) && cnt !== lastReportedReactorCount) {
              lastReportedReactorCount = cnt;
              reportBrowserEventBg("PAGE_PENDING_INVITES_COUNT", {
                external_page_id: assetId,
                detail: String(cnt),
              });
            }
            return;
          }
          container = container.parentElement;
        }
      }
    } catch (e) {}
  }

  function handlePageReactorAutoInviteDom() {
    scanAndReportPendingReactorCountDom();
    try {
      if ((window.location.href || "").includes("adsops_like_comments=1")) {
        performNaturalLikeMicroAction(3);
      }
    } catch (e) {}
    if (pageAutoPilotHalted || pageInvitePending) return;
    const challenge = detectSafetyChallenge();
    if (challenge) {
      haltAutoPilotForSafety(challenge);
      return;
    }

    const url = window.location.href || "";
    try {
      const u = new URL(url);
      if (u.searchParams.get("adsops_auto_invite_followers") === "1") {
        if (sessionStorage.getItem("adsops_auto_invite_active") !== "1") {
          sessionStorage.setItem("adsops_auto_invite_active", "1");
          sessionStorage.setItem("adsops_auto_invite_started_at", String(Date.now()));
          sessionStorage.setItem("adsops_auto_invite_count", "0");
          const lim = parseInt(u.searchParams.get("adsops_invite_limit") || "25", 10);
          sessionStorage.setItem("adsops_auto_invite_max", String(Math.max(5, Math.min(50, isNaN(lim) ? 25 : lim))));
          if (u.searchParams.get("adsops_auto_close") === "1") {
            sessionStorage.setItem("adsops_auto_invite_close", "1");
          }
          const pn = u.searchParams.get("adsops_page_name") || "";
          if (pn) sessionStorage.setItem("adsops_autopilot_pname", pn);
        }
      }
    } catch (e) {}

    let isActive = false;
    let startedAt = 0;
    let count = 0;
    let maxInvites = 25;
    let openedModal = false;
    let autoClose = false;
    try {
      isActive = sessionStorage.getItem("adsops_auto_invite_active") === "1";
      startedAt = Number(sessionStorage.getItem("adsops_auto_invite_started_at") || "0");
      count = Number(sessionStorage.getItem("adsops_auto_invite_count") || "0");
      maxInvites = Number(sessionStorage.getItem("adsops_auto_invite_max") || "25") || 25;
      openedModal = sessionStorage.getItem("adsops_auto_invite_opened_modal") === "1";
      autoClose = sessionStorage.getItem("adsops_auto_invite_close") === "1";
    } catch (e) {}

    if (!isActive) return;
    if (Date.now() - lastPageInviteClickAt < 3100) return;

    const finishAutoInvite = (reasonMsg) => {
      try {
        sessionStorage.removeItem("adsops_auto_invite_active");
        sessionStorage.removeItem("adsops_auto_invite_opened_modal");
      } catch (e) {}
      reportBrowserEventBg("PAGE_INVITE_FOLLOWERS_OK", {
        invited_count: count,
        detail: reasonMsg || ("Đã tự động gửi " + count + " lời mời theo dõi Fanpage cho người tương tác"),
      });
      setHudPageStatus("✅ [Auto-Invite] " + (reasonMsg || ("Đã gửi " + count + " lời mời theo dõi Fanpage!")), "#34d399");
      if (autoClose && !pageAutoPilotHalted) {
        scheduleSafeTabAutoClose(randDelay(6500, 9500));
      }
    };

    if (count >= maxInvites) {
      finishAutoInvite("Đạt ngưỡng an toàn " + count + "/" + maxInvites + " lời mời theo dõi Fanpage");
      return;
    }

    if (startedAt && Date.now() - startedAt > 95000) {
      finishAutoInvite("Hoàn tất phiên mời theo dõi (" + count + " lời mời đã gửi)");
      return;
    }

    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter((d) => {
      const r = d.getBoundingClientRect();
      return r.width > 200 && r.height > 120;
    });

    if (dialogs.length > 0) {
      const topDialog = dialogs[dialogs.length - 1];
      const findDialogSubmitBtn = () => {
        const btns = Array.from(topDialog.querySelectorAll('div[role="button"], button, span[role="button"]')).filter((b) => {
          if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
          const r = b.getBoundingClientRect();
          return r.width > 24 && r.height > 16;
        });
        return btns.find((b) => {
          const txt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
          if (txt.includes("đã mời") || txt.includes("invited") || txt.includes("bạn bè") || txt.includes("friends")) return false;
          return (
            txt === "gửi lời mời" ||
            txt === "send invitations" ||
            txt === "send invite" ||
            txt.startsWith("gửi lời mời (") ||
            txt.startsWith("send invitations (")
          );
        }) || null;
      };

      // Priority 1: Click "Chọn tất cả" (Select all) if present, then select any remaining unchecked reactor/commenter checkboxes & submit immediately!
      const allDialogClickables = Array.from(topDialog.querySelectorAll('div[role="button"], button, span[role="button"], label, div[role="checkbox"], input[type="checkbox"]'));
      const selectAllBtn = allDialogClickables.find((el) => {
        const txt = ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")).trim().toLowerCase();
        return txt === "chọn tất cả" || txt === "select all" || txt.startsWith("chọn tất cả (") || txt.startsWith("select all (");
      });

      const uncheckedBoxes = Array.from(
        topDialog.querySelectorAll('input[type="checkbox"]:not(:checked), div[role="checkbox"][aria-checked="false"]')
      ).filter((cb) => {
        const r = cb.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      });

      if (uncheckedBoxes.length > 0) {
        pageInvitePending = true;
        setTimeout(() => {
          if (pageAutoPilotHalted) { pageInvitePending = false; return; }
          if (selectAllBtn) {
            triggerReactSafeClick(selectAllBtn);
          }
          const remainingBoxes = Array.from(
            topDialog.querySelectorAll('input[type="checkbox"]:not(:checked), div[role="checkbox"][aria-checked="false"]')
          ).filter((cb) => {
            const r = cb.getBoundingClientRect();
            return r.width > 8 && r.height > 8;
          });
          const toSelect = remainingBoxes.slice(0, Math.max(1, maxInvites));
          toSelect.forEach((cb) => triggerReactSafeClick(cb));
          const selectedTotal = Math.max(toSelect.length, uncheckedBoxes.length);
          setHudPageStatus("🤝 [Auto-Invite] Đã chọn tất cả (" + selectedTotal + " người bình luận & thả cảm xúc), đang nhấn Gửi lời mời...", "#38bdf8");

          setTimeout(() => {
            pageInvitePending = false;
            if (pageAutoPilotHalted) return;
            const submitBtn = findDialogSubmitBtn();
            if (submitBtn) {
              submitBtn.style.outline = "2px solid #10b981";
              triggerReactSafeClick(submitBtn);
              lastPageInviteClickAt = Date.now();
              count = selectedTotal;
              try { sessionStorage.setItem("adsops_auto_invite_count", String(selectedTotal)); } catch (e) {}
              finishAutoInvite("Đã tự động chọn tất cả và gửi " + selectedTotal + " lời mời theo dõi Fanpage");
            }
          }, 700);
        }, 550);
        return;
      }

      // Priority 2: If checkboxes are already checked and "Gửi lời mời" submit button is enabled, click it immediately and finish!
      const readySubmitBtn = findDialogSubmitBtn();
      if (readySubmitBtn) {
        pageInvitePending = true;
        setTimeout(() => {
          pageInvitePending = false;
          if (pageAutoPilotHalted) return;
          readySubmitBtn.style.outline = "2px solid #10b981";
          triggerReactSafeClick(readySubmitBtn);
          lastPageInviteClickAt = Date.now();
          const sentCnt = Math.max(1, count);
          count = sentCnt;
          finishAutoInvite("Đã tự động gửi " + sentCnt + " lời mời theo dõi Fanpage");
        }, 500);
        return;
      }

      // Priority 3: Classic row-by-row "Mời" / "Invite" buttons inside modal — click all in one batch!
      const rowInviteBtns = Array.from(topDialog.querySelectorAll('div[role="button"], button, span[role="button"]')).filter((b) => {
        if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
        const r = b.getBoundingClientRect();
        if (r.width <= 24 || r.height <= 16) return false;
        const txt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
        return txt === "mời" || txt === "invite";
      });
      if (rowInviteBtns.length > 0) {
        pageInvitePending = true;
        const batchBtns = rowInviteBtns.slice(0, Math.max(1, maxInvites - count));
        batchBtns.forEach((btn, idx) => {
          setTimeout(() => {
            if (pageAutoPilotHalted) return;
            btn.style.outline = "2px solid #10b981";
            triggerReactSafeClick(btn);
            if (idx === batchBtns.length - 1) {
              pageInvitePending = false;
              count += batchBtns.length;
              finishAutoInvite("Đã tự động mời tất cả " + count + " người tương tác & bình luận");
            }
          }, idx * 350);
        });
        return;
      }
    }

    const allVisibleBtns = findVisiblePageButtons();
    const findReactorSectionInviteBtn = () => {
      const candidates = Array.from(document.querySelectorAll("div, span, h2, h3, h4, p")).filter((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return (
          (t.includes("tiếp cận những người đã bày tỏ cảm xúc") ||
            t.includes("reach people who reacted to your content") ||
            t.includes("bày tỏ cảm xúc và bình luận về nội dung")) &&
          t.length < 280
        );
      });
      for (const node of candidates) {
        let row = node.parentElement;
        for (let depth = 0; depth < 5 && row; depth++) {
          const rowBtns = Array.from(row.querySelectorAll('div[role="button"], button, a[role="button"]'));
          const sendBtn = rowBtns.find((b) => {
            if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
            const bt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
            return bt === "gửi lời mời" || bt === "send invitations" || bt === "send invite";
          });
          if (sendBtn) return sendBtn;
          row = row.parentElement;
        }
      }
      return allVisibleBtns.find((b) => {
        if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
        const bt = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim().toLowerCase();
        return bt === "gửi lời mời" || bt === "send invitations" || bt === "send invite";
      }) || null;
    };

    if (!openedModal) {
      const mbsInviteBtn = findReactorSectionInviteBtn();
      if (mbsInviteBtn) {
        pageInvitePending = true;
        const waitMs = randDelay(1500, 2900);
        setTimeout(() => {
          pageInvitePending = false;
          if (pageAutoPilotHalted) return;
          try {
            mbsInviteBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (e) {}
          mbsInviteBtn.style.outline = "2px solid #10b981";
          triggerReactSafeClick(mbsInviteBtn);
          lastPageInviteClickAt = Date.now();
          try { sessionStorage.setItem("adsops_auto_invite_opened_modal", "1"); } catch (e) {}
          setHudPageStatus("🤝 [Auto-Invite] Đã mở bảng 'Tiếp cận người đã bày tỏ cảm xúc' — Đang quét danh sách...", "#38bdf8");
        }, waitMs);
        return;
      }
    }

    if (startedAt && Date.now() - startedAt > 16000) {
      finishAutoInvite(
        count > 0
          ? "Đã tự động gửi " + count + " lời mời theo dõi Fanpage hoàn tất"
          : "Không có người tương tác mới cần gửi lời mời theo dõi"
      );
    }
  }

  setTimeout(() => {
    injectFloatingHud();
    handlePasskeyDom();
    handleTwoFactorAssistDom();
    handleSessionWarmupAndKeepAlive();
    handlePageCreationDom();
    handlePageOnboardingWizard();
    handlePageReactorAutoInviteDom();
  }, 900);
  setInterval(() => {
    scanBillingDom();
    handleTwoFactorAssistDom();
    handleSessionWarmupAndKeepAlive();
    handlePageCreationDom();
    handlePageOnboardingWizard();
    handlePageReactorAutoInviteDom();
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
  extraMeta?: ExtensionStewardshipMeta,
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
      extraMeta,
    ),
  )
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Chrome-Extension-v2.9.7-${slug}.zip`
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
  extraMeta?: ExtensionStewardshipMeta
}

export function downloadAllViasExtensionsBundleZip(items: ViaExtensionBundleSpec[]): void {
  if (!Array.isArray(items) || items.length === 0) return
  const allFiles: Array<{ name: string; content: string | Uint8Array }> = []
  const guideLines: string[] = [
    'TRON BO TIEN ICH ADSOPS COMPANION v2.9.7 PRO CHO TOAN BO DAN VIA',
    '================================================================',
    `Tong so thu muc Extension da dong goi: ${items.length} Via`,
    '',
    'Cach cai nhanh:',
    '1. Giai nen file .zip nay ra mot thu muc co dinh (VD: Desktop\\AdsOps-Extensions-v2.9.7).',
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
        spec.extraMeta,
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
  a.download = `AdsOps-Tron-Bo-Extension-v2.9.7-${items.length}Via.zip`
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
