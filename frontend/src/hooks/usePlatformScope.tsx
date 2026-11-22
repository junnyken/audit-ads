import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type PlatformScope = 'all' | 'meta' | 'google_ads'

const SCOPE_KEY = 'adsops.platform_scope'
const SIDEBAR_COLLAPSED_KEY = 'adsops.sidebar_collapsed'

interface PlatformScopeContextValue {
  platformScope: PlatformScope
  setPlatformScope: (scope: PlatformScope) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

const PlatformScopeContext = createContext<PlatformScopeContextValue>({
  platformScope: 'all',
  setPlatformScope: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
})

function readStoredScope(): PlatformScope {
  try {
    const raw = window.localStorage.getItem(SCOPE_KEY)
    if (raw === 'meta' || raw === 'google_ads' || raw === 'all') return raw
  } catch {
    // ignore storage failures
  }
  return 'all'
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function PlatformScopeProvider({ children }: { children: ReactNode }) {
  const [platformScope, setPlatformScopeState] = useState<PlatformScope>(() => readStoredScope())
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => readStoredCollapsed())

  const setPlatformScope = (scope: PlatformScope) => {
    setPlatformScopeState(scope)
    try {
      window.localStorage.setItem(SCOPE_KEY, scope)
    } catch {
      // ignore storage failures
    }
  }

  const setSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsedState(collapsed)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    } catch {
      // ignore storage failures
    }
  }

  const toggleSidebar = () => setSidebarCollapsed(!sidebarCollapsed)

  useEffect(() => {
    document.documentElement.dataset.platformScope = platformScope
  }, [platformScope])

  const value = useMemo(
    () => ({
      platformScope,
      setPlatformScope,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
    }),
    [platformScope, sidebarCollapsed],
  )

  return <PlatformScopeContext.Provider value={value}>{children}</PlatformScopeContext.Provider>
}

export function usePlatformScope(): PlatformScopeContextValue {
  return useContext(PlatformScopeContext)
}

export function isGoogleAdAccount(account: {
  external_account_id?: string | null
  tags?: string[]
  notes?: string
}): boolean {
  const ext = (account.external_account_id || '').trim().toLowerCase()
  if (ext.startsWith('gads_')) return true
  const notes = (account.notes || '').toLowerCase()
  if (notes.includes('google_ads')) return true
  const tags = account.tags ?? []
  return tags.some((tag) => tag.toLowerCase().includes('google'))
}

export function isGoogleIdentity(
  row: { label?: unknown; vault_reference?: unknown; browser_profile_label?: unknown; notes?: unknown },
  rawNotes?: string,
): boolean {
  const notes = String(rawNotes ?? row.notes ?? '').toLowerCase()
  if (notes.includes('[platform:google_ads') || notes.includes('google_ads')) return true
  const label = String(row.label ?? '').toLowerCase()
  const vault = String(row.vault_reference ?? '').toLowerCase()
  const profile = String(row.browser_profile_label ?? '').toLowerCase()
  return (
    vault.startsWith('gads') ||
    label.startsWith('[mcc]') ||
    label.startsWith('[google') ||
    label.includes('google ads') ||
    profile.includes('google_ads')
  )
}
