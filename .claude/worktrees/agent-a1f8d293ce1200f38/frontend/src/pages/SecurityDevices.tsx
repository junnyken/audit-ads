import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { DeviceSession, ExtensionInstallation } from '../lib/types'
import { formatRelative } from '../lib/format'
import { useI18n } from '../i18n'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { ErrorState, LoadingRegion } from '../components/states'
import { ConfirmDialog } from '../components/page/ConfirmDialog'
import { PageHeader } from '../components/page/PageHeader'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Note } from './account/parts'

type Confirm = { kind: 'one'; session: DeviceSession } | { kind: 'others' } | null

/** A9 §G.7. Shows only coarse metadata — no raw IP, no full user-agent, no fingerprint. The
 * current session cannot be revoked from here on purpose: signing yourself out is the existing
 * sign-out flow, and one misclick should not end your own session mid-task. Revoking another
 * device is confirmed in a dialog and read back from the server. */
export default function SecurityDevices() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const sessions = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<DeviceSession[]>('/api/v1/security/sessions/me'),
  })
  const installations = useQuery({
    queryKey: ['extension-installations'],
    queryFn: () => api.get<ExtensionInstallation[]>('/api/v1/extension/installations'),
  })

  const [confirm, setConfirm] = useState<Confirm>(null)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)

  const reread = () =>
    queryClient.fetchQuery({
      queryKey: ['my-sessions'],
      queryFn: () => api.get<DeviceSession[]>('/api/v1/security/sessions/me'),
      staleTime: 0,
    })

  const revoke = useMutation({
    mutationFn: async (session: DeviceSession) => {
      await api.post(`/api/v1/security/sessions/${session.id}/revoke`, {})
      const fresh = await reread()
      return { session, now: fresh.find((row) => row.id === session.id) }
    },
    onSuccess: ({ session, now }) => {
      void queryClient.invalidateQueries({ queryKey: ['my-sessions'] })
      setReadBack(
        now && now.revoked_at !== null
          ? { ok: true, text: t('sd.readback.revoked', { name: session.label }) }
          : { ok: false, text: t('sd.readback.mismatch') },
      )
      setConfirm(null)
    },
  })
  const logoutOthers = useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/security/sessions/logout-other-devices')
      return reread()
    },
    onSuccess: (fresh) => {
      void queryClient.invalidateQueries({ queryKey: ['my-sessions'] })
      const left = fresh.filter((row) => !row.is_current && row.revoked_at === null).length
      setReadBack(
        left === 0
          ? { ok: true, text: t('sd.readback.others', { count: 0 }) }
          : { ok: false, text: t('sd.readback.others', { count: left }) },
      )
      setConfirm(null)
    },
  })

  const columns = [t('sd.col.device'), t('sd.col.lastSeen'), t('sd.col.expires'), t('sd.col.status'), t('pg.actions')]

  if (sessions.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('sd.title')} description={t('sd.desc')} />
        <TableSkeleton columns={columns} rows={4} />
      </div>
    )
  }
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} title={t('sd.error.title')} />

  const rows = sessions.data ?? []
  const others = rows.filter((row) => !row.is_current && row.revoked_at === null)
  const pending = confirm?.kind === 'one' ? revoke : logoutOthers

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sd.title')}
        description={t('sd.desc')}
        actions={
          others.length > 0 && (
            <Button type="button" variant="secondary" disabled={logoutOthers.isPending} onClick={() => setConfirm({ kind: 'others' })}>
              {t('sd.logoutOthers', { count: others.length })}
            </Button>
          )
        }
      />

      {readBack && (
        <Note role="status" tone={readBack.ok ? 'info' : 'caution'}>
          {readBack.text}
        </Note>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('sd.sessions.title')}</CardTitle>
        </CardHeader>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">{t('sd.sessions.empty')}</p>
        ) : (
          <Table cards aria-label={t('sd.sessions.title')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.slice(0, 4).map((name) => (
                  <TableHead key={name}>{name}</TableHead>
                ))}
                <TableHead>
                  <span className="sr-only">{t('pg.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="cell-title">
                    {row.label}
                    {row.is_current && <span className="ml-1.5 text-xs text-ink-muted">{t('sd.thisDevice')}</span>}
                  </TableCell>
                  <TableCell label={columns[1]} className="text-xs text-ink-muted">{formatRelative(row.last_seen_at)}</TableCell>
                  <TableCell label={columns[2]} className="text-xs text-ink-muted">{formatRelative(row.expires_at)}</TableCell>
                  <TableCell label={columns[3]}>
                    <Badge tone={row.revoked_at === null ? 'positive' : 'neutral'}>
                      {row.revoked_at === null ? t('sd.status.active') : t('sd.status.revoked')}
                    </Badge>
                    {row.revoked_reason && <span className="mt-0.5 block text-2xs text-ink-muted">{row.revoked_reason}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.revoked_at !== null ? (
                      <span className="text-ink-faint">—</span>
                    ) : row.is_current ? (
                      <span className="text-xs text-ink-muted" title={t('sd.currentHint')}>
                        {t('sd.current')}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={revoke.isPending}
                        aria-label={t('sd.revokeNamed', { name: row.label })}
                        onClick={() => setConfirm({ kind: 'one', session: row })}
                      >
                        {t('sd.revoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <CardContent>
          <Note>{t('sd.note.sessions')}</Note>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('sd.ext.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {installations.isLoading ? (
            <LoadingRegion>
              <Skeleton className="h-9 w-full" />
            </LoadingRegion>
          ) : installations.isError ? (
            // A failed load is not "no browser connected": say which it is.
            <ErrorState error={installations.error} onRetry={() => installations.refetch()} title={t('sd.ext.error')} compact />
          ) : (installations.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t('sd.ext.empty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(installations.data ?? []).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <span>{row.label || t('sd.ext.unnamed')}</span>
                  <Badge tone={row.is_active ? 'positive' : 'neutral'}>
                    {row.is_active ? t('sd.ext.active') : t('sd.ext.revoked')}
                  </Badge>
                  <span className="text-xs text-ink-muted">{t('sd.ext.lastSeen', { time: formatRelative(row.last_seen_at) })}</span>
                </li>
              ))}
            </ul>
          )}
          <Note>{t('sd.ext.note')}</Note>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => {
          setConfirm(null)
          revoke.reset()
          logoutOthers.reset()
        }}
        title={confirm?.kind === 'one' ? t('sd.revoke.title') : t('sd.logoutOthers.title', { count: others.length })}
        object={
          confirm?.kind === 'one'
            ? t('sd.revoke.object', { name: confirm.session.label, time: formatRelative(confirm.session.last_seen_at) })
            : t('sd.logoutOthers.object')
        }
        effects={
          confirm?.kind === 'one'
            ? [t('sd.revoke.effect'), t('sd.revoke.scope'), t('sd.revoke.reversible')]
            : [t('sd.logoutOthers.effect', { count: others.length }), t('sd.logoutOthers.scope'), t('sd.logoutOthers.reversible')]
        }
        confirmLabel={confirm?.kind === 'one' ? t('sd.revoke.confirm') : t('sd.logoutOthers.confirm')}
        pending={pending.isPending}
        error={pending.isError ? pending.error : undefined}
        onConfirm={() => (confirm?.kind === 'one' ? revoke.mutate(confirm.session) : logoutOthers.mutate())}
      />
    </div>
  )
}
