import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { AlertDetail, DeliveryAttempt, NotificationDelivery } from '../lib/types'
import { ALERT_SEVERITY_META, ALERT_STATUS_META, DELIVERY_STATUS_META } from '../lib/alerts'
import { HEALTH_META } from '../lib/health'
import { READINESS_META } from '../lib/readiness'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { Field } from './primitives/field'
import { Skeleton } from './primitives/skeleton'
import { ErrorState, LoadingRegion } from './states'
import { FormSheet } from './page/FormSheet'
import { ConfirmDialog } from './page/ConfirmDialog'
import { Note } from '../pages/account/parts'
import { LoginToFixPanel } from './facebook/LoginToFixPanel'

function defaultExpiry(): string {
  const when = new Date(Date.now() + 4 * 60 * 60 * 1000)
  when.setSeconds(0, 0)
  // datetime-local wants a local ISO string without the zone.
  const offset = when.getTimezoneOffset() * 60_000
  return new Date(when.getTime() - offset).toISOString().slice(0, 16)
}

const DL = 'grid gap-y-1 text-xs sm:grid-cols-[minmax(0,160px)_1fr]'

/**
 * Alert detail with the four workflow actions, in a right-hand Sheet.
 *
 * There is deliberately no "send now": delivery follows the recorded policy, and a button that
 * bypassed dedupe and quiet hours would be the fastest route to alert fatigue.
 */
