import { api, resolveApiUrl } from './api'
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

export interface GuardrailBlockedDecision {
  allowed: false
  code: 'vault_ads_blocked' | 'soak_72h_blocked'
  viaId: string
  viaLabel: string
  viaTier: 'vault' | '72h_lock'
  targetUrl: string
  targetScope: string
  reason: string
  recommendedAlternative?: string
}

const GUARDRAIL_OVERRIDE_PREFIX = 'adsops_guardrail_override_'

export function storeOwnerOverrideGrant(viaKey: string, grant: string, expiresInSeconds = 900): void {
  if (typeof window === 'undefined' || !viaKey.trim() || !grant.trim()) return
  try {
    const expiresAt = Date.now() + Math.max(60, expiresInSeconds) * 1000
    window.sessionStorage.setItem(
      `${GUARDRAIL_OVERRIDE_PREFIX}${viaKey.trim()}`,
      JSON.stringify({ grant: grant.trim(), expiresAt }),
    )
  } catch {
    // Ignore storage quota / private mode errors
  }
}

export function getValidOwnerOverrideGrant(viaKey: string): string | null {
  if (typeof window === 'undefined' || !viaKey.trim()) return null
  try {
    const raw = window.sessionStorage.getItem(`${GUARDRAIL_OVERRIDE_PREFIX}${viaKey.trim()}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { grant?: string; expiresAt?: number }
    if (!parsed.grant || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(`${GUARDRAIL_OVERRIDE_PREFIX}${viaKey.trim()}`)
      return null
    }
    return parsed.grant
  } catch {
    return null
  }
}

export function evaluateViaActionGuardrail(params: {
  viaId: string
  viaLabel: string
  viaTier?: string | null
  isSoaking72h?: boolean
  targetUrl: string
}): { allowed: true } | GuardrailBlockedDecision {
  const viaKey = (params.viaId || params.viaLabel || '').trim()
  if (viaKey && getValidOwnerOverrideGrant(viaKey)) {
    return { allowed: true }
  }

  const cleanUrl = (params.targetUrl || '').trim()
  const urlLower = cleanUrl.toLowerCase()
  const isKeepalive = urlLower.includes('adsops_keepalive_session=1')

  if (params.isSoaking72h) {
    const hitsAdsManager = urlLower.includes('adsmanager.facebook.com')
    const hitsBm = urlLower.includes('business.facebook.com') && !isKeepalive
    const hitsSecurity = urlLower.includes('accountscenter.facebook.com/password_and_security')
    if (hitsAdsManager || hitsBm || hitsSecurity) {
      return {
        allowed: false,
        code: 'soak_72h_blocked',
        viaId: params.viaId,
        viaLabel: params.viaLabel,
        viaTier: '72h_lock',
        targetUrl: cleanUrl,
        targetScope: 'soak_72h_quarantine',
        reason:
          'Via này đang ở giai đoạn Ngâm 72h Vàng (cách ly trình duyệt mới). Thao tác Trình quản lý Quảng cáo, Business Manager hoặc Đổi mật khẩu/Passkey lúc này rất dễ kích hoạt Checkpoint.',
        recommendedAlternative:
          'Chỉ nên chạy Đảo Ấm Cookie (lướt News Feed tự nhiên) hoặc chờ hết đủ 72h trước khi mở BM / Ads Manager.',
      }
    }
  }

  const normTier = (params.viaTier || '').trim().toLowerCase()
  if (normTier === 'vault' && urlLower.includes('adsmanager.facebook.com')) {
    return {
      allowed: false,
      code: 'vault_ads_blocked',
      viaId: params.viaId,
      viaLabel: params.viaLabel,
      viaTier: 'vault',
      targetUrl: cleanUrl,
      targetScope: 'ads_manager_campaign',
      reason:
        'Via Lớp 1 (Via Tổng Hold BM / Giữ Fanpage) được bảo vệ không cho mở Trình quản lý Quảng cáo hay lên chiến dịch để tránh chết liên đới toàn bộ BM và dàn Fanpage gốc.',
      recommendedAlternative:
        'Hãy Share quyền TKQC sang Via Lớp 2 (Via Lên Camp) để chạy quảng cáo; Via Lớp 1 chỉ dùng vào Cài đặt BM (business.facebook.com) hoặc giữ tài sản.',
    }
  }

  return { allowed: true }
}

function appendGuardrailOverrideParam(targetUrl: string): string {
  const clean = (targetUrl || '').trim()
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) return clean
  try {
    const parsed = new URL(clean)
    parsed.searchParams.set('adsops_guard_override', '1')
    return parsed.toString()
  } catch {
    return clean.includes('?') ? `${clean}&adsops_guard_override=1` : `${clean}?adsops_guard_override=1`
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
    viaTier?: string | null
    isSoaking72h?: boolean
    overrideGrant?: string | null
  },
): Promise<'bridge' | 'protocol'> {
  const profileDir = resolveChromeProfileDirectory(browserProfileLabel, viaLabel)
  const nameHint = (browserProfileLabel || viaLabel || '').trim()
  const cleanProxy = (proxyLabel || '').trim()
  const viaLookupKey = (extra?.viaId || viaLabel || '').trim()
  const effectiveGrant = extra?.overrideGrant || (viaLookupKey ? getValidOwnerOverrideGrant(viaLookupKey) : null)
  const effectiveUrl = effectiveGrant ? appendGuardrailOverrideParam(targetUrl) : targetUrl

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(effectiveUrl).catch(() => {})
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
        url: effectiveUrl,
        antidetect_engine: extra?.antidetectEngine || undefined,
        antidetect_profile_id: extra?.antidetectProfileId || undefined,
        via_tier: extra?.viaTier || undefined,
        soak_72h: Boolean(extra?.isSoaking72h),
        override_grant: effectiveGrant || undefined,
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

  const protocolUrl = buildAdsOpsChromeProtocolUrl(effectiveUrl, browserProfileLabel, viaLabel, cleanProxy)
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
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME_EXE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if "%CHROME_EXE%"=="" if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if "%CHROME_EXE%"=="" if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME_EXE=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
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


export function hydrateExtensionFilesLocally(
  rawFiles: Array<{ name: string; content: string }>,
  opts: {
    viaName: string
    profileDir: string
    rawProxy: string
    twoFaSecret: string
    bridgeToken: string
  },
): Array<{ name: string; content: string }> {
  const parsed = parseProxyString(opts.rawProxy)
  const hasProxy = Boolean(parsed?.host)
  const proxyRawStr = parsed
    ? `${parsed.host}:${parsed.port}${parsed.user ? `:${parsed.user}:${parsed.pass}` : ''}`
    : ''
  const cleanTwoFa = (opts.twoFaSecret || '').replace(/\s+/g, '').toUpperCase()
  const manifestName = hasProxy
    ? `AdsOps Companion Pro · ${opts.profileDir} · Proxy ${parsed!.host}:${parsed!.port}`
    : `AdsOps Companion Pro · ${opts.profileDir} (${opts.viaName})`

  return rawFiles.map((f) => {
    if (f.name.endsWith('/manifest.json')) {
      try {
        const obj = JSON.parse(f.content) as Record<string, unknown>
        if (obj.name === '__ADSOPS_MANIFEST_NAME__') {
          obj.name = manifestName
        }
        return { name: f.name, content: JSON.stringify(obj, null, 2) }
      } catch {
        return f
      }
    }
    if (f.name.endsWith('/background.js') || f.name.endsWith('/popup.js')) {
      const hydrated = f.content
        .split('"__ADSOPS_PROXY_RAW_JSON__"').join(JSON.stringify(proxyRawStr))
        .split('"__ADSOPS_PROXY_ENABLED_BOOL__"').join(hasProxy ? 'true' : 'false')
        .split('"__ADSOPS_TOTP_SECRET_JSON__"').join(JSON.stringify(cleanTwoFa))
        .split('"__ADSOPS_BRIDGE_TOKEN_JSON__"').join(JSON.stringify(opts.bridgeToken))
      return { name: f.name, content: hydrated }
    }
    return f
  })
}

export async function downloadChromeExtensionZip(
  viaName = 'Tài Khoản Chính',
  profileDir = 'Default',
  rawProxy = '',
  bundledAccounts: ExtensionBundledAccount[] = [],
  twoFaSecret = '',
  viaTier: 'vault' | 'camp' | 'standby' = 'camp',
  viaId = '',
  extraMeta?: ExtensionStewardshipMeta,
): Promise<void> {
  const slug = profileDir.replace(/[^a-zA-Z0-9_-]/g, '-')
  const meta = extraMeta || {}
  const bridgeToken = (meta.bridgeToken || getLocalBridgeToken() || '').trim()
  const res = await api.post<{
    canary_id: string
    version: string
    files: Array<{ name: string; content: string }>
  }>('/api/v1/extension/package-bundle', {
    folder_root: 'AdsOps-Chrome-Extension',
    via_name: viaName,
    profile_dir: profileDir,
    via_tier: viaTier,
    via_id: viaId,
    bundled_accounts: bundledAccounts,
    stewardship_meta: {
      client_group: meta.clientGroup ?? null,
      warmup_phase: meta.warmupPhase ?? null,
      warmup_start_iso: meta.warmupStartIso ?? null,
      soak_hours_remaining: meta.soakHoursRemaining ?? null,
      default_warmup_mode: meta.defaultWarmupMode ?? null,
      soak_quarantine_enabled: meta.soakQuarantineEnabled !== false,
      ip_kill_switch: meta.ipKillSwitch !== false,
      auto_vault_cookie_refresh: meta.autoVaultCookieRefresh !== false,
      cooldown_until_ms: meta.cooldownUntilMs ?? null,
      cooldown_reason: meta.cooldownReason ?? null,
      trust_score: meta.trustScore ?? null,
    },
  })
  const hydrated = hydrateExtensionFilesLocally(res.files || [], {
    viaName,
    profileDir,
    rawProxy,
    twoFaSecret,
    bridgeToken,
  })
  const zipBlob = buildStoreZip(hydrated)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Chrome-Extension-${res.version || '2.11.0'}-${slug}.zip`
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

export async function downloadAllViasExtensionsBundleZip(items: ViaExtensionBundleSpec[]): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return
  const allFiles: Array<{ name: string; content: string | Uint8Array }> = []
  const guideLines: string[] = [
    'TRON BO TIEN ICH ADSOPS COMPANION PRO CHO TOAN BO DAN VIA (WATERMARKED)',
    '======================================================================',
    `Tong so thu muc Extension da dong goi: ${items.length} Via`,
    '',
  ]

  for (let idx = 0; idx < items.length; idx++) {
    const spec = items[idx]
    const slug = spec.profileDir.replace(/[^a-zA-Z0-9_-]/g, '-')
    const folderName = `${String(idx + 1).padStart(2, '0')}-${slug}-${spec.viaName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 28)}`
    const meta = spec.extraMeta || {}
    const bridgeToken = (meta.bridgeToken || getLocalBridgeToken() || '').trim()
    const res = await api.post<{
      canary_id: string
      version: string
      files: Array<{ name: string; content: string }>
    }>('/api/v1/extension/package-bundle', {
      folder_root: folderName,
      via_name: spec.viaName,
      profile_dir: spec.profileDir,
      via_tier: spec.viaTier,
      via_id: spec.viaId || '',
      bundled_accounts: spec.bundledAccounts || [],
      stewardship_meta: {
        client_group: meta.clientGroup ?? null,
        warmup_phase: meta.warmupPhase ?? null,
        warmup_start_iso: meta.warmupStartIso ?? null,
        soak_hours_remaining: meta.soakHoursRemaining ?? null,
        default_warmup_mode: meta.defaultWarmupMode ?? null,
        soak_quarantine_enabled: meta.soakQuarantineEnabled !== false,
        ip_kill_switch: meta.ipKillSwitch !== false,
        auto_vault_cookie_refresh: meta.autoVaultCookieRefresh !== false,
        cooldown_until_ms: meta.cooldownUntilMs ?? null,
        cooldown_reason: meta.cooldownReason ?? null,
        trust_score: meta.trustScore ?? null,
      },
    })
    guideLines.push(`  - [${idx + 1}] Via "${spec.viaName}" (${spec.profileDir}) -> ${folderName} [${res.canary_id}]`)
    allFiles.push(
      ...hydrateExtensionFilesLocally(res.files || [], {
        viaName: spec.viaName,
        profileDir: spec.profileDir,
        rawProxy: spec.rawProxy,
        twoFaSecret: spec.twoFaSecret,
        bridgeToken,
      }),
    )
  }

  allFiles.unshift({
    name: 'HUONG-DAN-CAI-NHANH-DAN-VIA.txt',
    content: guideLines.join('\r\n'),
  })

  const zipBlob = buildStoreZip(allFiles)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `AdsOps-Tron-Bo-Extension-${items.length}Via.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadDesktopProSecure(): Promise<void> {
  const res = await api.post<{ download_path: string; filename?: string }>(
    '/api/v1/extension/desktop-download-ticket',
    {},
  )
  const url = resolveApiUrl(res.download_path)
  const a = document.createElement('a')
  a.href = url
  a.download = res.filename || 'AdsOps-Desktop-Pro-latest.zip'
  document.body.appendChild(a)
  a.click()
  a.remove()
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
