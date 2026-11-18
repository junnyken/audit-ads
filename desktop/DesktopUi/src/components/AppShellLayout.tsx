import { useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Command,
  FastForward,
  FileText,
  Globe,
  Home,
  KeyRound,
  Lock,
  Palette,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { sendDesktopCommand } from '@/lib/bridge'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto, DesktopViewKey } from '@/types'

const NAV_ITEMS: Array<{
  key: DesktopViewKey
  label: string
  icon: typeof Home
  badgeKey?: keyof AppShellWebStateDto['navBadges']
}> = [
  { key: 'overview', label: 'Tổng quan', icon: Home, badgeKey: 'overview' },
  { key: 'vias', label: 'Quản lý Đa Via', icon: Users, badgeKey: 'vias' },
  { key: 'automation', label: 'Tự động hóa', icon: Play, badgeKey: 'automation' },
  { key: 'pages_bm', label: 'Fanpage & BM', icon: FileText },
  { key: 'ad_accounts', label: 'Tài khoản QC', icon: BarChart3 },
  { key: 'health_tokens', label: 'Sức khỏe & Token', icon: Activity, badgeKey: 'healthTokens' },
  { key: 'workspace_ops', label: 'Ngân sách & Team', icon: Briefcase, badgeKey: 'workspaceOps' },
  { key: 'settings', label: 'Két khóa & Cài đặt', icon: KeyRound },
]

function getHeaderCopy(state: AppShellWebStateDto): { title: string; subtitle: string } {
  const syncSuffix = state.lastSyncedAt && state.lastSyncedAt !== '—' ? ` • Cập nhật lúc ${state.lastSyncedAt}` : ''
  switch (state.activeView) {
    case 'overview':
      return {
        title: 'Tổng quan vận hành',
        subtitle: `Bức tranh đa Via, cảnh báo hệ thống & hàng đợi${syncSuffix}`,
      }
    case 'vias':
      return {
        title: 'Quản lý Đa Via',
        subtitle: `${state.vias.length} Via • 2FA local thời gian thực • ${
          state.automationConfig.useIsolatedProfiles ? 'Chrome cô lập (--user-data-dir)' : 'Chrome chung Profile'
        }${syncSuffix}`,
      }
    case 'automation':
      return {
        title: 'Trung tâm Tự động hóa',
        subtitle: `Tạo Page an toàn, Thiết kế Kịch bản Hành vi & Cloud Cron${syncSuffix}`,
      }
    case 'pages_bm':
      return {
        title: 'Fanpage, BM, Pixel & Domain SEO',
        subtitle: `${state.fanpages.length} Fanpage • ${state.bms.length} BM • ${state.pixels.length} Pixel${syncSuffix}`,
      }
    case 'ad_accounts':
      return {
        title: 'Tài khoản Quảng cáo',
        subtitle: `${state.adAccounts.length} TKQC liên kết • Số liệu căn lề Tabular chính xác${syncSuffix}`,
      }
    case 'health_tokens':
      return {
        title: 'Sức khỏe TKQC, Readiness & Audit Log',
        subtitle: `${state.metaConnections.length} Meta Token • ${state.accountHealthRows.length} đánh giá • ${state.readinessRows.length} Readiness${syncSuffix}`,
      }
    case 'workspace_ops':
      return {
        title: 'Ngân sách Hợp đồng (Retainers) & Team',
        subtitle: `${state.retainers.length} hợp đồng • ${state.teamMembers.length} thành viên${syncSuffix}`,
      }
    case 'settings':
      return {
        title: 'Két khóa DPAPI & Cài đặt',
        subtitle: `Kết nối Cloud, Két sao lưu AES-256-GCM (.adsopsvault) & Hệ thống${syncSuffix}`,
      }
  }
}