export default function AlertDrawer({
  alertId,
  onClose,
  onChanged,
}: {
  alertId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [suppressReason, setSuppressReason] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiry())
  const [confirmSuppress, setConfirmSuppress] = useState(false)

  const detail = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => api.get<AlertDetail>(`/api/v1/alerts/${alertId}`),
    enabled: Boolean(alertId),
  })

  function afterAction() {
    setNote('')
    setReason('')
    setSuppressReason('')
    setConfirmSuppress(false)
    void detail.refetch()
    onChanged()
  }

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/api/v1/alerts/${alertId}/acknowledge`, { note }),
    onSuccess: afterAction,
  })
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/v1/alerts/${alertId}/resolve`, { reason }),
    onSuccess: afterAction,
  })
  const suppress = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/alerts/${alertId}/suppress`, {
        reason: suppressReason,
        expires_at: new Date(expiresAt).toISOString(),
      }),
    onSuccess: afterAction,
  })
  const unsuppress = useMutation({
    mutationFn: () => api.post(`/api/v1/alerts/${alertId}/unsuppress`, { note: note || null }),
    onSuccess: afterAction,
  })

  if (!alertId) return null

  const data = detail.data
  const alert = data?.alert
  const severity = alert ? ALERT_SEVERITY_META[alert.severity] : null
  const status = alert ? ALERT_STATUS_META[alert.status] : null
  const isActive =
    alert?.status === 'open' || alert?.status === 'acknowledged' || alert?.status === 'suppressed'
  const noWrite = t('acct.error.noPermissionWrite')

  return (
    <FormSheet open onClose={onClose} title={alert?.title ?? t('al.sheet.fallbackTitle')} description={t('al.sheet.desc')} wide>
      {detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} title={t('al.sheet.error')} />
      ) : detail.isLoading || !data || !alert ? (
        <LoadingRegion className="space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-24 w-full" />
        </LoadingRegion>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severity!.tone} dot>
              {enumLabel('alertSeverity', alert.severity)}
            </Badge>
            <Badge tone={status!.tone} title={enumLabel('alertStatusHint', alert.status)}>
              {enumLabel('alertStatus', alert.status)}
            </Badge>
            <Badge tone="muted">{data.source_label}</Badge>
            <span className="font-mono text-xs text-ink-faint">{alert.category}</span>
          </div>

          <p className="text-sm">{alert.summary}</p>

          {data.account && (
            <div className="rounded-md border border-line bg-surface-muted p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/accounts/${data.account.id}?tab=health`} className="font-medium text-brand-text hover:underline">
                  {data.account.display_name}
                </Link>
                <span className="font-mono text-xs text-ink-faint">{data.account.external_account_id ?? t('al.sheet.noExternalId')}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Badge tone={HEALTH_META[data.account.health_status]?.tone ?? 'neutral'}>
                  {t('al.sheet.healthOf', { value: enumLabel('health', data.account.health_status) })}
                </Badge>
                <Badge tone={READINESS_META[data.account.readiness_status]?.tone ?? 'neutral'}>
                  {t('al.sheet.readinessOf', { value: enumLabel('readiness', data.account.readiness_status) })}
                </Badge>
              </div>
            </div>
          )}

          {data.account && <LoginToFixPanel identities={data.facebook_identities} />}

          {data.remediation_checklist && data.remediation_checklist.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold">{t('al.sheet.checklist.title')}</h3>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-muted">
                {data.remediation_checklist.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('al.sheet.source')}</h3>
            <dl className={DL}>
              <dt className="text-ink-faint">{t('al.sheet.rule')}</dt>
              <dd className="break-all font-mono text-xs">
                {String(alert.source_snapshot_json.rule_key ?? alert.source_entity_type)}
                {alert.source_snapshot_json.rule_version ? ` v${alert.source_snapshot_json.rule_version}` : ''}
              </dd>
              {alert.source_snapshot_json.health_severity != null && (
                <>
                  <dt className="text-ink-faint">{t('al.sheet.healthSeverity')}</dt>
                  <dd>{enumLabel('severity', String(alert.source_snapshot_json.health_severity))}</dd>
                </>
              )}
              {alert.source_snapshot_json.error_code != null && (
                <>
                  <dt className="text-ink-faint">{t('al.sheet.errorCode')}</dt>
                  <dd className="font-mono text-xs">{String(alert.source_snapshot_json.error_code)}</dd>
                </>
              )}
              <dt className="text-ink-faint">{t('al.sheet.first')}</dt>
              <dd>{formatDateTime(alert.first_observed_at)}</dd>
              <dt className="text-ink-faint">{t('al.sheet.last')}</dt>
              <dd>{formatDateTime(alert.last_observed_at)}</dd>
            </dl>
            {alert.source_snapshot_json.recommended_next_step != null && (
              <p className="mt-2 text-sm text-ink-muted">
                <strong>{t('al.sheet.next')}</strong> {String(alert.source_snapshot_json.recommended_next_step)}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('al.sheet.timeline')}</h3>
            <ul className="space-y-1 text-xs text-ink-muted">
              <li>{t('al.sheet.created', { time: formatDateTime(alert.created_at) })}</li>
              {alert.acknowledged_at && (
                <li>{t('al.sheet.acknowledged', { time: formatDateTime(alert.acknowledged_at), note: alert.acknowledgement_note ?? '—' })}</li>
              )}
              {alert.suppressed_at && (
                <li>
                  {t('al.sheet.suppressed', {
                    time: formatDateTime(alert.suppressed_at),
                    until: formatDateTime(alert.suppression_expires_at),
                    reason: alert.suppression_reason ?? '—',
                  })}
                </li>
              )}
              {alert.resolved_at && (
                <li>
                  {t('al.sheet.resolved', { time: formatDateTime(alert.resolved_at), reason: alert.resolution_reason ?? '—' })}
                  {alert.resolved_by === null && ` ${t('al.sheet.resolvedAuto')}`}
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('al.sheet.history', { count: data.notifications.length })}</h3>
            {data.notifications.length === 0 ? (
              <p className="text-xs text-ink-muted">{t('al.sheet.historyEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {data.notifications.map((delivery) => (
                  <DeliveryRow key={delivery.id} delivery={delivery} />
                ))}
              </ul>
            )}
            {!data.policy_decision.recipient_configured && <Note className="mt-2">{enumLabel('skipReason', 'no_recipient_configured')}</Note>}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('al.sheet.policy')}</h3>
            <dl className={DL}>
              <dt className="text-ink-faint">{t('al.sheet.timezone')}</dt>
              <dd>{data.policy_decision.timezone ?? '—'}</dd>
              <dt className="text-ink-faint">{t('al.sheet.quiet')}</dt>
              <dd>{data.policy_decision.quiet_hours_enabled ? t('pg.enabled') : t('pg.disabled')}</dd>
              <dt className="text-ink-faint">{t('al.sheet.criticalBypass')}</dt>
              <dd>{data.policy_decision.critical_bypasses_quiet_hours ? t('pg.yes') : t('pg.no')}</dd>
              <dt className="text-ink-faint">{t('al.sheet.recipient')}</dt>
              <dd>{data.policy_decision.recipient_configured ? t('pg.configured') : t('pg.notConfigured')}</dd>
            </dl>
          </div>

          {isActive && (
            <div className="space-y-4 border-t border-line pt-4">
              {alert.status === 'open' && (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    acknowledge.mutate()
                  }}
                >
                  <h3 className="text-xs font-semibold">{t('al.sheet.ack.title')}</h3>
                  <Note>{t('al.sheet.ack.hint')}</Note>
                  <Field label={t('al.sheet.ack.note')} required>
                    <textarea className="input min-h-[56px]" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} required />
                  </Field>
                  {acknowledge.isError && <ErrorState error={acknowledge.error} title={t('al.sheet.error.ack')} noPermissionText={noWrite} compact />}
                  <Button type="submit" variant="secondary" disabled={!note.trim() || acknowledge.isPending}>
                    {t('al.sheet.ack.submit')}
                  </Button>
                </form>
              )}

              {alert.status === 'suppressed' ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold">{t('al.sheet.unsuppress.title')}</h3>
                  <Note>{t('al.sheet.unsuppress.hint', { time: formatDateTime(alert.suppression_expires_at) })}</Note>
                  {unsuppress.isError && <ErrorState error={unsuppress.error} title={t('al.sheet.error.unsuppress')} noPermissionText={noWrite} compact />}
                  <Button type="button" variant="secondary" onClick={() => unsuppress.mutate()} disabled={unsuppress.isPending}>
                    {t('al.sheet.unsuppress.submit')}
                  </Button>
                </div>
              ) : (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    // A critical alert's delivery is the last line of the notification layer:
                    // muting it asks for an explicit confirmation naming the effect.
                    if (alert.severity === 'critical') setConfirmSuppress(true)
                    else suppress.mutate()
                  }}
                >
                  <h3 className="text-xs font-semibold">{t('al.sheet.suppress.title')}</h3>
                  <Note>{t('al.sheet.suppress.hint')}</Note>
                  {alert.severity === 'critical' && <Note tone="caution">{t('al.sheet.suppress.critical')}</Note>}
                  <Field label={t('al.sheet.suppress.reason')} required>
                    <input className="input" value={suppressReason} onChange={(event) => setSuppressReason(event.target.value)} maxLength={2000} required />
                  </Field>
                  <Field label={t('al.sheet.suppress.expires')} required hint={t('al.sheet.suppress.expiresHint')}>
                    <input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required />
                  </Field>
                  {suppress.isError && !confirmSuppress && <ErrorState error={suppress.error} title={t('al.sheet.error.suppress')} noPermissionText={noWrite} compact />}
                  <Button type="submit" variant="secondary" disabled={!suppressReason.trim() || !expiresAt || suppress.isPending}>
                    {t('al.sheet.suppress.submit')}
                  </Button>
                </form>
              )}

              <form
                className="space-y-2 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  resolve.mutate()
                }}
              >
                <h3 className="text-xs font-semibold">{t('al.sheet.resolve.title')}</h3>
                <Note>{t('al.sheet.resolve.hint')}</Note>
                <Field label={t('al.sheet.resolve.reason')} required>
                  <textarea className="input min-h-[56px]" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} required />
                </Field>
                {resolve.isError && <ErrorState error={resolve.error} title={t('al.sheet.error.resolve')} noPermissionText={noWrite} compact />}
                <Button type="submit" disabled={!reason.trim() || resolve.isPending}>
                  {t('al.sheet.resolve.submit')}
                </Button>
              </form>
            </div>
          )}

          <Note>{data.disclaimer}</Note>
        </div>
      )}

      <ConfirmDialog
        open={confirmSuppress}
        onCancel={() => {
          setConfirmSuppress(false)
          suppress.reset()
        }}
        title={t('al.sheet.suppressConfirm.title')}
        object={t('al.sheet.suppressConfirm.object', { title: alert?.title ?? '' })}
        effects={[
          t('al.sheet.suppressConfirm.effect', { time: expiresAt ? formatDateTime(new Date(expiresAt).toISOString()) : '—' }),
          t('al.sheet.suppressConfirm.scope'),
          t('al.sheet.suppressConfirm.reversible'),
        ]}
        confirmLabel={t('al.sheet.suppressConfirm.confirm')}
        pending={suppress.isPending}
        error={suppress.isError ? suppress.error : undefined}
        onConfirm={() => suppress.mutate()}
      />
    </FormSheet>
  )
}

