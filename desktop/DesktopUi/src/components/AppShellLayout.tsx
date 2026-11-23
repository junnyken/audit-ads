import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command,
  FastForward,
  FileText,
  Globe,
  Home,
  KeyRound,
  Layers,
  Lock,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sendDesktopCommand } from '@/lib/bridge'
import { isGoogleVia, useShellUi, type PlatformScope } from '@/lib/shell-context'
import { cn } from '@/lib/utils'
import type { AppShellWebStateDto, DesktopViewKey } from '@/types'

interface NavItemDef {
  key: DesktopViewKey
  label: string
  icon: typeof Home
  badgeKey?: keyof AppShellWebStateDto['navBadges']
}

const NAV_SECTIONS: Array<{ id: string; title: string; items: NavItemDef[] }> = [
  {
    id: 'dashboard',
    title: 'Bàn điều khiển',
    items: [{ key: 'overview', label: 'Tổng quan', icon: Home, badgeKey: 'overview' }],
  },
  {
    id: 'assets',
    title: 'Tài sản & Hồ sơ',
    items: [
      { key: 'vias', label: 'Hồ sơ & Via', icon: Users, badgeKey: 'vias' },
      { key: 'pages_bm', label: 'Fanpage & BM', icon: FileText },
      { key: 'ad_accounts', label: 'Tài khoản QC', icon: BarChart3 },
    ],
  },
  {
    id: 'automation',
    title: 'Tự động & Giám sát',
    items: [
      { key: 'automation', label: 'Tự động & Nuôi', icon: Play, badgeKey: 'automation' },
      { key: 'health_tokens', label: 'Sức khỏe & Cảnh báo', icon: Activity, badgeKey: 'healthTokens' },
    ],
  },
  {
    id: 'system',
    title: 'Hệ thống',
    items: [
      { key: 'workspace_ops', label: 'Ngân sách & Team', icon: Briefcase, badgeKey: 'workspaceOps' },
      { key: 'settings', label: 'Két khóa & Cài đặt', icon: KeyRound },
    ],
  },
]

