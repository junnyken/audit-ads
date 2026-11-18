import { useMemo, useState } from 'react'
import {
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
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
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
    { key: 'keepalive_due', label: `Cần Đảo Ấm (${state.vias.filter((v) => v.needsKeepAlive).length})` },
    { key: 'no_cookie', label: `Thiếu Cookie (${state.vias.filter((v) => !v.hasVaultCookie).length})` },
    { key: 'running', label: `Đang mở (${state.vias.filter((v) => v.isBrowserRunning).length})` },
    ...(issueCount > 0 || tierFilter === 'cooldown'
      ? [{ key: 'cooldown', label: `Cooldown/Cảnh báo (${issueCount})` }]
      : []),
  ]

  return (
    <div className="space-y-3.5">
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
          <div className="hidden grid-cols-[30px_1.5fr_0.95fr_1.15fr_176px_170px] items-center gap-3 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:grid">
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
      <CardContent className="grid grid-cols-1 items-center gap-3 p-3 lg:grid-cols-[30px_1.5fr_0.95fr_1.15fr_176px_170px]">
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
        <div className="flex items-center justify-end gap-1.5">
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
            <DropdownMenuContent align="end" className="w-60">
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
                Két Cookie &amp; 2FA DPAPI Local
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
