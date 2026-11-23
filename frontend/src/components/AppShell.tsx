import { Suspense, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AlertTriangle, Globe, Layers, Menu, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { PlatformScopeProvider, usePlatformScope, type PlatformScope } from '../hooks/usePlatformScope'
import { useI18n } from '../i18n'
import { cn } from '../lib/cn'
import { Button } from './primitives/button'
import { Skeleton } from './primitives/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './primitives/sheet'
import { TooltipProvider } from './primitives/tooltip'
import { BrandMark } from './shell/BrandMark'
import { DensityToggle } from './shell/DensityToggle'
import { LanguageToggle } from './shell/LanguageToggle'
import { SidebarNav } from './shell/SidebarNav'
import { ThemeToggle } from './shell/ThemeToggle'
import { UserMenu } from './shell/UserMenu'

function PlatformScopeSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n()
  const { platformScope, setPlatformScope } = usePlatformScope()

  const options: { key: PlatformScope; label: string; shortLabel: string; icon: typeof Layers }[] = [
    { key: 'all', label: t('shell.platformScope.all'), shortLabel: 'All', icon: Layers },
    { key: 'meta', label: t('shell.platformScope.meta'), shortLabel: 'M', icon: Sparkles },
    { key: 'google_ads', label: t('shell.platformScope.googleAds'), shortLabel: 'G', icon: Globe },
  ]

  return (
    <div
      role="group"
      aria-label={t('shell.platformScope.label')}
      className={cn(
        'rounded-lg border border-line bg-surface-sunken/70 p-1',
        collapsed ? 'flex flex-col gap-1' : 'grid grid-cols-3 gap-1',
      )}
    >
      {options.map((opt) => {
        const active = platformScope === opt.key
        const Icon = opt.icon
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setPlatformScope(opt.key)}
            className={cn(
              'inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all',
              active
                ? 'bg-surface text-ink shadow-xs border border-line/80'
                : 'text-ink-muted hover:text-ink border border-transparent',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && 'sr-only')}>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Synchronized App shell (v4.1.0 — Option A):
 * Collapsible sidebar (4 unified groups, 20 routes) + Top-of-Sidebar Platform Switcher + 52px header.
 */
function AppShellInner() {
  const { user } = useAuth()
  const { t, language } = useI18n()
  const { sidebarCollapsed, toggleSidebar } = usePlatformScope()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg"
      >
        {t('shell.skipToContent')}
      </a>

      <div className="min-h-screen min-[769px]:flex">
        <aside
          className={cn(
            'hidden shrink-0 border-r border-line/80 bg-surface/95 transition-[width] duration-200 min-[769px]:block',
            sidebarCollapsed ? 'w-16' : 'w-sidebar',
          )}
        >
          <div className="sticky top-0 flex h-screen flex-col overflow-y-auto">
            <div
              className={cn(
                'flex h-header shrink-0 items-center border-b border-line/60',
                sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3',
              )}
            >
              <BrandMark collapsed={sidebarCollapsed} />
              {!sidebarCollapsed && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-ink-muted hover:text-ink"
                  aria-label={t('shell.collapseSidebar')}
                  title={t('shell.collapseSidebar')}
                  onClick={toggleSidebar}
                >
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            {sidebarCollapsed && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-ink-muted hover:text-ink"
                  aria-label={t('shell.expandSidebar')}
                  title={t('shell.expandSidebar')}
                  onClick={toggleSidebar}
                >
                  <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}

            <div className={cn('py-2.5', sidebarCollapsed ? 'px-2' : 'px-3')}>
              <PlatformScopeSwitcher collapsed={sidebarCollapsed} />
            </div>

            <SidebarNav collapsed={sidebarCollapsed} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-header shrink-0 items-center gap-2 border-b border-line/80 bg-surface/85 px-3 backdrop-blur-md min-[769px]:px-6">
            <div className="min-[769px]:hidden">
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('shell.openMenu')}>
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" closeLabel={t('shell.closeMenu')}>
                  <SheetTitle className="sr-only">{t('shell.menuTitle')}</SheetTitle>
                  <SheetDescription className="sr-only">{t('shell.mainNavLabel')}</SheetDescription>
                  <div className="flex h-header shrink-0 items-center border-b border-line/60 px-4">
                    <BrandMark />
                  </div>
                  <div className="px-3 py-2.5">
                    <PlatformScopeSwitcher />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SidebarNav onNavigate={() => setNavOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink-muted" title={user?.workspace.name}>
              <span className="sr-only">{t('shell.workspace')}: </span>
              {user?.workspace.name}
            </div>

            <div className="flex items-center gap-1.5">
              <DensityToggle />
              <ThemeToggle />
              <LanguageToggle />
              <UserMenu />
            </div>
          </header>

          <main
            key={language}
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-5 outline-none min-[769px]:px-6"
          >
            {user?.workspace?.license &&
              (user.workspace.license.status === 'read_only' ||
                user.workspace.license.status === 'grace' ||
                user.workspace.license.status === 'expiring') && (
                <div
                  role="status"
                  className={cn(
                    'mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-medium',
                    user.workspace.license.status === 'read_only' ? 'tone-attention' : 'tone-caution',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {user.workspace.license.status === 'read_only'
                        ? t('shell.license.readOnly')
                        : user.workspace.license.status === 'grace'
                          ? t('shell.license.grace')
                          : t('shell.license.expiring', {
                              days: Math.max(0, user.workspace.license.days_remaining ?? 0),
                            })}
                    </span>
                  </div>
                  <Link to="/settings" className="font-semibold underline underline-offset-2 shrink-0">
                    {t('shell.license.settingsLink')}
                  </Link>
                </div>
              )}

            <Suspense
              fallback={
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
                  <Skeleton className="h-8 w-1/3" />
                  <Skeleton className="h-40 w-full" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>

          <footer className="border-t border-line bg-surface px-4 py-3 text-xs text-ink-faint min-[769px]:px-6">
            {t('shell.disclaimer')}
          </footer>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default function AppShell() {
  return (
    <PlatformScopeProvider>
      <AppShellInner />
    </PlatformScopeProvider>
  )
}
