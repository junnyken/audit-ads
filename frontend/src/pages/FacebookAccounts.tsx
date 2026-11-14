import { useEffect, useMemo, useState } from 'react'
import { Pencil, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { FacebookIdentitySummary, Paged, ReferenceRecord, TeamMember } from '../lib/types'
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
import {
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadSwitchyOmegaConfig,
  downloadWindowsChromeLauncherBat,
  fetchRealLocalChromeProfiles,
  launchInAssignedChromeProfile,
  normalizeProxyKey,
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

  const [search, setSearch] = useState('')
  const [holder, setHolder] = useState('')
  const [ownershipFilter, setOwnershipFilter] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | ViaRoleTier | 'risk'>('all')
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
  const proxyHealthQ = useQuery({
    queryKey: ['proxy-health-map'],
    queryFn: () => api.get<{ health_map: Record<string, ProxyHealthItem> }>('/api/v1/proxies/health-map'),
    retry: false,
  })
  const checkSingleProxy = useMutation({
    mutationFn: (proxy_string: string) =>
      api.post<ProxyHealthItem>('/api/v1/proxies/check-live', { proxy_string }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['proxy-health-map'] })
      setSyncNotice(
        res.status === 'LIVE'
          ? `🟢 Proxy ${res.normalized_key} SỐNG — IP ra: ${res.exit_ip ?? '—'} (${res.country_code ?? '—'} · ${res.latency_ms ?? 0}ms)`
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
      if (sharedNetwork.length >= 2) {
        risks.push(`1 Proxy đang gắn cho ${sharedNetwork.length + 1} Via (Vượt mức ≤ 2 Via/Proxy)`)
      }

      return {
        row,
        s,
        bmCount,
        adCount,
        browserLabel,
        networkLabel,
        meta,
        warmup,
        sharedBrowser,
        sharedNetwork,
        risks,
      }
    })
  }, [allBaseRows, bySummary])

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
      if (tierFilter === 'vault' && item.meta.tier !== 'vault') return false
      if (tierFilter === 'camp' && item.meta.tier !== 'camp') return false
      if (tierFilter === 'standby' && item.meta.tier !== 'standby') return false
      if (tierFilter === 'risk' && item.risks.length === 0) return false
      return true
    })
  }, [enrichedRows, holder, ownershipFilter, tierFilter])

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
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              🟢 Đã kết nối {chromeOptions.length} Hồ sơ Chrome thật trên máy
            </span>
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
            <Button
              type="button"
              variant="secondary"
              onClick={downloadWindowsChromeLauncherBat}
              title="Tải file cài đặt dự phòng cho máy Windows khác"
              data-testid="fb-chrome-launcher-setup"
            >
              ⚡ Tải bộ kết nối cho máy khác
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
                const { row, s, browserLabel, networkLabel, meta, warmup, sharedNetwork, risks } = item
                const proxyNormKey = normalizeProxyKey(networkLabel)
                const proxyHealth = proxyNormKey ? proxyHealthQ.data?.health_map?.[proxyNormKey] : undefined
                const safeLaunchChrome = (targetUrl: string) => {
                  if (proxyHealth?.status === 'DEAD') {
                    const proceed = window.confirm(
                      '⚠️ CẢNH BÁO PROXY ĐÃ CHẾT / LỖI: Lần kiểm tra gần nhất cho thấy Proxy của Via này không phản hồi. Mở Chrome lúc này có thể lộ IP thật hoặc gây Checkpoint! Bạn vẫn muốn mở?',
                    )
                    if (!proceed) return
                  }
                  launchInAssignedChromeProfile(targetUrl, browserLabel, String(row.label), networkLabel)
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

                          {browserLabel && (
                            <>
                              <button
                                type="button"
                                onClick={() => safeLaunchChrome('https://business.facebook.com/overview')}
                                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                                title={`Mở đúng cửa sổ Chrome (${browserLabel}) của Via ${String(row.label)}`}
                              >
                                🚀 Mở Chrome
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
                                      ? `🟢 Sống · ${proxyHealth.country_code ?? '—'} · ${proxyHealth.latency_ms ?? 0}ms (${proxyHealth.exit_ip ?? '—'})`
                                      : proxyHealth?.status === 'DEAD'
                                        ? '🔴 Proxy Chết / Lỗi'
                                        : '⚪ Chưa kiểm tra'}
                                  </Badge>
                                  {canWrite && (
                                    <button
                                      type="button"
                                      disabled={checkSingleProxy.isPending}
                                      onClick={() => checkSingleProxy.mutate(networkLabel)}
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
