import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { Button } from './primitives/button'
import { Skeleton } from './primitives/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './primitives/sheet'
import { TooltipProvider } from './primitives/tooltip'
import { BrandMark } from './shell/BrandMark'
import { LanguageToggle } from './shell/LanguageToggle'
import { SidebarNav } from './shell/SidebarNav'
import { ThemeToggle } from './shell/ThemeToggle'
import { UserMenu } from './shell/UserMenu'

/**
 * App shell (U1a): 240px sidebar with seven navigation groups, 52px header, one disclaimer.
 * At 768px and below the sidebar is replaced by a Sheet (Radix Dialog: focus trap, Esc, focus
 * returns to the menu button). Routes are unchanged; see components/shell/nav.ts.
 *
 * The desktop/mobile switch is CSS only (`min-[769px]`), so jsdom tests see both trees' markup
 * exactly as a browser's DOM would, minus the closed Sheet which is not mounted until opened.
 */
export default function AppShell() {
  const { user } = useAuth()
  const { t } = useI18n()
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
        <aside className="hidden w-sidebar shrink-0 border-r border-line bg-surface min-[769px]:block">
          <div className="sticky top-0 flex h-screen flex-col overflow-y-auto">
            <div className="flex h-header shrink-0 items-center px-4">
              <BrandMark />
            </div>
            <SidebarNav />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-header shrink-0 items-center gap-2 border-b border-line bg-surface px-3 min-[769px]:px-6">
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
                  <div className="flex h-header shrink-0 items-center px-4">
                    <BrandMark />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SidebarNav onNavigate={() => setNavOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="min-w-0 flex-1 truncate text-sm text-ink-muted" title={user?.workspace.name}>
              <span className="sr-only">{t('shell.workspace')}: </span>
              {user?.workspace.name}
            </div>

            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LanguageToggle />
              <UserMenu />
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-5 outline-none min-[769px]:px-6"
          >
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
