import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

      <TelegramInstantBotSection isOwner={isOwner} />

      <AutomationCronSection isOwner={isOwner} />

      <DomainSeoSection isOwner={isOwner} />

      <details className="rounded-md border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink hover:text-brand-text">
          ⚙️ Cấu hình nâng cao: Khung giờ yên lặng (Quiet Hours) &amp; Tần suất nhắc lại
        </summary>
        <div className="mt-3">
          <NotificationPolicySection isOwner={isOwner} />
        </div>
      </details>

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


interface TelegramBotConfigResp {
  enabled: boolean
  bot_configured: boolean
  bot_source: string
  bot_mask: string
  bot_username: string | null
  bot_name: string | null
  chat_configured: boolean
  chat_id_masked: string | null
  notify_ad_account_disabled: boolean
  notify_billing_failed: boolean
  notify_page_restricted: boolean
  notify_retainer_overspend: boolean
  quiet_hours_respect: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  updated_at: string | null
}

interface DetectedChatItem {
  chat_id: string
  title: string
  type: string
  username: string | null
}

function TelegramInstantBotSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient()
  const cfgQ = useQuery({
    queryKey: ['telegram-bot-config'],
    queryFn: () => api.get<TelegramBotConfigResp>('/api/v1/telegram-bot/config'),
  })

  const [enabled, setEnabled] = useState(true)
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [notifyDisabled, setNotifyDisabled] = useState(true)
  const [notifyBilling, setNotifyBilling] = useState(true)
  const [notifyPage, setNotifyPage] = useState(true)
  const [notifyRetainer, setNotifyRetainer] = useState(true)
  const [quietRespect, setQuietRespect] = useState(true)
  const [detectedChats, setDetectedChats] = useState<DetectedChatItem[]>([])
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!cfgQ.data) return
    setEnabled(cfgQ.data.enabled)
    setNotifyDisabled(cfgQ.data.notify_ad_account_disabled)
    setNotifyBilling(cfgQ.data.notify_billing_failed)
    setNotifyPage(cfgQ.data.notify_page_restricted)
    setNotifyRetainer(cfgQ.data.notify_retainer_overspend)
    setQuietRespect(cfgQ.data.quiet_hours_respect)
  }, [cfgQ.data])

  const saveMut = useMutation({
    mutationFn: () =>
      api.post<TelegramBotConfigResp>('/api/v1/telegram-bot/config', {
        enabled,
        ...(botToken.trim() ? { bot_token: botToken.trim() } : {}),
        ...(chatId.trim() ? { chat_id: chatId.trim() } : {}),
        notify_ad_account_disabled: notifyDisabled,
        notify_billing_failed: notifyBilling,
        notify_page_restricted: notifyPage,
        notify_retainer_overspend: notifyRetainer,
        quiet_hours_respect: quietRespect,
      }),
    onSuccess: (res) => {
      setBotToken('')
      setChatId('')
      void qc.invalidateQueries({ queryKey: ['telegram-bot-config'] })
      void qc.invalidateQueries({ queryKey: ['notification-policy'] })
      setNotice({
        ok: true,
        text: `Đã lưu cấu hình Telegram${res.bot_username ? ` (@${res.bot_username})` : ''}.`,
      })
    },
    onError: (err) => {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Không lưu được cấu hình Telegram.' })
    },
  })

  const detectMut = useMutation({
    mutationFn: () =>
      api.post<{ chats: DetectedChatItem[]; hint: string }>('/api/v1/telegram-bot/detect-chat', {
        ...(botToken.trim() ? { bot_token: botToken.trim() } : {}),
      }),
    onSuccess: (res) => {
      setDetectedChats(res.chats)
      if (res.chats.length > 0 && !chatId.trim()) {
        setChatId(res.chats[0].chat_id)
      }
      setNotice({ ok: res.chats.length > 0, text: res.hint })
    },
    onError: (err) => {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Không quét được Chat ID Telegram.' })
    },
  })

  const testMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; message: string }>('/api/v1/telegram-bot/test-send', {
        ...(botToken.trim() ? { bot_token: botToken.trim() } : {}),
        ...(chatId.trim() ? { chat_id: chatId.trim() } : {}),
      }),
    onSuccess: (res) => {
      setNotice({ ok: true, text: res.message })
    },
    onError: (err) => {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Gửi tin nhắn thử thất bại.' })
    },
  })

  const cfg = cfgQ.data

  return (
    <Panel title="🤖 Cảnh Báo Tức Thời Qua Telegram Bot">
      {cfgQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : cfgQ.isError ? (
        <ErrorState title="Không tải được cấu hình Telegram Bot" error={cfgQ.error} onRetry={() => cfgQ.refetch()} compact />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={cfg?.bot_configured ? 'positive' : 'caution'}>
              {cfg?.bot_configured
                ? `🟢 Đã kết nối Bot${cfg.bot_username ? ` (@${cfg.bot_username})` : ` (${cfg.bot_mask})`}`
                : '⚪ Chưa gắn Bot Token'}
            </Badge>
            <Badge tone={cfg?.chat_configured ? 'positive' : 'caution'}>
              {cfg?.chat_configured ? `🟢 Nhóm nhận: ${cfg.chat_id_masked}` : '⚪ Chưa chọn nhóm / Chat ID'}
            </Badge>
            <Badge tone={cfg?.enabled ? 'info' : 'neutral'}>
              {cfg?.enabled ? 'Đang bật báo động' : 'Đang tạm tắt'}
            </Badge>
          </div>

          <div className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            <strong>3 bước gắn nhanh:</strong> B1: Mở <code className="font-mono">@BotFather</code> trên Telegram gõ{' '}
            <code className="font-mono">/newbot</code> lấy Token · B2: Thêm Bot vào nhóm Telegram của bạn &amp; nhắn{' '}
            <code className="font-mono">/start</code> · B3: Bấm <strong>🔍 Tự lấy ID nhóm</strong> rồi bấm{' '}
            <strong>📨 Gửi Tin Nhắn Test Ngay</strong>.
          </div>

          {!isOwner ? (
            <NoPermissionState compact description="Chỉ Chủ Workspace (Owner) mới được sửa Bot Token Telegram." />
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Bật gửi báo động tức thời về Telegram
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Bot Token Telegram (Mã hóa AES tại máy chủ)"
                  hint={cfg?.bot_configured ? `Đang lưu: ${cfg.bot_mask} (Để trống nếu giữ nguyên)` : 'VD: 123456789:ABCdef...'}
                >
                  <input
                    type="password"
                    autoComplete="off"
                    className="input font-mono text-xs"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder={cfg?.bot_configured ? `Đã lưu (${cfg.bot_mask})` : '123456789:ABCdefGHIjkl...'}
                    maxLength={140}
                  />
                </Field>

                <Field
                  label="Chat ID / ID Nhóm Telegram nhận tin"
                  hint={cfg?.chat_configured ? `Đang lưu: ${cfg.chat_id_masked} (Để trống nếu giữ nguyên)` : 'VD: -1001234567890'}
                >
                  <div className="flex items-center gap-2">
                    <input
                      className="input flex-1 font-mono text-xs"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      placeholder={cfg?.chat_id_masked ?? '-1001234567890'}
                      maxLength={64}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={detectMut.isPending}
                      onClick={() => {
                        setNotice(null)
                        detectMut.mutate()
                      }}
                    >
                      {detectMut.isPending ? 'Đang quét...' : '🔍 Tự lấy ID nhóm'}
                    </Button>
                  </div>
                </Field>
              </div>

              {detectedChats.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs">
                  <span className="font-semibold text-ink">Chọn nhóm vừa quét:</span>
                  {detectedChats.map((ch) => (
                    <button
                      key={ch.chat_id}
                      type="button"
                      onClick={() => setChatId(ch.chat_id)}
                      className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium transition ${
                        chatId === ch.chat_id
                          ? 'border-brand bg-brand text-brand-fg'
                          : 'border-line bg-surface hover:border-brand text-ink'
                      }`}
                    >
                      {ch.title} ({ch.chat_id})
                    </button>
                  ))}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={notifyDisabled} onChange={(e) => setNotifyDisabled(e.target.checked)} />
                  🔴 TKQC bị Vô hiệu hóa / Hạn chế QC
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={notifyBilling} onChange={(e) => setNotifyBilling(e.target.checked)} />
                  💳 Lỗi Thẻ thanh toán / Dư nợ quá hạn
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={notifyPage} onChange={(e) => setNotifyPage(e.target.checked)} />
                  🚩 Fanpage bị Hạn chế / Hủy đăng
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={notifyRetainer} onChange={(e) => setNotifyRetainer(e.target.checked)} />
                  💰 Retainer sắp vượt / chạm trần (≥ 90%)
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" className="h-4 w-4" checked={quietRespect} onChange={(e) => setQuietRespect(e.target.checked)} />
                Tôn trọng khung giờ yên lặng cho cảnh báo thường (Báo động Khẩn cấp luôn gửi ngay)
              </label>

              {notice && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs font-medium ${
                    notice.ok
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {notice.text}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={saveMut.isPending}
                  onClick={() => {
                    setNotice(null)
                    saveMut.mutate()
                  }}
                >
                  {saveMut.isPending ? 'Đang lưu...' : '💾 Lưu Cấu Hình Telegram'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={testMut.isPending || (!cfg?.bot_configured && !botToken.trim())}
                  onClick={() => {
                    setNotice(null)
                    testMut.mutate()
                  }}
                >
                  {testMut.isPending ? 'Đang gửi thử...' : '📨 Gửi Tin Nhắn Test Ngay'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

interface AutomationCronStatusResp {
  auto_meta_sync_enabled: boolean
  sync_interval_minutes: number
  auto_page_warmup_enabled: boolean
  warmup_min_gap_hours: number
  last_run_at: string | null
  last_sync_at: string | null
  next_sync_at: string | null
  last_run_summary: {
    outbox_processed?: number
    sync_executed?: boolean
    alerts_dispatched?: number
    warmup_posts_published?: number
    warmup_skipped_count?: number
  } | null
}

function AutomationCronSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient()
  const { language } = useI18n()
  const cronQ = useQuery({
    queryKey: ['automation-cron-status'],
    queryFn: () => api.get<AutomationCronStatusResp>('/api/v1/automation-cron/status'),
  })

  const [autoSync, setAutoSync] = useState(true)
  const [syncMinutes, setSyncMinutes] = useState(60)
  const [autoWarmup, setAutoWarmup] = useState(true)
  const [gapHours, setGapHours] = useState(8)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!cronQ.data) return
    setAutoSync(cronQ.data.auto_meta_sync_enabled)
    setSyncMinutes(cronQ.data.sync_interval_minutes)
    setAutoWarmup(cronQ.data.auto_page_warmup_enabled)
    setGapHours(cronQ.data.warmup_min_gap_hours)
  }, [cronQ.data])

  const saveMut = useMutation({
    mutationFn: () =>
      api.post<AutomationCronStatusResp>('/api/v1/automation-cron/config', {
        auto_meta_sync_enabled: autoSync,
        sync_interval_minutes: syncMinutes,
        auto_page_warmup_enabled: autoWarmup,
        warmup_min_gap_hours: gapHours,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automation-cron-status'] })
      setNotice('Đã lưu lịch chạy ngầm Auto-Cron.')
    },
  })

  const runNowMut = useMutation({
    mutationFn: () =>
      api.post<{ run_summary: NonNullable<AutomationCronStatusResp['last_run_summary']> }>(
        '/api/v1/automation-cron/run-now',
        { sync: true, warmup: true },
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['automation-cron-status'] })
      void qc.invalidateQueries({ queryKey: ['facebook-pages-summary'] })
      const s = res.run_summary
      setNotice(
        `Đã chạy xong chu kỳ: ${s.sync_executed ? 'Đồng bộ Meta OK' : 'Bỏ qua Sync'} · Đăng ${
          s.warmup_posts_published ?? 0
        } bài mồi Fanpage · Gửi ${s.alerts_dispatched ?? 0} cảnh báo Telegram.`,
      )
    },
  })

  const st = cronQ.data

  return (
    <Panel title="⏱️ Tự Động Hóa Chạy Ngầm (Auto-Cron Meta & Nuôi Page 48h)">
      {cronQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : cronQ.isError ? (
        <ErrorState title="Không tải được trạng thái Auto-Cron" error={cronQ.error} onRetry={() => cronQ.refetch()} compact />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={st?.auto_meta_sync_enabled ? 'positive' : 'neutral'}>
              {st?.auto_meta_sync_enabled ? `🟢 Auto Sync: mỗi ${st.sync_interval_minutes} phút` : '⚪ Auto Sync: Tắt'}
            </Badge>
            <Badge tone={st?.auto_page_warmup_enabled ? 'positive' : 'neutral'}>
              {st?.auto_page_warmup_enabled ? `🟢 Tự rải bài nuôi Page: cách ${st.warmup_min_gap_hours}h` : '⚪ Auto Nuôi Page: Tắt'}
            </Badge>
            <span className="text-ink-muted">
              Chạy gần nhất: <strong>{st?.last_run_at ? formatRelative(st.last_run_at, language) : 'Chưa chạy'}</strong>
              {st?.next_sync_at ? ` · Lần Sync tới: ${formatRelative(st.next_sync_at, language)}` : ''}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-md border border-line bg-surface-sunken p-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!isOwner}
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                />
                Tự động đồng bộ TKQC, Page &amp; Chi tiêu từ Meta + Quét báo động Telegram
              </label>
              <Field label="Chu kỳ quét Meta Graph API">
                <select
                  className="input text-xs"
                  disabled={!isOwner || !autoSync}
                  value={syncMinutes}
                  onChange={(e) => setSyncMinutes(Number(e.target.value))}
                >
                  <option value={30}>Mỗi 30 phút</option>
                  <option value={60}>Mỗi 60 phút (Khuyên dùng)</option>
                  <option value={180}>Mỗi 3 giờ</option>
                  <option value={360}>Mỗi 6 giờ</option>
                </select>
              </Field>
            </div>

            <div className="space-y-2 rounded-md border border-line bg-surface-sunken p-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!isOwner}
                  checked={autoWarmup}
                  onChange={(e) => setAutoWarmup(e.target.checked)}
                />
                Tự động đăng bài mồi Fanpage đang LIVE (cho tới đủ 3 bài chuẩn Ads)
              </label>
              <Field label="Giãn cách tối thiểu giữa bài #2 và bài #3">
                <select
                  className="input text-xs"
                  disabled={!isOwner || !autoWarmup}
                  value={gapHours}
                  onChange={(e) => setGapHours(Number(e.target.value))}
                >
                  <option value={6}>Cách nhau 6 giờ</option>
                  <option value={8}>Cách nhau 8 giờ (Chuẩn chống Spam)</option>
                  <option value={12}>Cách nhau 12 giờ</option>
                </select>
              </Field>
            </div>
          </div>

          {notice && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
              ✓ {notice}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <Button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {saveMut.isPending ? 'Đang lưu...' : '💾 Lưu Lịch Tự Động'}
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={runNowMut.isPending} onClick={() => runNowMut.mutate()}>
              {runNowMut.isPending ? 'Đang chạy chu kỳ...' : '⚡ Chạy Chu Kỳ Ngay'}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

interface DomainSeoConfigResp {
  custom_domain: string
  effective_public_url: string
  default_env_cors_count: number
  updated_at: string | null
  seo_checklist: Array<{ key: string; label: string; ready: boolean }>
}

function DomainSeoSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient()
  const seoQ = useQuery({
    queryKey: ['domain-seo-config'],
    queryFn: () => api.get<DomainSeoConfigResp>('/api/v1/domain-seo/config'),
  })

  const [domainInput, setDomainInput] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (seoQ.data) setDomainInput(seoQ.data.custom_domain)
  }, [seoQ.data])

  const saveMut = useMutation({
    mutationFn: () =>
      api.post<DomainSeoConfigResp>('/api/v1/domain-seo/config', {
        custom_domain: domainInput.trim(),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['domain-seo-config'] })
      setNotice({ ok: true, text: `Đã cập nhật tên miền chính thức: ${res.effective_public_url} (Đã mở CORS & link Telegram tự động).` })
    },
    onError: (err) => {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Tên miền không hợp lệ.' })
    },
  })

  const data = seoQ.data

  return (
    <Panel title="🌐 Tên Miền Chính Thức & Chuẩn Hóa SEO">
      {seoQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : seoQ.isError ? (
        <ErrorState title="Không tải được cấu hình tên miền" error={seoQ.error} onRetry={() => seoQ.refetch()} compact />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted">Tên miền đang dùng:</span>
            <code className="rounded border border-line bg-surface-sunken px-2 py-0.5 font-mono text-ink">
              {data?.effective_public_url}
            </code>
            <a href="/og-banner.png" target="_blank" rel="noreferrer" className="text-brand-text hover:underline">
              Xem ảnh OG 1200×630 →
            </a>
            <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="text-brand-text hover:underline">
              Sitemap.xml →
            </a>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(data?.seo_checklist ?? []).map((item) => (
              <Badge key={item.key} tone={item.ready ? 'positive' : 'caution'}>
                {item.ready ? '✓' : '•'} {item.label}
              </Badge>
            ))}
          </div>

          {isOwner && (
            <div className="space-y-2">
              <Field
                label="Tên miền riêng khi đổi Domain (HTTPS)"
                hint="Khi trỏ domain mới (VD: https://adsops.tencongty.vn), hệ thống tự mở CORS Backend và dùng domain này cho nút bấm trong Telegram mà không cần sửa file .env."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input flex-1 font-mono text-xs"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="https://adsops.tencongty.vn (để trống để dùng domain mặc định)"
                    maxLength={160}
                  />
                  <Button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    {saveMut.isPending ? 'Đang lưu...' : '💾 Lưu Tên Miền'}
                  </Button>
                </div>
              </Field>
              {notice && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs font-medium ${
                    notice.ok
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {notice.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
