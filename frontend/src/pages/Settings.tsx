import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CurrentUser, ExtensionInstallation, NotificationPolicy } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Field } from '../components/primitives/field'
import { Skeleton } from '../components/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, LoadingRegion, NoPermissionState } from '../components/states'
import { ConfirmDialog, ReadBackNote, type ReadBack } from '../components/meta/confirm'
import { ReaderCredentialsSection } from '../components/meta/ReaderCredentialsSection'
import { DL_CLASS, Note, Panel, Row } from './account/parts'
import { RevealPinSection } from '../components/facebook/RevealPinSection'
import { formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'

const LINK_CARD =
  'block rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-sunken'

export default function Settings() {
  const { user } = useAuth()
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<CurrentUser>('/api/v1/auth/me'),
    initialData: user ?? undefined,
  })

  if (!me.data) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </LoadingRegion>
    )
  }
  const isOwner = me.data.role === 'owner'

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold leading-7">{t('set.title')}</h1>
        <p className="text-sm text-ink-muted">{t('set.intro')}</p>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title={t('set.me.title')}>
          <dl className={DL_CLASS}>
            <Row label={t('set.me.email')}>{me.data.email}</Row>
            <Row label={t('set.me.name')}>{me.data.full_name || '—'}</Row>
            <Row label={t('set.me.role')}>{enumLabel('role', me.data.role)}</Row>
            <Row label={t('set.me.workspace')}>
              {me.data.workspace.name}{' '}
              <span className="font-mono text-xs text-ink-faint">({me.data.workspace.slug})</span>
            </Row>
          </dl>
        </Panel>

        <Panel title={t('set.team.title')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {isOwner && (
              <Link to="/team" className={LINK_CARD}>
                <p className="text-sm font-medium">{t('set.team.seats')}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{t('set.team.seatsBody')}</p>
              </Link>
            )}
            <Link to="/security-devices" className={LINK_CARD}>
              <p className="text-sm font-medium">{t('set.team.security')}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{t('set.team.securityBody')}</p>
            </Link>
          </div>
        </Panel>
      </div>

      <RevealPinSection />

      <ReaderCredentialsSection isOwner={isOwner} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title={t('set.meta.title')}>
          <Link to="/meta-connections" className={LINK_CARD}>
            <p className="text-sm font-medium">{t('set.meta.link')}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{t('set.meta.body')}</p>
          </Link>
        </Panel>

        <Panel title={t('set.system.title')}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link to="/system" className={LINK_CARD}>
              <p className="text-sm font-medium">{t('set.system.link')}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{t('set.system.body')}</p>
            </Link>
            <Link to="/audit-log" className={LINK_CARD}>
              <p className="text-sm font-medium">{t('nav.item.auditLog')}</p>
              <p className="mt-0.5 text-xs text-ink-muted">Tra cứu lịch sử thay đổi &amp; thao tác hệ thống</p>
            </Link>
          </div>
        </Panel>
      </div>

      <NotificationPolicySection isOwner={isOwner} />

      <ConnectedBrowsersSection />

      <Panel title={t('set.limits.title')}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {(['1', '2', '3', '4', '5', '6', '7'] as const).map((n) => (
            <li key={n}>{t(`set.limits.${n}`)}</li>
          ))}
        </ul>
        <Note role="note">{t('set.limits.roles')}</Note>
      </Panel>
    </div>
  )
}

/**
 * Browsers connected through the Chrome extension (A5).
 *
 * Revoking here matters: it works from any machine, so a lost laptop can be cut off without
 * touching it. Revocation is a stored fact, not a token expiry, so it takes effect at once.
 * Asked once in words, then read back from the list the server returns.
 */
