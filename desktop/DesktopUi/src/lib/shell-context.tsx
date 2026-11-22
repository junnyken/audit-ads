import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WebViaItemDto } from '@/types'

export type PlatformScope = 'all' | 'meta' | 'google_ads'
export type DesktopThemeMode = 'dark' | 'light'

const SCOPE_KEY = 'adsops.desktop.platformScope'
const THEME_KEY = 'adsops.desktop.themeMode'
const SIDEBAR_KEY = 'adsops.desktop.sidebarCollapsed'

function safeReadStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeWriteStorage(key: string, val: string): void {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* ignore WebView private storage restrictions */
  }
}

export function isGoogleVia(v: Pick<WebViaItemDto, 'accountPlatform' | 'googleAdsCustomerId'>): boolean {
  const plat = (v.accountPlatform || '').trim().toLowerCase()
  return plat === 'google_ads_mcc' || plat === 'google_ads_standalone' || plat.startsWith('google_ads')
}

export function isGoogleAdAccountId(extId: string): boolean {
  return (extId || '').trim().toLowerCase().startsWith('gads_')
}

interface ShellUiContextValue {
  platformScope: PlatformScope
  setPlatformScope: (scope: PlatformScope) => void
  themeMode: DesktopThemeMode
  setThemeMode: (mode: DesktopThemeMode) => void
  toggleThemeMode: () => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
}

const ShellUiContext = createContext<ShellUiContextValue | null>(null)

export function ShellUiProvider({ children }: { children: ReactNode }) {
  const [platformScope, setScopeState] = useState<PlatformScope>(() => {
    const raw = safeReadStorage(SCOPE_KEY)
    return raw === 'meta' || raw === 'google_ads' ? raw : 'all'
  })

  const [themeMode, setThemeState] = useState<DesktopThemeMode>(() => {
    const raw = safeReadStorage(THEME_KEY)
    return raw === 'light' ? 'light' : 'dark'
  })

  const [sidebarCollapsed, setCollapsedState] = useState<boolean>(() => {
    return safeReadStorage(SIDEBAR_KEY) === '1'
  })

  const setPlatformScope = useCallback((scope: PlatformScope) => {
    setScopeState(scope)
    safeWriteStorage(SCOPE_KEY, scope)
  }, [])

  const setThemeMode = useCallback((mode: DesktopThemeMode) => {
    setThemeState(mode)
    safeWriteStorage(THEME_KEY, mode)
  }, [])

  const toggleThemeMode = useCallback(() => {
    setThemeState((prev) => {
      const next: DesktopThemeMode = prev === 'dark' ? 'light' : 'dark'
      safeWriteStorage(THEME_KEY, next)
      return next
    })
  }, [])

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedState(collapsed)
    safeWriteStorage(SIDEBAR_KEY, collapsed ? '1' : '0')
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      safeWriteStorage(SIDEBAR_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', themeMode === 'dark')
    root.classList.toggle('light', themeMode === 'light')
  }, [themeMode])

  const value = useMemo<ShellUiContextValue>(
    () => ({
      platformScope,
      setPlatformScope,
      themeMode,
      setThemeMode,
      toggleThemeMode,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebarCollapsed,
    }),
    [
      platformScope,
      setPlatformScope,
      themeMode,
      setThemeMode,
      toggleThemeMode,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebarCollapsed,
    ],
  )

  return <ShellUiContext.Provider value={value}>{children}</ShellUiContext.Provider>
}

export function useShellUi(): ShellUiContextValue {
  const ctx = useContext(ShellUiContext)
  if (!ctx) {
    throw new Error('useShellUi must be used inside ShellUiProvider')
  }
  return ctx
}
