import { useEffect, useMemo, useState } from 'react'
import { Pencil, RefreshCw, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
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
import { isGoogleIdentity, usePlatformScope } from '../hooks/usePlatformScope'
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
import { ViaGuardrailDialog } from '../components/ViaGuardrailDialog'
import { twoFactorTone } from '../lib/readiness'
import { useMaxViasPerProxy } from '../lib/proxyClusterPrefs'
import {
  ANTIDETECT_ENGINE_OPTIONS,
  WORKSTATION_REAL_CHROME_PROFILES,
  fetchAntidetectBenchmark,
  fetchRealLocalChromeProfiles,
  fetchWorkstationTelemetry,
  getAntidetectEngineLabel,
  normalizeProxyKey,
  parseAntidetectFromNotes,
  probeLocalDesktopBridge,
  type GuardrailBlockedDecision,
} from '../lib/chromeProfileLauncher'

// Stored references are metadata only; credentials must never be rendered or launched.
export function safeStoredNetworkLabel(value: unknown): string {
  const label = String(value ?? '').trim()
  if (!label) return ''
  if (/@|(?:[^:\s]+:){3}|[/?=]/.test(label)) return '[redacted]'
  return label
}

function isRealNetworkLabel(value: string): boolean {
  return Boolean(value.trim())
}

export type ViaRoleTier = 'vault' | 'camp' | 'standby'

function parseViaMetaFromNotes(
  notesRaw: string,
  label: string,
  bmCount: number,
  adCount: number,
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

export function computeWarmupStatus(warmupStartIso: string): {
  label: string
  hint: string
  tone: 'neutral'
} {
  const valid = Number.isFinite(Date.parse(warmupStartIso))
  return {
    label: valid ? 'Có mốc thời gian tự ghi nhận' : 'Chưa có mốc thời gian hợp lệ',
    hint: 'Mốc thời gian do người dùng ghi nhận không xác minh độ tin cậy thiết bị, trạng thái bảo vệ hoặc quyền truy cập nhà cung cấp.',
    tone: 'neutral',
  }
}

export function TwoFactorMethodCell({ row, badgeLabel }: { row: ReferenceRecord; badgeLabel: string }) {
  const { t } = useI18n()
  return <div className="space-y-1">
    <Badge tone={twoFactorTone(String(row.two_factor_method))}>{badgeLabel}</Badge>
    <p className="text-xs text-ink-muted">{t('honest.facebook.twoFactorManual')}</p>
  </div>
}

export default function FacebookAccounts() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const { platformScope } = usePlatformScope()
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
  const [guardrailBlocked, setGuardrailBlocked] = useState<{
    decision: GuardrailBlockedDecision
    pendingLaunch: {
      targetUrl: string
      browserLabel: string
      viaLabel: string
      networkLabel: string
      viaId: string
      antidetectEngine: string
      antidetectProfileId: string
      viaTier: ViaRoleTier
      isSoaking72h: boolean
    }
  } | null>(null)

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
      const networkLabel = safeStoredNetworkLabel(rawNetwork)
      const meta = parseViaMetaFromNotes(String(row.notes ?? ''), String(row.label ?? ''), bmCount, adCount)
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
                  safeStoredNetworkLabel(o.network_label).toLowerCase() === networkLabel.toLowerCase(),
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

  useEffect(() => {
    if (platformScope === 'google_ads') setPlaybookPlatform('google_ads')
    else if (platformScope === 'meta') setPlaybookPlatform('meta')
    else setPlaybookPlatform('all')
  }, [platformScope])

  const filteredItems = useMemo(() => {
    return enrichedRows.filter((item) => {
      if (platformScope !== 'all') {
        const isG = isGoogleIdentity(item.row, String(item.row.notes ?? ''))
        if (platformScope === 'google_ads' && !isG) return false
        if (platformScope === 'meta' && isG) return false
      }
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
  }, [enrichedRows, platformScope, holder, ownershipFilter, engineFilter, proxyFilter, tierFilter])

  const chromeOptions = localChrome.data ?? WORKSTATION_REAL_CHROME_PROFILES

  const columns = [
    'Tài khoản Via & Nhóm vai trò',
    'Tham chiếu môi trường đăng nhập (chưa xác minh)',
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
              <span className="inline-flex items-center gap-1.5 rounded-md border border-tone-positive-border bg-tone-positive-bg px-2.5 py-1.5 text-xs font-medium text-tone-positive-fg">
                <span className="h-1.5 w-1.5 rounded-full bg-tone-positive-fg" aria-hidden="true" />
                <span>Đã kết nối {chromeOptions.length} Hồ sơ Chrome thật trên máy</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-ink-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" aria-hidden="true" />
                <span>Cầu nối Desktop (:17890) chưa bật — mở AdsOps Desktop Pro để đọc Hồ sơ Chrome thật</span>
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
                disabled
                title={t('honest.facebook.automationUnavailable')}
              >
                {t('honest.facebook.automationUnavailable')}
              </Button>
            )}
            {bridgeProbe?.isDesktopApp && (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-tone-positive-border bg-tone-positive-bg px-2.5 py-1.5 text-xs font-semibold text-tone-positive-fg"
                title={`AdsOps Desktop Pro đang chạy ngầm tại 127.0.0.1:${bridgeProbe.port || 17890}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-tone-positive-fg" aria-hidden="true" />
                <span>App Windows v{bridgeProbe.version || '5.1.0'} Đang Chạy</span>
              </span>
            )}
            <button
              type="button"
              disabled title={t('honest.facebook.automationUnavailable')}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:border-line-strong hover:bg-surface-muted"
            >
              Tải App Windows v5.1 (.zip)
            </button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'playbooks' ? 'none' : 'playbooks'))}
              title="Mở Chợ Kịch bản Team (Meta / Google Ads / TikTok) & chạy lô lệch pha Jitter"
            >
              Kịch bản Team ({playbooksQ.data?.length ?? 0})
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'audit' ? 'none' : 'audit'))}
              title="Xem Nhật ký Team: Ai đã mở Profile nào, bằng Engine gì, lúc nào"
            >
              Nhật ký Mở Profile
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHubPanel((p) => (p === 'onboarding' ? 'none' : 'onboarding'))}
              title="Hướng dẫn Thiết lập 5 bước cho người mới"
            >
              Hướng dẫn 5 Bước
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled title={t('honest.facebook.automationUnavailable')}
              data-testid="fb-chrome-launcher-setup"
            >
              Tải .bat dự phòng
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
        <div className="rounded-md border border-tone-positive-border bg-tone-positive-bg px-3.5 py-2 text-xs font-medium text-tone-positive-fg">
          {syncNotice}
        </div>
      )}

      {/* THANH GIÁM SÁT RAM MÁY TRẠM + BENCHMARK 5 ENGINE (CHỈ HIỆN DỮ LIỆU THẬT TỪ BRIDGE) */}
      {bridgeProbe?.isDesktopApp && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-ink">
              RAM máy trạm:{' '}
              {workstationQ.data?.workstation_memory
                ? `${workstationQ.data.workstation_memory.available_physical_mb.toLocaleString()}/${workstationQ.data.workstation_memory.total_physical_mb.toLocaleString()} MB trống (Khuyên tối đa ${workstationQ.data.workstation_memory.recommended_max_concurrent} luồng)`
                : 'Đang đọc...'}
            </span>
            <span className="text-ink-muted">
              • Phiên đang chạy: <strong className="text-ink">{workstationQ.data?.active_count ?? 0}</strong>
            </span>
            {benchmarkQ.data && (
              <span className="font-semibold text-tone-positive-fg">
                Engine nhanh nhất: {getAntidetectEngineLabel(benchmarkQ.data.recommended_engine)} (
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
            disabled title={t('honest.facebook.automationUnavailable')}
          >
            {benchmarkQ.isPending ? 'Đang đo tốc độ...' : 'Benchmark 5 Engine'}
          </Button>
        </div>
      )}

      {/* BẢNG MỞ RỘNG: CHỢ KỊCH BẢN TEAM / NHẬT KÝ MỞ PROFILE / LỘ TRÌNH AN TOÀN 5 BƯỚC */}
      {showHubPanel === 'onboarding' && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Lộ trình Thiết lập 5 Bước cho Người mới</h3>
            <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
              Đóng
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-5 text-xs">
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">1. Cầu nối Desktop</div>
              <div className="text-ink-muted mt-0.5">{bridgeProbe?.isDesktopApp ? `Đã bật Zero-Trust :${bridgeProbe.port || 17890}` : 'Tải & bật AdsOps Desktop Pro'}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">2. Phân tầng 3 lớp</div>
              <div className="text-ink-muted mt-0.5">{tierStats.vault > 0 ? `Có ${tierStats.vault} Via Hold BM` : 'Gắn ít nhất 1 Via Tổng Hold BM'}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">3. Cách ly Profile</div>
              <div className="text-ink-muted mt-0.5">{tierStats.risk === 0 && tierStats.total > 0 ? 'Sạch 0 trùng Silo' : `${tierStats.risk} Via cần tách Profile/Proxy`}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <div className="font-bold">4. Proxy &amp; Múi giờ</div>
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
              <h3 className="text-sm font-bold text-ink">Chợ Kịch Bản Team (Meta / Google Ads / TikTok) &amp; Chạy Lô Lệch Pha (Jitter)</h3>
              <p className="text-xs text-ink-muted">Thay vì nhân bản chuột đồng thời dễ dính Checkpoint chùm, hệ thống chạy tuần tự có nghỉ lệch pha ±35% và ghi lịch sử nhóm.</p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setCreatingPlaybook((v) => !v)}>
                  {creatingPlaybook ? 'Hủy tạo' : 'Tạo Kịch bản Team'}
                </Button>
              )}
              <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
                Đóng
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
                    {pb.rating_count > 0 && pb.avg_rating != null ? `${pb.avg_rating.toFixed(1)}/5 (${pb.rating_count})` : 'Chưa chấm sao'} • {pb.run_count} lượt
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
                          pb.my_rating === st ? 'bg-tone-caution-bg font-semibold text-tone-caution-fg' : 'text-ink-muted hover:text-ink'
                        }`}
                        title={`Chấm ${st} sao`}
                      >
                        {st}★
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
                        setSyncNotice(t('honest.facebook.automationUnavailable'))
                      }}
                    >
                      {t('honest.facebook.automationUnavailable')}
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
            <h3 className="text-sm font-bold text-ink">Nhật ký Team Mở Profile, Chạy Kịch bản &amp; Failover (Audit)</h3>
            <button type="button" onClick={() => setShowHubPanel('none')} className="text-xs text-ink-muted hover:underline">
              Đóng
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
          <span className="mr-1 text-xs font-semibold text-ink-muted">Lọc theo Lớp vận hành:</span>
          {(
            [
              { key: 'all', label: `Tất cả Via (${tierStats.total})`, dotCls: null },
              { key: 'vault', label: `Lớp 1: Via Tổng Giữ BM (${tierStats.vault})`, dotCls: 'bg-tone-positive-fg' },
              { key: 'camp', label: `Lớp 2: Via Lên Camp (${tierStats.camp})`, dotCls: 'bg-brand' },
              { key: 'standby', label: `Lớp 3: Via Dự Phòng Ngâm Sẵn (${tierStats.standby})`, dotCls: 'bg-tone-caution-fg' },
              { key: 'risk', label: `Cần tối ưu cách ly (${tierStats.risk})`, dotCls: 'bg-tone-attention-fg' },
            ] as const
          ).map(({ key, label, dotCls }) => {
            const active = tierFilter === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTierFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-line bg-surface hover:bg-surface-muted text-ink'
                }`}
              >
                {dotCls && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-current opacity-85' : dotCls}`}
                    aria-hidden="true"
                  />
                )}
                <span>{label}</span>
              </button>
            )
          })}
        </div>

        <Link
          to="/operations-guide"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-text transition hover:border-line-strong hover:bg-surface-muted"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Xem Hướng dẫn &amp; Công thức Vận hành →</span>
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
            ['direct', t('honest.facebook.networkMissing')],
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
                const { row, s, browserLabel, networkLabel, meta, adMeta, warmup, risks } = item
                const activeSess = workstationQ.data?.sessions?.find(
                  ws => ws.alive && ws.via_id === row.id,
                )
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
                              : `${getAntidetectEngineLabel(adMeta.engine)}${adMeta.profileId ? ` #${adMeta.profileId}` : ''}`}
                          </Badge>
                          {activeSess && (
                            <Badge tone="positive" title={activeSess.status_text}>
                              {Math.round(activeSess.ram_mb)}MB · {(activeSess.cpu_percent ?? 0).toFixed(1)}%
                            </Badge>
                          )}
                          {clientName && <span className="text-xs text-ink-muted">{clientName}</span>}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          {Boolean(row.external_reference_id) && (
                            <span className="font-mono">ID: {String(row.external_reference_id)}</span>
                          )}
                          {emailHint && <span className="font-mono text-[11px]">· {emailHint}</span>}
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
                              className={`rounded-md border px-2 py-1 text-[11px] font-semibold focus:outline-none ${
                                meta.tier === 'vault'
                                  ? 'border-tone-positive-border bg-tone-positive-bg text-tone-positive-fg'
                                  : meta.tier === 'camp'
                                    ? 'border-brand/40 bg-brand-light text-brand-text'
                                    : 'border-tone-caution-border bg-tone-caution-bg text-tone-caution-fg'
                              }`}
                            >
                              <option value="vault">Lớp 1: Via Tổng (Giữ BM - Cấm lên camp)</option>
                              <option value="camp">Lớp 2: Via Lên Camp (Chạy Ads khách)</option>
                              <option value="standby">Lớp 3: Via Dự Phòng (Ngâm sẵn)</option>
                            </select>
                          ) : (
                            <Badge tone={meta.tier === 'vault' ? 'positive' : meta.tier === 'camp' ? 'info' : 'caution'}>
                              {meta.tier === 'vault'
                                ? 'Lớp 1: Via Tổng (Giữ BM)'
                                : meta.tier === 'camp'
                                  ? 'Lớp 2: Via Lên Camp'
                                  : 'Lớp 3: Via Dự Phòng'}
                            </Badge>
                          )}
                        </div>

                        {meta.tier === 'vault' && (
                          <div data-detail-only="true" className="rounded border border-tone-positive-border bg-tone-positive-bg px-2 py-1 text-[10.5px] font-medium text-tone-positive-fg">
                            Bảo vệ Via Tổng: Chỉ giữ BM &amp; Share quyền, tuyệt đối không bấm tạo camp.
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

                          <button type="button" disabled title={t('honest.facebook.automationUnavailable')}>
                            {t('honest.facebook.automationUnavailable')}
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-ink-muted">{t('honest.facebook.networkReference')}</span>
                          <span className="font-mono text-xs">{networkLabel || t('honest.facebook.networkMissing')}</span>
                          {networkLabel && <Badge tone="neutral">{t('honest.facebook.unverified')}</Badge>}
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
                                  className="text-[10.5px] font-semibold text-tone-positive-fg hover:underline"
                                  title="Tắt đồng hồ ngâm 72h khi Via đã hoạt động ổn định"
                                >
                                  Hoàn tất ngâm
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
                                title="Bấm khi bạn vừa đăng nhập Via mới vào Chrome để bật đồng hồ đếm ngược 72h theo dõi"
                              >
                                Bật hẹn giờ ngâm 72h (cho Via mới)
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
                                className="flex items-center gap-1 rounded border border-tone-caution-border bg-tone-caution-bg px-2 py-0.5 text-[10.5px] font-medium text-tone-caution-fg"
                              >
                                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span>{r}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div data-detail-only="true" className="inline-flex items-center gap-1 text-[10.5px] font-medium text-ink-muted">
                            <span>{t('honest.facebook.unverified')}</span>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell label={columns[2]}>{s?.owner_member_name ?? '—'}</TableCell>
                    <TableCell label={columns[3]}>
                      <TwoFactorMethodCell row={row} badgeLabel={t(`twoFactor.${String(row.two_factor_method)}` as never)} />
                    </TableCell>
                    <TableCell label={columns[4]}>
                      {s ? (
                        <div className="space-y-0.5">
                          <Badge tone="neutral">
                            {`${s.business_manager_count} BM`}
                          </Badge>
                          <div data-detail-only="true" className="text-[10px] text-ink-muted">
                            {t('honest.facebook.linkedBm')}
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
      <ViaGuardrailDialog
        open={Boolean(guardrailBlocked)}
        onOpenChange={(open) => {
          if (!open) setGuardrailBlocked(null)
        }}
        decision={guardrailBlocked?.decision ?? null}
        isOwner={role === 'owner'}
        onOverrideGranted={() => {
          setGuardrailBlocked(null)
          setSyncNotice(t('honest.facebook.automationUnavailable'))
        }}
      />
    </div>
  )
}
