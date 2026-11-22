import { useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  CheckSquare,
  ChevronDown,
  Chrome,
  Coffee,
  Copy,
  Edit3,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  Globe,
  Grid2x2,
  KeyRound,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
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
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [engineFilter, setEngineFilter] = useState('all')
  const [proxyFilter, setProxyFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const distinctProxies = useMemo(() => {
    const set = new Set<string>()
    for (const v of state.vias) {
      if (v.proxyHostPort) set.add(v.proxyHostPort)
    }
    return Array.from(set).sort()
  }, [state.vias])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.vias.filter((v) => {
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
        v.displayName.toLowerCase().includes(q) ||
        v.externalReferenceId.toLowerCase().includes(q) ||
        v.profileDir.toLowerCase().includes(q) ||
        v.antidetectProfileId.toLowerCase().includes(q) ||
        v.networkLabel.toLowerCase().includes(q) ||
        v.ownerMemberName.toLowerCase().includes(q) ||
        v.clientGroup.toLowerCase().includes(q)
      )
    })
  }, [state.vias, search, tierFilter, engineFilter, proxyFilter, ownerFilter])

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

  const issueCount = state.vias.filter(
    (v) => v.isInCooldown || v.hasSiloConflict || v.proxyStatus === 'DEAD',
  ).length

  const tierChips = [
    { key: 'all', label: `Tất cả (${state.vias.length})` },
    { key: 'vault', label: `Hold BM (${state.vias.filter((v) => v.roleTier === 'vault' || v.roleTier === 'hold').length})` },
    {
      key: 'camp',
      label: `Lên Camp (${state.vias.filter((v) => v.roleTier !== 'vault' && v.roleTier !== 'hold' && v.roleTier !== 'standby').length})`,
    },
    { key: 'standby', label: `Dự phòng (${state.vias.filter((v) => v.roleTier === 'standby').length})` },
    {
      key: 'ready_to_born',
      label: `🔔 Chờ Khai Sinh (${state.vias.filter((v) => v.incubationStageKey === 'ready_to_born').length})`,
    },
    {
      key: 'incubating',
      label: `🥚 Đang Ủ / Ấp (${
        state.vias.filter(
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
      label: `🛡️ Dự Phòng Sẵn Sàng (${state.vias.filter((v) => v.incubationStageKey === 'standby_ready').length})`,
    },
    { key: 'keepalive_due', label: `Cần Đảo Ấm (${state.vias.filter((v) => v.needsKeepAlive).length})` },
    { key: 'no_cookie', label: `Thiếu Cookie (${state.vias.filter((v) => !v.hasVaultCookie).length})` },
    { key: 'running', label: `Đang mở (${state.vias.filter((v) => v.isBrowserRunning).length})` },
    ...(issueCount > 0 || tierFilter === 'cooldown'
      ? [{ key: 'cooldown', label: `Cooldown/Cảnh báo (${issueCount})` }]
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

  const [standbyOpen, setStandbyOpen] = useState(true)
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
      {/* Agency Standby Pool & Scheduled 2-3 Day Embryo Factory Bar (v3.9.1) */}
      <Card className="border-indigo-500/30 bg-indigo-500/5">
        <CardContent className="space-y-2.5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="flex items-center gap-2 text-left text-xs font-bold text-indigo-200 hover:text-indigo-100"
              onClick={() => setStandbyOpen((v) => !v)}
            >
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              🛡️ Kho Dự Phòng Agency &amp; Xưởng Tự Động Ủ Phôi 2–3 Ngày (v3.9.1) {standbyOpen ? '▲' : '▼'}
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 border border-indigo-500/35 px-2.5 text-xs text-indigo-200 hover:bg-indigo-500/15"
                onClick={() => setFactoryConfigOpen((v) => !v)}
              >
                ⚙️ Lịch Tự Động ({efEnabled ? `Mỗi ${efInterval}d` : 'Đang Tắt'}) {factoryConfigOpen ? '▲' : '▼'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={ef.isSilentPreBakeRunning}
                className="h-7 border border-emerald-500/35 px-2.5 text-xs text-emerald-300 hover:bg-emerald-500/15"
                onClick={() => sendDesktopCommand('spawn_embryo_now')}
              >
                {ef.isSilentPreBakeRunning ? '⏳ Đang Ủ Ngầm...' : '🥚 Đẻ & Ủ Ngầm 1 Phôi Ngay'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => sendDesktopCommand('add_via')}
              >
                + Thêm Via Thủ Công
              </Button>
            </div>
          </div>

          {ef.readyToBornCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <div className="flex items-center gap-2 font-semibold">
                <BellRing className="h-4 w-4 shrink-0 text-emerald-400" />
                🔔 Có {ef.readyToBornCount} Phôi đã ủ chín Cookie sạch — Sẵn sàng Khai Sinh 60s chính chủ &amp; tự đưa vào Lò Ấp 7 Ngày!
              </div>
              <Button
                size="sm"
                className="h-7 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-500"
                onClick={() => setTierFilter('ready_to_born')}
              >
                Lọc Phôi Chờ Khai Sinh ({ef.readyToBornCount})
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
                  <span className={row.standbyReadyCount > 0 ? 'text-emerald-400' : 'text-amber-300'}>
                    {row.standbyReadyCount} Sẵn sàng
                  </span>
                  {row.incubatingCount > 0 && <span>• {row.incubatingCount} đang ủ/ấp</span>}
                  {row.missingRecoveryMailCount > 0 && (
                    <span className="text-amber-300">• {row.missingRecoveryMailCount} thiếu Mail</span>
                  )}
                  {row.hasStandbyDeficit && <span>⚠ Thiếu (&lt;2 Standby)</span>}
                </Badge>
              ))}
            </div>
          )}

          {factoryConfigOpen && (
            <div className="space-y-3 rounded-lg border border-border/80 bg-background/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Switch checked={efEnabled} onCheckedChange={setEfEnabled} />
                  <div>
                    <div className="text-xs font-bold text-foreground">
                      Bật Lịch Tự Động Đẻ &amp; Ủ Cookie Ngầm Định Kỳ (08:00–22:00)
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {ef.nextSpawnHint} • Tạo gần nhất: {ef.lastSpawnLocal} • Proxy sạch trong kho: {ef.proxyPoolValidCount}
                    </div>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ef.isSilentPreBakeRunning}
                  onClick={() => sendDesktopCommand('bake_all_embryos_silent')}
                >
                  👻 Ủ Ngầm Tất Cả Phôi Đang Chờ ({ef.preBakingCount})
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Chu kỳ tạo (ngày)</span>
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
                  <span className="text-[11px] font-semibold text-muted-foreground">Phiên Cookie Robot cần ủ</span>
                  <Select value={efSessions} onValueChange={setEfSessions}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 phiên (~1–2 ngày)</SelectItem>
                      <SelectItem value="3">3 phiên (~2–3 ngày)</SelectItem>
                      <SelectItem value="4">4 phiên (Cực chín)</SelectItem>
                      <SelectItem value="5">5 phiên (Siêu sạch)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Trần Phôi chờ tối đa</span>
                  <Input
                    value={efMaxPending}
                    onChange={(e) => setEfMaxPending(e.target.value)}
                    placeholder="3"
                    className="h-8 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Nhóm khách (Client Silo)</span>
                  <Input
                    value={efClientGroup}
                    onChange={(e) => setEfClientGroup(e.target.value)}
                    placeholder="VD: NhaKhoa_A"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Domain Mail riêng (tùy chọn)</span>
                  <Input
                    value={efDomain}
                    onChange={(e) => setEfDomain(e.target.value)}
                    placeholder="VD: agency.vn"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Kho Proxy sạch dành riêng cho Phôi tự động (mỗi dòng 1 Proxy: ip:port:user:pass hoặc http://user:pass@ip:port)
                </span>
                <Textarea
                  value={efProxyPool}
                  onChange={(e) => setEfProxyPool(e.target.value)}
                  rows={2}
                  placeholder="103.1.2.3:8080:user:pass&#10;http://user:pass@45.6.7.8:3128"
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  ⚙️ 90% Tự Động: App tự đẻ Profile + ủ ngầm Cookie sạch mỗi {efInterval} ngày. Đủ {efSessions} phiên app báo chuông để bạn bấm Khai Sinh 60s chính chủ (không tự động vượt CAPTCHA/SMS), rồi tự đưa tiếp vào Lò Ấp 7 Ngày.
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
                  💾 Lưu Lịch Xưởng Phôi
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search, Action Header & Filters Card */}
      <Card>
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên Via, UID, Profile Chrome, Proxy..."
                className="pl-8"
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/15"
              onClick={() => sendDesktopCommand('harvest_all_open_cookies')}
              title="Tự động thu Cookie Facebook sạch từ các cửa sổ Chrome Cô lập đang mở và lưu vào Két DPAPI (mở khóa 100% chế độ chạy ẩn)"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Thu Cookie đang mở
            </Button>

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
                  Công cụ Lô <ChevronDown className="h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem onClick={() => sendDesktopCommand('bulk_change_tier', { viaIds: selectedIds })}>
                  <Users className="h-3.5 w-3.5 text-indigo-400" />
                  Đổi Lớp Via / Nhóm Khách &amp; Tách Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_proxy_check')}>
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                  Quét kiểm tra Proxy Live/Dead toàn bộ
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('bulk_import_vias')}>
                  <Upload className="h-3.5 w-3.5 text-sky-400" />
                  Nhập Lô nhiều Via từ Clipboard (Ctrl+B)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('export_vias_csv')}>
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                  Xuất danh sách Via &amp; Proxy ra file CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('tile_chrome_windows', { grid: '2x2' })}>
                  <Grid2x2 className="h-3.5 w-3.5" />
                  Xếp cửa sổ Chrome đang mở dạng lưới 2×2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_auto_connect_token')}>
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  Dán Token EAAB... kết nối nhanh Via &amp; TKQC
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('benchmark_engines')}>
                  <Gauge className="h-3.5 w-3.5 text-purple-400" />
                  Benchmark tốc độ 5 Engine Antidetect
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_stewardship_log')}>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Xem Nhật ký Bảo vệ &amp; Chặn rò rỉ IP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_launch_audit')}>
                  <Terminal className="h-3.5 w-3.5" />
                  Xem Nhật ký Mở Profile (Audit Log)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleAllVisible}>
                  <CheckSquare className="h-3.5 w-3.5" />
                  Chọn / Bỏ chọn tất cả Via đang hiển thị
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" onClick={() => sendDesktopCommand('add_via')}>
              <Plus className="h-3.5 w-3.5" />
              Thêm Via
            </Button>
          </div>

          {/* Tier Filter Chips */}
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

          {/* Unified Engine / Proxy Cluster / Owner Filters */}
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
            <Select value={engineFilter} onValueChange={setEngineFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Engine: Tất cả (5+1)</SelectItem>
                {state.supportedEngines.map((eng) => (
                  <SelectItem key={eng.value} value={eng.value}>
                    Engine: {eng.label} (
                    {state.vias.filter((v) => v.antidetectEngine === eng.value).length})
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

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <Card className="border-primary/45 bg-primary/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-2.5 p-3">
            <span className="text-xs font-semibold text-primary">
              Đã chọn {selectedIds.length} Via — Áp dụng thao tác hàng loạt an toàn:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                onClick={() => sendDesktopCommand('distribute_proxies', { viaIds: selectedIds })}
              >
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
                <Coffee className="h-3 w-3" /> Đảo Ấm lô chọn
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => sendDesktopCommand('bulk_check_proxy', { viaIds: selectedIds })}
              >
                <Globe className="h-3 w-3" /> Check Proxy đã chọn
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

      {/* Empty or Linear Via Table Rows */}
      {state.vias.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Users className="h-9 w-9 text-muted-foreground" />
            <div>
              <div className="text-sm font-bold text-foreground">Chưa có Via nào trong hệ thống</div>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Thêm Via đầu tiên để gắn Chrome Profile, Proxy tĩnh và lưu trữ Cookie / 2FA mã hóa DPAPI tại máy.
              </p>
            </div>
            <Button onClick={() => sendDesktopCommand('add_via')}>
              <Plus className="h-4 w-4" /> Thêm Via đầu tiên
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            Không có Via nào khớp bộ lọc hiện tại.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[30px_1.45fr_0.9fr_1.1fr_168px_210px] items-center gap-3 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:grid">
            <div className="flex justify-center">
              <Checkbox
                checked={filtered.length > 0 && filtered.every((v) => selectedSet.has(v.viaId))}
                onCheckedChange={toggleAllVisible}
              />
            </div>
            <div>TÀI KHOẢN VIA &amp; VAI TRÒ</div>
            <div>ĐIỂM TRUST &amp; COOKIE</div>
            <div>PROFILE &amp; MẠNG PROXY</div>
            <div>MÃ 2FA LIVE</div>
            <div className="text-right">THAO TÁC</div>
          </div>

          {filtered.map((via) => (
            <ViaRowCard
              key={via.viaId}
              via={via}
              totp={state.totpMap[via.viaId]}
              checked={selectedSet.has(via.viaId)}
              onToggle={(c) => toggleVia(via.viaId, c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ViaRowCard({
  via,
  totp,
  checked,
  onToggle,
}: {
  via: WebViaItemDto
  totp?: LiveTotpItemDto
  checked: boolean
  onToggle: (checked: boolean) => void
}) {
  const tierInfo =
    via.roleTier === 'vault' || via.roleTier === 'hold'
      ? { label: 'HOLD BM', variant: 'info' as const }
      : via.roleTier === 'standby'
      ? { label: 'DỰ PHÒNG', variant: 'warning' as const }
      : { label: 'LÊN CAMP', variant: 'success' as const }

  const trustColor =
    via.trustScore >= 70 ? 'text-emerald-400' : via.trustScore >= 45 ? 'text-amber-400' : 'text-rose-400'
  const barClass =
    via.trustScore >= 70 ? 'bg-emerald-500' : via.trustScore >= 45 ? 'bg-amber-500' : 'bg-rose-500'

  const engineLine =
    via.antidetectEngine === 'chrome_native'
      ? `Chrome Cô lập • ${via.profileDir}`
      : `🎭 ${via.antidetectEngineLabel} #${via.antidetectProfileId}`

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
    ? `Cần Đảo Ấm (${via.idleDays.toFixed(1)}d)`
    : `Ấm (${via.idleDays.toFixed(1)}d)`

  const launchLabel =
    via.antidetectEngine === 'chrome_native' ? 'Mở Chrome' : `Mở ${via.antidetectEngineLabel}`

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="grid grid-cols-1 items-center gap-3 p-3 lg:grid-cols-[30px_1.45fr_0.9fr_1.1fr_168px_210px]">
        {/* Checkbox */}
        <div className="hidden justify-center lg:flex">
          <Checkbox checked={checked} onCheckedChange={(v) => onToggle(Boolean(v))} />
        </div>

        {/* Col 1: Avatar + Identity */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary font-mono text-xs font-bold text-primary">
            {getInitials(via.label)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-bold text-foreground">{via.label}</span>
              <Badge variant={tierInfo.variant} className="px-1.5 py-0 text-[10px]">
                {tierInfo.label}
              </Badge>
              {via.isInCooldown ? (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]" title={via.cooldownReason}>
                  ❄️ COOLDOWN
                </Badge>
              ) : via.hasSiloConflict ? (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]" title={via.siloConflictDetail}>
                  <ShieldAlert className="h-2.5 w-2.5" /> TRÙNG SILO
                </Badge>
              ) : via.isBrowserRunning ? (
                <Badge variant="success" className="px-1.5 py-0 font-mono text-[10px]">
                  ⚡ ĐANG MỞ ({via.activeRamMb}MB)
                </Badge>
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {via.externalReferenceId ? `UID: ${via.externalReferenceId}` : 'UID: —'} • Cầm{' '}
              {via.holdingPagesCount}/{via.holdingLimit} Page • {via.adAccountsCount} TKQC
              {via.ownerMemberName ? ` • 👤 ${via.ownerMemberName}` : ''}
              {via.customTag ? ` • 🏷️ ${via.customTag}` : ''}
            </div>
          </div>
        </div>

        {/* Col 2: Trust Score + Cookie DPAPI */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={cn('font-mono font-bold tabular-nums', trustColor)}>{via.trustScore}/100</span>
                <span className={cn('text-[11px] font-semibold', via.hasVaultCookie ? 'text-emerald-400' : 'text-amber-400')}>
                  {via.hasVaultCookie ? '✓ Két Cookie' : '⚠ Chưa lưu'}
                </span>
              </div>
              <Progress value={Math.max(12, via.trustScore)} className="h-1.5" indicatorClassName={barClass} />
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {via.incubationStageLabel || '🛡️ Đang vận hành'}
                {via.hasRecoveryMail ? ' • 📧 Mail Két' : ' • ⚠ Thiếu Mail'}
                {(via.unusedBackupCodesCount ?? 0) > 0 ? ` • 🔢 ${via.unusedBackupCodesCount} mã` : ''}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>{via.trustSummary || `Điểm Trust ${via.trustScore}/100 (${via.warmupLabel})`}</TooltipContent>
        </Tooltip>

        {/* Col 3: Profile & Proxy */}
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-xs font-semibold text-foreground">{engineLine}</div>
          <div
            className={cn(
              'truncate text-[11px]',
              via.proxyStatus === 'DEAD'
                ? 'text-rose-400'
                : via.needsKeepAlive
                ? 'text-amber-400'
                : 'text-emerald-400',
            )}
          >
            ● {proxyShort}
            {proxyHealth ? ` (${proxyHealth})` : ''} • {keepText}
          </div>
          <div
            className="truncate font-mono text-[10px] text-muted-foreground"
            title={`Cỡ cửa sổ cố định: ${via.envViewport || '1440×900'} • Ngôn ngữ: ${via.envLang || 'vi-VN'} • Múi giờ: ${via.envTimezone || 'Asia/Ho_Chi_Minh'} • Khóa rò rỉ WebRTC: ${via.webRtcLocked !== false ? 'BẬT' : 'TẮT'}`}
          >
            🖥️ {via.envViewport || '1440×900'} • 🌐 {via.envCountry || 'VN'} ({via.envLang || 'vi-VN'})
            {via.webRtcLocked !== false ? ' • 🛡️ WebRTC Lock' : ''}
          </div>
          {via.hasTimezoneMismatch && (
            <div className="truncate text-[10px] text-amber-400" title={via.timezoneWarning}>
              ⚠ Lệch múi giờ Proxy
            </div>
          )}
        </div>

        {/* Col 4: Live 2FA OTP */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'truncate font-mono text-sm font-bold tabular-nums',
                totp?.justCopied ? 'text-emerald-400' : totp?.valid ? 'text-primary' : 'text-xs text-muted-foreground',
              )}
            >
              {totp?.formattedCode ?? (via.hasTwoFa ? '••••••' : 'Chưa gắn 2FA')}
            </span>
            {totp?.valid && !totp.justCopied && (
              <span
                className={cn(
                  'rounded border px-1 py-0.5 font-mono text-[10px] tabular-nums',
                  totp.secondsRemaining <= 5
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
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
            title={via.hasTwoFa ? 'Copy mã 2FA 6 số' : 'Bấm để gắn mã 2FA / Cookie vào Két DPAPI'}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Col 5: Actions */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {via.incubationStageKey === 'ready_to_born' && (
            <Button
              size="sm"
              className="h-8 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-500"
              onClick={() => sendDesktopCommand('open_assisted_onboarding', { viaId: via.viaId })}
              title="Phôi đã ủ chín Cookie sạch — Bấm để mở Bàn Khai Sinh 60 Giây (gom Cookie + lưu Két 6 Lớp + Lò Ấp 7 Ngày)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Khai Sinh 60s
            </Button>
          )}
          <Button
            size="sm"
            disabled={!via.canLaunch}
            onClick={() => sendDesktopCommand('open_via_chrome', { viaId: via.viaId })}
            title={via.canLaunch ? `Mở trình duyệt an toàn (${launchLabel})` : via.denyReason}
          >
            <Chrome className="h-3.5 w-3.5" />
            {via.canLaunch ? launchLabel : '🔒 Khóa'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="w-8 px-0" title="Thao tác Via">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => sendDesktopCommand('quick_test_via', { viaId: via.viaId })}>
                <FlaskConical className="h-3.5 w-3.5 text-primary" />
                Test Nhanh Kịch Bản (5s/bước)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('keepalive_single_via', { viaId: via.viaId })}>
                <Coffee className="h-3.5 w-3.5 text-amber-400" />
                Đảo Ấm thụ động cho Via này
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_local_vault', { viaId: via.viaId })}>
                <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                Két 6 Lớp (Cookie + 2FA + Mail + Mã 8 số)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_checkpoint_rescue', { viaId: via.viaId })}>
                <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                🚑 Ứng cứu Checkpoint 1-Chạm (2FA + Mail)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_recovery_mailbox', { viaId: via.viaId })}>
                <Globe className="h-3.5 w-3.5 text-sky-400" />
                📧 Mở Hộp thư Khôi phục trên cùng Proxy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('run_silent_prebake_single', { viaId: via.viaId })}>
                <Coffee className="h-3.5 w-3.5 text-indigo-300" />
                👻 Ủ Cookie Nền Chạy Ẩn (Off-Screen CDP)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_assisted_onboarding', { viaId: via.viaId })}>
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                🧭 Bàn Khai Sinh 60 Giây (Gom Cookie + Két 6 Lớp)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('run_prebake_session', { viaId: via.viaId })}>
                <Coffee className="h-3.5 w-3.5 text-amber-300" />
                🥚 Chạy 1 Phiên Ủ Cookie Hiện Hình (Pre-Bake)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('open_manual_onboarding', { viaId: via.viaId, target: 'gmail' })}>
                <Users className="h-3.5 w-3.5 text-sky-300" />
                🌐 Mở Khởi tạo Gmail / Webmail Thủ công
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('set_via_env_override', { viaId: via.viaId, cycleViewport: true })}>
                <Monitor className="h-3.5 w-3.5 text-sky-400" />
                Đổi cỡ màn hình ({via.envViewport || '1440×900'})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('set_via_env_override', { viaId: via.viaId, cycleCountry: true })}>
                <Globe className="h-3.5 w-3.5 text-indigo-400" />
                Đổi Quốc gia / TZ ({via.envCountry || 'VN'} • {via.envTimezone || 'Asia/Ho_Chi_Minh'})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('set_via_custom_tag', { viaId: via.viaId, cycleTag: true })}>
                <Users className="h-3.5 w-3.5 text-amber-400" />
                🏷️ Đổi Nhãn nhóm ({via.customTag || 'Chưa gắn'})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendDesktopCommand('edit_via', { viaId: via.viaId })}>
                <Edit3 className="h-3.5 w-3.5" />
                Chỉnh sửa thông tin Via &amp; Proxy
              </DropdownMenuItem>
              {via.networkLabel && (
                <DropdownMenuItem onClick={() => sendDesktopCommand('check_via_proxy', { viaId: via.viaId })}>
                  <Globe className="h-3.5 w-3.5 text-sky-400" />
                  Kiểm tra nhanh Proxy Live/Dead
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-rose-400 focus:text-rose-300"
                onClick={() => sendDesktopCommand('archive_via', { viaId: via.viaId })}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Lưu trữ (Archive) Via này
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}