function ConnectedBrowsersSection() {
  const { t, language } = useI18n()
  const [target, setTarget] = useState<ExtensionInstallation | null>(null)
  const [readBack, setReadBack] = useState<ReadBack | null>(null)
  const installations = useQuery({
    queryKey: ['extension-installations'],
    queryFn: () => api.get<ExtensionInstallation[]>('/api/v1/extension/installations'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.post('/api/v1/extension/installations/revoke', {
        installation_id: id,
        reason: 'Revoked from the dashboard settings page.',
      }),
  })

  async function confirmRevoke() {
    if (!target) return
    await revoke.mutateAsync(target.id)
    const fresh = await installations.refetch()
    const row = fresh.data?.find((candidate) => candidate.id === target.id)
    const label = target.label || t('set.browsers.unnamed')
    const status = row?.is_active === false ? t('set.browsers.revoked') : t('set.browsers.connected')
    const ok = row?.is_active === false
    setReadBack({
      ok,
      text: t(ok ? 'set.browsers.readback.ok' : 'set.browsers.readback.mismatch', { label, status }),
    })
  }

  let body
  if (installations.isLoading) {
    body = (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </LoadingRegion>
    )
  } else if (installations.isError) {
    body = <ErrorState title={t('set.browsers.error')} error={installations.error} onRetry={() => installations.refetch()} />
  } else if (installations.data!.length === 0) {
    body = <EmptyState title={t('set.browsers.title')} description={t('set.browsers.empty')} />
  } else {
    body = (
      <Table cards>
        <TableHeader>
          <TableRow>
            <TableHead>{t('set.browsers.col.browser')}</TableHead>
            <TableHead>{t('set.browsers.col.version')}</TableHead>
            <TableHead>{t('set.browsers.col.lastSeen')}</TableHead>
            <TableHead>{t('set.browsers.col.status')}</TableHead>
            <TableHead>{t('set.browsers.col.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installations.data!.map((row) => (
            <TableRow key={row.id}>
              <TableCell label={t('set.browsers.col.browser')}>{row.label || t('set.browsers.unnamed')}</TableCell>
              <TableCell label={t('set.browsers.col.version')} className="font-mono text-xs">
                {row.extension_version || '—'}
              </TableCell>
              <TableCell label={t('set.browsers.col.lastSeen')} className="text-xs text-ink-muted">
                {row.last_seen_at ? formatRelative(row.last_seen_at, language) : t('format.never')}
              </TableCell>
              <TableCell label={t('set.browsers.col.status')}>
                {/* Connected is a session fact, not a verdict on the browser: neutral, not green. */}
                <Badge tone={row.is_active ? 'neutral' : 'muted'}>
                  {row.is_active ? t('set.browsers.connected') : t('set.browsers.revoked')}
                </Badge>
                {row.revoked_reason && <p className="mt-0.5 text-2xs text-ink-faint">{row.revoked_reason}</p>}
              </TableCell>
              <TableCell label={t('set.browsers.col.actions')}>
                {row.is_active ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('set.browsers.revokeAria', { label: row.label || t('set.browsers.unnamed') })}
                    onClick={() => setTarget(row)}
                  >
                    {t('set.browsers.revoke')}
                  </Button>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <Panel title={t('set.browsers.title')}>
      {body}
      <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />
      <Note role="note">{t('set.browsers.note')}</Note>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={t('set.browsers.dialog.title', { label: target?.label || t('set.browsers.unnamed') })}
        object={target?.label || t('set.browsers.unnamed')}
        effects={[t('set.browsers.dialog.e1'), t('set.browsers.dialog.e3')]}
        irreversible
        destructive
        confirmLabel={t('set.browsers.dialog.confirm')}
        onConfirm={confirmRevoke}
      />
    </Panel>
  )
}

function NotificationPolicySection({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n()
  const policy = useQuery({
    queryKey: ['notification-policy'],
    queryFn: () => api.get<NotificationPolicy>('/api/v1/notification-policies/current'),
  })

  const [form, setForm] = useState<Record<string, unknown>>({})
  const [chatId, setChatId] = useState('')
  const [readBack, setReadBack] = useState<ReadBack | null>(null)

  useEffect(() => {
    if (policy.data) {
      setForm({
        enabled: policy.data.enabled,
        timezone: policy.data.timezone,
        quiet_hours_enabled: policy.data.quiet_hours_enabled,
        quiet_hours_start: (policy.data.quiet_hours_start ?? '23:00:00').slice(0, 5),
        quiet_hours_end: (policy.data.quiet_hours_end ?? '07:00:00').slice(0, 5),
        critical_bypasses_quiet_hours: policy.data.critical_bypasses_quiet_hours,
        warning_telegram_enabled: policy.data.warning_telegram_enabled,
        attention_telegram_enabled: policy.data.attention_telegram_enabled,
        reminder_enabled: policy.data.reminder_enabled,
        reminder_interval_hours: policy.data.reminder_interval_hours ?? 24,
      })
    }
  }, [policy.data])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        ...form,
        quiet_hours_start: `${String(form.quiet_hours_start)}:00`,
        quiet_hours_end: `${String(form.quiet_hours_end)}:00`,
      }
      if (chatId.trim()) payload.telegram_chat_id = chatId.trim()
      if (!payload.reminder_enabled) delete payload.reminder_interval_hours
      return api.patch<NotificationPolicy>('/api/v1/notification-policies/current', payload)
    },
    onSuccess: async () => {
      setChatId('')
      // Read back: the policy the server returns now, not the form, is what is shown.
      const fresh = await policy.refetch()
      const stored = fresh.data
      if (!stored) return
      const onOff = (value: boolean) => (value ? t('set.notif.on') : t('set.notif.off'))
      const quiet = stored.quiet_hours_enabled
        ? `${onOff(true)} (${(stored.quiet_hours_start ?? '').slice(0, 5)}–${(stored.quiet_hours_end ?? '').slice(0, 5)})`
        : onOff(false)
      setReadBack({
        ok: true,
        text: t('set.notif.readback', { enabled: onOff(stored.enabled), quiet, tz: stored.timezone }),
      })
    },
  })

  if (policy.isLoading) {
    return (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </LoadingRegion>
    )
  }
  if (policy.isError) {
    return <ErrorState title={t('set.notif.error')} error={policy.error} onRetry={() => policy.refetch()} />
  }

  const data = policy.data!
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }))

  const checkbox = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={Boolean(form[key])}
        onChange={(event) => set(key, event.target.checked)}
      />
      {label}
    </label>
  )

  return (
    <Panel title={t('set.notif.title')}>
      <div className="flex flex-wrap gap-2">
        {/* "Configured" says a transport exists, not that a message ever arrived (rule 28). */}
        <Badge tone={data.telegram_transport_configured ? 'neutral' : 'caution'}>
          {t('set.notif.transport', {
            state: data.telegram_transport_configured ? t('set.notif.configured') : t('set.notif.notConfigured'),
          })}
        </Badge>
        <Badge tone={data.recipient_configured ? 'neutral' : 'caution'}>
          {t('set.notif.recipient', {
            state: data.recipient_configured
              ? t('set.notif.configuredMasked', { masked: data.telegram_chat_id_masked ?? '' })
              : t('set.notif.notConfigured'),
          })}
        </Badge>
      </div>

      {(!data.telegram_transport_configured || !data.recipient_configured) && (
        <Note role="note" tone="caution">
          {t('set.notif.transportMissing')}
        </Note>
      )}

      <Note role="note">{t('set.notif.tokenNote')}</Note>

      {!isOwner ? (
        <NoPermissionState compact description={t('set.notif.ownerOnly')} />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setReadBack(null)
            save.mutate()
          }}
        >
          {checkbox('enabled', t('set.notif.enabled'))}

          <Field label={t('set.notif.timezone')} required hint={t('set.notif.timezoneHint')}>
            <input
              className="input"
              value={String(form.timezone ?? '')}
              onChange={(event) => set('timezone', event.target.value)}
              maxLength={64}
            />
          </Field>

          {checkbox('quiet_hours_enabled', t('set.notif.quietEnabled'))}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('set.notif.quietStart')} hint={t('set.notif.quietStartHint')}>
              <input
                className="input"
                type="time"
                value={String(form.quiet_hours_start ?? '')}
                onChange={(event) => set('quiet_hours_start', event.target.value)}
              />
            </Field>
            <Field label={t('set.notif.quietEnd')}>
              <input
                className="input"
                type="time"
                value={String(form.quiet_hours_end ?? '')}
                onChange={(event) => set('quiet_hours_end', event.target.value)}
              />
            </Field>
          </div>

          {checkbox('critical_bypasses_quiet_hours', t('set.notif.criticalBypass'))}
          {checkbox('warning_telegram_enabled', t('set.notif.warning'))}
          {checkbox('attention_telegram_enabled', t('set.notif.attention'))}
          {checkbox('reminder_enabled', t('set.notif.reminder'))}
          {Boolean(form.reminder_enabled) && (
            <Field label={t('set.notif.reminderHours')} required>
              <input
                className="input"
                type="number"
                min={1}
                max={168}
                value={Number(form.reminder_interval_hours ?? 24)}
                onChange={(event) => set('reminder_interval_hours', Number(event.target.value))}
              />
            </Field>
          )}

          <Field label={t('set.notif.chat')} hint={t('set.notif.chatHint')}>
            <input
              className="input"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder={data.telegram_chat_id_masked ?? '-1001234567890'}
              maxLength={64}
            />
          </Field>

          {save.isError && (
            <ErrorState title={t('set.notif.saveError')} error={save.error} noPermissionText={t('confirm.noPermission')} compact />
          )}
          <ReadBackNote readBack={readBack} onDismiss={() => setReadBack(null)} />
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('set.notif.saving') : t('set.notif.save')}
          </Button>
        </form>
      )}
    </Panel>
  )
}
