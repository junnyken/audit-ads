import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CurrentUser, ExtensionInstallation, NotificationPolicy } from '../lib/types'
import { Badge, Card, ErrorState, Field, InlineNote, Skeleton } from '../components/ui'
import { formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { TRANSPORT_NOT_CONFIGURED } from '../lib/alerts'

export default function Settings() {
  const { user } = useAuth()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<CurrentUser>('/api/v1/auth/me'),
    initialData: user ?? undefined,
  })

  if (!me.data) return <Skeleton rows={4} />

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Settings</h1>
        <p className="text-[12.5px] text-ink-muted">Workspace, account and notification policy.</p>
      </header>

      <Card title="Signed in as">
        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,200px)_1fr]">
          <dt className="text-ink-faint">Email</dt>
          <dd>{me.data.email}</dd>
          <dt className="text-ink-faint">Name</dt>
          <dd>{me.data.full_name || '—'}</dd>
          <dt className="text-ink-faint">Role</dt>
          <dd>{me.data.role}</dd>
          <dt className="text-ink-faint">Workspace</dt>
          <dd>
            {me.data.workspace.name}{' '}
            <span className="font-mono text-[11.5px] text-ink-faint">({me.data.workspace.slug})</span>
          </dd>
        </dl>
      </Card>

      <Card title="Team &amp; security">
        <div className="grid gap-2 sm:grid-cols-2">
          {me.data.role === 'owner' && (
            <Link to="/team" className="card block px-3 py-2.5 hover:border-line-strong">
              <p className="text-[13px] font-medium">Team &amp; Seats</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Seat capacity, invitations, member roles, and which Business Managers or ad
                accounts each person can see.
              </p>
            </Link>
          )}
          <Link to="/security-devices" className="card block px-3 py-2.5 hover:border-line-strong">
            <p className="text-[13px] font-medium">Security &amp; Devices</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Where your account is signed in, and how to sign a lost device out server-side.
            </p>
          </Link>
        </div>
      </Card>

      <Card title="Meta">
        <Link to="/meta-connections" className="card block px-3 py-2.5 hover:border-line-strong">
          <p className="text-[13px] font-medium">Meta connections &amp; read-only discovery</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Which environment each connection points at, what the token can actually do, and a
            read-only read of the configured Business Manager&apos;s ad accounts and Pixels.
          </p>
        </Link>
      </Card>

      <Card title="System">
        <Link to="/system" className="card block px-3 py-2.5 hover:border-line-strong">
          <p className="text-[13px] font-medium">System Status</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Background dispatch, backups and scheduled work — including whether each has ever
            run, which is reported separately from whether it ran recently.
          </p>
        </Link>
      </Card>

      <NotificationPolicySection isOwner={me.data.role === 'owner'} />

      <ConnectedBrowsersSection />

      <Card title="What this release does not do">
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-muted">
          <li>It never stores passwords, cookies, session data, tokens or proxy credentials.</li>
          <li>The Telegram bot token lives only in server configuration; it is never shown here, returned by the API, or written to the database.</li>
          <li>It does not connect to, or change anything on, an advertising platform.</li>
          <li>Telegram delivery is one-way: there are no bot commands that change anything.</li>
          <li>It runs no browser automation and rotates no proxies.</li>
          <li>It never claims an account cannot be restricted, or that an ad will be approved.</li>
          <li>It hard-deletes nothing: archive is reversible and audit history is permanent.</li>
        </ul>
        <InlineNote>
          Role management is not editable yet. The data model already carries workspace roles, so
          a later MINI-SPEC can add team assignment without a migration of intent.
        </InlineNote>
      </Card>
    </div>
  )
}

/**
 * Browsers connected through the Chrome extension (A5).
 *
 * Revoking here matters: it works from any machine, so a lost laptop can be cut off without
 * touching it. Revocation is a stored fact, not a token expiry, so it takes effect at once.
 */
