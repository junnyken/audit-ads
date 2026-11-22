import { useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Chrome,
  Code2,
  Coffee,
  Copy,
  Edit3,
  Eye,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  Ghost,
  Globe,
  Grid2x2,
  KeyRound,
  Lock,
  Mail,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InspectorDrawer, InspectorSection } from '@/components/ui/inspector-drawer'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleVia, useShellUi } from '@/lib/shell-context'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto, LiveTotpItemDto, WebViaItemDto } from '@/types'

function extractHostPort(raw: string): string {
  const clean = (raw || '').trim()
  if (!clean) return ''
  const parts = clean.split(':')
  if (parts.length >= 2 && !clean.includes('://')) return `${parts[0]}:${parts[1]}`
  try {
    const u = new URL(clean)
    return `${u.hostname}:${u.port || 80}`
  } catch {
    return clean
  }
}

function getInitials(label: string): string {
  const words = (label || 'V').split(/[\s\-_]+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
  return (label || 'VA').slice(0, 2).toUpperCase()
}

export function ViasTab({ state }: { state: AppShellWebStateDto }) {
  const { platformScope } = useShellUi()
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [engineFilter, setEngineFilter] = useState('all')
  const [proxyFilter, setProxyFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [inspectedVia, setInspectedVia] = useState<WebViaItemDto | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const scopedBaseVias = useMemo(() => {
    if (platformScope === 'all') return state.vias
    return state.vias.filter((v) =>
      platformScope === 'google_ads' ? isGoogleVia(v) : !isGoogleVia(v),
    )
  }, [state.vias, platformScope])

  const distinctProxies = useMemo(() => {
    const set = new Set<string>()
    for (const v of scopedBaseVias) {
      if (v.proxyHostPort) set.add(v.proxyHostPort)
    }
    return Array.from(set).sort()
  }, [scopedBaseVias])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scopedBaseVias.filter((v) => {
      const tierOk =
        tierFilter === 'vault'
          ? v.roleTier === 'vault' || v.roleTier === 'hold'
          : tierFilter === 'camp'
          ? v.roleTier !== 'vault' && v.roleTier !== 'hold' && v.roleTier !== 'standby'
          : tierFilter === 'standby'
          ? v.roleTier === 'standby'
          : tierFilter === 'keepalive_due'
          ? v.needsKeepAlive
          : tierFilter === 'no_cookie'
          ? !v.hasVaultCookie
          : tierFilter === 'ready_to_born'
          ? v.incubationStageKey === 'ready_to_born'
          : tierFilter === 'incubating'
          ? v.incubationStageKey === 'pre_bake' ||
            v.incubationStageKey === 'ready_to_born' ||
            v.incubationStageKey === 'soak_72h' ||
            v.incubationStageKey === 'interactive_4_7d'
          : tierFilter === 'standby_ready'
          ? v.incubationStageKey === 'standby_ready'
          : tierFilter === 'running'
          ? v.isBrowserRunning
          : tierFilter === 'cooldown'
          ? v.isInCooldown || v.hasSiloConflict || v.proxyStatus === 'DEAD'
          : tierFilter === 'google_mcc'
          ? (v.accountPlatform || 'meta') === 'google_ads_mcc'
          : tierFilter === 'google_standalone'
          ? (v.accountPlatform || 'meta') === 'google_ads_standalone'
          : true
      if (!tierOk) return false
      if (engineFilter !== 'all' && v.antidetectEngine.toLowerCase() !== engineFilter.toLowerCase()) return false
      if (proxyFilter !== 'all') {
        if (proxyFilter === 'direct') {
          if (v.networkLabel.trim()) return false
        } else if (v.proxyHostPort.toLowerCase() !== proxyFilter.toLowerCase()) {
          return false
        }
      }
      if (ownerFilter !== 'all') {
        if (ownerFilter === 'unassigned') {
          if (v.ownerMemberId.trim()) return false
        } else if (v.ownerMemberId.toLowerCase() !== ownerFilter.toLowerCase()) {
          return false
        }
      }
      if (!q) return true
      return (
        v.label.toLowerCase().includes(q) ||
        (v.customTag || '').toLowerCase().includes(q) ||
        (v.googleAdsCustomerId || '').toLowerCase().includes(q) ||
        v.displayName.toLowerCase().includes(q) ||
        v.externalReferenceId.toLowerCase().includes(q) ||
        v.profileDir.toLowerCase().includes(q) ||
        v.antidetectProfileId.toLowerCase().includes(q) ||
        v.networkLabel.toLowerCase().includes(q) ||
        v.ownerMemberName.toLowerCase().includes(q) ||
        v.clientGroup.toLowerCase().includes(q)
      )
    })
  }, [scopedBaseVias, search, tierFilter, engineFilter, proxyFilter, ownerFilter])

  const liveInspected = useMemo(
    () => (inspectedVia ? state.vias.find((v) => v.viaId === inspectedVia.viaId) ?? inspectedVia : null),
    [inspectedVia, state.vias],
  )

  const toggleVia = (viaId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? (prev.includes(viaId) ? prev : [...prev, viaId]) : prev.filter((x) => x !== viaId),
    )
  }

  const toggleAllVisible = () => {
    const visibleIds = filtered.map((v) => v.viaId)
    const allSel = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id))
    setSelectedIds(allSel ? [] : visibleIds)
  }

  const issueCount = scopedBaseVias.filter(
    (v) => v.isInCooldown || v.hasSiloConflict || v.proxyStatus === 'DEAD',
  ).length
  const googleMccCount = scopedBaseVias.filter((v) => (v.accountPlatform || 'meta') === 'google_ads_mcc').length
  const googleStandaloneCount = scopedBaseVias.filter(
    (v) => (v.accountPlatform || 'meta') === 'google_ads_standalone',
  ).length

  const tierChips = [
    { key: 'all', label: `Tất cả (${scopedBaseVias.length})` },
    ...(platformScope !== 'meta'
      ? [
          { key: 'google_mcc', label: `Google MCC (${googleMccCount})` },
          { key: 'google_standalone', label: `Gmail 1:1 (${googleStandaloneCount})` },
        ]
      : []),
    ...(platformScope !== 'google_ads'
      ? [
          {
            key: 'vault',
            label: `Hold BM (${scopedBaseVias.filter((v) => v.roleTier === 'vault' || v.roleTier === 'hold').length})`,
          },
          {
            key: 'camp',
            label: `Lên Camp (${scopedBaseVias.filter((v) => v.roleTier !== 'vault' && v.roleTier !== 'hold' && v.roleTier !== 'standby').length})`,
          },
          { key: 'standby', label: `Dự phòng (${scopedBaseVias.filter((v) => v.roleTier === 'standby').length})` },
          {
            key: 'ready_to_born',
            label: `Chờ khai sinh (${scopedBaseVias.filter((v) => v.incubationStageKey === 'ready_to_born').length})`,
          },
          {
            key: 'incubating',
            label: `Đang ủ/ấp (${
              scopedBaseVias.filter(
                (v) =>
                  v.incubationStageKey === 'pre_bake' ||
                  v.incubationStageKey === 'ready_to_born' ||
                  v.incubationStageKey === 'soak_72h' ||
                  v.incubationStageKey === 'interactive_4_7d',
              ).length
            })`,
          },
          {
            key: 'standby_ready',
            label: `Dự phòng sẵn (${scopedBaseVias.filter((v) => v.incubationStageKey === 'standby_ready').length})`,
          },
          { key: 'keepalive_due', label: `Cần đảo ấm (${scopedBaseVias.filter((v) => v.needsKeepAlive).length})` },
          { key: 'no_cookie', label: `Thiếu Cookie (${scopedBaseVias.filter((v) => !v.hasVaultCookie).length})` },
        ]
      : []),
    { key: 'running', label: `Đang mở (${scopedBaseVias.filter((v) => v.isBrowserRunning).length})` },
    ...(issueCount > 0 || tierFilter === 'cooldown'
      ? [{ key: 'cooldown', label: `Cảnh báo (${issueCount})` }]
      : []),
  ]

  const ef = state.embryoFactory ?? {
    enabled: false,
    spawnIntervalDays: 3,
    requiredSessions: 3,
    maxPendingEmbryos: 3,
    proxyPoolRaw: '',
    proxyPoolValidCount: 0,
    defaultClientGroup: '',
    customDomain: '',
    lastSpawnLocal: 'Chưa tạo',
    nextSpawnHint: 'Bật Lịch Xưởng Phôi để tự động đẻ & ủ ngầm mỗi 2–3 ngày',
    preBakingCount: 0,
    readyToBornCount: 0,
    isSilentPreBakeRunning: false,
  }

  const [standbyOpen, setStandbyOpen] = useState(false)
  const [factoryConfigOpen, setFactoryConfigOpen] = useState(false)
  const [efEnabled, setEfEnabled] = useState(ef.enabled)
  const [efInterval, setEfInterval] = useState(String(ef.spawnIntervalDays))
  const [efSessions, setEfSessions] = useState(String(ef.requiredSessions))
  const [efMaxPending, setEfMaxPending] = useState(String(ef.maxPendingEmbryos))
  const [efClientGroup, setEfClientGroup] = useState(ef.defaultClientGroup)
  const [efDomain, setEfDomain] = useState(ef.customDomain)
  const [efProxyPool, setEfProxyPool] = useState(ef.proxyPoolRaw)

  useEffect(() => {
    setEfEnabled(ef.enabled)
    setEfInterval(String(ef.spawnIntervalDays))
    setEfSessions(String(ef.requiredSessions))
    setEfMaxPending(String(ef.maxPendingEmbryos))
    setEfClientGroup(ef.defaultClientGroup)
    setEfDomain(ef.customDomain)
    setEfProxyPool(ef.proxyPoolRaw)
  }, [state.configRev])

  const poolRows = state.standbyPoolMatrix ?? []

  return (
    <div className="space-y-3.5">
      {/* Top Contextual Banner: Google Ads Silo OR Agency Standby / Embryo Factory */}
      {platformScope === 'google_ads' ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-2 text-xs">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="font-semibold text-foreground">
                Chế độ Google Ads 1:1 — Đã tách biệt hoàn toàn khỏi kịch bản Meta / Extension Script
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => sendDesktopCommand('open_google_ads_script_wizard')}
              >
                <Code2 className="h-3.5 w-3.5 text-emerald-500" /> Mã Google Ads Script
              </Button>
              <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => sendDesktopCommand('add_via')}>
                <Plus className="h-3.5 w-3.5" /> Thêm MCC / Gmail 1:1
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-2.5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="flex items-center gap-2 text-left text-xs font-semibold text-foreground hover:text-primary"
                onClick={() => setStandbyOpen((v) => !v)}
              >
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>Kho Dự phòng &amp; Xưởng Tự động Ủ Phôi ({poolRows.length} nhóm)</span>
                {standbyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setFactoryConfigOpen((v) => !v)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Lịch Ủ ({efEnabled ? `${efInterval} ngày` : 'Tắt'})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ef.isSilentPreBakeRunning}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => sendDesktopCommand('spawn_embryo_now')}
                >
                  <Ghost className="h-3.5 w-3.5 text-emerald-500" />
                  {ef.isSilentPreBakeRunning ? 'Đang ủ ngầm...' : 'Đẻ & Ủ 1 Phôi ngay'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => sendDesktopCommand('add_via')}
                >
                  <Plus className="h-3.5 w-3.5" /> Thêm Via
                </Button>
              </div>
            </div>

            {ef.readyToBornCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                <div className="flex items-center gap-2 font-medium">
                  <BellRing className="h-4 w-4 shrink-0" />
                  Có {ef.readyToBornCount} Phôi đã ủ chín Cookie sạch — sẵn sàng Khai sinh 60s
                </div>
                <Button
                  size="sm"
                  className="h-7 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-500"
                  onClick={() => setTierFilter('ready_to_born')}
                >
                  Lọc phôi sẵn ({ef.readyToBornCount})
                </Button>
              </div>
            )}

            {standbyOpen && poolRows.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {poolRows.map((row) => (
                  <Badge
                    key={row.clientGroup}
                    variant={row.hasStandbyDeficit ? 'warning' : 'secondary'}
                    className="gap-1.5 px-2.5 py-1 font-mono text-[11px]"
                  >
                    <span className="font-sans font-semibold">{row.clientGroup}:</span>
                    <span>{row.activePrimaryCount} Chính</span>
                    <span>•</span>
                    <span>{row.standbyReadyCount} Standby</span>
                    {row.incubatingCount > 0 && <span>• {row.incubatingCount} đang ủ</span>}
                  </Badge>
                ))}
              </div>
            )}

            {factoryConfigOpen && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Switch checked={efEnabled} onCheckedChange={setEfEnabled} />
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        Bật lịch tự động đẻ &amp; ủ Cookie ngầm (08:00–22:00)
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {ef.nextSpawnHint} • Gần nhất: {ef.lastSpawnLocal} • Proxy kho: {ef.proxyPoolValidCount}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ef.isSilentPreBakeRunning}
                    onClick={() => sendDesktopCommand('bake_all_embryos_silent')}
                  >
                    <Ghost className="h-3.5 w-3.5 text-emerald-500" />
                    Ủ ngầm phôi chờ ({ef.preBakingCount})
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Chu kỳ tạo</span>
                    <Select value={efInterval} onValueChange={setEfInterval}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Mỗi 1 ngày</SelectItem>
                        <SelectItem value="2">Mỗi 2 ngày</SelectItem>
                        <SelectItem value="3">Mỗi 3 ngày (Khuyên dùng)</SelectItem>
                        <SelectItem value="5">Mỗi 5 ngày</SelectItem>
                        <SelectItem value="7">Mỗi 7 ngày</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Số phiên Cookie Robot</span>
                    <Select value={efSessions} onValueChange={setEfSessions}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">2 phiên (~1–2 ngày)</SelectItem>
                        <SelectItem value="3">3 phiên (~2–3 ngày)</SelectItem>
                        <SelectItem value="4">4 phiên (Chín kỹ)</SelectItem>
                        <SelectItem value="5">5 phiên (Siêu sạch)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Trần phôi tối đa</span>
                    <Input
                      value={efMaxPending}
                      onChange={(e) => setEfMaxPending(e.target.value)}
                      placeholder="3"
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Nhóm khách (Silo)</span>
                    <Input
                      value={efClientGroup}
                      onChange={(e) => setEfClientGroup(e.target.value)}
                      placeholder="VD: NhaKhoa_A"
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Domain Mail riêng</span>
                    <Input
                      value={efDomain}
                      onChange={(e) => setEfDomain(e.target.value)}
                      placeholder="VD: agency.vn"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <Textarea
                  value={efProxyPool}
                  onChange={(e) => setEfProxyPool(e.target.value)}
                  rows={2}
                  placeholder="103.1.2.3:8080:user:pass"
                  className="font-mono text-xs"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    App tự tạo Profile + ủ Cookie sạch mỗi {efInterval} ngày; đủ {efSessions} phiên sẽ báo chuông để bạn
                    thực hiện Khai Sinh 60s chính chủ.
                  </p>
                  <Button
                    size="sm"
                    onClick={() =>
                      sendDesktopCommand('save_embryo_factory_config', {
                        enabled: efEnabled,
                        spawnIntervalDays: Number(efInterval) || 3,
                        requiredSessions: Number(efSessions) || 3,
                        maxPendingEmbryos: Number(efMaxPending) || 3,
                        defaultClientGroup: efClientGroup,
                        customDomain: efDomain,
                        proxyPoolRaw: efProxyPool,
                      })
                    }
                  >
                    Lưu cấu hình Xưởng
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter & Actions Toolbar */}
      <Card>
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên Via, UID, Gmail/CID, Chrome Profile, Proxy..."
                className="pl-8"
              />
            </div>

            {platformScope !== 'google_ads' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('harvest_all_open_cookies')}
                title="Thu Cookie FB từ các Chrome Cô lập đang mở vào Két DPAPI"
              >
                <KeyRound className="h-3.5 w-3.5 text-emerald-500" />
                Thu Cookie đang mở
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => sendDesktopCommand('distribute_proxies', { viaIds: selectedIds })}
            >
              <Globe className="h-3.5 w-3.5" />
              Chia Proxy 1:{state.automationConfig.maxViasPerProxyInBatch}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  Công cụ lô <ChevronDown className="h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem onClick={() => sendDesktopCommand('bulk_change_tier', { viaIds: selectedIds })}>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Đổi Lớp Via / Nhóm Khách &amp; Tách Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_proxy_check')}>
                  <Globe className="h-3.5 w-3.5 text-emerald-500" />
                  Quét kiểm tra Proxy Live/Dead toàn bộ
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('bulk_import_vias')}>
                  <Upload className="h-3.5 w-3.5 text-sky-500" />
                  Nhập lô nhiều Via từ Clipboard (Ctrl+B)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('export_vias_csv')}>
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
                  Xuất danh sách Via &amp; Proxy ra file CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('tile_chrome_windows', { grid: '2x2' })}>
                  <Grid2x2 className="h-3.5 w-3.5" />
                  Xếp cửa sổ Chrome đang mở lưới 2×2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_auto_connect_token')}>
                  <KeyRound className="h-3.5 w-3.5 text-amber-500" />
                  Dán Token EAAB kết nối nhanh Via &amp; TKQC
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('benchmark_engines')}>
                  <Gauge className="h-3.5 w-3.5 text-violet-500" />
                  Benchmark tốc độ 5 Engine Antidetect
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_stewardship_log')}>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  Xem nhật ký bảo vệ &amp; chống rò rỉ IP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_launch_audit')}>
                  <Terminal className="h-3.5 w-3.5" />
                  Xem nhật ký mở Profile (Audit Log)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleAllVisible}>
                  <CheckSquare className="h-3.5 w-3.5" />
                  Chọn / Bỏ chọn tất cả đang hiển thị
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => sendDesktopCommand('open_google_ads_script_wizard')}
              title="Lấy mã Google Ads Script cho MCC & Gmail khách độc lập"
            >
              <Code2 className="h-3.5 w-3.5 text-emerald-500" />
              Google Ads Script
            </Button>

            <Button size="sm" onClick={() => sendDesktopCommand('add_via')}>
              <Plus className="h-3.5 w-3.5" />
              Thêm hồ sơ
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {tierChips.map((ch) => (
              <Button
                key={ch.key}
                type="button"
                size="sm"
                variant={tierFilter === ch.key ? 'default' : 'secondary'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setTierFilter(ch.key)}
              >
                {ch.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
            <Select value={engineFilter} onValueChange={setEngineFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Engine: Tất cả</SelectItem>
                {state.supportedEngines.map((eng) => (
                  <SelectItem key={eng.value} value={eng.value}>
                    Engine: {eng.label} ({scopedBaseVias.filter((v) => v.antidetectEngine === eng.value).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={proxyFilter} onValueChange={setProxyFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Proxy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Proxy: Tất cả cụm</SelectItem>
                <SelectItem value="direct">Proxy: Mạng gốc (Direct)</SelectItem>
                {distinctProxies.map((px) => (
                  <SelectItem key={px} value={px}>
                    Proxy: {px}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Phụ trách" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Phụ trách: Tất cả nhân sự</SelectItem>
                <SelectItem value="unassigned">Phụ trách: Chưa phân công</SelectItem>
                {state.teamMemberOptions.map((tm) => (
                  <SelectItem key={tm.value} value={tm.value}>
                    Phụ trách: {tm.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Selection Strip */}
      {selectedIds.length > 0 && (
        <Card className="border-primary/40 bg-primary/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-2.5 p-3">
            <span className="text-xs font-semibold text-primary">
              Đã chọn {selectedIds.length} hồ sơ:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" onClick={() => sendDesktopCommand('distribute_proxies', { viaIds: selectedIds })}>
                <Globe className="h-3 w-3" /> Chia Proxy 1:{state.automationConfig.maxViasPerProxyInBatch}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('bulk_change_tier', { viaIds: selectedIds })}
              >
                <Users className="h-3 w-3" /> Đổi Lớp / Profile
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('bulk_keepalive', { viaIds: selectedIds })}
              >
                <Coffee className="h-3 w-3" /> Đảo ấm lô chọn
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('bulk_check_proxy', { viaIds: selectedIds })}
              >
                <Globe className="h-3 w-3" /> Check Proxy
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('bulk_provision_ext', { viaIds: selectedIds })}
              >
                <ShieldCheck className="h-3 w-3" /> Cấp Extension
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Bỏ chọn
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {state.vias.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Users className="h-9 w-9 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold text-foreground">Chưa có hồ sơ trình duyệt nào</div>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Thêm Via hoặc tài khoản Google Ads để gắn Chrome Profile, Proxy tĩnh và két Cookie/2FA DPAPI.
              </p>
            </div>
            <Button onClick={() => sendDesktopCommand('add_via')}>
              <Plus className="h-4 w-4" /> Thêm hồ sơ đầu tiên
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            Không có hồ sơ khớp bộ lọc hiện tại.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[30px_1.45fr_0.9fr_1.1fr_168px_220px] items-center gap-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:grid">
            <div className="flex justify-center">
              <Checkbox
                checked={filtered.length > 0 && filtered.every((v) => selectedSet.has(v.viaId))}
                onCheckedChange={toggleAllVisible}
              />
            </div>
            <div>Hồ sơ &amp; Vai trò</div>
            <div>Trust &amp; Bảo mật</div>
            <div>Trình duyệt &amp; Proxy</div>
            <div>Mã 2FA Live</div>
            <div className="text-right">Thao tác</div>
          </div>

          {filtered.map((via) => (
            <ViaRowCard
              key={via.viaId}
              via={via}
              totp={state.totpMap[via.viaId]}
              checked={selectedSet.has(via.viaId)}
              onToggle={(c) => toggleVia(via.viaId, c)}
              onInspect={() => setInspectedVia(via)}
            />
          ))}
        </div>
      )}

      {/* RIGHT SLIDE-OVER INSPECTOR DRAWER */}
      <InspectorDrawer
        open={Boolean(liveInspected)}
        onOpenChange={(o) => !o && setInspectedVia(null)}
        title={liveInspected?.label || ''}
        subtitle={
          liveInspected
            ? isGoogleVia(liveInspected)
              ? `Google Ads • ${liveInspected.googleAdsCustomerId || 'Chưa gắn CID'}`
              : `Chrome ${liveInspected.profileDir} • ${liveInspected.clientGroup || 'Chưa phân nhóm'}`
            : ''
        }
        badge={
          liveInspected && (
            <Badge variant={isGoogleVia(liveInspected) ? 'success' : 'info'}>
              {liveInspected.accountPlatform || 'meta'}
            </Badge>
          )
        }
        footer={
          liveInspected && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('edit_via', { viaId: liveInspected.viaId })}
              >
                <Edit3 className="h-3.5 w-3.5" /> Chỉnh sửa
              </Button>
              <Button
                size="sm"
                disabled={!liveInspected.canLaunch}
                onClick={() =>
                  sendDesktopCommand(isGoogleVia(liveInspected) ? 'open_google_ads_clean' : 'open_via_chrome', {
                    viaId: liveInspected.viaId,
                  })
                }
              >
                <Chrome className="h-3.5 w-3.5" /> Mở trình duyệt
              </Button>
            </div>
          )
        }
      >
        {liveInspected && (
          <div className="space-y-3 text-xs">
            <InspectorSection title="Mã 2FA & Két bảo mật DPAPI">
              <div className="flex items-center justify-between rounded-md border border-border bg-card p-2.5">
                <div>
                  <div className="text-[11px] text-muted-foreground">Mã TOTP 6 số</div>
                  <div className="font-mono text-lg font-bold tracking-wider text-primary tabular-nums">
                    {state.totpMap[liveInspected.viaId]?.formattedCode ??
                      (liveInspected.hasTwoFa ? '••••••' : 'Chưa gắn 2FA')}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => sendDesktopCommand('copy_via_totp', { viaId: liveInspected.viaId })}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy 2FA
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('open_local_vault', { viaId: liveInspected.viaId })}
                >
                  <KeyRound className="h-3.5 w-3.5 text-emerald-500" /> Mở Két 6 Lớp
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  onClick={() => sendDesktopCommand('open_recovery_mailbox', { viaId: liveInspected.viaId })}
                >
                  <Mail className="h-3.5 w-3.5 text-sky-500" /> Mở Mail khôi phục
                </Button>
              </div>
            </InspectorSection>

            <InspectorSection title="Mạng Proxy & Dấu vân tay (Fingerprint)">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Proxy:</dt>
                  <dd className="font-mono text-right">{liveInspected.networkLabel || 'Direct IP'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Màn hình / Quốc gia:</dt>
                  <dd className="font-mono text-right">
                    {liveInspected.envViewport || '1440×900'} • {liveInspected.envCountry || 'VN'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Múi giờ:</dt>
                  <dd className="font-mono text-right">{liveInspected.envTimezone || 'Asia/Ho_Chi_Minh'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Điểm Trust:</dt>
                  <dd className="font-mono font-semibold">{liveInspected.trustScore}/100</dd>
                </div>
              </dl>
            </InspectorSection>

            {!isGoogleVia(liveInspected) && (
              <InspectorSection title="Chu trình Nuôi & Ứng cứu">
                <div className="grid grid-cols-1 gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start"
                    onClick={() => sendDesktopCommand('keepalive_single_via', { viaId: liveInspected.viaId })}
                  >
                    <Coffee className="h-3.5 w-3.5 text-amber-500" /> Đảo ấm thụ động
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start"
                    onClick={() => sendDesktopCommand('run_silent_prebake_single', { viaId: liveInspected.viaId })}
                  >
                    <Ghost className="h-3.5 w-3.5 text-emerald-500" /> Ủ Cookie nền chạy ẩn
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start"
                    onClick={() => sendDesktopCommand('open_assisted_onboarding', { viaId: liveInspected.viaId })}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Bàn Khai sinh 60s
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start"
                    onClick={() => sendDesktopCommand('open_checkpoint_rescue', { viaId: liveInspected.viaId })}
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> Ứng cứu Checkpoint 1-chạm
                  </Button>
                </div>
              </InspectorSection>
            )}
          </div>
        )}
      </InspectorDrawer>
    </div>
  )
}

function ViaRowCard({
  via,
  totp,
  checked,
  onToggle,
  onInspect,
}: {
  via: WebViaItemDto
  totp?: LiveTotpItemDto
  checked: boolean
  onToggle: (checked: boolean) => void
  onInspect: () => void
}) {
  const tierInfo =
    via.roleTier === 'vault' || via.roleTier === 'hold'
      ? { label: 'HOLD BM', variant: 'info' as const }
      : via.roleTier === 'standby'
      ? { label: 'DỰ PHÒNG', variant: 'warning' as const }
      : { label: 'LÊN CAMP', variant: 'success' as const }

  const trustColor =
    via.trustScore >= 70
      ? 'text-emerald-600 dark:text-emerald-400'
      : via.trustScore >= 45
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-rose-600 dark:text-rose-400'
  const barClass =
    via.trustScore >= 70 ? 'bg-emerald-500' : via.trustScore >= 45 ? 'bg-amber-500' : 'bg-rose-500'

  const engineLine =
    via.antidetectEngine === 'chrome_native'
      ? `Chrome Cô lập • ${via.profileDir}`
      : `${via.antidetectEngineLabel} #${via.antidetectProfileId}`

  const proxyShort = !via.networkLabel.trim()
    ? 'Direct IP (Mạng gốc)'
    : extractHostPort(via.networkLabel) || via.networkLabel

  const proxyHealth =
    via.proxyStatus === 'LIVE'
      ? via.proxyLatencyMs != null
        ? `LIVE (${via.proxyLatencyMs}ms)`
        : 'LIVE'
      : via.proxyStatus === 'DEAD'
      ? 'DEAD'
      : ''

  const keepText = via.needsKeepAlive
    ? `Cần đảo ấm (${via.idleDays.toFixed(1)}d)`
    : `Ấm (${via.idleDays.toFixed(1)}d)`

  const plat = via.accountPlatform || 'meta'
  const isGadsMcc = plat === 'google_ads_mcc'
  const isGadsStandalone = plat === 'google_ads_standalone'
  const isGoogleAds = isGadsMcc || isGadsStandalone

  const launchLabel = isGoogleAds
    ? 'Mở Google Ads'
    : via.antidetectEngine === 'chrome_native'
    ? 'Mở Chrome'
    : `Mở ${via.antidetectEngineLabel}`

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="grid grid-cols-1 items-center gap-3 p-3 lg:grid-cols-[30px_1.45fr_0.9fr_1.1fr_168px_220px]">
        <div className="hidden justify-center lg:flex">
          <Checkbox checked={checked} onCheckedChange={(v) => onToggle(Boolean(v))} />
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary font-mono text-xs font-semibold text-primary">
            {getInitials(via.label)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onInspect}
                className="truncate text-left text-sm font-semibold text-foreground hover:text-primary"
              >
                {via.label}
              </button>
              {isGadsMcc ? (
                <Badge variant="info" className="px-1.5 py-0 text-[10px]">
                  GOOGLE MCC
                </Badge>
              ) : isGadsStandalone ? (
                <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                  GMAIL 1:1
                </Badge>
              ) : (
                <Badge variant={tierInfo.variant} className="px-1.5 py-0 text-[10px]">
                  {tierInfo.label}
                </Badge>
              )}
              {via.isInCooldown ? (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]" title={via.cooldownReason}>
                  COOLDOWN
                </Badge>
              ) : via.hasSiloConflict ? (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]" title={via.siloConflictDetail}>
                  <ShieldAlert className="h-2.5 w-2.5" /> TRÙNG SILO
                </Badge>
              ) : via.isBrowserRunning ? (
                <Badge variant="success" className="px-1.5 py-0 font-mono text-[10px]">
                  Mở ({via.activeRamMb}MB)
                </Badge>
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {isGoogleAds
                ? `${via.googleAdsCustomerId ? `CID: ${via.googleAdsCustomerId}` : 'CID: Chưa gắn'} • Cách ly 1:1`
                : `${via.externalReferenceId ? `UID: ${via.externalReferenceId}` : 'UID: —'} • ${via.holdingPagesCount}/${via.holdingLimit} Page • ${via.adAccountsCount} TKQC`}
              {via.ownerMemberName ? ` • ${via.ownerMemberName}` : ''}
              {via.customTag ? ` • ${via.customTag}` : ''}
            </div>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={cn('font-mono font-semibold tabular-nums', trustColor)}>
                  {via.trustScore}/100
                </span>
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    via.hasVaultCookie
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {via.hasVaultCookie ? 'Có Cookie' : 'Thiếu Cookie'}
                </span>
              </div>
              <Progress value={Math.max(12, via.trustScore)} className="h-1.5" indicatorClassName={barClass} />
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {via.incubationStageLabel || 'Đang vận hành'}
                {via.hasRecoveryMail ? ' • Có Mail' : ' • Thiếu Mail'}
                {(via.unusedBackupCodesCount ?? 0) > 0 ? ` • ${via.unusedBackupCodesCount} mã` : ''}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>{via.trustSummary || `Điểm Trust ${via.trustScore}/100 (${via.warmupLabel})`}</TooltipContent>
        </Tooltip>

        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-xs font-medium text-foreground">{engineLine}</div>
          <div
            className={cn(
              'truncate text-[11px]',
              via.proxyStatus === 'DEAD'
                ? 'text-rose-600 dark:text-rose-400'
                : via.needsKeepAlive
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {proxyShort}
            {proxyHealth ? ` (${proxyHealth})` : ''} • {keepText}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {via.envViewport || '1440×900'} • {via.envCountry || 'VN'}
            {via.webRtcLocked !== false ? ' • WebRTC Lock' : ''}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate font-mono text-sm font-semibold tabular-nums',
                totp?.justCopied
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : totp?.valid
                  ? 'text-primary'
                  : 'text-xs text-muted-foreground',
              )}
            >
              {totp?.formattedCode ?? (via.hasTwoFa ? '••••••' : 'Chưa có 2FA')}
            </span>
            {totp?.valid && !totp.justCopied && (
              <span
                className={cn(
                  'rounded border px-1 py-0.5 font-mono text-[10px] tabular-nums',
                  totp.secondsRemaining <= 5
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-secondary text-muted-foreground',
                )}
              >
                {totp.secondsRemaining}s
              </span>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={() => sendDesktopCommand('copy_via_totp', { viaId: via.viaId })}
            title={via.hasTwoFa ? 'Copy mã 2FA 6 số' : 'Gắn mã 2FA / Cookie vào Két DPAPI'}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {via.incubationStageKey === 'ready_to_born' && (
            <Button
              size="sm"
              className="h-8 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-500"
              onClick={() => sendDesktopCommand('open_assisted_onboarding', { viaId: via.viaId })}
            >
              <Sparkles className="h-3.5 w-3.5" /> Khai sinh
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Xem chi tiết hồ sơ"
            onClick={onInspect}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            disabled={!via.canLaunch}
            onClick={() =>
              sendDesktopCommand(isGoogleAds ? 'open_google_ads_clean' : 'open_via_chrome', {
                viaId: via.viaId,
              })
            }
            title={via.canLaunch ? `Mở trình duyệt an toàn (${launchLabel})` : via.denyReason}
          >
            {via.canLaunch ? <Chrome className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {via.canLaunch ? launchLabel : 'Khóa'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="w-8 px-0" title="Thao tác thêm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => sendDesktopCommand('quick_test_via', { viaId: via.viaId })}>
                <FlaskConical className="h-3.5 w-3.5 text-primary" />
                Test nhanh kịch bản (5s/bước)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('keepalive_single_via', { viaId: via.viaId })}>
                <Coffee className="h-3.5 w-3.5 text-amber-500" />
                Đảo ấm thụ động
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_local_vault', { viaId: via.viaId })}>
                <KeyRound className="h-3.5 w-3.5 text-emerald-500" />
                Két 6 Lớp (Cookie + 2FA + Mail)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_checkpoint_rescue', { viaId: via.viaId })}>
                <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                Ứng cứu Checkpoint 1-chạm
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_recovery_mailbox', { viaId: via.viaId })}>
                <Globe className="h-3.5 w-3.5 text-sky-500" />
                Mở hộp thư khôi phục cùng Proxy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('run_silent_prebake_single', { viaId: via.viaId })}>
                <Ghost className="h-3.5 w-3.5 text-primary" />
                Ủ Cookie nền chạy ẩn (CDP)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_assisted_onboarding', { viaId: via.viaId })}>
                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                Bàn Khai sinh 60 giây
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('run_prebake_session', { viaId: via.viaId })}>
                <Coffee className="h-3.5 w-3.5 text-amber-500" />
                Chạy 1 phiên Ủ Cookie hiện hình
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => sendDesktopCommand('open_manual_onboarding', { viaId: via.viaId, target: 'gmail' })}
              >
                <Users className="h-3.5 w-3.5 text-sky-500" />
                Mở khởi tạo Gmail / Webmail thủ công
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => sendDesktopCommand('set_via_env_override', { viaId: via.viaId, cycleViewport: true })}
              >
                <Monitor className="h-3.5 w-3.5 text-sky-500" />
                Đổi cỡ màn hình ({via.envViewport || '1440×900'})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => sendDesktopCommand('set_via_env_override', { viaId: via.viaId, cycleCountry: true })}
              >
                <Globe className="h-3.5 w-3.5 text-primary" />
                Đổi Quốc gia / TZ ({via.envCountry || 'VN'})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => sendDesktopCommand('set_via_custom_tag', { viaId: via.viaId, cycleTag: true })}
              >
                <Users className="h-3.5 w-3.5 text-amber-500" />
                Đổi nhãn nhóm ({via.customTag || 'Chưa gắn'})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('edit_via', { viaId: via.viaId })}>
                <Edit3 className="h-3.5 w-3.5" />
                Chỉnh sửa thông tin Via &amp; Proxy
              </DropdownMenuItem>
              {via.networkLabel && (
                <DropdownMenuItem onClick={() => sendDesktopCommand('check_via_proxy', { viaId: via.viaId })}>
                  <Globe className="h-3.5 w-3.5 text-sky-500" />
                  Kiểm tra nhanh Proxy Live/Dead
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-rose-500 focus:text-rose-500"
                onClick={() => sendDesktopCommand('archive_via', { viaId: via.viaId })}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Lưu trữ (Archive) hồ sơ này
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}
