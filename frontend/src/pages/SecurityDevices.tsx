import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { DeviceSession, ExtensionInstallation } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from '../components/ui'
import { formatRelative } from '../lib/format'

/** A9 §G.7. Shows only coarse metadata — no raw IP, no full user-agent, no fingerprint. The
 * current session cannot be revoked from here on purpose: signing yourself out is the existing
 * sign-out flow, and one misclick should not end your own session mid-task. */
export default function SecurityDevices() {
  const sessions = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<DeviceSession[]>('/api/v1/security/sessions/me'),
  })
  const installations = useQuery({
    queryKey: ['extension-installations'],
    queryFn: () => api.get<ExtensionInstallation[]>('/api/v1/extension/installations'),
  })

  const [error, setError] = useState<unknown>(null)
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/security/sessions/${id}/revoke`, {}),
    onSuccess: () => void sessions.refetch(),
    onError: setError,
  })
  const logoutOthers = useMutation({
    mutationFn: () => api.post('/api/v1/security/sessions/logout-other-devices'),
    onSuccess: () => void sessions.refetch(),
    onError: setError,
  })

  if (sessions.isLoading) return <Skeleton rows={5} />
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />

  const rows = sessions.data ?? []
  const others = rows.filter((row) => !row.is_current && row.revoked_at === null)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Security &amp; Devices</h1>
          <p className="text-[12.5px] text-ink-muted">
            Where your account is signed in. Revoking takes effect on the very next request from
            that device — it is a server-side fact, not a local sign-out.
          </p>
        </div>
        {others.length > 0 && (
          <button
            type="button"
            className="btn-secondary"
            disabled={logoutOthers.isPending}
            onClick={() => logoutOthers.mutate()}
          >
            {logoutOthers.isPending ? 'Signing out…' : `Sign out ${others.length} other device(s)`}
          </button>
        )}
      </header>

      <Card title="Your dashboard sessions">
        <div className="table-scroll">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Device</th>
                <th className="th">Last seen</th>
                <th className="th">Expires</th>
                <th className="th">Status</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <td className="td">
                    {row.label}
                    {row.is_current && (
                      <span className="ml-1.5 text-[11.5px] text-ink-faint">(this device)</span>
                    )}
                  </td>
                  <td className="td text-[12px] text-ink-muted">{formatRelative(row.last_seen_at)}</td>
                  <td className="td text-[12px] text-ink-muted">{formatRelative(row.expires_at)}</td>
                  <td className="td">
                    <Badge tone={row.revoked_at === null ? 'positive' : 'neutral'}>
                      {row.revoked_at === null ? 'Active' : 'Revoked'}
                    </Badge>
                    {row.revoked_reason && (
                      <p className="mt-0.5 text-[11px] text-ink-faint">{row.revoked_reason}</p>
                    )}
                  </td>
                  <td className="td">
                    {row.revoked_at !== null ? (
                      <span className="text-ink-faint">—</span>
                    ) : row.is_current ? (
                      <span
                        className="text-[11.5px] text-ink-faint"
                        title="Use the sign-out button in the header to end this session."
                      >
                        Sign out from the header
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(row.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error !== null && <ErrorState error={error} />}
        <InlineNote>
          Only coarse browser/OS information is kept. No IP address, full user-agent string,
          browser fingerprint or anything from Meta is stored or shown here.
        </InlineNote>
      </Card>

      <Card title="Connected browsers (Chrome extension)">
        {installations.isLoading ? (
          <Skeleton rows={2} />
        ) : (installations.data ?? []).length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            No browser has connected the Chrome extension to this account yet.
          </p>
        ) : (
          <ul className="space-y-1 text-[12.5px]">
            {(installations.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span>{row.label || 'Unnamed browser'}</span>
                <Badge tone={row.is_active ? 'positive' : 'neutral'}>
                  {row.is_active ? 'Connected' : 'Revoked'}
                </Badge>
                <span className="text-[11.5px] text-ink-faint">
                  last seen {formatRelative(row.last_seen_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <InlineNote>
          Extension sessions are tracked separately from dashboard sessions and are revoked from
          Settings — they were already revocable before this release and are unchanged by it.
        </InlineNote>
      </Card>
    </div>
  )
}
