import { useMemo, useState } from 'react'
import {
  Activity,
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
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UserPlus,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SegmentedTabs, StatusDot, TrustRing } from '@/components/ui/studio-primitives'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleAdAccountId, isGoogleVia, useShellUi } from '@/lib/shell-context'
import { cn } from '@/lib/utils'
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
  const [triageTab, setTriageTab] = useState<'alerts' | 'risks' | 'vias'>('alerts')
  const [activityTab, setActivityTab] = useState<'invite' | 'runtime' | 'cloud'>('invite')

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

  const totalViaPool = Math.max(1, kpi.totalVias)
  const pctProxyLive = Math.round((kpi.liveProxyVias / totalViaPool) * 100)
  const pctCookie = Math.round((kpi.cookieVaultCount / totalViaPool) * 100)
  const pctProfileReady = Math.round((kpi.nativeProfileReadyCount / totalViaPool) * 100)

  const pipelineSteps = [
    {
      num: '01',
      title: 'Dọn Cache & RAM',
      desc: 'Thu hồi bộ nhớ Profile nhàn rỗi',
      tone: 'live' as const,
      action: 'clean_ram',
      tip: 'Dọn cache Chrome Profile không hoạt động ngay',
    },
    {
      num: '02',
      title: 'Quét Proxy Live',
      desc: `${kpi.liveProxyVias} LIVE · ${kpi.directIpVias} Direct`,
      tone: kpi.liveProxyVias > 0 || kpi.directIpVias > 0 ? ('live' as const) : ('muted' as const),
      action: 'batch_proxy_check',
      tip: 'Kiểm tra kết nối toàn bộ Proxy & đối chiếu múi giờ',
    },
    {
      num: '03',
      title: 'Đồng bộ Meta & BM',
      desc: `${kpi.totalPages} Page · ${kpi.totalAdAccounts} TKQC`,
      tone: 'info' as const,
      action: 'sync_meta_pages',
      tip: 'Cập nhật lại dữ liệu Fanpage và TKQC từ Meta',
    },
    {
      num: '04',
      title: 'Nuôi Page & Follow',
      desc: `Đã mời ${kpi.totalFollowersInvited.toLocaleString('en-US')} lượt`,
      tone: 'info' as const,
      action: 'batch_invite_followers',
      tip: 'Mở hàng loạt Fanpage để gửi lời mời Follow tự động',
    },
    {
      num: '05',
      title: 'Đảo Ấm Đa Via',
      desc:
        kpi.dueKeepAliveCount > 0
          ? `${kpi.dueKeepAliveCount} Via cần cuộn Feed`
          : 'Toàn bộ đang ấm ổn định',
      tone: kpi.dueKeepAliveCount > 0 ? ('warning' as const) : ('live' as const),
      action: 'keepalive_due',
      tip: 'Chạy kịch bản Đảo Ấm cho các Via tới hạn',
    },
  ]

  const ot = state.operationalTelemetry
  const scopedRisks = (ot?.earlyAccountRisks ?? []).filter((r) =>
    platformScope === 'all' ? true : r.platform === platformScope,
  )
  const threshCnt = scopedRisks.filter(
    (r) => r.kind === 'billing_threshold_80' || r.kind === 'spend_cap_85',
  ).length
  const spikeCnt = scopedRisks.filter((r) => r.kind === 'daily_spend_spike').length
  const clusters = ot?.proxyClusters ?? []

  const livePagesForInvite = state.fanpages
    .filter((p) => !p.isUnsyncedDraft && p.healthStatus.toUpperCase() === 'LIVE')
    .slice(0, 5)

  return (
    <div className="space-y-5">
      {/* Portable Backup Warning Strip (Clean hairline bar) */}
      {state.vias.length > 0 && !state.settings.hasPortableBackupPassphrase && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong>Chưa đặt Mật khẩu Két Backup Portable:</strong> Nếu cài lại Windows hoặc đổi máy, bản Auto-Backup DPAPI cục bộ sẽ không giải mã được.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
          >
            Đặt mật khẩu Két ngay
          </Button>
        </div>
      )}

      {/* Unauthenticated Cloud Notice */}
      {!state.isLoggedIn && (
        <div className="studio-panel flex flex-wrap items-center justify-between gap-4 border-primary/30 p-5">
          <div className="flex items-start gap-3.5">
            <div className="rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Kết nối tài khoản AdsOps Cloud</h2>
              <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                Đăng nhập tài khoản để đồng bộ Via, Business Manager, Fanpage và Tài khoản QC. Cookie &amp; 2FA luôn được mã hóa DPAPI tại máy Windows này.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}>
            <KeyRound className="h-3.5 w-3.5" />
            Đi tới Đăng nhập &amp; Két khóa
          </Button>
        </div>
      )}

      {/* Quiet Workstation Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <StatusDot
            tone={kpi.bridgeOnline ? 'live' : 'critical'}
            label={`Bridge :${kpi.bridgePort} · Ext v${kpi.extVersion}`}
            labelClassName="font-mono text-[11px] text-foreground"
          />
          <span className="text-border">|</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                <Cpu className="h-3.5 w-3.5 text-primary/80" />
                RAM trống {formatMb(workstation.availableRamMb)} / {formatMb(workstation.totalRamMb)} MB ({workstation.recommendedConcurrent} luồng)
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Tài nguyên máy trạm: trống {workstation.freePercent}% · khuyến nghị mở tối đa {workstation.recommendedConcurrent} Chrome song song
            </TooltipContent>
          </Tooltip>
          {kpi.activeBrowsers > 0 && (
            <>
              <span className="text-border">|</span>
              <StatusDot
                tone="info"
                label={`${kpi.activeBrowsers} Chrome đang mở`}
                labelClassName="font-mono text-[11px]"
              />
            </>
          )}
          {state.isOfflineSnapshot && (
            <>
              <span className="text-border">|</span>
              <StatusDot
                tone="warning"
                label={`Dự phòng Offline (${state.offlineSnapshotAt})`}
                labelClassName="text-[11px]"
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {state.isLoggedIn && kpi.totalVias > 0 && platformScope !== 'google_ads' && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => sendDesktopCommand('quick_test_first')}
            >
              <FlaskConical className="h-3.5 w-3.5 text-primary" />
              Test nhanh 1 Via
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => sendDesktopCommand('clean_ram')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Dọn RAM
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-xs">
                <Wrench className="h-3.5 w-3.5" />
                Công cụ nhanh
                <ChevronDown className="h-3 w-3 opacity-65" />
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

      {/* TIER 1: BORDERLESS EXECUTIVE KPI STRIP (1 outer container, hairline dividers) */}
      <section className="studio-panel grid grid-cols-1 divide-y divide-border/75 sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
        <button
          type="button"
          onClick={() => sendDesktopCommand('switch_view', { view: 'vias' })}
          className="group flex flex-col justify-between p-5 text-left transition-colors hover:bg-muted/35"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {platformScope === 'google_ads' ? 'Hồ sơ Google Ads' : 'Hồ sơ & Dàn Via'}
            </span>
            <StatusDot
              tone={kpi.dueKeepAliveCount > 0 ? 'warning' : 'live'}
              label={kpi.dueKeepAliveCount > 0 ? `${kpi.dueKeepAliveCount} cần đảo ấm` : 'Ổn định'}
              labelClassName="text-[11px]"
            />
          </div>
          <div className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground group-hover:text-primary transition-colors">
            {state.isLoggedIn ? scopedTotalVias : '—'}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground">
            {kpi.nativeProfileReadyCount}/{kpi.totalVias} Profile sẵn sàng · {kpi.cookieVaultCount} Két Cookie
          </div>
        </button>

        <button
          type="button"
          onClick={() => sendDesktopCommand('switch_view', { view: 'pages_bm' })}
          className="group flex flex-col justify-between p-5 text-left transition-colors hover:bg-muted/35"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Fanpage &amp; Tăng trưởng
            </span>
            <StatusDot
              tone="live"
              label={`+${kpi.totalFollowersInvited.toLocaleString('en-US')} mời`}
              labelClassName="font-mono text-[11px] tabular-nums"
            />
          </div>
          <div className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground group-hover:text-primary transition-colors">
            {state.isLoggedIn ? kpi.totalPages : '—'}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground">
            {kpi.adsReadyPages}/{kpi.totalPages} Fanpage sẵn sàng chạy Ads
          </div>
        </button>

        <button
          type="button"
          onClick={() => sendDesktopCommand('switch_view', { view: 'ad_accounts' })}
          className="group flex flex-col justify-between p-5 text-left transition-colors hover:bg-muted/35"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Tài khoản Quảng cáo
            </span>
            <StatusDot
              tone={kpi.openAlertCount > 0 ? 'warning' : 'live'}
              label={kpi.openAlertCount > 0 ? `${kpi.openAlertCount} cảnh báo mở` : 'An toàn'}
              labelClassName="text-[11px]"
            />
          </div>
          <div className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground group-hover:text-primary transition-colors">
            {state.isLoggedIn ? scopedTotalAds : '—'}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground">
            {scopedActiveAds} TKQC Active · {kpi.criticalHealthCount} Critical
          </div>
        </button>

        <button
          type="button"
          onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
          className="group flex flex-col justify-between p-5 text-left transition-colors hover:bg-muted/35"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Khiên Bảo vệ &amp; 2FA
            </span>
            <StatusDot
              tone={kpi.bridgeOnline ? 'info' : 'critical'}
              label={`Ext v${kpi.extVersion}`}
              labelClassName="font-mono text-[11px]"
            />
          </div>
          <div className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground group-hover:text-primary transition-colors">
            {kpi.bridgeOnline ? `:${kpi.bridgePort}` : 'OFF'}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground">
            Zero-Trust DPAPI · {kpi.twoFaReadyCount} mã 2FA cục bộ
          </div>
        </button>
      </section>

      {/* TIER 2: CONNECTED 5-STEP AUTO-PILOT PIPELINE */}
      <section className="studio-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-semibold text-foreground">Chu trình Auto-Pilot 5 Bước</h2>
            <StatusDot
              tone={state.autoDailyPipeline ? 'live' : 'muted'}
              label={state.autoDailyPipeline ? 'Lịch sáng tự động: BẬT' : 'Kích hoạt thủ công'}
              labelClassName="text-[11px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground tabular-nums">
            <span>Chrome sẵn {pctProfileReady}%</span>
            <span>·</span>
            <span>Direct IP {kpi.directIpVias}/{kpi.maxDirectIpPerBatch}</span>
            <span>·</span>
            <span>Proxy LIVE {pctProxyLive}%</span>
            <span>·</span>
            <span>DPAPI {pctCookie}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border/70 md:grid-cols-5 md:divide-x md:divide-y-0">
          {pipelineSteps.map((st) => (
            <Tooltip key={st.num}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => sendDesktopCommand(st.action)}
                  className="group relative flex flex-col justify-between p-4 text-left transition-colors hover:bg-muted/35"
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-0 top-0 h-[2px] opacity-60 transition-opacity group-hover:opacity-100',
                      st.tone === 'live'
                        ? 'bg-emerald-500'
                        : st.tone === 'warning'
                        ? 'bg-amber-500'
                        : st.tone === 'info'
                        ? 'bg-primary'
                        : 'bg-muted-foreground/40',
                    )}
                  />
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10.5px] font-semibold tracking-wider text-muted-foreground">
                      STEP {st.num}
                    </span>
                    <Play className="h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="mt-2">
                    <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {st.title}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{st.desc}</div>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent>{st.tip}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </section>

      {/* TIER 3: BALANCED 12-COLUMN OPERATIONAL WORKSPACE */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT 7 COLS: Priority Triage (Alerts / Card Risks / Quick Vias) */}
        <section className="studio-panel flex flex-col overflow-hidden lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
            <SegmentedTabs
              value={triageTab}
              onChange={setTriageTab}
              items={[
                { value: 'alerts', label: 'Cảnh báo hệ thống', count: kpi.openAlertCount },
                { value: 'risks', label: 'Ngưỡng thẻ ≥80%', count: scopedRisks.length },
                { value: 'vias', label: 'Hồ sơ nhanh', count: scopedVias.length },
              ]}
            />

            <div className="flex items-center gap-1.5">
              {triageTab === 'alerts' && kpi.openAlertCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => sendDesktopCommand('ack_all_alerts')}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Ghi nhận tất cả
                </Button>
              )}
              {triageTab === 'risks' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => sendDesktopCommand('open_ad_accounts', { search: '', filter: 'all' })}
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Kiểm tra TKQC
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => sendDesktopCommand('test_telegram')}
              >
                <Send className="h-3 w-3" />
                Test Telegram
              </Button>
            </div>
          </div>

          <div className="flex-1">
            {triageTab === 'alerts' && (
              state.groupedAlerts.length === 0 ? (
                <div className="flex items-center gap-2.5 px-5 py-8 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span>Không có cảnh báo đang mở. Toàn bộ tài khoản quảng cáo và tiến trình ổn định.</span>
                </div>
              ) : (
                <ScrollArea className="h-[380px]">
                  <div className="divide-y divide-border/60">
                    {state.groupedAlerts.map((grp) => (
                      <AlertGroupRow key={grp.key} group={grp} />
                    ))}
                  </div>
                </ScrollArea>
              )
            )}

            {triageTab === 'risks' && (
              scopedRisks.length === 0 ? (
                <div className="flex items-center gap-2.5 px-5 py-8 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span>Chưa ghi nhận TKQC nào chạm ≥80% ngưỡng thanh toán hoặc vọt chi tiêu hôm nay.</span>
                </div>
              ) : (
                <ScrollArea className="h-[380px]">
                  <div className="divide-y divide-border/60">
                    {scopedRisks.map((risk) => (
                      <div
                        key={`${risk.adAccountId}-${risk.kind}`}
                        className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/35"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <StatusDot
                              tone={risk.severity === 'critical' ? 'critical' : 'warning'}
                              label={`${risk.ratioPct.toFixed(0)}%`}
                              labelClassName="font-mono text-[11px] tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                sendDesktopCommand('open_ad_accounts', {
                                  search: risk.displayName,
                                  filter: 'all',
                                })
                              }
                              className="truncate text-xs font-semibold text-foreground hover:text-primary transition-colors"
                            >
                              {risk.displayName}
                            </button>
                            <span className="font-mono text-[10px] uppercase text-muted-foreground">
                              {risk.platform === 'google_ads' ? 'Google' : 'Meta'}
                            </span>
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{risk.summary}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2.5 text-xs opacity-75 group-hover:opacity-100"
                          onClick={() =>
                            sendDesktopCommand('open_ad_accounts', {
                              search: risk.displayName,
                              filter: 'all',
                            })
                          }
                        >
                          Mở TKQC
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )
            )}

            {triageTab === 'vias' && (
              scopedVias.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                  Chưa có hồ sơ phù hợp với bộ lọc kênh hiện tại.
                </div>
              ) : (
                <ScrollArea className="h-[380px]">
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
              )
            )}
          </div>
        </section>

        {/* RIGHT 5 COLS: 7-Day Telemetry + Proxy Clusters + Quick Page Invite */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          {/* 7-Day Operational Telemetry & Proxy Cluster Health */}
          <section className="studio-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <h2 className="text-[13px] font-semibold text-foreground">Đo lường 7 Ngày &amp; Cụm Proxy</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => sendDesktopCommand('batch_proxy_check')}
              >
                <Globe className="h-3 w-3" /> Quét Proxy
              </Button>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-border/70 border-b border-border/70">
              <div className="p-3.5">
                <div className="text-[11px] text-muted-foreground">Đảo ấm (7N)</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {ot && ot.keepAliveRatePct >= 0 ? `${ot.keepAliveRatePct.toFixed(1)}%` : '—'}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {ot ? `${ot.keepAliveOk7d} đạt · ${ot.keepAliveFail7d} sự cố` : 'Chưa có phiên'}
                </div>
              </div>

              <div className="p-3.5">
                <div className="text-[11px] text-muted-foreground">Nuôi Page (7N)</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {ot && ot.pageNurtureRatePct >= 0 ? `${ot.pageNurtureRatePct.toFixed(1)}%` : '—'}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {ot ? `${ot.pageNurtureOk7d} xong · ${ot.pageNurtureFail7d} lỗi` : 'Chưa có phiên'}
                </div>
              </div>

              <div className="p-3.5">
                <div className="text-[11px] text-muted-foreground">Cụm Proxy ổn định</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {ot ? `${ot.totalHealthyProxies}/${ot.totalHealthyProxies + ot.totalProblemProxies}` : '0/0'}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {ot ? `${ot.totalProblemProxies} cụm cần lưu ý` : 'Chưa gán Proxy'}
                </div>
              </div>

              <div className="p-3.5">
                <div className="text-[11px] text-muted-foreground">Cảnh báo sớm thẻ</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
                  {threshCnt + spikeCnt}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {threshCnt} ≥80% · {spikeCnt} vọt chi tiêu
                </div>
              </div>
            </div>

            <div className="px-4 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Xếp hạng cụm Proxy</span>
                <button
                  type="button"
                  onClick={() => sendDesktopCommand('switch_view', { view: 'vias' })}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  Bảng Via →
                </button>
              </div>
              {clusters.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Chưa có hồ sơ Via để thống kê cụm Proxy.</p>
              ) : (
                <div className="divide-y divide-border/55">
                  {clusters.slice(0, 4).map((c) => {
                    const dotTone =
                      c.status === 'DEAD'
                        ? 'critical'
                        : c.status === 'INCIDENT' || c.status === 'CROWDED'
                        ? 'warning'
                        : 'live'
                    const label =
                      c.status === 'DEAD'
                        ? 'DEAD'
                        : c.status === 'INCIDENT'
                        ? 'Sự cố 7N'
                        : c.status === 'CROWDED'
                        ? 'Đông Via'
                        : 'Ổn định'
                    return (
                      <div key={c.proxyKey} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-medium text-foreground">
                            {c.proxyKey}
                          </div>
                          <div className="truncate text-[10.5px] text-muted-foreground">{c.sampleViaLabels}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {c.viaCount} Via{c.incidentCount7d > 0 ? ` · ${c.incidentCount7d} lỗi` : ''}
                          </span>
                          <StatusDot tone={dotTone} label={label} labelClassName="text-[11px]" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Compact Activity Panel: Fanpage Invite / Runtime Logs / Cloud */}
          <section className="studio-panel flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
              <SegmentedTabs
                value={activityTab}
                onChange={setActivityTab}
                items={[
                  { value: 'invite', label: 'Mời Page nhanh' },
                  { value: 'runtime', label: 'Máy trạm' },
                  { value: 'cloud', label: 'Cloud', count: state.cloudLogs.length },
                ]}
              />
              {activityTab === 'invite' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-primary hover:text-primary"
                  onClick={() => sendDesktopCommand('batch_invite_followers')}
                >
                  Chạy lô ({kpi.totalPages})
                </Button>
              )}
            </div>

            <div className="flex-1">
              {activityTab === 'invite' && (
                livePagesForInvite.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground">Chưa có Fanpage LIVE được đồng bộ.</p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {livePagesForInvite.map((pg) => (
                      <FanpageInviteRow key={pg.id} page={pg} />
                    ))}
                  </div>
                )
              )}

              {activityTab === 'runtime' && (
                <ScrollArea className="h-[190px] p-3.5">
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
              )}

              {activityTab === 'cloud' && (
                <ScrollArea className="h-[190px]">
                  {state.cloudLogs.length === 0 ? (
                    <p className="px-4 py-6 text-xs text-muted-foreground">Chưa có hoạt động Cloud gần đây.</p>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {state.cloudLogs.map((item) => (
                        <div key={item.id} className="px-4 py-2.5">
                          <div className="truncate text-xs font-medium text-foreground">{item.title}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {item.detail || item.createdAt}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function AlertGroupRow({ group }: { group: OverviewAlertGroupDto }) {
  const tone =
    group.severity === 'critical' ? 'critical' : group.severity === 'warning' ? 'warning' : 'info'

  return (
    <div className="group flex flex-col gap-2.5 px-4 py-3 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot
            tone={tone}
            label={`${group.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}${
              group.count > 1 ? ` (${group.count})` : ''
            }`}
            labelClassName="text-[11px]"
          />
          <span className="truncate text-xs font-semibold text-foreground">{group.title}</span>
        </div>
        <p className="truncate text-[11px] text-primary/90">
          TKQC: {group.accountNames.join(', ')}
          {group.count > group.accountNames.length
            ? ` (+${group.count - group.accountNames.length} khác)`
            : ''}
          {group.bmNames.length > 0 ? ` · BM: ${group.bmNames.join(', ')}` : ''}
        </p>
        {group.summary && <p className="line-clamp-2 text-[11px] text-muted-foreground">{group.summary}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {group.firstAccountSearch && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
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
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => sendDesktopCommand('ack_alert_group', { alertIds: group.alertIds })}
        >
          <CheckCheck className="h-3 w-3" />
          Ghi nhận
        </Button>
      </div>
    </div>
  )
}

function ViaQuickRow({ via }: { via: WebViaItemDto }) {
  const pxTone = via.proxyStatus === 'LIVE' ? 'live' : via.proxyStatus === 'DEAD' ? 'critical' : 'muted'

  return (
    <TableRow>
      <TableCell>
        <div className="max-w-[165px] truncate text-xs font-semibold text-foreground">{via.label}</div>
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {via.profileDir} · {via.roleTier}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <TrustRing score={via.trustScore} size={26} />
          <StatusDot tone={pxTone} label={via.proxyStatus} labelClassName="text-[11px]" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
          <span className={via.hasVaultCookie ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}>
            CK
          </span>
          <span className="text-border">·</span>
          <span className={via.hasTwoFa ? 'text-primary' : 'text-muted-foreground/50'}>2FA</span>
          {via.isBrowserRunning && (
            <>
              <span className="text-border">·</span>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{via.activeRamMb}MB</span>
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-1">
          {!isGoogleVia(via) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => sendDesktopCommand('quick_test_via', { viaId: via.viaId })}
            >
              <FlaskConical className="h-3 w-3" />
              Test
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs hover:bg-primary hover:text-primary-foreground"
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
    <div className="group flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/35">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusDot tone="live" />
          <span className="truncate text-xs font-medium text-foreground">{page.name}</span>
          {page.pendingInviteCount != null && page.pendingInviteCount > 0 && (
            <span className="font-mono text-[10.5px] font-medium text-amber-600 dark:text-amber-400 tabular-nums">
              {page.pendingInviteCount} chờ
            </span>
          )}
        </div>
        <div className="pl-3.5 truncate text-[11px] text-muted-foreground">
          {page.followersCount != null ? `${page.followersCount.toLocaleString('en-US')} theo dõi` : 'LIVE'} · Via:{' '}
          {page.effectiveHolderLabel || 'Mặc định'}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 border-border/80 bg-transparent px-2.5 text-xs hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
        onClick={() => sendDesktopCommand('invite_single_page', { pageId: page.id })}
      >
        <UserPlus className="h-3 w-3" />
        Mời{page.pendingInviteCount ? ` (${page.pendingInviteCount})` : ''}
      </Button>
    </div>
  )
}
