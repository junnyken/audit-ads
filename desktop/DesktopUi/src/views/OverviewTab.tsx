import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronDown,
  Chrome,
  Coffee,
  Cpu,
  CreditCard,
  ExternalLink,
  FlaskConical,
  Gauge,
  Globe,
  HardDriveDownload,
  KeyRound,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleAdAccountId, isGoogleVia, useShellUi } from '@/lib/shell-context'
import type {
  AppShellWebStateDto,
  OverviewAlertGroupDto,
  WebFanpageDto,
  WebViaItemDto,
} from '@/types'

function formatMb(mb: number): string {
  return mb.toLocaleString('en-US')
}

export function OverviewTab({ state }: { state: AppShellWebStateDto }) {
  const { platformScope } = useShellUi()
  const { kpi, workstation } = state

  const scopedVias = useMemo(() => {
    if (platformScope === 'all') return state.vias
    return state.vias.filter((v) =>
      platformScope === 'google_ads' ? isGoogleVia(v) : !isGoogleVia(v),
    )
  }, [state.vias, platformScope])

  const scopedAdAccounts = useMemo(() => {
    if (platformScope === 'all') return state.adAccounts
    return state.adAccounts.filter((a) =>
      platformScope === 'google_ads'
        ? isGoogleAdAccountId(a.externalAccountId)
        : !isGoogleAdAccountId(a.externalAccountId),
    )
  }, [state.adAccounts, platformScope])

  const scopedTotalVias = platformScope === 'all' ? kpi.totalVias : scopedVias.length
  const scopedTotalAds = platformScope === 'all' ? kpi.totalAdAccounts : scopedAdAccounts.length
  const scopedActiveAds =
    platformScope === 'all' ? kpi.activeAdAccounts : scopedAdAccounts.filter((a) => a.isActive).length

  const readyCount = Math.max(kpi.cookieVaultCount, kpi.nativeProfileReadyCount)
  const viaReadyPct =
    kpi.totalVias > 0 ? Math.max(12, Math.round((readyCount / kpi.totalVias) * 100)) : 100
  const pageReadyPct =
    kpi.totalPages > 0 ? Math.max(15, Math.round((kpi.adsReadyPages / kpi.totalPages) * 100)) : 85
  const adActivePct =
    scopedTotalAds > 0 ? Math.max(12, Math.round((scopedActiveAds / scopedTotalAds) * 100)) : 80
  const ramUsedPct = Math.max(0, Math.min(100, 100 - workstation.freePercent))

  const pipelineSteps = [
    {
      num: '01',
      title: 'Dọn Cache & RAM',
      desc: 'Thu hồi bộ nhớ Chrome Profile đang đóng',
      tone: 'success' as const,
      action: 'clean_ram',
      tip: 'Dọn cache Chrome Profile không hoạt động ngay',
    },
    {
      num: '02',
      title: 'Quét Proxy Live',
      desc: `${kpi.liveProxyVias} Proxy LIVE • ${kpi.directIpVias} Direct IP`,
      tone: 'success' as const,
      action: 'batch_proxy_check',
      tip: 'Kiểm tra kết nối toàn bộ Proxy & đối chiếu múi giờ',
    },
    {
      num: '03',
      title: 'Đồng bộ Meta & BM',
      desc: `Quét ${kpi.totalPages} Fanpage & ${kpi.totalAdAccounts} TKQC`,
      tone: 'info' as const,
      action: 'sync_meta_pages',
      tip: 'Cập nhật lại dữ liệu Fanpage và TKQC từ Meta',
    },
    {
      num: '04',
      title: 'Nuôi Page & Follow',
      desc: `Đã mời ${kpi.totalFollowersInvited.toLocaleString('en-US')} lượt tương tác`,
      tone: 'info' as const,
      action: 'batch_invite_followers',
      tip: 'Mở hàng loạt Fanpage để gửi lời mời Follow tự động',
    },
    {
      num: '05',
      title: 'Đảo Ấm Đa Via',
      desc:
        kpi.dueKeepAliveCount > 0
          ? `${kpi.dueKeepAliveCount} Via đến hạn cuộn Feed`
          : 'Toàn bộ Via đang ấm ổn định',
      tone: kpi.dueKeepAliveCount > 0 ? ('warning' as const) : ('success' as const),
      action: 'keepalive_due',
      tip: 'Chạy kịch bản Đảo Ấm cho các Via tới hạn',
    },
  ]

  const totalViaPool = Math.max(1, kpi.totalVias)
  const pctProxyLive = Math.round((kpi.liveProxyVias / totalViaPool) * 100)
  const pctCookie = Math.round((kpi.cookieVaultCount / totalViaPool) * 100)
  const pctProfileReady = Math.round((kpi.nativeProfileReadyCount / totalViaPool) * 100)
  const pctDue = Math.round((kpi.dueKeepAliveCount / totalViaPool) * 100)
  const segProxy = Math.min(100, pctProxyLive)
  const segCookie = Math.max(0, Math.min(100 - segProxy, pctCookie))
  const segNative = Math.max(0, Math.min(100 - segProxy - segCookie, pctProfileReady - segCookie))
  const segDue = Math.max(0, Math.min(100 - segProxy - segCookie - segNative, pctDue))

  const livePagesForInvite = state.fanpages
    .filter((p) => !p.isUnsyncedDraft && p.healthStatus.toUpperCase() === 'LIVE')
    .slice(0, 4)

  return (
    <div className="space-y-4">
      {state.vias.length > 0 && !state.settings.hasPortableBackupPassphrase && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Chưa đặt Mật khẩu Két Backup Portable:</strong> Nếu cài lại Windows hoặc đổi máy, bản Auto-Backup DPAPI cục bộ sẽ không giải mã được. Hãy đặt mật khẩu Portable 1 lần!
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
          >
            Đặt mật khẩu Két ngay
          </Button>
        </div>
      )}

      {/* Workstation Status & Quick Tools Bar */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={kpi.bridgeOnline ? 'success' : 'destructive'} className="font-mono">
              <ShieldCheck className="h-3 w-3" />
              Bridge :{kpi.bridgePort} · Ext v{kpi.extVersion}
            </Badge>
            {kpi.activeBrowsers > 0 && (
              <Badge variant="info" className="font-mono">
                <Chrome className="h-3 w-3" />
                {kpi.activeBrowsers} Chrome đang mở
              </Badge>
            )}
            {state.isOfflineSnapshot && (
              <Badge variant="warning">Dự phòng Offline ({state.offlineSnapshotAt})</Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="hidden items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground xl:flex">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  <span className="tabular-nums font-medium text-foreground">
                    RAM trống {formatMb(workstation.availableRamMb)} / {formatMb(workstation.totalRamMb)} MB
                  </span>
                  <div className="w-16">
                    <Progress
                      value={ramUsedPct}
                      className="h-1.5"
                      indicatorClassName={workstation.isLowRam ? 'bg-amber-500' : 'bg-emerald-500'}
                    />
                  </div>
                  <span className="text-muted-foreground">({workstation.recommendedConcurrent} luồng)</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Tài nguyên máy trạm: trống {workstation.freePercent}% • khuyến nghị mở tối đa{' '}
                {workstation.recommendedConcurrent} Chrome song song
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {state.isLoggedIn && kpi.totalVias > 0 && platformScope !== 'google_ads' && (
              <Button size="sm" onClick={() => sendDesktopCommand('quick_test_first')}>
                <FlaskConical className="h-3.5 w-3.5" />
                Test nhanh 1 Via (5s)
              </Button>
            )}

            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('clean_ram')}>
              <Trash2 className="h-3.5 w-3.5" />
              Dọn RAM
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Wrench className="h-3.5 w-3.5" />
                  Công cụ nhanh
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Bộ công cụ điều hành</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_proxy_check')}>
                  <Globe className="h-3.5 w-3.5 text-emerald-500" />
                  Quét kiểm tra Proxy hàng loạt (Live/Dead)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('keepalive_due')}>
                  <Coffee className="h-3.5 w-3.5 text-amber-500" />
                  Đảo ấm toàn bộ Via quá hạn ngay
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_invite_followers')}>
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  Chạy lô mời người tương tác Follow Page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('sync_meta_pages')}>
                  <RefreshCw className="h-3.5 w-3.5 text-sky-500" />
                  Đồng bộ Fanpage từ Meta Graph API
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('provision_extensions')}>
                  <Shield className="h-3.5 w-3.5 text-emerald-500" />
                  Cấp lại Chrome Extension v{state.extVersion}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('benchmark_engines')}>
                  <Gauge className="h-3.5 w-3.5 text-violet-500" />
                  Benchmark tốc độ 5 Engine Antidetect
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_launch_audit')}>
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  Xem nhật ký mở Profile (Audit Log)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('apply_safe_preset')}>
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Áp dụng cấu hình An toàn chuẩn (1-Click)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Card>

      {!state.isLoggedIn && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-primary">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Kết nối tài khoản AdsOps Cloud</h2>
                <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                  Đăng nhập tài khoản để đồng bộ Via, Business Manager, Fanpage và Tài khoản QC. Cookie &amp; 2FA luôn
                  được mã hóa DPAPI tại máy Windows này.
                </p>
              </div>
            </div>
            <Button onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}>
              <KeyRound className="h-4 w-4" />
              Đi tới Đăng nhập &amp; Két khóa
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 4 Compact KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'vias' })}
          className="cursor-pointer transition-colors hover:border-primary/50"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {platformScope === 'google_ads' ? 'Hồ sơ Google Ads' : 'Hồ sơ & Dàn Via'}
            </CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? scopedTotalVias : '—'}
              </span>
              <Badge variant={kpi.dueKeepAliveCount > 0 ? 'warning' : 'success'}>
                {kpi.dueKeepAliveCount > 0 ? `${kpi.dueKeepAliveCount} cần đảo ấm` : 'Ổn định'}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {kpi.nativeProfileReadyCount}/{kpi.totalVias} Profile sẵn sàng • {kpi.cookieVaultCount} Két Cookie
            </p>
            <Progress value={viaReadyPct} indicatorClassName="bg-primary" />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'pages_bm' })}
          className="cursor-pointer transition-colors hover:border-emerald-500/50"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Fanpage &amp; Tăng trưởng</CardTitle>
            <LayoutDashboard className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? kpi.totalPages : '—'}
              </span>
              <Badge variant="success">+{kpi.totalFollowersInvited.toLocaleString('en-US')} mời</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {kpi.adsReadyPages}/{kpi.totalPages} Fanpage sẵn sàng chạy Ads
            </p>
            <Progress value={pageReadyPct} indicatorClassName="bg-emerald-500" />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'ad_accounts' })}
          className="cursor-pointer transition-colors hover:border-amber-500/50"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Tài khoản Quảng cáo</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? scopedTotalAds : '—'}
              </span>
              <Badge variant={kpi.openAlertCount > 0 ? 'warning' : 'success'}>
                {kpi.openAlertCount} cảnh báo mở
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {scopedActiveAds} TKQC Active • {kpi.criticalHealthCount} Critical
            </p>
            <Progress
              value={adActivePct}
              indicatorClassName={kpi.openAlertCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
          className="cursor-pointer transition-colors hover:border-primary/50"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Khiên Bảo vệ &amp; 2FA</CardTitle>
            <ShieldCheck className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {kpi.bridgeOnline ? `:${kpi.bridgePort}` : 'OFF'}
              </span>
              <Badge variant="info">Ext v{kpi.extVersion}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Zero-Trust DPAPI • {kpi.twoFaReadyCount} mã 2FA cục bộ
            </p>
            <Progress value={kpi.bridgeOnline ? 100 : 15} indicatorClassName="bg-primary" />
          </CardContent>
        </Card>
      </div>

      {/* 5-Step Pipeline */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <Zap className="h-4 w-4 text-primary" />
                  Chu trình Auto-Pilot 5 Bước
                </CardTitle>
                <Badge variant={state.autoDailyPipeline ? 'success' : 'secondary'}>
                  {state.autoDailyPipeline ? 'Lịch sáng tự động: BẬT' : 'Kích hoạt thủ công'}
                </Badge>
              </div>
              <CardDescription className="mt-0.5 text-xs">
                Bấm từng bước để chạy riêng lẻ, hoặc bấm Auto-Pilot trên thanh tiêu đề để chạy tuần tự 01 → 05.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>Chrome sẵn: {pctProfileReady}%</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>Direct IP: {kpi.directIpVias} (max {kpi.maxDirectIpPerBatch})</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>Proxy LIVE: {pctProxyLive}%</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>DPAPI: {pctCookie}%</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
            {pipelineSteps.map((st) => (
              <Tooltip key={st.num}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => sendDesktopCommand(st.action)}
                    className="group flex flex-col justify-between rounded-lg border border-border bg-background/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-primary">STEP {st.num}</span>
                      <Badge variant={st.tone} className="px-1.5 py-0 text-[10px]">
                        Sẵn sàng
                      </Badge>
                    </div>
                    <div className="mt-1.5">
                      <div className="text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
                        {st.title}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{st.desc}</div>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{st.tip}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${segProxy}%` }}
                title={`Proxy LIVE: ${kpi.liveProxyVias} Via (${pctProxyLive}%)`}
              />
              <div
                className="bg-primary transition-all"
                style={{ width: `${segCookie}%` }}
                title={`Cookie DPAPI: ${kpi.cookieVaultCount} Via (${pctCookie}%)`}
              />
              <div
                className="bg-sky-500 transition-all"
                style={{ width: `${segNative}%` }}
                title={`Profile Chrome sẵn sàng: ${kpi.nativeProfileReadyCount} Via (${pctProfileReady}%)`}
              />
              <div
                className="bg-amber-500 transition-all"
                style={{ width: `${segDue}%` }}
                title={`Cần Đảo Ấm: ${kpi.dueKeepAliveCount} Via (${pctDue}%)`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* v4.2.0 Operational 7d Telemetry, Proxy Cluster Health & Early Threshold/Spike Monitor */}
      {(() => {
        const ot = state.operationalTelemetry
        const scopedRisks = (ot?.earlyAccountRisks ?? []).filter((r) =>
          platformScope === 'all' ? true : r.platform === platformScope,
        )
        const threshCnt = scopedRisks.filter(
          (r) => r.kind === 'billing_threshold_80' || r.kind === 'spend_cap_85',
        ).length
        const spikeCnt = scopedRisks.filter((r) => r.kind === 'daily_spend_spike').length
        const clusters = ot?.proxyClusters ?? []

        return (
          <Card>
            <CardHeader className="pb-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                    <Activity className="h-4 w-4 text-primary" />
                    Đo lường Vận hành 7 Ngày, Cụm Proxy &amp; Cảnh báo Sớm Thẻ (≥80%)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Theo dõi tỷ lệ Đảo Ấm / Nuôi Page thành công, cụm Proxy rủi ro và cảnh báo TKQC chạm ngưỡng / vọt chi tiêu
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => sendDesktopCommand('batch_proxy_check')}
                  >
                    <Globe className="h-3.5 w-3.5" /> Quét Proxy hàng loạt
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => sendDesktopCommand('open_ad_accounts', { search: '', filter: 'all' })}
                  >
                    <CreditCard className="h-3.5 w-3.5" /> Kiểm tra TKQC
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">Đảo Ấm Keep-Alive (7N)</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-foreground">
                    {ot && ot.keepAliveRatePct >= 0 ? `${ot.keepAliveRatePct.toFixed(1)}%` : 'Chưa có phiên 7N'}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {ot ? `${ot.keepAliveOk7d} đạt · ${ot.keepAliveFail7d} sự cố` : '0 đạt · 0 sự cố'}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">Nuôi Page Tự động (7N)</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-foreground">
                    {ot && ot.pageNurtureRatePct >= 0 ? `${ot.pageNurtureRatePct.toFixed(1)}%` : 'Chưa có phiên 7N'}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {ot
                      ? `${ot.pageNurtureOk7d} xong (${ot.pageNurtureFallback7d} fallback) · ${ot.pageNurtureFail7d} lỗi`
                      : '0 xong · 0 lỗi'}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Cụm Proxy (Sức khỏe)</span>
                    <Globe className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div className="font-mono text-lg font-bold tabular-nums text-foreground">
                    {ot ? `${ot.totalHealthyProxies}/${ot.totalHealthyProxies + ot.totalProblemProxies}` : '0/0'} ổn định
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {ot ? `${ot.totalProblemProxies} cụm cần lưu ý (Dead / Đông Via / Sự cố)` : 'Chưa gán Proxy'}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Ngưỡng Thẻ ≥80% &amp; Spike</span>
                    <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="font-mono text-lg font-bold tabular-nums text-foreground">
                    {threshCnt + spikeCnt} cảnh báo sớm
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {threshCnt} chạm ngưỡng · {spikeCnt} vọt chi tiêu
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      TKQC Chạm Ngưỡng Thẻ (≥80%) &amp; Tăng Chi Tiêu Đột Biến
                    </span>
                    <Badge variant={scopedRisks.length > 0 ? 'warning' : 'success'}>
                      {scopedRisks.length > 0 ? `${scopedRisks.length} TKQC` : 'An toàn'}
                    </Badge>
                  </div>
                  {scopedRisks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Chưa ghi nhận TKQC nào chạm ≥80% ngưỡng thanh toán hoặc vọt chi tiêu hôm nay.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                      {scopedRisks.slice(0, 6).map((risk) => (
                        <div
                          key={`${risk.adAccountId}-${risk.kind}`}
                          className="rounded-md border border-border bg-card px-2.5 py-2 space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Badge variant={risk.platform === 'google_ads' ? 'info' : 'secondary'} className="text-[10px]">
                                {risk.platform === 'google_ads' ? 'Google' : 'Meta'}
                              </Badge>
                              <button
                                type="button"
                                onClick={() =>
                                  sendDesktopCommand('open_ad_accounts', {
                                    search: risk.displayName,
                                    filter: 'all',
                                  })
                                }
                                className="truncate text-xs font-semibold text-primary hover:underline"
                              >
                                {risk.displayName}
                              </button>
                            </div>
                            <Badge variant={risk.severity === 'critical' ? 'destructive' : 'warning'} className="font-mono text-[10px] tabular-nums">
                              {risk.ratioPct.toFixed(0)}%
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{risk.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Xếp hạng Sức khỏe Cụm Proxy &amp; Mật độ Via
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => sendDesktopCommand('switch_view', { view: 'vias' })}
                    >
                      Mở Bảng Via →
                    </Button>
                  </div>
                  {clusters.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Chưa có hồ sơ Via để thống kê cụm Proxy.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
                      {clusters.slice(0, 6).map((c) => {
                        const variant =
                          c.status === 'DEAD'
                            ? 'destructive'
                            : c.status === 'INCIDENT' || c.status === 'CROWDED'
                            ? 'warning'
                            : 'success'
                        const label =
                          c.status === 'DEAD'
                            ? 'DEAD'
                            : c.status === 'INCIDENT'
                            ? 'Sự cố 7N'
                            : c.status === 'CROWDED'
                            ? 'Đông Via'
                            : 'Ổn định'
                        return (
                          <div
                            key={c.proxyKey}
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs font-semibold text-foreground">
                                {c.proxyKey}
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">{c.sampleViaLabels}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                                {c.viaCount} Via
                              </Badge>
                              {c.incidentCount7d > 0 && (
                                <Badge variant="destructive" className="font-mono text-[10px] tabular-nums">
                                  {c.incidentCount7d} lỗi
                                </Badge>
                              )}
                              <Badge variant={variant} className="text-[10px]">
                                {label}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Alerts / Scoped Vias + Page Invite / Runtime Logs */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-7">
          <Tabs defaultValue="alerts" className="flex flex-1 flex-col">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="alerts">
                    <Bell className="mr-1.5 h-3.5 w-3.5" />
                    Cảnh báo hệ thống
                    {state.groupedAlerts.length > 0 && (
                      <Badge variant="warning" className="ml-1.5 px-1.5 py-0 text-[10px]">
                        {kpi.openAlertCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="vias">
                    <Users className="mr-1.5 h-3.5 w-3.5" />
                    Hồ sơ nhanh ({scopedVias.length})
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-1.5">
                  {kpi.openAlertCount > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sendDesktopCommand('ack_all_alerts')}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Ghi nhận tất cả
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => sendDesktopCommand('test_telegram')}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Test Telegram
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 pt-2">
              <TabsContent value="alerts" className="mt-0">
                {state.groupedAlerts.length === 0 ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-4 text-xs text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span>
                      Không có cảnh báo đang mở. Toàn bộ tài khoản quảng cáo và tiến trình ổn định.
                    </span>
                  </div>
                ) : (
                  <ScrollArea className="h-[340px] pr-2">
                    <div className="space-y-2.5">
                      {state.groupedAlerts.map((grp) => (
                        <AlertGroupRow key={grp.key} group={grp} />
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              <TabsContent value="vias" className="mt-0">
                {scopedVias.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Chưa có hồ sơ phù hợp với bộ lọc kênh hiện tại.
                  </div>
                ) : (
                  <ScrollArea className="h-[340px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Hồ sơ / Profile</TableHead>
                          <TableHead>Proxy &amp; Trust</TableHead>
                          <TableHead>Bảo mật</TableHead>
                          <TableHead className="text-right">Thao tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scopedVias.map((v) => (
                          <ViaQuickRow key={v.viaId || v.label} via={v} />
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <div className="flex flex-col gap-3.5 lg:col-span-5">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  <UserPlus className="h-4 w-4 text-emerald-500" />
                  Mời theo dõi Fanpage nhanh
                </CardTitle>
                <Badge variant="success">Đã mời: {kpi.totalFollowersInvited.toLocaleString('en-US')}</Badge>
              </div>
              <CardDescription className="text-xs">
                Tự động mời người bày tỏ cảm xúc/bình luận theo dõi Fanpage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {livePagesForInvite.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Chưa có Fanpage LIVE được đồng bộ.</p>
              ) : (
                livePagesForInvite.map((pg) => <FanpageInviteRow key={pg.id} page={pg} />)
              )}
              <Button
                variant="secondary"
                className="mt-1 w-full"
                onClick={() => sendDesktopCommand('batch_invite_followers')}
              >
                <Users className="h-3.5 w-3.5" />
                Chạy lô mời hàng loạt ({kpi.totalPages} Fanpage)
              </Button>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <Tabs defaultValue="runtime">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                    <Terminal className="h-4 w-4 text-primary" />
                    Hoạt động gần đây
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="runtime">Máy trạm</TabsTrigger>
                    <TabsTrigger value="cloud">Cloud ({state.cloudLogs.length})</TabsTrigger>
                  </TabsList>
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <TabsContent value="runtime" className="mt-0">
                  <ScrollArea className="h-[155px] rounded-md border border-border bg-background/60 p-2.5">
                    {state.runtimeLogs.length === 0 ? (
                      <p className="font-mono text-[11px] text-muted-foreground">Chưa có nhật ký mới.</p>
                    ) : (
                      <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                        {state.runtimeLogs.map((ln, idx) => (
                          <div key={idx} className="break-words leading-relaxed">
                            {ln}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="cloud" className="mt-0">
                  <ScrollArea className="h-[155px] pr-2">
                    {state.cloudLogs.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">Chưa có hoạt động Cloud gần đây.</p>
                    ) : (
                      <div className="space-y-2">
                        {state.cloudLogs.map((item) => (
                          <div key={item.id} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                            <div className="truncate text-xs font-semibold text-foreground">{item.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {item.detail || item.createdAt}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  )
}

function AlertGroupRow({ group }: { group: OverviewAlertGroupDto }) {
  const sevVariant =
    group.severity === 'critical' ? 'destructive' : group.severity === 'warning' ? 'warning' : 'info'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={sevVariant}>
            <AlertTriangle className="h-3 w-3" />
            {group.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}
            {group.count > 1 ? ` (${group.count})` : ''}
          </Badge>
          <span className="text-xs font-semibold text-foreground">{group.title}</span>
        </div>
        <p className="truncate text-[11px] font-medium text-primary">
          TKQC: {group.accountNames.join(', ')}
          {group.count > group.accountNames.length
            ? ` (+${group.count - group.accountNames.length} khác)`
            : ''}
          {group.bmNames.length > 0 ? ` • BM: ${group.bmNames.join(', ')}` : ''}
        </p>
        {group.summary && <p className="line-clamp-2 text-[11px] text-muted-foreground">{group.summary}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {group.firstAccountSearch && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              sendDesktopCommand('open_ad_accounts', {
                search: group.count > 1 ? '' : group.firstAccountSearch,
                filter: group.count > 1 ? 'disabled' : 'all',
              })
            }
          >
            <ExternalLink className="h-3 w-3" />
            {group.count > 1 ? `Xem ${group.count}` : 'Mở TKQC'}
          </Button>
        )}
        <Button size="sm" onClick={() => sendDesktopCommand('ack_alert_group', { alertIds: group.alertIds })}>
          <CheckCheck className="h-3 w-3" />
          Ghi nhận
        </Button>
      </div>
    </div>
  )
}

function ViaQuickRow({ via }: { via: WebViaItemDto }) {
  const pxBadge =
    via.proxyStatus === 'LIVE' ? 'success' : via.proxyStatus === 'DEAD' ? 'destructive' : 'secondary'

  return (
    <TableRow>
      <TableCell className="py-2">
        <div className="max-w-[165px] truncate text-xs font-semibold text-foreground">{via.label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {via.profileDir} • {via.roleTier}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="flex items-center gap-1.5">
          <Badge variant={pxBadge} className="px-1.5 py-0 text-[10px]">
            {via.proxyStatus}
          </Badge>
          <span className="font-mono text-[11px] font-semibold tabular-nums">{via.trustScore}đ</span>
        </div>
        <Progress
          value={via.trustScore}
          className="mt-1 h-1 w-20"
          indicatorClassName={via.trustScore >= 75 ? 'bg-emerald-500' : 'bg-amber-500'}
        />
      </TableCell>
      <TableCell className="py-2">
        <div className="flex flex-wrap items-center gap-1">
          {via.hasVaultCookie && (
            <Badge variant="info" className="px-1.5 py-0 text-[10px]">
              <HardDriveDownload className="h-2.5 w-2.5" /> Cookie
            </Badge>
          )}
          {via.hasTwoFa && (
            <Badge variant="purple" className="px-1.5 py-0 text-[10px]">
              2FA
            </Badge>
          )}
          {via.isBrowserRunning && (
            <Badge variant="success" className="px-1.5 py-0 font-mono text-[10px]">
              {via.activeRamMb}MB
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="inline-flex items-center gap-1">
          {!isGoogleVia(via) && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2"
              onClick={() => sendDesktopCommand('quick_test_via', { viaId: via.viaId })}
            >
              <FlaskConical className="h-3 w-3" />
              Test 5s
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 px-2"
            onClick={() => sendDesktopCommand('open_via_chrome', { viaId: via.viaId })}
          >
            <Chrome className="h-3 w-3" />
            Mở
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function FanpageInviteRow({ page }: { page: WebFanpageDto }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{page.name}</span>
          {page.pendingInviteCount != null && page.pendingInviteCount > 0 && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
              {page.pendingInviteCount} cần mời
            </Badge>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {page.followersCount != null ? `${page.followersCount.toLocaleString('en-US')} theo dõi` : 'LIVE'} • Via:{' '}
          {page.effectiveHolderLabel || 'Mặc định'}
        </div>
      </div>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => sendDesktopCommand('invite_single_page', { pageId: page.id })}
      >
        <UserPlus className="h-3 w-3" />
        Mời{page.pendingInviteCount ? ` (${page.pendingInviteCount})` : ''}
      </Button>
    </div>
  )
}
