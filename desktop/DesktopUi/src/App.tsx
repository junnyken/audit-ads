import { useEffect, useState } from 'react'
import { AppShellLayout } from '@/components/AppShellLayout'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  mergeLiveTick,
  PREVIEW_FALLBACK_STATE,
  sendDesktopCommand,
  subscribeDesktopState,
} from '@/lib/bridge'
import type { AppShellWebStateDto } from '@/types'
import { AdAccountsTab } from '@/views/AdAccountsTab'
import { AutomationTab } from '@/views/AutomationTab'
import { HealthTokensTab } from '@/views/HealthTokensTab'
import { OverviewTab } from '@/views/OverviewTab'
import { PagesBmTab } from '@/views/PagesBmTab'
import { SettingsTab } from '@/views/SettingsTab'
import { ViasTab } from '@/views/ViasTab'
import { WorkspaceOpsTab } from '@/views/WorkspaceOpsTab'

const CTRL_HOTKEYS = new Set(['K', 'P', 'B', 'N', '1', '2', '3', '4', '5', '6', '7', '8'])

export default function App() {
  const [state, setState] = useState<AppShellWebStateDto>(PREVIEW_FALLBACK_STATE)

  useEffect(() => {
    return subscribeDesktopState(
      (full) => setState(full),
      (tick) => setState((prev) => mergeLiveTick(prev, tick)),
    )
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    root.dataset.palette = state.palette || 'obsidian'
    root.style.background = ''
    document.body.style.background = ''
  }, [state.palette])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        sendDesktopCommand('hotkey', { key: 'F5' })
        return
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const key = e.key.toUpperCase()
        if (CTRL_HOTKEYS.has(key)) {
          e.preventDefault()
          sendDesktopCommand('hotkey', { key })
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function renderActiveView() {
    switch (state.activeView) {
      case 'overview':
        return <OverviewTab state={state} />
      case 'vias':
        return <ViasTab state={state} />
      case 'automation':
        return <AutomationTab state={state} />
      case 'pages_bm':
        return <PagesBmTab state={state} />
      case 'ad_accounts':
        return (
          <AdAccountsTab
            state={state}
            initialSearch={state.adSearch ?? ''}
            initialFilter={state.adFilter ?? 'all'}
          />
        )
      case 'health_tokens':
        return <HealthTokensTab state={state} />
      case 'workspace_ops':
        return <WorkspaceOpsTab state={state} />
      case 'settings':
        return <SettingsTab state={state} />
      default:
        return <OverviewTab state={state} />
    }
  }

  return (
    <TooltipProvider delayDuration={180}>
      <AppShellLayout state={state}>{renderActiveView()}</AppShellLayout>
    </TooltipProvider>
  )
}