export function AppShellLayout({
  state,
  children,
}: {
  state: AppShellWebStateDto
  children: ReactNode
}) {
  const [logExpanded, setLogExpanded] = useState(false)
  const { title, subtitle } = getHeaderCopy(state)
  const { queue, kpi } = state
  const latestLog = state.runtimeLogs[0] ?? 'Sẵn sàng.'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* LEFT SIDEBAR */}
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-border bg-card/70 px-3 py-3">
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight text-foreground">AdsOps Pro</div>
            <div className="truncate text-[11px] font-medium text-muted-foreground">
              shadcn/ui v{state.appVersion}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto pr-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = state.activeView === item.key
            const badgeText = item.badgeKey ? state.navBadges[item.badgeKey] : ''
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => sendDesktopCommand('switch_view', { view: item.key })}
                className={cn(
                  'group flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] font-semibold transition-all',
                  active
                    ? 'border-primary/45 bg-primary/15 text-foreground shadow-xs'
                    : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeText && (
                  <Badge
                    variant={badgeText === 'RUN' ? 'success' : 'warning'}
                    className="shrink-0 px-1.5 py-0 font-mono text-[10px]"
                  >
                    {badgeText}
                  </Badge>
                )}
              </button>
            )
          })}
        </nav>

        <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
          <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-xs font-semibold text-foreground">
                {state.isLoggedIn ? state.userDisplay || state.userEmail || 'Đã đăng nhập' : 'Chưa đăng nhập'}
              </span>
              {state.isOfflineSnapshot && (
                <Badge variant="warning" className="px-1 py-0 text-[9px]">
                  Offline
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {state.isLoggedIn ? `WS: ${state.workspaceDisplay}` : 'Mở Két khóa để kết nối Cloud'}
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-start gap-2 font-mono text-[11px]"
            onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
            title="Local Bridge 127.0.0.1 kết nối trực tiếp với Web & Chrome Extension"
          >
            <Globe className={cn('h-3.5 w-3.5 shrink-0', kpi.bridgeOnline ? 'text-emerald-400' : 'text-rose-400')} />
            <span className="truncate">
              {kpi.bridgeOnline ? `Bridge ON :${kpi.bridgePort}` : 'Bridge OFF'} · v{state.extVersion}
            </span>
          </Button>
        </div>
      </aside>

      {/* MAIN CONTENT SHELL */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* TOP HEADER */}
        <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/50 px-5">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold tracking-tight text-foreground">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sendDesktopCommand('toggle_palette')}
              title="Đổi bảng màu Linear Obsidian <-> Emerald Vault"
            >
              <Palette className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {state.palette === 'emerald' ? 'Emerald Vault' : 'Linear Obsidian'}
              </span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => sendDesktopCommand('open_command_palette')}
              title="Bảng tìm nhanh Via / Copy 2FA / Điều hướng (Ctrl+K)"
            >
              <Command className="h-3.5 w-3.5" />
              <span>⌘K Lệnh nhanh</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={state.isBusy}
              onClick={() => sendDesktopCommand('sync_cloud')}
              title="Đồng bộ dữ liệu từ AdsOps Cloud (F5)"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', state.isBusy && 'animate-spin')} />
              <span>Đồng bộ</span>
            </Button>

            {state.isLoggedIn && (
              <Button
                size="sm"
                onClick={() => sendDesktopCommand('run_autopilot')}
                title="Chạy tuần tự 5 bước: Dọn Cache/RAM -> Quét Proxy -> Đồng bộ Meta -> Nuôi Page/Mời Follow -> Đảo Ấm Via"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Auto-Pilot 5 Bước</span>
              </Button>
            )}
          </div>

          {state.isBusy && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-secondary">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          )}
        </header>

        {/* ERROR / OFFLINE BANNER */}
        {state.errorBannerText && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-500/40 bg-rose-950/35 px-5 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span className="break-words">{state.errorBannerText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('retry_error_banner')}>
                <RefreshCw className="h-3 w-3" />
                {state.isAuthExpired ? 'Đăng nhập lại (24/7)' : 'Thử lại'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('dismiss_error_banner')}>
                <X className="h-3.5 w-3.5" />
                Đóng
              </Button>
            </div>
          </div>
        )}

        {/* MAIN SCROLLABLE VIEWPORT */}
        <ScrollArea className="flex-1">
          <main className="space-y-4 p-4 sm:p-5">
            {/* GLOBAL QUEUE & LIVE STEP RUNNER BANNER */}
            {(queue.isActive || state.liveRunner?.isActive || state.liveRunner?.isCompleted) && (() => {
              const lr = state.liveRunner
              const isRunnerActive = Boolean(lr?.isActive)
              const isPaused = Boolean(lr?.isPaused) || queue.phase === 'Paused'
              const isCompletedOnly = !isRunnerActive && (queue.phase === 'Completed' || Boolean(lr?.isCompleted))

              return (
                <Card
                  className={cn(
                    'transition-all',
                    isCompletedOnly
                      ? 'border-emerald-500/45 bg-emerald-950/25'
                      : isPaused
                      ? 'border-amber-500/45 bg-amber-950/25'
                      : 'border-primary/50 bg-primary/10',
                  )}
                >
                  <CardContent className="space-y-2.5 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div
                          className={cn(
                            'rounded-md p-1.5',
                            isCompletedOnly
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : isPaused
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-primary/20 text-primary',
                          )}
                        >
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                isCompletedOnly ? 'success' : isPaused ? 'warning' : 'info'
                              }
                            >
                              {isCompletedOnly
                                ? '✓ Hoàn tất kịch bản'
                                : isPaused
                                ? '⏸ Đang tạm dừng'
                                : isRunnerActive
                                ? `▶ Bước ${lr!.currentStepIndex}/${lr!.totalSteps}`
                                : queue.phase === 'Syncing'
                                ? 'Đang chạy kịch bản'
                                : 'Đang chạy'}
                            </Badge>
                            <span className="truncate text-xs font-bold text-foreground">
                              {isRunnerActive
                                ? `${lr!.currentStepTitle} — Via: ${lr!.viaLabel} (${lr!.profileDir})`
                                : queue.summaryText}
                            </span>
                            {isRunnerActive && (
                              <Badge variant="secondary" className="font-mono text-[10px]">
                                🛡️ {lr!.engineModeLabel}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {isRunnerActive
                              ? `⏱️ Bước hiện tại: còn ${lr!.stepRemainingSec}s / ${lr!.stepDurationSec}s • Đã chạy: ${lr!.totalElapsedSec}s • Dự kiến còn: ~${lr!.estimatedRemainingSec}s`
                              : queue.detailText}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isRunnerActive ? (
                          <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 font-mono text-xs font-bold text-amber-300 tabular-nums">
                            ⏱️ Còn {lr!.stepRemainingSec}s / {lr!.stepDurationSec}s
                          </span>
                        ) : (
                          <span className="px-2 font-mono text-xs font-bold text-amber-300 tabular-nums">
                            {queue.countdownSeconds > 0
                              ? `Chờ ${queue.countdownSeconds}s`
                              : `${queue.launchedCount}/${queue.totalCount}`}
                          </span>
                        )}

                        {!isCompletedOnly ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => sendDesktopCommand('queue_toggle_pause')}
                            >
                              {isPaused ? (
                                <>
                                  <Play className="h-3 w-3" /> Tiếp tục
                                </>
                              ) : (
                                <>
                                  <Pause className="h-3 w-3" /> Tạm dừng
                                </>
                              )}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => sendDesktopCommand('queue_skip_wait')}
                            >
                              <FastForward className="h-3 w-3" />
                              {isRunnerActive ? 'Bỏ qua bước' : 'Bỏ qua chờ'}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => sendDesktopCommand('queue_stop')}
                            >
                              <Square className="h-3 w-3" />
                              Dừng hẳn
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => sendDesktopCommand('dismiss_queue_banner')}
                          >
                            <X className="h-3.5 w-3.5" />
                            Đóng thông báo
                          </Button>
                        )}
                      </div>
                    </div>

                    {lr && lr.steps && lr.steps.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {lr.steps.map((st) => {
                          const isDone = st.status === 'done'
                          const isRunning = st.status === 'running' && isRunnerActive
                          return (
                            <div
                              key={`${st.key}-${st.index}`}
                              className={cn(
                                'flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all',
                                isDone
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : isRunning
                                  ? 'border-amber-400 bg-amber-500/20 font-bold text-amber-200 shadow-xs'
                                  : 'border-border/70 bg-background/45 text-muted-foreground',
                              )}
                            >
                              <span>
                                {isDone ? '✓' : isRunning ? '●' : '○'} {st.index}. {st.icon} {st.title}
                              </span>
                              <span className="font-mono text-[10px] opacity-85">
                                {isRunning
                                  ? `(${lr.stepRemainingSec}s/${st.durationSec}s)`
                                  : `(${st.durationSec}s)`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <Progress
                      value={isRunnerActive ? lr!.overallProgressPercent : queue.progressPercent}
                      className="h-1.5"
                    />
                  </CardContent>
                </Card>
              )
            })()}

            {/* UNAUTHENTICATED GUARD FOR CLOUD VIEWS */}
            {!state.isLoggedIn && state.activeView !== 'settings' && state.activeView !== 'overview' ? (
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-primary">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-sm font-bold text-foreground">Kết nối tài khoản AdsOps Cloud</h2>
                      <p className="max-w-2xl text-xs text-muted-foreground">
                        Đăng nhập tài khoản để đồng bộ danh sách Via, BM, Fanpage, Tài khoản QC và bật Hàng đợi Tự
                        động hóa trên Chrome Profile thật. Mọi Cookie &amp; 2FA vẫn được mã hóa DPAPI 100% tại máy
                        Windows này.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}>
                    <KeyRound className="h-4 w-4" />
                    Đi tới Đăng nhập &amp; Két khóa
                  </Button>
                </CardContent>
              </Card>
            ) : (
              children
            )}
          </main>
        </ScrollArea>

        {/* BOTTOM COLLAPSIBLE SYSTEM LOG DRAWER */}
        <footer
          className={cn(
            'flex shrink-0 flex-col border-t border-border bg-card/85 transition-all',
            logExpanded ? 'h-[190px]' : 'h-[34px]',
          )}
        >
          <div className="flex h-[34px] shrink-0 items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">Nhật ký hệ thống:</span>
              <span className="truncate font-mono text-[11px] text-foreground">{latestLog}</span>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => sendDesktopCommand('clear_logs')}>
                <Trash2 className="h-3 w-3" />
                Xóa log
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setLogExpanded((v) => !v)}
              >
                {logExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                {logExpanded ? 'Thu gọn' : 'Mở rộng'}
              </Button>
            </div>
          </div>

          {logExpanded && (
            <ScrollArea className="flex-1 border-t border-border/70 bg-background/70 px-4 py-2">
              <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                {state.runtimeLogs.length === 0 ? (
                  <div>Chưa có nhật ký.</div>
                ) : (
                  state.runtimeLogs.map((ln, idx) => (
                    <div key={idx} className="break-words leading-relaxed">
                      {ln}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </footer>
      </div>
    </div>
  )
}
