/** The one hook the pages use to reach the worker: connection state plus current context. */
import { useCallback, useEffect, useState } from 'react'
import { ask } from './messaging'
import type { ConnectionState, ContextResolution } from './types'

export function useConnection() {
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const refresh = useCallback(async () => {
    const response = await ask<ConnectionState>({ kind: 'getConnection' })
    setConnection(
      response.data ?? {
        connected: false,
        dashboardUrl: '',
        workspaceName: null,
        userEmail: null,
        expiresAt: null,
        error: response.error ?? null,
      },
    )
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { connection, refresh }
}

export function useContext(enabled: boolean) {
  const [context, setContext] = useState<ContextResolution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    const response = await ask<ContextResolution>({ kind: 'getContext' })
    setLoading(false)
    if (response.ok && response.data) {
      setContext(response.data)
      setError(null)
    } else {
      setContext(null)
      setError(response.error ?? 'Could not read the page context.')
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { context, error, loading, refresh }
}

export function dashboardLink(dashboardUrl: string, path: string): string {
  if (!dashboardUrl) return '#'
  return `${dashboardUrl.replace(/\/+$/, '')}${path}`
}
