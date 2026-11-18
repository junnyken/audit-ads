import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronDown,
  Chrome,
  Coffee,
  Cpu,
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
  const { kpi, workstation } = state
  const readyCount = Math.max(kpi.cookieVaultCount, kpi.nativeProfileReadyCount)
  const viaReadyPct =
    kpi.totalVias > 0 ? Math.max(12, Math.round((readyCount / kpi.totalVias) * 100)) : 100
  const pageReadyPct =
    kpi.totalPages > 0 ? Math.max(15, Math.round((kpi.adsReadyPages / kpi.totalPages) * 100)) : 85
  const adActivePct =
    kpi.totalAdAccounts > 0
      ? Math.max(12, Math.round((kpi.activeAdAccounts / kpi.totalAdAccounts) * 100))
      : 80
  const ramUsedPct = Math.max(0, Math.min(100, 100 - workstation.freePercent))

  const pipelineSteps = [
    {
      num: '01',
      title: 'Dọn Cache & RAM',
      desc: 'Thu hồi bộ nhớ Chrome Profile đang đóng',
      tone: 'success' as const,
      action: 'clean_ram',
      tip: 'Bấm để dọn cache Chrome Profile không hoạt động ngay',
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
      {/* Telemetry & Quick Actions Strip */}
      <Card className="border-border/80 bg-card/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info" className="gap-1 px-2.5 py-0.5">
              <Sparkles className="h-3 w-3" />
              Unified shadcn/ui v{state.appVersion}
            </Badge>
            <Badge variant={kpi.bridgeOnline ? 'success' : 'destructive'} className="font-mono">
              <ShieldCheck className="h-3 w-3" />
              Bridge :{kpi.bridgePort} · Ext v{kpi.extVersion}
            </Badge>
            {kpi.activeBrowsers > 0 && (
              <Badge variant="purple" className="animate-pulse font-mono">
                <Chrome className="h-3 w-3" />
                {kpi.activeBrowsers} Chrome đang mở
              </Badge>
            )}
            {state.isOfflineSnapshot && (
              <Badge variant="warning">Dự phòng Offline ({state.offlineSnapshotAt})</Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="hidden xl:flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
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
            {state.isLoggedIn && kpi.totalVias > 0 && (
              <Button size="sm" onClick={() => sendDesktopCommand('quick_test_first')}>
                <FlaskConical className="h-3.5 w-3.5" />
                Test Nhanh 1 Via (5s)
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
                  Công cụ Hệ thống
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Bộ công cụ Điều hành Desktop</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_proxy_check')}>
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                  Quét kiểm tra Proxy hàng loạt (Live/Dead)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('keepalive_due')}>
                  <Coffee className="h-3.5 w-3.5 text-amber-400" />
                  Đảo Ấm toàn bộ Via quá hạn ngay
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('batch_invite_followers')}>
                  <UserPlus className="h-3.5 w-3.5 text-indigo-400" />
                  Chạy lô Mời người tương tác Follow Page
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('sync_meta_pages')}>
                  <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                  Đồng bộ Fanpage từ Meta Graph API
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('provision_extensions')}>
                  <Shield className="h-3.5 w-3.5 text-emerald-400" />
                  Cấp lại Chrome Extension v{state.extVersion}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('benchmark_engines')}>
                  <Gauge className="h-3.5 w-3.5 text-purple-400" />
                  Benchmark tốc độ 5 Engine Antidetect
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendDesktopCommand('open_launch_audit')}>
                  <Terminal className="h-3.5 w-3.5 text-slate-300" />
                  Xem Nhật ký Mở Profile (Audit Log)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => sendDesktopCommand('apply_safe_preset')}>
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Áp dụng Preset An Toàn Chuẩn (1-Click)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Card>

      {!state.isLoggedIn && (
        <Card className="border-indigo-500/40 bg-indigo-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5 text-indigo-300">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Kết nối tài khoản AdsOps Cloud</h2>
                <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                  Đăng nhập tài khoản để đồng bộ danh sách Via, Business Manager, Fanpage, Tài khoản QC và bật Hàng
                  đợi Tự động hóa trên Chrome Profile thật. Cookie &amp; 2FA luôn được mã hóa DPAPI tại máy Windows này.
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

      {/* 4 Interactive Bento KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'vias' })}
          className="cursor-pointer transition-all hover:border-primary/60 hover:bg-card/80"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Dàn Via Đang Quản Lý</CardTitle>
            <Users className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? kpi.totalVias : '—'}
              </span>
              <Badge variant={kpi.dueKeepAliveCount > 0 ? 'warning' : 'success'}>
                {kpi.dueKeepAliveCount > 0 ? `${kpi.dueKeepAliveCount} cần Đảo Ấm` : 'Đang ấm'}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {kpi.nativeProfileReadyCount}/{kpi.totalVias} Profile Chrome sẵn • {kpi.cookieVaultCount} Két Cookie •{' '}
              {kpi.twoFaReadyCount} 2FA
            </p>
            <Progress value={viaReadyPct} indicatorClassName="bg-indigo-500" />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'pages_bm' })}
          className="cursor-pointer transition-all hover:border-emerald-500/60 hover:bg-card/80"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Fanpage &amp; Tăng Trưởng</CardTitle>
            <LayoutDashboard className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? kpi.totalPages : '—'}
              </span>
              <Badge variant="success">+{kpi.totalFollowersInvited.toLocaleString('en-US')} mời Follow</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {kpi.adsReadyPages}/{kpi.totalPages} Fanpage sẵn sàng chạy Ads
            </p>
            <Progress value={pageReadyPct} indicatorClassName="bg-emerald-500" />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'ad_accounts' })}
          className="cursor-pointer transition-all hover:border-amber-500/60 hover:bg-card/80"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Tài Khoản Quảng Cáo</CardTitle>
            <Activity className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {state.isLoggedIn ? kpi.totalAdAccounts : '—'}
              </span>
              <Badge variant={kpi.openAlertCount > 0 ? 'warning' : 'success'}>
                {kpi.openAlertCount} cảnh báo mở
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {kpi.activeAdAccounts} TKQC Active • {kpi.criticalHealthCount} Critical Health
            </p>
            <Progress
              value={adActivePct}
              indicatorClassName={kpi.openAlertCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </CardContent>
        </Card>

        <Card
          onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
          className="cursor-pointer transition-all hover:border-purple-500/60 hover:bg-card/80"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Khiên Bảo Vệ &amp; Két 2FA</CardTitle>
            <ShieldCheck className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums">
                {kpi.bridgeOnline ? `:${kpi.bridgePort}` : 'OFF'}
              </span>
              <Badge variant="purple">Ext v{kpi.extVersion}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Zero-Trust DPAPI • {kpi.twoFaReadyCount} mã TOTP sẵn sàng
            </p>
            <Progress value={kpi.bridgeOnline ? 100 : 15} indicatorClassName="bg-purple-500" />
          </CardContent>
        </Card>
      </div>

      {/* 5-Step Auto-Pilot Pipeline + Fleet Health Segmented Bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-primary" />
                  Chu Trình Auto-Pilot 5 Bước Khép Kín
                </CardTitle>
                <Badge variant={state.autoDailyPipeline ? 'success' : 'secondary'}>
                  {state.autoDailyPipeline ? 'Tự động mỗi sáng: BẬT' : 'Kích hoạt 1-Chạm'}
                </Badge>
              </div>
              <CardDescription className="mt-1">
                Bấm trực tiếp vào từng bước để chạy riêng lẻ, hoặc bấm Auto-Pilot để chạy tuần tự 1 → 5.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>Profile Chrome sẵn: {pctProfileReady}%</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>Direct IP: {kpi.directIpVias} Via (Trần {kpi.maxDirectIpPerBatch}/ca)</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>Proxy LIVE: {pctProxyLive}%</span>
              <Separator orientation="vertical" className="h-3.5" />
              <span>Cookie DPAPI: {pctCookie}%</span>
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
                    className="group flex flex-col justify-between rounded-lg border border-border bg-background/55 p-3 text-left transition-all hover:border-primary/60 hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-mono text-[11px] font-bold text-primary">STEP {st.num}</span>
                      <Badge variant={st.tone} className="px-1.5 py-0 text-[10px]">
                        Sẵn sàng
                      </Badge>
                    </div>
                    <div className="mt-1.5">
                      <div className="text-xs font-bold text-foreground transition-colors group-hover:text-primary">
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

          <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${segProxy}%` }}
                title={`Proxy LIVE: ${kpi.liveProxyVias} Via (${pctProxyLive}%)`}
              />
              <div
                className="bg-indigo-500 transition-all"
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

      {/* Two-Column Bottom Bento: Alerts/Via Quick Table + Auto-Invite & Logs */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-7">
          <Tabs defaultValue="alerts" className="flex flex-1 flex-col">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="alerts">
                    <Bell className="h-3.5 w-3.5" />
                    Cảnh Báo Gom Nhóm
                    {state.groupedAlerts.length > 0 && (
                      <Badge variant="warning" className="ml-1 px-1.5 py-0 text-[10px]">
                        {kpi.openAlertCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="vias">
                    <Users className="h-3.5 w-3.5" />
                    Dàn Via Trực Tiếp ({state.vias.length})
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
                      Ghi nhận tất cả ({kpi.openAlertCount})
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
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3.5 py-4 text-xs text-emerald-300">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span>
                      Không có cảnh báo nào đang mở. Toàn bộ TKQC và tiến trình vận hành ổn định.
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
                {state.vias.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Chưa có dữ liệu Via nào. Hãy đăng nhập hoặc bấm Đồng bộ.
                  </div>
                ) : (
                  <ScrollArea className="h-[340px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Via / Profile</TableHead>
                          <TableHead>Proxy &amp; Trust</TableHead>
                          <TableHead>Két Bảo Vệ</TableHead>
                          <TableHead className="text-right">Thao tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.vias.map((v) => (
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
                <CardTitle className="flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4 text-emerald-400" />
                  Auto-Invite Page Followers
                </CardTitle>
                <Badge variant="success">Đã mời: {kpi.totalFollowersInvited.toLocaleString('en-US')}</Badge>
              </div>
              <CardDescription>
                Tự động bấm Gửi lời mời người đã bày tỏ cảm xúc trên Meta Business Suite.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {livePagesForInvite.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Chưa có Fanpage LIVE nào được đồng bộ.</p>
              ) : (
                livePagesForInvite.map((pg) => <FanpageInviteRow key={pg.id} page={pg} />)
              )}
              <Button
                variant="secondary"
                className="mt-1 w-full"
                onClick={() => sendDesktopCommand('batch_invite_followers')}
              >
                <Users className="h-3.5 w-3.5" />
                Chạy Lô Mời Follow Tự Động ({kpi.totalPages} Fanpage)
              </Button>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <Tabs defaultValue="runtime">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5">
                    <Terminal className="h-4 w-4 text-primary" />
                    Nhật Ký Hoạt Động
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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/55 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={sevVariant}>
            <AlertTriangle className="h-3 w-3" />
            {group.severity === 'critical' ? 'NGHIÊM TRỌNG' : 'CẢNH BÁO'}
            {group.count > 1 ? ` (${group.count})` : ''}
          </Badge>
          <span className="text-xs font-bold text-foreground">{group.title}</span>
        </div>
        <p className="truncate text-[11px] font-semibold text-primary">
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
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2"
            onClick={() => sendDesktopCommand('quick_test_via', { viaId: via.viaId })}
          >
            <FlaskConical className="h-3 w-3" />
            Test 5s
          </Button>
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
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/55 px-3 py-2">
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
