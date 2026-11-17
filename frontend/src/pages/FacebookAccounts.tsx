import { useEffect, useMemo, useState } from 'react'
import { Pencil, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type {
  AutomationPlaybook,
  FacebookIdentitySummary,
  Paged,
  ProfileLaunchAuditRow,
  ReferenceRecord,
  TeamMember,
} from '../lib/types'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { PageHeader } from '../components/page/PageHeader'
import { SearchField, SelectField } from '../components/page/Filters'
import { EmptyState, ErrorState } from '../components/states'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { FacebookAccountFormSheet } from '../components/facebook/FacebookAccountFormSheet'
import { twoFactorTone } from '../lib/readiness'
import { useMaxViasPerProxy } from '../lib/proxyClusterPrefs'
import {
  ANTIDETECT_ENGINE_OPTIONS,
  WORKSTATION_REAL_CHROME_PROFILES,
  canMemberLaunchVia,
  downloadSwitchyOmegaConfig,
  downloadWindowsChromeLauncherBat,
  fetchAntidetectBenchmark,
  fetchRealLocalChromeProfiles,
  fetchWorkstationTelemetry,
  getAntidetectEngineLabel,
  launchInAssignedChromeProfile,
  normalizeProxyKey,
  parseAntidetectFromNotes,
  probeLocalDesktopBridge,
} from '../lib/chromeProfileLauncher'

const LEGACY_MOCK_NETWORKS = [
  'vnpt static ip — line #',
  'fpt static ip — line #',
  'viettel residential — line #',
  'mobile 4g/5g vn — line #',
  'mạng gốc văn phòng',
  'proxy dân cư tĩnh vn #',
  'vn static residential proxy #',
  'office direct line',
]

function isRealNetworkLabel(val: string): boolean {
  const clean = val.trim()
  if (!clean) return false
  const lower = clean.toLowerCase()
  return !LEGACY_MOCK_NETWORKS.some((p) => lower.startsWith(p))
}

interface ProxyHealthItem {
  ok: boolean
  status: 'LIVE' | 'DEAD' | 'INVALID'
  ssrf_blocked?: boolean
  exit_ip: string | null
  country_code: string | null
  country_name: string | null
  timezone?: string | null
  timezone_match?: boolean | null
  timezone_warning?: string | null
  latency_ms: number | null
  normalized_key: string
  error_summary?: string | null
  checked_at?: string | null
}

export type ViaRoleTier = 'vault' | 'camp' | 'standby'

function parseViaMetaFromNotes(
  notesRaw: string,
  label: string,
  bmCount: number,
  adCount: number,
  _createdAt?: string | null,
): {
  tier: ViaRoleTier
  warmupStartIso: string
  cleanNotes: string
} {
  const notes = String(notesRaw || '')
  const tierMatch = notes.match(/\[TIER:(vault|camp|standby)\]/i)
  const warmupMatch = notes.match(/\[WARMUP:([0-9T:.-]+Z?)\]/i)

  let tier: ViaRoleTier = 'camp'
  if (tierMatch) {
    tier = tierMatch[1].toLowerCase() as ViaRoleTier
  } else {
    const lblLower = label.toLowerCase()
    if (bmCount >= 3 || lblLower.includes('chính') || lblLower.includes('tổng')) {
      tier = 'vault'
    } else if (adCount === 0 || lblLower.includes('mới') || lblLower.includes('dự phòng') || lblLower.includes('via 3')) {
      tier = 'standby'
    } else {
      tier = 'camp'
    }
  }

  const warmupStartIso = warmupMatch?.[1] || ''
  const cleanNotes = notes
    .replace(/\[TIER:(?:vault|camp|standby)\]/gi, '')
    .replace(/\[WARMUP:[0-9T:.-]+Z?\]/gi, '')
    .trim()

  return { tier, warmupStartIso, cleanNotes }
}

function buildUpdatedNotes(cleanNotes: string, tier: ViaRoleTier, warmupStartIso: string): string {
  const prefix = `[TIER:${tier}] [WARMUP:${warmupStartIso}]`
  return cleanNotes ? `${prefix} ${cleanNotes}` : prefix
}

function computeWarmupStatus(warmupStartIso: string): {
  hoursElapsed: number
  daysElapsed: number
  phase: '72h_lock' | '7d_warmup' | 'trusted'
  label: string
  hint: string
  tone: 'caution' | 'info' | 'positive'
} {
  const startMs = Date.parse(warmupStartIso)
  const validStart = Number.isNaN(startMs) ? Date.now() - 10 * 86400_000 : startMs
  const diffMs = Math.max(0, Date.now() - validStart)
  const hoursElapsed = Math.floor(diffMs / 3600_000)
  const daysElapsed = Math.floor(diffMs / 86400_000)

  if (hoursElapsed < 72) {
    return {
      hoursElapsed,
      daysElapsed,
      phase: '72h_lock',
      label: `⏳ Ngâm 72h vàng (${hoursElapsed}/72h)`,
      hint: 'Đang trong 72h đầu: CẤM vào Ads Manager, CẤM đổi mật khẩu, CẤM đá thiết bị cũ. Chỉ lướt Newsfeed/Watch 5–10p.',
      tone: 'caution',
    }
  }
  if (daysElapsed < 7) {
    return {
      hoursElapsed,
      daysElapsed,
      phase: '7d_warmup',
      label: `🟡 Ngâm ngày ${daysElapsed}/7`,
      hint: 'Từ ngày 4–7: Có thể nhận link mời BM qua email nhưng chưa nên đá thiết bị cũ hoặc lên camp nặng.',
      tone: 'info',
    }
  }
  return {
    hoursElapsed,
    daysElapsed,
    phase: 'trusted',
    label: `✅ Đã ngâm > 7 ngày (Đã Trust)`,
    hint: 'Thiết bị Chrome & IP của Via này đã đủ độ tin cậy (Trusted Device). Có thể vận hành ổn định.',
    tone: 'positive',
  }
}

function extractBase32Secret(vaultRef?: unknown): string | null {
  const raw = String(vaultRef ?? '').trim()
  if (!raw || raw.startsWith('meta-user://') || raw.startsWith('http')) return null
  const stripped = raw.replace(/^2fa:\/\//i, '').replace(/[\s-]/g, '').toUpperCase()
  if (/^[A-Z2-7]{12,128}$/.test(stripped)) {
    return stripped
  }
  return null
}

function base32ToBytes(b32: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (let i = 0; i < b32.length; i++) {
    const idx = alphabet.indexOf(b32[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

async function generateTotpCode(secretBase32: string): Promise<string> {
  const keyBytes = base32ToBytes(secretBase32)
  const epochSec = Math.floor(Date.now() / 1000)
  const counter = Math.floor(epochSec / 30)
  const counterBytes = new Uint8Array(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await window.crypto.subtle.sign('HMAC', cryptoKey, counterBytes as unknown as BufferSource))
  const offset = sig[sig.length - 1] & 0x0f
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function TwoFactorOtpCell({
  row,
  canWrite,
  badgeLabel,
  onSaveSecret,
}: {
  row: ReferenceRecord
  canWrite: boolean
  badgeLabel: string
  onSaveSecret: (id: string, secret: string) => void
}) {
  const secret = extractBase32Secret(row.vault_reference)
  const [otp, setOtp] = useState<string>('------')
  const [secLeft, setSecLeft] = useState<number>(30 - (Math.floor(Date.now() / 1000) % 30))
  const [copied, setCopied] = useState(false)
  const [editingKey, setEditingKey] = useState(false)
  const [draftKey, setDraftKey] = useState(secret ?? '')

  useEffect(() => {
    if (!secret) return
    let cancelled = false
    const tick = () => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30)
      setSecLeft(rem)
      void generateTotpCode(secret)
        .then((code) => {
          if (!cancelled) setOtp(code)
        })
        .catch(() => {})
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [secret])

  if (editingKey) {
    return (
      <div className="space-y-1.5 min-w-[175px]">
        <input
          type="text"
          className="input font-mono text-xs py-1 px-2"
          placeholder="Dán khóa 2FA (VD: JBSWY3DP...)"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => {
              const cleaned = draftKey.replace(/[\s-]/g, '').toUpperCase()
              onSaveSecret(row.id, cleaned ? `2fa://${cleaned}` : '')
              setEditingKey(false)
            }}
            className="rounded bg-brand px-2 py-0.5 font-semibold text-brand-fg hover:bg-brand-hover"
          >
            Lưu 2FA
          </button>
          <button
            type="button"
            onClick={() => setEditingKey(false)}
            className="rounded border border-line px-2 py-0.5 text-ink-muted hover:bg-surface-muted"
          >
            Hủy
          </button>
        </div>
      </div>
    )
  }

  if (secret) {
    return (
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1">
          <span className="font-mono text-xs font-extrabold tracking-wider text-emerald-700 dark:text-emerald-300 tabular-nums">
            {otp.slice(0, 3)} {otp.slice(3)}
          </span>
          <span className="font-mono text-[10px] text-ink-muted tabular-nums">({secLeft}s)</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(otp)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-500"
            title="Sao chép mã OTP 2FA 6 số"
          >
            {copied ? 'Đã chép' : 'Copy'}
          </button>
        </div>
        {canWrite && (
          <div>
            <button
              type="button"
              onClick={() => {
                setDraftKey(secret)
                setEditingKey(true)
              }}
              className="text-[10px] text-ink-muted hover:text-brand-text hover:underline"
            >
              ✎ Đổi khóa 2FA
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Badge tone={twoFactorTone(String(row.two_factor_method))}>{badgeLabel}</Badge>
      {canWrite && (
        <div>
          <button
            type="button"
            onClick={() => {
              setDraftKey('')
              setEditingKey(true)
            }}
            className="text-[11px] font-medium text-brand-text hover:underline"
            title="Dán chuỗi khóa 2FA (Secret Key) để tự động lấy mã OTP 6 số trực tiếp trên bảng"
          >
            + Gắn khóa 2FA (Lấy mã 6 số)
          </button>
        </div>
      )}
    </div>
  )
}


export default function FacebookAccounts() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'owner'
  const canWrite = role !== 'viewer'
  const canAssignOwner = role === 'owner' || role === 'admin'
  const [maxViasPerProxy] = useMaxViasPerProxy()

  const [search, setSearch] = useState('')
  const [holder, setHolder] = useState('')
  const [ownershipFilter, setOwnershipFilter] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | ViaRoleTier | 'risk'>('all')
  const [engineFilter, setEngineFilter] = useState('')
  const [proxyFilter, setProxyFilter] = useState('')
  const [showHubPanel, setShowHubPanel] = useState<'none' | 'playbooks' | 'audit' | 'onboarding'>('none')
  const [playbookPlatform, setPlaybookPlatform] = useState('all')
  const [creatingPlaybook, setCreatingPlaybook] = useState(false)
  const [pbTitle, setPbTitle] = useState('')
  const [pbPlatform, setPbPlatform] = useState<'meta' | 'google_ads' | 'tiktok' | 'multi'>('meta')
  const [pbTargetUrl, setPbTargetUrl] = useState('https://www.facebook.com/')
  const [pbStagger, setPbStagger] = useState(60)
  const [pbJitter, setPbJitter] = useState(35)
  const [pbDesc, setPbDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ReferenceRecord | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['personal-account-references', 'facebook-list', search],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/personal-account-references${query({ search, page_size: 200 })}`),
  })
  const summary = useQuery({
    queryKey: ['facebook-identities', 'summary'],
    queryFn: () => api.get<FacebookIdentitySummary[]>('/api/v1/facebook-identities/summary'),
  })
  const members = useQuery({
    queryKey: ['team-members', 'options'],
    queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'),
    retry: false,
  })
  const localChrome = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    initialData: WORKSTATION_REAL_CHROME_PROFILES,
    retry: false,
  })
  const desktopBridgeQ = useQuery({
    queryKey: ['local-desktop-bridge-probe'],
    queryFn: () => probeLocalDesktopBridge(),
    refetchInterval: 10000,
    retry: false,
  })
  const bridgeProbe = desktopBridgeQ.data
  const proxyHealthQ = useQuery({
    queryKey: ['proxy-health-map'],
    queryFn: () => api.get<{ health_map: Record<string, ProxyHealthItem> }>('/api/v1/proxies/health-map'),
    retry: false,
  })
  const workstationQ = useQuery({
    queryKey: ['local-workstation-telemetry'],
    queryFn: () => fetchWorkstationTelemetry(),
    enabled: Boolean(bridgeProbe?.isDesktopApp),
    refetchInterval: 8000,
    retry: false,
  })
  const benchmarkQ = useMutation({
    mutationFn: () => fetchAntidetectBenchmark(),
  })
  const playbooksQ = useQuery({
    queryKey: ['automation-playbooks', playbookPlatform],
    queryFn: () =>
      api.get<AutomationPlaybook[]>(
        playbookPlatform === 'all' ? '/api/v1/playbooks' : `/api/v1/playbooks?platform=${playbookPlatform}`,
      ),
    retry: false,
  })
  const launchAuditQ = useQuery({
    queryKey: ['profile-launch-audit'],
    queryFn: () => api.get<ProfileLaunchAuditRow[]>('/api/v1/playbooks/launch-audit?limit=50'),
    enabled: showHubPanel === 'audit',
    retry: false,
  })
  const createPlaybookMut = useMutation({
    mutationFn: () =>
      api.post<AutomationPlaybook>('/api/v1/playbooks', {
        title: pbTitle,
        platform: pbPlatform,
        category: 'custom',
        description: pbDesc,
        version_tag: '1.0.0',
        default_stagger_sec: pbStagger,
        jitter_pct: pbJitter,
        steps: [{ action: 'open_url', target: pbTargetUrl, wait_sec: 15, note: 'Jitter batch step' }],
      }),
    onSuccess: () => {
      setCreatingPlaybook(false)
      setPbTitle('')
      setPbDesc('')
      void queryClient.invalidateQueries({ queryKey: ['automation-playbooks'] })
      setSyncNotice('Đã tạo và chia sẻ Kịch bản Team mới.')
    },
  })
  const ratePlaybookMut = useMutation({
    mutationFn: ({ id, stars }: { id: string; stars: number }) =>
      api.post<AutomationPlaybook>(`/api/v1/playbooks/${id}/rate`, { stars, comment: '' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['automation-playbooks'] }),
  })
  const recordPlaybookRunMut = useMutation({
    mutationFn: ({ id, via_ids, engine, stagger_sec, jitter_pct }: { id: string; via_ids: string[]; engine: string; stagger_sec: number; jitter_pct: number }) =>
      api.post<AutomationPlaybook>(`/api/v1/playbooks/${id}/record-run`, {
        via_ids,
        engine,
        stagger_sec,
        jitter_pct,
        workstation: 'Web Control Center',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automation-playbooks'] })
      void queryClient.invalidateQueries({ queryKey: ['profile-launch-audit'] })
    },
  })
  const checkSingleProxy = useMutation({
    mutationFn: (payload: string | { proxy_string: string; expected_timezone?: string | null; via_label?: string }) => {
      const body = typeof payload === 'string' ? { proxy_string: payload } : payload
      return api.post<ProxyHealthItem>('/api/v1/proxies/check-live', body)
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['proxy-health-map'] })
      setSyncNotice(
        res.status === 'LIVE'
          ? `🟢 Proxy ${res.normalized_key} SỐNG — IP ra: ${res.exit_ip ?? '—'} (${res.country_code ?? '—'}${res.timezone ? ` · ${res.timezone}` : ''} · ${res.latency_ms ?? 0}ms)${res.timezone_warning ? ` — ⚠️ ${res.timezone_warning}` : ''}`
          : `🔴 Proxy ${res.normalized_key || ''} LỖI/CHẾT: ${res.error_summary ?? 'Không phản hồi'}`,
      )
    },
  })
  const checkBatchProxies = useMutation({
    mutationFn: () =>
      api.post<{ checked_count: number; live_count: number; dead_count: number }>('/api/v1/proxies/check-batch', {}),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['proxy-health-map'] })
      setSyncNotice(
        `🩺 Đã kiểm tra ${res.checked_count} Proxy: 🟢 ${res.live_count} Sống · 🔴 ${res.dead_count} Chết/Lỗi.`,
      )
    },
  })

  const syncFromMeta = useMutation({
    mutationFn: () =>
      api.post<{ status: string; total_business_users?: number; total_ad_accounts?: number }>(
        '/api/v1/meta-operations/quick-sync',
        { business_manager_reference: '' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setSyncNotice('Đã tự động lấy toàn bộ danh sách Via (Business Users), BM và TKQC thật từ Meta Graph API.')
      setTimeout(() => setSyncNotice(null), 5000)
    },
  })

  const quickUpdateProfile = useMutation({
    mutationFn: ({ id, browser_profile_label }: { id: string; browser_profile_label: string }) =>
      api.patch(`/api/v1/personal-account-references/${id}`, { browser_profile_label }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const quickUpdateNotes = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.patch(`/api/v1/personal-account-references/${id}`, { notes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
    },
  })

  const quickUpdate2fa = useMutation({
    mutationFn: ({ id, vault_reference }: { id: string; vault_reference: string }) =>
      api.patch(`/api/v1/personal-account-references/${id}`, {
        vault_reference,
        two_factor_method: vault_reference ? 'app' : 'none',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
    },
  })

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/personal-account-references/${id}/archive`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
    },
  })

  const bySummary = useMemo(() => new Map((summary.data ?? []).map((row) => [row.id, row])), [summary.data])
  const allBaseRows = list.data?.items ?? []

  // Precompute role tier, warmup status, and anti-die warnings for every Via
  const enrichedRows = useMemo(() => {
    return allBaseRows.map((row) => {
      const s = bySummary.get(row.id)
      const bmCount = s?.business_manager_count ?? 0
      const adCount = s?.ad_account_count ?? 0
      const browserLabel = String(row.browser_profile_label ?? '').trim()
      const rawNetwork = String(row.network_label ?? '').trim()
      const networkLabel = isRealNetworkLabel(rawNetwork) ? rawNetwork : ''
      const meta = parseViaMetaFromNotes(String(row.notes ?? ''), String(row.label ?? ''), bmCount, adCount, row.created_at)
      const warmup = meta.warmupStartIso ? computeWarmupStatus(meta.warmupStartIso) : null

      const sharedBrowser =
        s?.shared_browser_profile_with ??
        (browserLabel
          ? allBaseRows
              .filter(
                (o) =>
                  o.id !== row.id &&
                  String(o.browser_profile_label ?? '').trim().toLowerCase() === browserLabel.toLowerCase(),
              )
              .map((o) => String(o.label))
          : [])

      const sharedNetwork =
        networkLabel
          ? allBaseRows
              .filter(
                (o) =>
                  o.id !== row.id &&
                  isRealNetworkLabel(String(o.network_label ?? '')) &&
                  String(o.network_label ?? '').trim().toLowerCase() === networkLabel.toLowerCase(),
              )
              .map((o) => String(o.label))
          : []

      const risks: string[] = []
      if (sharedBrowser.length > 0) {
        risks.push(`Trùng Chrome Profile với: ${sharedBrowser.join(', ')}`)
      }
      if (!browserLabel) {
        risks.push('Chưa gắn cố định Hồ sơ Chrome riêng')
      }
      if (meta.tier === 'camp' && bmCount > 2) {
        risks.push(`Via Lên Camp đang nắm ${bmCount} BM (Nên chuyển quyền Admin BM về Via Tổng)`)
      }
      if (sharedNetwork.length >= maxViasPerProxy) {
        risks.push(`1 Proxy đang gắn cho ${sharedNetwork.length + 1} Via (Vượt mức ≤ ${maxViasPerProxy} Via/Proxy)`)
      }

      const adMeta = parseAntidetectFromNotes(String(row.notes ?? ''))

      return {
        row,
        s,
        bmCount,
        adCount,
        browserLabel,
        networkLabel,
        meta,
        adMeta,
        warmup,
        sharedBrowser,
        sharedNetwork,
        risks,
      }
    })
  }, [allBaseRows, bySummary, maxViasPerProxy])

  const distinctProxyFilterOptions = useMemo(() => {
    const keys = new Set<string>()
    for (const item of enrichedRows) {
      const k = normalizeProxyKey(item.networkLabel)
      if (k) keys.add(k)
    }
    return Array.from(keys).sort()
  }, [enrichedRows])

  const currentMemberId = useMemo(() => {
    const listMembers = members.data ?? []
    const matched = listMembers.find(
      (m) => (user?.id && m.user_id === user.id) || (user?.email && m.email.toLowerCase() === user.email.toLowerCase()),
    )
    return matched?.id ?? null
  }, [members.data, user])

  const tierStats = useMemo(() => {
    let vault = 0
    let camp = 0
    let standby = 0
    let risk = 0
    for (const item of enrichedRows) {
      if (item.meta.tier === 'vault') vault++
      else if (item.meta.tier === 'camp') camp++
      else standby++
      if (item.risks.length > 0) risk++
    }
    return { total: enrichedRows.length, vault, camp, standby, risk }
  }, [enrichedRows])

  const filteredItems = useMemo(() => {
    return enrichedRows.filter((item) => {
      if (holder && item.row.owner_member_id !== holder) return false
      if (ownershipFilter && (item.row.ownership_type ?? 'agency_owned') !== ownershipFilter) return false
      if (engineFilter && item.adMeta.engine !== engineFilter) return false
      if (proxyFilter === 'direct' && Boolean(item.networkLabel)) return false
      if (proxyFilter && proxyFilter !== 'direct' && normalizeProxyKey(item.networkLabel) !== proxyFilter) return false
      if (tierFilter === 'vault' && item.meta.tier !== 'vault') return false
      if (tierFilter === 'camp' && item.meta.tier !== 'camp') return false
      if (tierFilter === 'standby' && item.meta.tier !== 'standby') return false
      if (tierFilter === 'risk' && item.risks.length === 0) return false
      return true
    })
  }, [enrichedRows, holder, ownershipFilter, engineFilter, proxyFilter, tierFilter])

  const chromeOptions = localChrome.data ?? WORKSTATION_REAL_CHROME_PROFILES

  const columns = [
    'Tài khoản Via & Phân tầng Chống Die',
    'Môi trường đăng nhập (Chrome & Proxy) & Độ Trust',
    t('fb.owner'),
    t('fb.twoFactor'),
    t('fb.businessManagers'),
    t('fb.adAccounts'),
    t('fb.status'),
    ...(canWrite ? [t('fb.form.editBtn')] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('fb.title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {chromeOptions.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                🟢 Đã kết nối {chromeOptions.length} Hồ sơ Chrome thật trên máy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-ink-muted">
                ⚪ Cầu nối Desktop (:17890) chưa bật — mở AdsOps Desktop Pro để đọc Hồ sơ Chrome thật
              </span>
            )}
            {canWrite && (
              <Button
                type="button"
                variant="secondary"
                disabled={syncFromMeta.isPending}
                onClick={() => syncFromMeta.mutate()}
                title="Tự động quét toàn bộ Via (Business Users), Email, 2FA, BM và TKQC từ Meta Graph API mà không cần nhập tay"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncFromMeta.isPending ? 'animate-spin' : ''}`} />
                {syncFromMeta.isPending ? 'Đang lấy Via từ Meta...' : 'Tự động lấy Via từ Meta'}
              </Button>
            )}
            {canWrite && (
              <Button
                type="button"
                variant="secondary"
                disabled={checkBatchProxies.isPending}
                onClick={() => checkBatchProxies.mutate()}
                title="Kiểm tra hàng loạt xem Proxy gắn cho từng Via còn sống hay đã chết, IP ra & Quốc gia nào"
              >
                {checkBatchProxies.isPending ? '🩺 Đang kiểm tra Proxy...' : '🩺 Kiểm tra tất cả Proxy'}
              </Button>
            )}
            {bridgeProbe?.isDesktopApp && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300"
                title={`AdsOps Desktop Pro đang chạy ngầm tại 127.0.0.1:${bridgeProbe.port || 17890}`}
              >
                💻 App Windows v{bridgeProbe.version || '2.6.5'} Đang Chạy
              </span>
            )}
            <a
              href="/downloads/AdsOps-Desktop-Pro-v2.3.zip"
              download
              className="inline-flex h-9 items-center gap-1 rounded-md border border-indigo-500/45 bg-indigo-500/15 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-300"
              title="Tải App Windows AdsOps Desktop Pro v2.6.5 (Tự gia hạn phiên 24/7 DPAPI, Chrome Profile gốc & Cô lập, Broker PID Tracking, Chia Proxy 1:4, Watchdog, 5 Engine Antidetect & Extension v2.10.0)"
            >
              💻 Tải App Windows v2.6.5 (.zip)
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'playbooks' ? 'none' : 'playbooks'))}
              title="Mở Chợ Kịch bản Team (Meta / Google Ads / TikTok) & chạy lô lệch pha Jitter"
            >
              📚 Kịch bản Team ({playbooksQ.data?.length ?? 0})
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'audit' ? 'none' : 'audit'))}
              title="Xem Nhật ký Team: Ai đã mở Profile nào, bằng Engine gì, lúc nào"
            >
              🕵️ Nhật ký Mở Profile
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'onboarding' ? 'none' : 'onboarding'))}
              title="Hướng dẫn Thiết lập An toàn 5 bước cho người mới"
            >
              🛡️ Hướng dẫn 5 Bước
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={downloadWindowsChromeLauncherBat}
              title="Tải file .bat dự phòng cho máy Windows khác"
              data-testid="fb-chrome-launcher-setup"
            >
              ⚡ Tải .bat dự phòng
            </Button>
            {canWrite && (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('fb.empty.action')}
              </Button>
            )}
          </div>
        }
      />

      {syncNotice && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          ✓ {syncNotice}
        </div>
      )}

      {/* THANH GIÁM SÁT RAM MÁY TRẠM + BENCHMARK 5 ENGINE (CHỈ HIỆN DỮ LIỆU THẬT TỪ BRIDGE) */}
      {bridgeProbe?.isDesktopApp && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-ink">
              💻 RAM máy trạm:{' '}
              {workstationQ.data?.workstation_memory
                ? `${workstationQ.data.workstation_memory.available_physical_mb.toLocaleString()}/${workstationQ.data.workstation_memory.total_physical_mb.toLocaleString()} MB trống (Khuyên tối đa ${workstationQ.data.workstation_memory.recommended_max_concurrent} luồng)`
                : 'Đang đọc...'}
            </span>
            <span className="text-ink-muted">
              • Phiên đang chạy: <strong className="text-ink">{workstationQ.data?.active_count ?? 0}</strong>
            </span>
            {benchmarkQ.data && (
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                ⚡ Engine nhanh nhất: {getAntidetectEngineLabel(benchmarkQ.data.recommended_engine)} (
                {benchmarkQ.data.probes
                  .filter((p) => p.Online)
                  .map((p) => `${getAntidetectEngineLabel(p.Engine)} ${p.LatencyMs}ms`)
                  .join(' · ') || 'Chrome Gốc'}
                )
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={benchmarkQ.isPending}
            onClick={() => benchmarkQ.mutate()}
          >
            {benchmarkQ.isPending ? '⏱️ Đang đo tốc độ...' : '⏱️ Benchmark 5 Engine'}
          </Button>
        </div>
      )}

      {/* BẢNG MỞ RỘNG: CHỢ KỊCH BẢN TEAM / NHẬT KÝ MỞ PROFILE / LỘ TRÌNH AN TOÀN 5 BƯỚC */}
      {showHubPanel === 'onboarding' && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">🛡️ Lộ trình Thiết lập An toàn 5 Bước cho Người mới</h3>
            <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
              Đóng ✕
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-5 text-xs">
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">1. Cầu nối Desktop</div>
              <div className="text-ink-muted mt-0.5">{bridgeProbe?.isDesktopApp ? `✓ Đã bật Zero-Trust :${bridgeProbe.port || 17890}` : '○ Tải & bật AdsOps Desktop Pro'}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">2. Phân tầng 3 lớp</div>
              <div className="text-ink-muted mt-0.5">{tierStats.vault > 0 ? `✓ Có ${tierStats.vault} Via Hold BM` : '○ Gắn ít nhất 1 Via Tổng Hold BM'}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">3. Cách ly Profile</div>
              <div className="text-ink-muted mt-0.5">{tierStats.risk === 0 && tierStats.total > 0 ? '✓ Sạch 0 trùng Silo' : `⚠ ${tierStats.risk} Via cần tách Profile/Proxy`}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">4. Proxy & Múi giờ</div>
              <div className="text-ink-muted mt-0.5">Bấm «Kiểm tra tất cả Proxy» để xác nhận IP khớp Múi giờ Via.</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">5. Jitter thay đồng bộ</div>
              <div className="text-ink-muted mt-0.5">Chạy kịch bản với nghỉ trễ ±35% Jitter để tránh Checkpoint hàng loạt.</div>
            </div>
          </div>
        </Card>
      )}

      {showHubPanel === 'playbooks' && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-ink">📚 Chợ Kịch Bản Team (Meta / Google Ads / TikTok) &amp; Chạy Lô Lệch Pha (Jitter)</h3>
              <p className="text-xs text-ink-muted">Thay vì nhân bản chuột đồng thời dễ dính Checkpoint chùm, hệ thống chạy tuần tự có nghỉ lệch pha ±35% và ghi lịch sử nhóm.</p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setCreatingPlaybook((v) => !v)}>
                  {creatingPlaybook ? 'Hủy tạo' : '➕ Tạo Kịch bản Team'}
                </Button>
              )}
              <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
                Đóng ✕
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['all', 'Tất cả'],
              ['meta', 'Meta Ads'],
              ['google_ads', 'Google Ads'],
              ['tiktok', 'TikTok Ads'],
              ['multi', 'Đa nền tảng'],
            ] as const).map(([pk, pl]) => (
              <button
                key={pk}
                type="button"
                onClick={() => setPlaybookPlatform(pk)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  playbookPlatform === pk ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface text-ink'
                }`}
              >
                {pl}
              </button>
            ))}
          </div>

          {creatingPlaybook && (
            <div className="grid gap-2 rounded-lg border border-line bg-surface-muted p-3 sm:grid-cols-3 text-xs">
              <input
                type="text"
                value={pbTitle}
                onChange={(e) => setPbTitle(e.target.value)}
                placeholder="Tên kịch bản mới..."
                className="rounded border border-line bg-surface px-2 py-1.5 text-ink"
              />
              <select
                value={pbPlatform}
                onChange={(e) => setPbPlatform(e.target.value as 'meta' | 'google_ads' | 'tiktok' | 'multi')}
                className="rounded border border-line bg-surface px-2 py-1.5 text-ink"
              >
                <option value="meta">Meta Ads</option>
                <option value="google_ads">Google Ads</option>
                <option value="tiktok">TikTok Ads</option>
                <option value="multi">Đa nền tảng</option>
              </select>
              <input
                type="text"
                value={pbTargetUrl}
                onChange={(e) => setPbTargetUrl(e.target.value)}
                placeholder="https://..."
                className="rounded border border-line bg-surface px-2 py-1.5 text-ink font-mono"
              />
              <input
                type="number"
                value={pbStagger}
                onChange={(e) => setPbStagger(Number(e.target.value) || 60)}
                placeholder="Nghỉ (giây)"
                className="rounded border border-line bg-surface px-2 py-1.5 text-ink"
              />
              <input
                type="number"
                value={pbJitter}
                onChange={(e) => setPbJitter(Number(e.target.value) || 35)}
                placeholder="Jitter (%)"
                className="rounded border border-line bg-surface px-2 py-1.5 text-ink"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pbDesc}
                  onChange={(e) => setPbDesc(e.target.value)}
                  placeholder="Mô tả..."
                  className="flex-1 rounded border border-line bg-surface px-2 py-1.5 text-ink"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!pbTitle.trim() || createPlaybookMut.isPending}
                  onClick={() => createPlaybookMut.mutate()}
                >
                  Lưu
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            {(playbooksQ.data ?? []).map((pb) => (
              <div key={pb.id} className="rounded-lg border border-line bg-surface-muted p-3 text-xs space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Badge tone="info">{pb.platform.toUpperCase()}</Badge>{' '}
                    <strong className="text-ink">{pb.title}</strong>{' '}
                    <span className="font-mono text-[10px] text-ink-muted">v{pb.version_tag}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                    {pb.rating_count > 0 && pb.avg_rating != null ? `★${pb.avg_rating.toFixed(1)} (${pb.rating_count})` : 'Chưa chấm sao'} • {pb.run_count} lượt
                  </span>
                </div>
                <div className="text-ink-muted">{pb.description}</div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => ratePlaybookMut.mutate({ id: pb.id, stars: st })}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          pb.my_rating === st ? 'bg-amber-500/20 font-bold text-amber-600' : 'text-ink-muted hover:text-amber-500'
                        }`}
                        title={`Chấm ${st} sao`}
                      >
                        {pb.my_rating === st ? `★${st}` : `☆${st}`}
                      </button>
                    ))}
                    <span className="ml-1 text-[10px] text-ink-muted">Tác giả: {pb.author_name}</span>
                  </div>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const eligible = filteredItems.filter((it) =>
                          canMemberLaunchVia(
                            role,
                            currentMemberId,
                            typeof it.row.owner_member_id === 'string' ? it.row.owner_member_id : null,
                          ).allowed,
                        )
                        if (eligible.length === 0) return
                        const firstUrl = pb.steps[0]?.target || 'https://www.facebook.com/'
                        const targetList = eligible.slice(0, 6)
                        recordPlaybookRunMut.mutate({
                          id: pb.id,
                          via_ids: targetList.map((t) => t.row.id),
                          engine: engineFilter || 'chrome_native',
                          stagger_sec: pb.default_stagger_sec,
                          jitter_pct: pb.jitter_pct,
                        })
                        targetList.forEach((t, idx) => {
                          const jitterMult = 1 + ((Math.random() * 2 - 1) * pb.jitter_pct) / 100
                          const delayMs = idx === 0 ? 0 : Math.max(1500, Math.round(idx * 1800 * jitterMult))
                          window.setTimeout(() => {
                            void launchInAssignedChromeProfile(firstUrl, t.browserLabel, String(t.row.label), t.networkLabel, {
                              viaId: t.row.id,
                              antidetectEngine: t.adMeta.engine,
                              antidetectProfileId: t.adMeta.profileId,
                            })
                          }, delayMs)
                        })
                        setSyncNotice(`🚀 Đang chạy kịch bản "${pb.title}" với Jitter ±${pb.jitter_pct}% cho ${targetList.length} Via đã lọc.`)
                      }}
                    >
                      🚀 Chạy Jitter ({Math.min(6, filteredItems.length)} Via)
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showHubPanel === 'audit' && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">🕵️ Nhật ký Team Mở Profile, Chạy Kịch bản &amp; Failover (Audit)</h3>
            <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
              Đóng ✕
            </button>
          </div>
          {launchAuditQ.isLoading ? (
            <div className="text-xs text-ink-muted">Đang tải nhật ký Team...</div>
          ) : (launchAuditQ.data ?? []).length === 0 ? (
            <div className="text-xs text-ink-muted">Chưa có sự kiện Mở Profile nào được ghi nhận trong Workspace.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-line text-xs">
              {(launchAuditQ.data ?? []).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Badge tone={row.action === 'via.engine_failover' ? 'caution' : 'info'}>{row.action}</Badge>{' '}
                    <strong className="text-ink">{row.via_label || '—'}</strong> · Engine:{' '}
                    <span className="font-mono">{getAntidetectEngineLabel(row.antidetect_engine)}</span>{' '}
                    {row.browser_profile && <span className="text-ink-muted">({row.browser_profile})</span>} · Người mở:{' '}
                    <strong className="text-brand-text">{row.actor_name || row.actor_email || '—'}</strong>
                    {row.workstation && <span className="text-ink-muted"> · Máy: {row.workstation}</span>}
                    {row.startup_ms != null && <span className="text-ink-muted"> · {row.startup_ms}ms</span>}
                  </div>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* THANH LỌC 1 CHẠM THEO LỚP VẬN HÀNH + NÚT MỞ TRANG HƯỚNG DẪN & CÔNG THỨC */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-ink-muted mr-1">Lọc theo Lớp vận hành:</span>
          {(
            [
              ['all', `Tất cả Via (${tierStats.total})`],
              ['vault', `🛡️ Lớp 1: Via Tổng Giữ BM (${tierStats.vault})`],
              ['camp', `🚀 Lớp 2: Via Lên Camp (${tierStats.camp})`],
              ['standby', `🌱 Lớp 3: Via Dự Phòng Ngâm Sẵn (${tierStats.standby})`],
              ['risk', `⚠️ Cần tối ưu cách ly (${tierStats.risk})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTierFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                tierFilter === key
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-line bg-surface hover:bg-surface-muted text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Link
          to="/operations-guide"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-light px-3 py-1.5 text-xs font-bold text-brand-text hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>📖 Xem Hướng dẫn &amp; Công thức Vận hành →</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <SearchField label={t('pg.search')} placeholder={t('fb.search')} value={search} onApply={setSearch} />
        <SelectField
          label={t('fb.ownership')}
          value={ownershipFilter}
          onChange={setOwnershipFilter}
          options={[
            ['', t('fb.ownership.all')],
            ['agency_owned', t('fb.ownership.agency_owned')],
            ['client_provided', t('fb.ownership.client_provided')],
          ]}
        />
        {members.data && (
          <SelectField
            label={t('fb.owner')}
            value={holder}
            onChange={setHolder}
            options={[['', t('fb.anyOwner')], ...members.data.map((m) => [m.id, m.full_name || m.email] as [string, string])]}
          />
        )}
        <SelectField
          label="Engine Antidetect"
          value={engineFilter}
          onChange={setEngineFilter}
          options={[['', 'Tất cả Engine (5+1)'], ...ANTIDETECT_ENGINE_OPTIONS.map((o) => [o.key, o.label] as [string, string])]}
        />
        <SelectField
          label="Cụm Proxy"
          value={proxyFilter}
          onChange={setProxyFilter}
          options={[
            ['', 'Tất cả cụm Proxy'],
            ['direct', 'Mạng gốc (Direct IP)'],
            ...distinctProxyFilterOptions.map((px) => [px, px] as [string, string]),
          ]}
        />
      </div>

      {list.isLoading ? (
        <TableSkeleton columns={columns} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} title={t('fb.error.title')} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={t('fb.empty.title')}
          description={t('fb.empty.body')}
          action={
            canWrite ? (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('fb.empty.action')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table cards aria-label={t('fb.title')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => {
                const { row, s, browserLabel, networkLabel, meta, adMeta, warmup, sharedNetwork, risks } = item
                const proxyNormKey = normalizeProxyKey(networkLabel)
                const proxyHealth = proxyNormKey ? proxyHealthQ.data?.health_map?.[proxyNormKey] : undefined
                const launchPerm = canMemberLaunchVia(
                  role,
                  currentMemberId,
                  typeof row.owner_member_id === 'string' ? row.owner_member_id : null,
                )
                const activeSess = workstationQ.data?.sessions?.find(
                  (ws) => ws.alive && (ws.via_id === row.id || ws.via_label === String(row.label)),
                )
                const safeLaunchChrome = (targetUrl: string) => {
                  if (!launchPerm.allowed) {
                    setSyncNotice(`🔒 ${launchPerm.reason}`)
                    return
                  }
                  if (proxyHealth?.status === 'DEAD') {
                    const proceed = window.confirm(
                      '⚠️ CẢNH BÁO PROXY ĐÃ CHẾT / LỖI: Lần kiểm tra gần nhất cho thấy Proxy của Via này không phản hồi. Mở Chrome lúc này có thể lộ IP thật hoặc gây Checkpoint! Bạn vẫn muốn mở?',
                    )
                    if (!proceed) return
                  }
                  void launchInAssignedChromeProfile(targetUrl, browserLabel, String(row.label), networkLabel, {
                    viaId: row.id,
                    antidetectEngine: adMeta.engine,
                    antidetectProfileId: adMeta.profileId,
                  })
                  void api
                    .post('/api/v1/facebook-pages/browser-event', {
                      event_type: 'PROFILE_LAUNCHED',
                      via_id: row.id,
                      via_label: String(row.label),
                      browser_profile: browserLabel,
                      antidetect_engine: adMeta.engine,
                      antidetect_profile_id: adMeta.profileId,
                      workstation: 'Web Control Center',
                      target_url: targetUrl,
                    })
                    .catch(() => {})
                }
                const ownership = String(row.ownership_type ?? 'agency_owned')
                const clientName = String(row.client_name ?? '').trim()
                const emailHint = String(row.email_hint ?? '').trim()

                return (
                  <TableRow key={row.id} className="align-top">
                    {/* CỘT 1: TÊN VIA + ID META THẬT + EMAIL + PHÂN TẦNG 3 LỚP CHỐNG DIE */}
                    <TableCell label={columns[0]} className="cell-title min-w-[17rem]">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/facebook-accounts/${row.id}`}
                            className="font-semibold text-brand-text hover:underline"
                          >
                            {String(row.label)}
                          </Link>
                          <Badge tone={ownership === 'client_provided' ? 'info' : 'neutral'}>
                            {t(`fb.ownership.${ownership}` as never)}
                          </Badge>
                          <Badge tone={adMeta.engine === 'chrome_native' ? 'muted' : 'info'}>
                            {adMeta.engine === 'chrome_native'
                              ? 'Chrome Gốc'
                              : `🎭 ${getAntidetectEngineLabel(adMeta.engine)}${adMeta.profileId ? ` #${adMeta.profileId}` : ''}`}
                          </Badge>
                          {activeSess && (
                            <Badge tone="positive" title={activeSess.status_text}>
                              ⚡ {Math.round(activeSess.ram_mb)}MB · {(activeSess.cpu_percent ?? 0).toFixed(1)}%
                            </Badge>
                          )}
                          {clientName && <span className="text-xs text-ink-muted">{clientName}</span>}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          {Boolean(row.external_reference_id) && (
                            <span className="font-mono">ID: {String(row.external_reference_id)}</span>
                          )}
                          {emailHint && <span className="font-mono text-[11px]">· ✉️ {emailHint}</span>}
                        </div>

                        {/* Bộ chọn nhanh Phân tầng 3 lớp Via ngay trên dòng */}
                        <div className="pt-0.5">
                          {canWrite ? (
                            <select
                              aria-label={`Chọn lớp vai trò cho ${String(row.label)}`}
                              value={meta.tier}
                              onChange={(e) => {
                                const nextTier = e.target.value as ViaRoleTier
                                const updatedNotes = buildUpdatedNotes(meta.cleanNotes, nextTier, meta.warmupStartIso)
                                quickUpdateNotes.mutate({ id: row.id, notes: updatedNotes })
                              }}
                              className={`rounded-md border px-2 py-1 text-[11px] font-bold focus:outline-none ${
                                meta.tier === 'vault'
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : meta.tier === 'camp'
                                    ? 'border-brand/40 bg-brand-light text-brand-text'
                                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              <option value="vault">🛡️ Lớp 1: Via Tổng (Giữ BM - Cấm lên camp)</option>
                              <option value="camp">🚀 Lớp 2: Via Lên Camp (Chạy Ads khách)</option>
                              <option value="standby">🌱 Lớp 3: Via Dự Phòng (Ngâm sẵn)</option>
                            </select>
                          ) : (
                            <Badge tone={meta.tier === 'vault' ? 'positive' : meta.tier === 'camp' ? 'info' : 'caution'}>
                              {meta.tier === 'vault'
                                ? '🛡️ Lớp 1: Via Tổng (Giữ BM)'
                                : meta.tier === 'camp'
                                  ? '🚀 Lớp 2: Via Lên Camp'
                                  : '🌱 Lớp 3: Via Dự Phòng'}
                            </Badge>
                          )}
                        </div>

                        {meta.tier === 'vault' && (
                          <div data-detail-only="true" className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                            🔒 Bảo vệ Via Tổng: Chỉ giữ BM & Share quyền, tuyệt đối không bấm tạo camp.
                          </div>
                        )}

                        {meta.cleanNotes && (
                          <p data-detail-only="true" className="text-[11px] text-ink-muted line-clamp-1" title={meta.cleanNotes}>
                            {meta.cleanNotes}
                          </p>
                        )}
                      </div>
                    </TableCell>

                    {/* CỘT 2: CHỌN NHANH HỒ SƠ CHROME THẬT & PROXY + ĐỒNG HỒ NGÂM 72H VÀNG & CẢNH BÁO */}
                    <TableCell label={columns[1]} className="min-w-[21rem] text-xs">
                      <div className="space-y-1.5" data-testid={`fb-env-${row.id}`}>
                        {/* Dòng 1: Chọn nhanh Hồ sơ Chrome thật ngay trên bảng + Mở Chrome */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-ink-muted">Chrome:</span>
                          {canWrite ? (
                            <select
                              aria-label={`Chọn hồ sơ Chrome cho ${String(row.label)}`}
                              className="max-w-[16.5rem] rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-brand focus:border-brand focus:outline-none"
                              value={browserLabel}
                              onChange={(e) =>
                                quickUpdateProfile.mutate({
                                  id: row.id,
                                  browser_profile_label: e.target.value,
                                })
                              }
                            >
                              <option value="">— Chọn Hồ sơ Chrome trên máy —</option>
                              {chromeOptions.map((cp) => (
                                <option key={cp.folder} value={cp.label}>
                                  {cp.label}
                                </option>
                              ))}
                              {browserLabel && !chromeOptions.some((cp) => cp.label === browserLabel) && (
                                <option value={browserLabel}>{browserLabel}</option>
                              )}
                            </select>
                          ) : (
                            <span className="font-semibold text-ink">{browserLabel || '—'}</span>
                          )}

                          {(browserLabel || adMeta.profileId) && (
                            <>
                              <button
                                type="button"
                                disabled={!launchPerm.allowed}
                                onClick={() => safeLaunchChrome('https://business.facebook.com/overview')}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${
                                  launchPerm.allowed
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                                    : 'cursor-not-allowed border-line bg-surface-muted text-ink-muted'
                                }`}
                                title={
                                  launchPerm.allowed
                                    ? `Mở ${getAntidetectEngineLabel(adMeta.engine)} (${adMeta.profileId || browserLabel}) cho Via ${String(row.label)}`
                                    : launchPerm.reason
                                }
                              >
                                {launchPerm.allowed ? `🚀 Mở ${getAntidetectEngineLabel(adMeta.engine)}` : '🔒 Phân quyền khác'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const kaTier = meta.tier === 'vault' ? 'vault' : 'standard'
                                  const kaUrl = `https://www.facebook.com/?adsops_keepalive_session=1&adsops_auto_close=0&adsops_via_tier=${kaTier}&adsops_via_id=${encodeURIComponent(row.id)}&adsops_via_label=${encodeURIComponent(String(row.label || ''))}`
                                  safeLaunchChrome(kaUrl)
                                }}
                                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                                title="Chạy phiên Đảo Ấm Cookie sinh học an toàn ngay trên Chrome của Via này"
                              >
                                ☕ Đảo Ấm
                              </button>
                              <button
                                type="button"
                                onClick={() => safeLaunchChrome('https://accountscenter.facebook.com/password_and_security/passkeys?adsops_auto_delete_passkey=1')}
                                className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
                                data-detail-only="true"
                                title="Mở thẳng trang Khóa truy cập (Passkey) trên Chrome của Via này để Tiện ích tự động phát hiện & xóa sạch Passkey chỉ với 1 chạm"
                              >
                                🚫 Quét &amp; Xoá Passkey
                              </button>
                            </>
                          )}
                        </div>

                        {/* Dòng 2: Proxy / Mạng thực tế */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-ink-muted">IP/Mạng:</span>
                          {networkLabel ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingRecord(row)}
                                className="font-mono text-xs font-semibold text-brand-text hover:underline"
                                title="Bấm để đổi Proxy IP:Port:User:Pass"
                              >
                                {networkLabel} ✎
                              </button>
                              <Badge
                                tone={
                                  sharedNetwork.length === 0
                                    ? 'positive'
                                    : sharedNetwork.length === 1
                                      ? 'info'
                                      : 'caution'
                                }
                              >
                                {sharedNetwork.length === 0
                                  ? '1/2 Via · 1 Proxy riêng'
                                  : sharedNetwork.length === 1
                                    ? `2/2 Via · Chung với ${sharedNetwork[0]}`
                                    : `${sharedNetwork.length + 1}/2 Via · Quá tải Proxy`}
                              </Badge>
                              {proxyNormKey && (
                                <>
                                  <Badge tone={proxyHealth?.status === 'LIVE' ? 'positive' : proxyHealth?.status === 'DEAD' ? 'attention' : 'neutral'}>
                                    {proxyHealth?.status === 'LIVE'
                                      ? `🟢 Sống · ${proxyHealth.country_code ?? '—'}${proxyHealth.timezone ? ` (${proxyHealth.timezone})` : ''} · ${proxyHealth.latency_ms ?? 0}ms (${proxyHealth.exit_ip ?? '—'})`
                                      : proxyHealth?.status === 'DEAD'
                                        ? '🔴 Proxy Chết / Lỗi'
                                        : '⚪ Chưa kiểm tra'}
                                  </Badge>
                                  {proxyHealth?.timezone_match === false && (
                                    <Badge tone="caution" title={proxyHealth.timezone_warning || 'Lệch múi giờ IP Proxy'}>
                                      🕒 Lệch múi giờ IP
                                    </Badge>
                                  )}
                                  {canWrite && (
                                    <button
                                      type="button"
                                      disabled={checkSingleProxy.isPending}
                                      onClick={() =>
                                        checkSingleProxy.mutate({
                                          proxy_string: networkLabel,
                                          expected_timezone: (row.timezone as string | null) ?? null,
                                          via_label: String(row.label),
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                                    >
                                      🩺 Test Proxy
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => downloadSwitchyOmegaConfig(networkLabel, String(row.label))}
                                    className="inline-flex items-center gap-1 rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
                                  >
                                    🛡️ Tải cấu hình Proxy (.bak)
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1 rounded border border-line bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                                🌐 Mạng gốc (Chưa gắn Proxy riêng)
                              </span>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => setEditingRecord(row)}
                                  className="text-[11px] font-medium text-brand-text hover:underline"
                                >
                                  + Gắn Proxy tĩnh
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {/* Dòng 3: Đồng hồ Ngâm 72h Vàng (Chỉ hiện khi bật cho Via mới đăng nhập) */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {warmup ? (
                            <>
                              <Badge tone={warmup.tone} title={warmup.hint}>
                                {warmup.label}
                              </Badge>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedNotes = `[TIER:${meta.tier}]${meta.cleanNotes ? ` ${meta.cleanNotes}` : ''}`
                                    quickUpdateNotes.mutate({ id: row.id, notes: updatedNotes })
                                  }}
                                  className="text-[10.5px] font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                                  title="Tắt đồng hồ ngâm 72h khi Via đã hoạt động ổn định"
                                >
                                  ✓ Hoàn tất ngâm
                                </button>
                              )}
                            </>
                          ) : (
                            canWrite && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nowIso = new Date().toISOString()
                                  const updatedNotes = buildUpdatedNotes(meta.cleanNotes, meta.tier, nowIso)
                                  quickUpdateNotes.mutate({ id: row.id, notes: updatedNotes })
                                }}
                                className="text-[10.5px] text-ink-muted hover:text-brand-text hover:underline"
                                data-detail-only="true"
                                title="Bấm khi bạn vừa đăng nhập Via mới vào Chrome để bật đồng hồ đếm ngược 72h ngâm an toàn"
                              >
                                ⏳ Bật hẹn giờ ngâm 72h (cho Via mới)
                              </button>
                            )
                          )}
                        </div>

                        {/* Dòng 4: Cảnh báo rủi ro chết liên đới (nếu có) */}
                        {risks.length > 0 ? (
                          <div className="space-y-1 pt-0.5" data-testid={`fb-collision-browser-${row.id}`}>
                            {risks.map((r, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-800 dark:text-amber-300"
                              >
                                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span>{r}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div data-detail-only="true" className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            <span>Cách ly chuẩn (1 Chrome riêng · Không xung đột)</span>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell label={columns[2]}>{s?.owner_member_name ?? '—'}</TableCell>
                    <TableCell label={columns[3]}>
                      <TwoFactorOtpCell
                        row={row}
                        canWrite={canWrite}
                        badgeLabel={t(`twoFactor.${String(row.two_factor_method)}` as never)}
                        onSaveSecret={(id, secret) => quickUpdate2fa.mutate({ id, vault_reference: secret })}
                      />
                    </TableCell>
                    <TableCell label={columns[4]}>
                      {s ? (
                        <div className="space-y-0.5">
                          <Badge tone={s.business_manager_count <= 2 ? 'positive' : s.business_manager_count <= 4 ? 'info' : 'caution'}>
                            {`${s.business_manager_count} BM`}
                          </Badge>
                          <div data-detail-only="true" className="text-[10px] text-ink-muted">
                            {s.business_manager_count <= 2
                              ? 'An toàn (≤ 2 BM gốc/Via)'
                              : s.business_manager_count <= 4
                                ? 'Chạm trần tạo BM (4 BM)'
                                : 'Via Tổng / Partner'}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell label={columns[5]} className="font-mono font-semibold tabular-nums">
                      {s ? s.ad_account_count : '—'}
                    </TableCell>
                    <TableCell label={columns[6]}>
                      <Badge tone={row.status === 'active' ? 'positive' : row.status === 'restricted' ? 'attention' : 'neutral'}>
                        {enumLabel('refStatus', String(row.status))}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell label={columns[7]}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingRecord(row)}
                            data-testid={`fb-edit-${row.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t('fb.form.editBtn')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={archive.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  language === 'vi'
                                    ? `Lưu trữ (xóa) tài khoản Facebook "${String(row.label)}"?`
                                    : `Archive Facebook account "${String(row.label)}"?`,
                                )
                              ) {
                                archive.mutate(row.id)
                              }
                            }}
                            data-testid={`fb-delete-${row.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger-text" />
                            {language === 'vi' ? 'Xóa' : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <FacebookAccountFormSheet
        open={creating || Boolean(editingRecord)}
        record={editingRecord}
        onClose={() => {
          setCreating(false)
          setEditingRecord(null)
        }}
        members={members.data ?? []}
        canAssignOwner={canAssignOwner}
      />
    </div>
  )
}