function DeliveryRow({ delivery }: { delivery: NotificationDelivery }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [open, setOpen] = useState(false)
  const meta = DELIVERY_STATUS_META[delivery.status]
  const attempts = useQuery({
    queryKey: ['delivery-attempts', delivery.id],
    queryFn: () => api.get<DeliveryAttempt[]>(`/api/v1/notifications/${delivery.id}/attempts`),
    enabled: open,
  })

  return (
    <li className="rounded-md border border-line p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={meta?.tone ?? 'neutral'} title={enumLabel('deliveryHint', delivery.status)}>
          {enumLabel('delivery', delivery.status)}
        </Badge>
        <span className="text-ink-muted">{enumLabel('deliveryReason', delivery.reason)}</span>
        <span className="text-ink-faint">{t('al.sheet.scheduled', { time: formatDateTime(delivery.scheduled_for) })}</span>
        {delivery.sent_at && <span className="text-ink-faint">{t('al.sheet.sent', { time: formatDateTime(delivery.sent_at) })}</span>}
        {delivery.attempt_count > 0 && <span className="text-ink-faint">{t('al.sheet.attemptCount', { count: delivery.attempt_count })}</span>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? t('al.sheet.hide') : t('al.sheet.attempts')}
        </Button>
      </div>
      {delivery.skip_reason && <p className="mt-1 text-xs text-ink-muted">{enumLabel('skipReason', delivery.skip_reason)}</p>}
      {delivery.quiet_hours_decision?.deferred === true && (
        <p className="mt-1 text-xs text-tone-caution-fg">
          {t('al.sheet.deferred', { tz: String(delivery.quiet_hours_decision.timezone ?? ''), time: formatDateTime(delivery.scheduled_for) })}
        </p>
      )}
      {delivery.failure_summary && (
        <p className="mt-1 text-xs text-tone-attention-fg">
          {delivery.failure_code}: {delivery.failure_summary}
        </p>
      )}
      {delivery.telegram_message_id && (
        <p className="mt-1 font-mono text-2xs text-ink-faint">
          {t('al.sheet.messageTo', { id: delivery.telegram_message_id, to: delivery.recipient_masked ?? '—' })}
        </p>
      )}
      {open && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
          {attempts.isLoading && <li className="text-ink-muted">{t('al.sheet.attemptsLoading')}</li>}
          {attempts.isError && (
            <li>
              <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} title={t('al.sheet.attemptsError')} compact />
            </li>
          )}
          {(attempts.data ?? []).map((attempt) => (
            <li key={attempt.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">#{attempt.attempt_number}</span>
              <Badge tone={DELIVERY_STATUS_META[attempt.status]?.tone ?? 'neutral'}>{enumLabel('delivery', attempt.status)}</Badge>
              <span className="text-ink-faint">{formatDateTime(attempt.started_at)}</span>
              {attempt.provider_response_code && <span className="text-ink-faint">HTTP {attempt.provider_response_code}</span>}
              {attempt.failure_summary && <span className="text-tone-attention-fg">{attempt.failure_summary}</span>}
              {attempt.retry_scheduled_for && <span className="text-ink-faint">{t('al.sheet.retry', { time: formatDateTime(attempt.retry_scheduled_for) })}</span>}
            </li>
          ))}
          {attempts.data?.length === 0 && <li className="text-ink-muted">{t('al.sheet.noAttempt')}</li>}
        </ul>
      )}
    </li>
  )
}