function getBreadcrumbMeta(state: AppShellWebStateDto): { group: string; title: string; subtitle: string } {
  const syncSuffix =
    state.lastSyncedAt && state.lastSyncedAt !== '—' ? `Cập nhật ${state.lastSyncedAt}` : 'Chế độ nội bộ'
  switch (state.activeView) {
    case 'overview':
      return { group: 'Bàn điều khiển', title: 'Tổng quan vận hành', subtitle: syncSuffix }
    case 'vias':
      return {
        group: 'Tài sản & Hồ sơ',
        title: 'Hồ sơ Trình duyệt & Via',
        subtitle: `${state.vias.length} hồ sơ • 2FA cục bộ • ${
          state.automationConfig.useIsolatedProfiles ? 'Chrome cô lập' : 'Chrome chuẩn'
        }`,
      }
    case 'automation':
      return {
        group: 'Tự động & Giám sát',
        title: 'Trung tâm Nuôi & Kịch bản',
        subtitle: `Đảo ấm, Tạo Page & Ủ phôi tự động • ${syncSuffix}`,
      }
    case 'pages_bm':
      return {
        group: 'Tài sản & Hồ sơ',
        title: 'Fanpage, BM & Kho nội dung',
        subtitle: `${state.fanpages.length} Fanpage • ${state.bms.length} BM • ${state.pixels.length} Pixel`,
      }
    case 'ad_accounts':
      return {
        group: 'Tài sản & Hồ sơ',
        title: 'Tài khoản Quảng cáo',
        subtitle: `${state.adAccounts.length} TKQC Meta & Google Ads`,
      }
    case 'health_tokens':
      return {
        group: 'Tự động & Giám sát',
        title: 'Sức khỏe TKQC & Kết nối',
        subtitle: `${state.metaConnections.length} Meta Token • ${state.accountHealthRows.length} đánh giá`,
      }
    case 'workspace_ops':
      return {
        group: 'Hệ thống',
        title: 'Ngân sách & Thành viên',
        subtitle: `${state.retainers.length} hợp đồng • ${state.teamMembers.length} thành viên`,
      }
    case 'settings':
      return {
        group: 'Hệ thống',
        title: 'Két khóa DPAPI & Cài đặt',
        subtitle: `Bảo mật AES-256-GCM & Antidetect • ${syncSuffix}`,
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
  const {
    platformScope,
    setPlatformScope,
    themeMode,
    toggleThemeMode,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useShellUi()

  const [dockExpanded, setDockExpanded] = useState(false)
  const [dockTab, setDockTab] = useState<'runner' | 'logs'>('logs')

  const metaCount = useMemo(() => state.vias.filter((v) => !isGoogleVia(v)).length, [state.vias])
  const googleCount = useMemo(() => state.vias.filter((v) => isGoogleVia(v)).length, [state.vias])

  const { group, title, subtitle } = getBreadcrumbMeta(state)
  const { queue, kpi } = state
  const lr = state.liveRunner
  const isRunnerActive = Boolean(lr?.isActive)
  const isPaused = Boolean(lr?.isPaused) || queue.phase === 'Paused'
  const isCompletedOnly = !isRunnerActive && (queue.phase === 'Completed' || Boolean(lr?.isCompleted))
  const hasRunnerBanner = queue.isActive || isRunnerActive || isCompletedOnly
  const latestLog = state.runtimeLogs[0] ?? 'Hệ thống sẵn sàng.'

  useEffect(() => {
    if (isRunnerActive || queue.isActive) {
      setDockTab('runner')
    }
  }, [isRunnerActive, queue.isActive])

  const scopeOptions: Array<{ key: PlatformScope; label: string; shortLabel: string; count: number; dotClass: string }> = [
    { key: 'all', label: 'Tất cả', shortLabel: 'All', count: state.vias.length, dotClass: 'bg-foreground/60' },
    { key: 'meta', label: 'Meta', shortLabel: 'FB', count: metaCount, dotClass: 'bg-blue-500' },
    { key: 'google_ads', label: 'Google', shortLabel: 'GG', count: googleCount, dotClass: 'bg-emerald-500' },
  ]

  function cycleScope() {
    const order: PlatformScope[] = ['all', 'meta', 'google_ads']
    const idx = order.indexOf(platformScope)
    setPlatformScope(order[(idx + 1) % order.length])
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* COLLAPSIBLE LEFT SIDEBAR */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-card/85 transition-[width] duration-200',
          sidebarCollapsed ? 'w-[64px]' : 'w-[236px]',
        )}
      >
        {/* Brand Header */}
        <div
          className={cn(
            'flex h-[52px] shrink-0 items-center border-b border-border/70 px-3',
            sidebarCollapsed ? 'justify-center' : 'justify-between gap-2',
          )}
        >
          {!sidebarCollapsed && (
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold tracking-tight text-foreground">AdsOps Pro</div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">v{state.appVersion}</div>
              </div>
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={toggleSidebarCollapsed}
                aria-label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {sidebarCollapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Platform Switcher */}
        <div className="border-b border-border/60 px-2.5 py-2.5">
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={cycleScope}
                  className="flex h-8 w-full items-center justify-center rounded-md border border-border bg-secondary/70 text-[11px] font-semibold text-foreground transition-colors hover:bg-accent"
                  aria-label="Chuyển kênh hiển thị"
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      platformScope === 'meta'
                        ? 'bg-blue-500'
                        : platformScope === 'google_ads'
                        ? 'bg-emerald-500'
                        : 'bg-foreground/70',
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Kênh: {scopeOptions.find((x) => x.key === platformScope)?.label} (bấm để đổi)
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
              {scopeOptions.map((opt) => {
                const selected = platformScope === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPlatformScope(opt.key)}
                    className={cn(
                      'flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-all',
                      selected
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', opt.dotClass)} />
                    <span className="truncate">{opt.label}</span>
                    <span className="font-mono text-[10px] opacity-65">{opt.count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 4 Grouped Nav Sections */}
        <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-3">
          {NAV_SECTIONS.map((sec) => (
            <div key={sec.id} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {sec.title}
                </div>
              )}
              {sec.items.map((item) => {
                const Icon = item.icon
                const active = state.activeView === item.key
                const badgeText = item.badgeKey ? state.navBadges[item.badgeKey] : ''

                const btn = (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => sendDesktopCommand('switch_view', { view: item.key })}
                    className={cn(
                      'group flex w-full items-center rounded-md text-[13px] font-medium transition-colors',
                      sidebarCollapsed ? 'h-9 justify-center px-0' : 'justify-between gap-2 px-2.5 py-1.5',
                      active
                        ? 'bg-primary/12 text-foreground ring-1 ring-inset ring-primary/30'
                        : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                    )}
                  >
                    <span className={cn('flex min-w-0 items-center', sidebarCollapsed ? '' : 'gap-2.5')}>
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                        )}
                      />
                      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                    </span>
                    {!sidebarCollapsed && badgeText && (
                      <Badge
                        variant={badgeText === 'RUN' ? 'success' : 'warning'}
                        className="shrink-0 px-1.5 py-0 font-mono text-[10px]"
                      >
                        {badgeText}
                      </Badge>
                    )}
                  </button>
                )

                return sidebarCollapsed ? (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right">
                      {item.label}
                      {badgeText ? ` (${badgeText})` : ''}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  btn
                )
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="shrink-0 space-y-1.5 border-t border-border/70 p-2.5">
          {!sidebarCollapsed && (
            <div className="rounded-md border border-border/80 bg-background/60 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs font-semibold text-foreground">
                  {state.isLoggedIn ? state.userDisplay || state.userEmail || 'Đã kết nối' : 'Chưa đăng nhập'}
                </span>
                {state.isOfflineSnapshot && (
                  <Badge variant="warning" className="px-1 py-0 text-[9px]">
                    Offline
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {state.isLoggedIn ? state.workspaceDisplay : 'Mở Két khóa để đồng bộ'}
              </div>
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}
                className={cn(
                  'flex w-full items-center rounded-md border border-border/70 bg-secondary/50 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  sidebarCollapsed ? 'h-8 justify-center px-0' : 'gap-2 px-2.5 py-1.5',
                )}
              >
                <Globe
                  className={cn('h-3.5 w-3.5 shrink-0', kpi.bridgeOnline ? 'text-emerald-500' : 'text-rose-500')}
                />
                {!sidebarCollapsed && (
                  <span className="truncate">
                    {kpi.bridgeOnline ? `Bridge :${kpi.bridgePort}` : 'Bridge OFF'} · Ext v{state.extVersion}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {kpi.bridgeOnline
                ? `Local Bridge 127.0.0.1:${kpi.bridgePort} • Companion v${state.extVersion}`
                : 'Local Bridge đang tắt'}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* TOP HEADER (52px) */}
        <header className="relative flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border bg-card/70 px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">{group}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/70 sm:inline" />
              <h1 className="truncate tracking-tight">{title}</h1>
              {platformScope !== 'all' && (
                <Badge
                  variant={platformScope === 'google_ads' ? 'success' : 'info'}
                  className="ml-1.5 hidden sm:inline-flex"
                >
                  <Layers className="h-3 w-3" />
                  {platformScope === 'google_ads' ? 'Chỉ Google Ads' : 'Chỉ Meta Ads'}
                </Badge>
              )}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={toggleThemeMode}
                  aria-label={themeMode === 'dark' ? 'Chuyển giao diện Sáng' : 'Chuyển giao diện Tối'}
                >
                  {themeMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {themeMode === 'dark' ? 'Chế độ Sáng (Linear Light)' : 'Chế độ Tối (Linear Graphite)'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => sendDesktopCommand('toggle_palette')}
                  aria-label="Đổi điểm nhấn màu hệ thống"
                >
                  <Palette className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Điểm nhấn tối: {state.palette === 'emerald' ? 'Emerald Vault' : 'Linear Cobalt'}
              </TooltipContent>
            </Tooltip>

            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => sendDesktopCommand('open_command_palette')}
              title="Bảng tìm nhanh Via / Copy 2FA / Điều hướng (Ctrl+K)"
            >
              <Command className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Tìm nhanh</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={state.isBusy}
              onClick={() => sendDesktopCommand('sync_cloud')}
              title="Đồng bộ dữ liệu Cloud (F5)"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', state.isBusy && 'animate-spin')} />
              <span className="hidden sm:inline">Đồng bộ</span>
            </Button>

            {state.isLoggedIn && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => sendDesktopCommand('run_autopilot')}
                title="Chạy tuần tự 5 bước tự động"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Auto-Pilot</span>
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
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-500/30 bg-rose-500/10 px-5 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-rose-700 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="break-words">{state.errorBannerText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('retry_error_banner')}>
                <RefreshCw className="h-3 w-3" />
                {state.isAuthExpired ? 'Đăng nhập lại' : 'Thử lại'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => sendDesktopCommand('dismiss_error_banner')}>
                <X className="h-3.5 w-3.5" />
                Đóng
              </Button>
            </div>
          </div>
        )}

        {/* UPDATE AVAILABLE / MANDATORY BANNER */}
        {(state.settings.isNewerUpdate || state.settings.updateRequired) && state.settings.hasUpdateManifest && (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs',
              state.settings.updateRequired
                ? 'border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : 'border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Zap className="h-4 w-4 shrink-0" />
              <span className="font-medium">
                {state.settings.updateRequired
                  ? `Cập nhật bắt buộc: Phiên bản v${state.appVersion} cũ hơn bản tối thiểu v${state.settings.minSupportedVersion}.`
                  : `Đã có bản cập nhật mới v${state.settings.latestAvailableVersion} (có tự sao lưu .bak an toàn).`}
              </span>
            </div>
            <Button size="sm" onClick={() => sendDesktopCommand('apply_self_update')}>
              <RefreshCw className="h-3 w-3" /> Cập nhật lên v{state.settings.latestAvailableVersion}
            </Button>
          </div>
        )}

        {/* LICENSE EXPIRY / GRACE / READ-ONLY BANNER */}
        {(state.settings.licenseStatus === 'read_only' ||
          state.settings.licenseStatus === 'grace' ||
          state.settings.licenseStatus === 'expiring') && (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs',
              state.settings.licenseIsReadOnly
                ? 'border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>
                {state.settings.licenseIsReadOnly
                  ? 'Workspace đang ở chế độ Chỉ-đọc (quá ân hạn 3 ngày). Mở Chrome Profile, lấy 2FA & Sao lưu Két vẫn dùng được; Auto-Pilot & Đồng bộ tạm khóa.'
                  : state.settings.licenseStatus === 'grace'
                    ? 'Gói thuê bao đang trong thời gian ân hạn 3 ngày. Vui lòng nhập Mã gia hạn sớm để tránh chuyển sang Chỉ-đọc.'
                    : `Gói thuê bao còn ${Math.max(0, state.settings.licenseDaysRemaining ?? 0)} ngày sử dụng.`}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => sendDesktopCommand('switch_view', { view: 'settings' })}>
              <KeyRound className="h-3 w-3" /> Nhập mã gia hạn
            </Button>
          </div>
        )}

        {/* CONTENT SCROLL AREA */}
        <ScrollArea className="flex-1">
          <main className="mx-auto w-full max-w-[1480px] space-y-4 p-4 sm:p-5">
            {!state.isLoggedIn && state.activeView !== 'settings' && state.activeView !== 'overview' ? (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-primary">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-foreground">Kết nối tài khoản AdsOps Cloud</h2>
                      <p className="max-w-2xl text-xs text-muted-foreground">
                        Đăng nhập để đồng bộ Via, Fanpage, BM và Tài khoản Quảng cáo. Cookie &amp; 2FA luôn được mã hóa
                        DPAPI cục bộ trên Windows.
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

        {/* UNIFIED BOTTOM OPERATIONS DOCK */}
        <footer
          className={cn(
            'relative flex shrink-0 flex-col border-t border-border bg-card/90 transition-[height] duration-200',
            dockExpanded ? 'h-[216px]' : 'h-[38px]',
          )}
        >
          {(isRunnerActive || queue.isActive) && (
            <div className="absolute inset-x-0 top-0 h-[2px] bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${Math.max(4, Math.min(100, isRunnerActive ? lr!.overallProgressPercent : queue.progressPercent))}%`,
                }}
              />
            </div>
          )}

          {/* Dock Toolbar Strip */}
          <div className="flex h-[38px] shrink-0 items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {hasRunnerBanner ? (
                <>
                  <Badge
                    variant={isCompletedOnly ? 'success' : isPaused ? 'warning' : 'info'}
                    className="shrink-0 font-mono text-[10px]"
                  >
                    <Bot className="h-3 w-3" />
                    {isCompletedOnly
                      ? 'Hoàn tất'
                      : isPaused
                      ? 'Tạm dừng'
                      : isRunnerActive
                      ? `Bước ${lr!.currentStepIndex}/${lr!.totalSteps}`
                      : `${queue.launchedCount}/${queue.totalCount}`}
                  </Badge>
                  <span className="truncate text-xs font-medium text-foreground">
                    {isRunnerActive ? `${lr!.currentStepTitle} • ${lr!.viaLabel}` : queue.summaryText}
                  </span>
                  {isRunnerActive && (
                    <span className="hidden shrink-0 font-mono text-[11px] text-amber-600 dark:text-amber-400 md:inline">
                      {lr!.stepRemainingSec}s/{lr!.stepDurationSec}s
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Nhật ký:</span>
                  <span className="truncate font-mono text-[11px] text-foreground">{latestLog}</span>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {hasRunnerBanner && !isCompletedOnly && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={() => sendDesktopCommand('queue_toggle_pause')}
                  >
                    {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                    <span className="hidden sm:inline">{isPaused ? 'Tiếp tục' : 'Tạm dừng'}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={() => sendDesktopCommand('queue_skip_wait')}
                  >
                    <FastForward className="h-3 w-3" />
                    <span className="hidden sm:inline">Bỏ qua</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    onClick={() => sendDesktopCommand('queue_stop')}
                  >
                    <Square className="h-3 w-3" />
                    <span className="hidden sm:inline">Dừng</span>
                  </Button>
                </>
              )}

              {hasRunnerBanner && isCompletedOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => sendDesktopCommand('dismiss_queue_banner')}
                >
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span>Ẩn</span>
                </Button>
              )}

              {dockExpanded && (
                <div className="mx-1 flex items-center rounded-md bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => setDockTab('runner')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      dockTab === 'runner' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground',
                    )}
                  >
                    Tiến trình
                  </button>
                  <button
                    type="button"
                    onClick={() => setDockTab('logs')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      dockTab === 'logs' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground',
                    )}
                  >
                    Nhật ký ({state.runtimeLogs.length})
                  </button>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => sendDesktopCommand('clear_logs')}
                title="Xóa nhật ký"
              >
                <Trash2 className="h-3 w-3" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setDockExpanded((v) => !v)}
              >
                {dockExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                <span>{dockExpanded ? 'Thu gọn' : 'Chi tiết'}</span>
              </Button>
            </div>
          </div>

          {/* Expanded Dock Content */}
          {dockExpanded && (
            <ScrollArea className="flex-1 border-t border-border/70 bg-background/70 px-4 py-2.5">
              {dockTab === 'runner' ? (
                <div className="space-y-2">
                  {hasRunnerBanner ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="font-medium text-foreground">
                          {isRunnerActive
                            ? `${lr!.currentStepTitle} — ${lr!.viaLabel} (${lr!.profileDir})`
                            : queue.detailText || queue.summaryText}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {isRunnerActive
                            ? `Đã chạy ${lr!.totalElapsedSec}s • Còn ~${lr!.estimatedRemainingSec}s`
                            : `Tiến độ ${queue.progressPercent}%`}
                        </div>
                      </div>
                      {lr && lr.steps && lr.steps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {lr.steps.map((st) => {
                            const isDone = st.status === 'done'
                            const isRunning = st.status === 'running' && isRunnerActive
                            return (
                              <span
                                key={`${st.key}-${st.index}`}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
                                  isDone
                                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : isRunning
                                    ? 'border-amber-500/40 bg-amber-500/15 font-semibold text-amber-700 dark:text-amber-300'
                                    : 'border-border bg-card text-muted-foreground',
                                )}
                              >
                                {st.index}. {st.title} ({isRunning ? `${lr.stepRemainingSec}s/` : ''}
                                {st.durationSec}s)
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      Hiện không có phiên tương tác hoặc hàng đợi nào đang chạy.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  {state.runtimeLogs.length === 0 ? (
                    <div>Chưa có nhật ký hoạt động.</div>
                  ) : (
                    state.runtimeLogs.map((ln, idx) => (
                      <div key={idx} className="break-words leading-relaxed">
                        {ln}
                      </div>
                    ))
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </footer>
      </div>
    </div>
  )
}