function ConnectedBrowsersSection() {
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
    onSuccess: () => void installations.refetch(),
  })

  if (installations.isLoading) return <Skeleton rows={3} />
  if (installations.isError)
    return <ErrorState error={installations.error} onRetry={() => installations.refetch()} />

  const rows = installations.data!

  return (
    <Card title="Connected browsers">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">
          No browser has connected the Chrome extension to this account yet.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[560px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Browser</th>
                <th className="th">Version</th>
                <th className="th">Last seen</th>
                <th className="th">Status</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <td className="td">{row.label || 'Unnamed browser'}</td>
                  <td className="td font-mono text-[11.5px]">{row.extension_version || '—'}</td>
                  <td className="td text-[12px] text-ink-muted">
                    {row.last_seen_at ? formatRelative(row.last_seen_at) : 'never'}
                  </td>
                  <td className="td">
                    <Badge tone={row.is_active ? 'positive' : 'neutral'}>
                      {row.is_active ? 'Connected' : 'Revoked'}
                    </Badge>
                    {row.revoked_reason && (
                      <p className="mt-0.5 text-[11px] text-ink-faint">{row.revoked_reason}</p>
                    )}
                  </td>
                  <td className="td">
                    {row.is_active ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(row.id)}
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoke.isError && <ErrorState error={revoke.error} />}
      <InlineNote>
        The extension holds a separate, shorter-lived session that cannot create accounts, change
        readiness or resolve alerts. Revoking takes effect on that browser&apos;s next request,
        not whenever its session would have expired.
      </InlineNote>
    </Card>
  )
}

function NotificationPolicySection({ isOwner }: { isOwner: boolean }) {
  const policy = useQuery({
    queryKey: ['notification-policy'],
    queryFn: () => api.get<NotificationPolicy>('/api/v1/notification-policies/current'),
  })

  const [form, setForm] = useState<Record<string, unknown>>({})
  const [chatId, setChatId] = useState('')

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
    onSuccess: () => {
      setChatId('')
      void policy.refetch()
    },
  })

  if (policy.isLoading) return <Skeleton rows={5} />
  if (policy.isError) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />

  const data = policy.data!
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <Card title="Notification policy">
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone={data.telegram_transport_configured ? 'positive' : 'caution'}>
          Telegram transport: {data.telegram_transport_configured ? 'Configured' : 'Not configured'}
        </Badge>
        <Badge tone={data.recipient_configured ? 'positive' : 'caution'}>
          Recipient chat: {data.recipient_configured ? `Configured (${data.telegram_chat_id_masked})` : 'Not configured'}
        </Badge>
      </div>

      {(!data.telegram_transport_configured || !data.recipient_configured) && (
        <InlineNote>{TRANSPORT_NOT_CONFIGURED}</InlineNote>
      )}

      <InlineNote>
        The Telegram bot token is server-side configuration. It is never displayed here, never
        returned by the API, and never stored in the database.
      </InlineNote>

      {!isOwner ? (
        <p className="mt-3 text-[12.5px] text-ink-muted">
          Only the workspace owner can change notification policy.
        </p>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.enabled)}
              onChange={(event) => set('enabled', event.target.checked)}
            />
            Notifications enabled
          </label>

          <Field label="Timezone" required hint="An IANA identifier, for example Asia/Ho_Chi_Minh.">
            <input
              className="input"
              value={String(form.timezone ?? '')}
              onChange={(event) => set('timezone', event.target.value)}
              maxLength={64}
            />
          </Field>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.quiet_hours_enabled)}
              onChange={(event) => set('quiet_hours_enabled', event.target.checked)}
            />
            Quiet hours enabled
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quiet hours start" hint="Windows may cross midnight.">
              <input
                className="input"
                type="time"
                value={String(form.quiet_hours_start ?? '')}
                onChange={(event) => set('quiet_hours_start', event.target.value)}
              />
            </Field>
            <Field label="Quiet hours end">
              <input
                className="input"
                type="time"
                value={String(form.quiet_hours_end ?? '')}
                onChange={(event) => set('quiet_hours_end', event.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.critical_bypasses_quiet_hours)}
              onChange={(event) => set('critical_bypasses_quiet_hours', event.target.checked)}
            />
            Critical alerts bypass quiet hours
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.warning_telegram_enabled)}
              onChange={(event) => set('warning_telegram_enabled', event.target.checked)}
            />
            Send warnings to Telegram
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.attention_telegram_enabled)}
              onChange={(event) => set('attention_telegram_enabled', event.target.checked)}
            />
            Send info-level alerts to Telegram (off by default)
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(form.reminder_enabled)}
              onChange={(event) => set('reminder_enabled', event.target.checked)}
            />
            Reminders for alerts that stay open
          </label>
          {Boolean(form.reminder_enabled) && (
            <Field label="Reminder interval (hours)" required>
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

          <Field
            label="Telegram chat reference"
            hint="A numeric chat id or an @public_name. A bot token is never accepted here. Leave blank to keep the current value."
          >
            <input
              className="input"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder={data.telegram_chat_id_masked ?? '-1001234567890'}
              maxLength={64}
            />
          </Field>

          {save.isError && <ErrorState error={save.error} />}
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save policy'}
          </button>
        </form>
      )}
    </Card>
  )
}
