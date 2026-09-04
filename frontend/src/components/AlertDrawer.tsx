import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { AlertDetail, DeliveryAttempt, NotificationDelivery } from '../lib/types'
import { Badge, Drawer, ErrorState, Field, InlineNote, Skeleton } from './ui'
import {
  ACKNOWLEDGE_HINT,
  ALERT_SEVERITY_META,
  ALERT_STATUS_META,
  CRITICAL_SUPPRESS_WARNING,
  DELIVERY_STATUS_META,
  RESOLVE_HINT,
  SKIP_REASON_LABEL,
  SUPPRESS_HINT,
} from '../lib/alerts'
import { HEALTH_META } from '../lib/health'
import { READINESS_META } from '../lib/readiness'
import { formatDateTime, humanise } from '../lib/format'

function defaultExpiry(): string {
  const when = new Date(Date.now() + 4 * 60 * 60 * 1000)
  when.setSeconds(0, 0)
  // datetime-local wants a local ISO string without the zone.
  const offset = when.getTimezoneOffset() * 60_000
  return new Date(when.getTime() - offset).toISOString().slice(0, 16)
}

/**
 * Alert detail with the four workflow actions.
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
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [suppressReason, setSuppressReason] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiry())

  const detail = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => api.get<AlertDetail>(`/api/v1/alerts/${alertId}`),
    enabled: Boolean(alertId),
  })

  function afterAction() {
    setNote('')
    setReason('')
    setSuppressReason('')
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

  return (
    <Drawer open title={alert?.title ?? 'Alert'} onClose={onClose}>
      {detail.isLoading || !data || !alert ? (
        <Skeleton rows={6} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severity!.tone} dot>
              {severity!.label}
            </Badge>
            <Badge tone={status!.tone} title={status!.hint}>
              {status!.label}
            </Badge>
            <Badge tone="muted">{data.source_label}</Badge>
            <span className="font-mono text-[11px] text-ink-faint">{alert.category}</span>
          </div>

          <p className="text-[13px]">{alert.summary}</p>

          {data.account && (
            <div className="rounded-md border border-line bg-surface-muted p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/accounts/${data.account.id}?tab=health`}
                  className="font-medium text-brand hover:underline"
                >
                  {data.account.display_name}
                </Link>
                <span className="font-mono text-[11px] text-ink-faint">
                  {data.account.external_account_id ?? 'no external ID'}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Badge tone={HEALTH_META[data.account.health_status].tone}>
                  Health: {HEALTH_META[data.account.health_status].label}
                </Badge>
                <Badge tone={READINESS_META[data.account.readiness_status].tone}>
                  Readiness: {READINESS_META[data.account.readiness_status].label}
                </Badge>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-[12px] font-semibold">Source</h3>
            <dl className="grid gap-y-1 text-[12px] sm:grid-cols-[minmax(0,160px)_1fr]">
              <dt className="text-ink-faint">Rule</dt>
              <dd className="font-mono text-[11.5px] break-all">
                {String(alert.source_snapshot_json.rule_key ?? alert.source_entity_type)}
                {alert.source_snapshot_json.rule_version
                  ? ` v${alert.source_snapshot_json.rule_version}`
                  : ''}
              </dd>
              {alert.source_snapshot_json.health_severity != null && (
                <>
                  <dt className="text-ink-faint">Health severity</dt>
                  <dd>{String(alert.source_snapshot_json.health_severity)}</dd>
                </>
              )}
              {alert.source_snapshot_json.error_code != null && (
                <>
                  <dt className="text-ink-faint">Error code</dt>
                  <dd className="font-mono text-[11.5px]">
                    {String(alert.source_snapshot_json.error_code)}
                  </dd>
                </>
              )}
              <dt className="text-ink-faint">First observed</dt>
              <dd>{formatDateTime(alert.first_observed_at)}</dd>
              <dt className="text-ink-faint">Last observed</dt>
              <dd>{formatDateTime(alert.last_observed_at)}</dd>
            </dl>
            {alert.source_snapshot_json.recommended_next_step != null && (
              <p className="mt-2 text-[12.5px] text-ink-muted">
                <strong>Next step:</strong>{' '}
                {String(alert.source_snapshot_json.recommended_next_step)}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-[12px] font-semibold">Timeline</h3>
            <ul className="space-y-1 text-[12px] text-ink-muted">
              <li>Created {formatDateTime(alert.created_at)}</li>
              {alert.acknowledged_at && (
                <li>
                  Acknowledged {formatDateTime(alert.acknowledged_at)} — {alert.acknowledgement_note}
                </li>
              )}
              {alert.suppressed_at && (
                <li>
                  Suppressed {formatDateTime(alert.suppressed_at)} until{' '}
                  {formatDateTime(alert.suppression_expires_at)} — {alert.suppression_reason}
                </li>
              )}
              {alert.resolved_at && (
                <li>
                  Resolved {formatDateTime(alert.resolved_at)} — {alert.resolution_reason}
                  {alert.resolved_by === null && ' (closed automatically: the source condition ended)'}
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-1 text-[12px] font-semibold">
              Notification history ({data.notifications.length})
            </h3>
            {data.notifications.length === 0 ? (
              <p className="text-[12px] text-ink-muted">No delivery has been planned yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.notifications.map((delivery) => (
                  <DeliveryRow key={delivery.id} delivery={delivery} />
                ))}
              </ul>
            )}
            {!data.policy_decision.recipient_configured && (
              <InlineNote>{SKIP_REASON_LABEL.no_recipient_configured}</InlineNote>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-[12px] font-semibold">Current policy decision</h3>
            <dl className="grid gap-y-1 text-[12px] sm:grid-cols-[minmax(0,160px)_1fr]">
              <dt className="text-ink-faint">Timezone</dt>
              <dd>{data.policy_decision.timezone ?? '—'}</dd>
              <dt className="text-ink-faint">Quiet hours</dt>
              <dd>{data.policy_decision.quiet_hours_enabled ? 'Enabled' : 'Disabled'}</dd>
              <dt className="text-ink-faint">Critical bypass</dt>
              <dd>{data.policy_decision.critical_bypasses_quiet_hours ? 'Yes' : 'No'}</dd>
              <dt className="text-ink-faint">Recipient</dt>
              <dd>{data.policy_decision.recipient_configured ? 'Configured' : 'Not configured'}</dd>
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
                  <h3 className="text-[12px] font-semibold">Acknowledge</h3>
                  <InlineNote>{ACKNOWLEDGE_HINT}</InlineNote>
                  <Field label="Note" required>
                    <textarea
                      className="input min-h-[56px]"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={2000}
                      required
                    />
                  </Field>
                  {acknowledge.isError && <ErrorState error={acknowledge.error} />}
                  <button type="submit" className="btn-secondary" disabled={!note.trim() || acknowledge.isPending}>
                    Acknowledge
                  </button>
                </form>
              )}

              {alert.status === 'suppressed' ? (
                <div className="space-y-2">
                  <h3 className="text-[12px] font-semibold">Suppression</h3>
                  <InlineNote>
                    Delivery is muted until {formatDateTime(alert.suppression_expires_at)}. The alert
                    stays visible and its history is kept.
                  </InlineNote>
                  {unsuppress.isError && <ErrorState error={unsuppress.error} />}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => unsuppress.mutate()}
                    disabled={unsuppress.isPending}
                  >
                    Unsuppress
                  </button>
                </div>
              ) : (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    suppress.mutate()
                  }}
                >
                  <h3 className="text-[12px] font-semibold">Suppress delivery</h3>
                  <InlineNote>{SUPPRESS_HINT}</InlineNote>
                  {alert.severity === 'critical' && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
                      {CRITICAL_SUPPRESS_WARNING}
                    </p>
                  )}
                  <Field label="Reason" required>
                    <input
                      className="input"
                      value={suppressReason}
                      onChange={(event) => setSuppressReason(event.target.value)}
                      maxLength={2000}
                      required
                    />
                  </Field>
                  <Field label="Expires at" required hint="Suppression cannot be indefinite.">
                    <input
                      className="input"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                      required
                    />
                  </Field>
                  {suppress.isError && <ErrorState error={suppress.error} />}
                  <button
                    type="submit"
                    className="btn-secondary"
                    disabled={!suppressReason.trim() || !expiresAt || suppress.isPending}
                  >
                    Suppress
                  </button>
                </form>
              )}

              <form
                className="space-y-2 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  resolve.mutate()
                }}
              >
                <h3 className="text-[12px] font-semibold">Resolve</h3>
                <InlineNote>{RESOLVE_HINT}</InlineNote>
                <Field label="Resolution reason" required>
                  <textarea
                    className="input min-h-[56px]"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2000}
                    required
                  />
                </Field>
                {resolve.isError && <ErrorState error={resolve.error} />}
                <button type="submit" className="btn-primary" disabled={!reason.trim() || resolve.isPending}>
                  Resolve alert
                </button>
              </form>
            </div>
          )}

          <InlineNote>{data.disclaimer}</InlineNote>
        </div>
      )}
    </Drawer>
  )
}

function DeliveryRow({ delivery }: { delivery: NotificationDelivery }) {
  const [open, setOpen] = useState(false)
  const meta = DELIVERY_STATUS_META[delivery.status]
  const attempts = useQuery({
    queryKey: ['delivery-attempts', delivery.id],
    queryFn: () => api.get<DeliveryAttempt[]>(`/api/v1/notifications/${delivery.id}/attempts`),
    enabled: open,
  })

  return (
    <li className="rounded-md border border-line p-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={meta.tone} title={meta.hint}>
          {meta.label}
        </Badge>
        <span className="text-ink-muted">{humanise(delivery.reason)}</span>
        <span className="text-ink-faint">scheduled {formatDateTime(delivery.scheduled_for)}</span>
        {delivery.sent_at && <span className="text-ink-faint">sent {formatDateTime(delivery.sent_at)}</span>}
        {delivery.attempt_count > 0 && (
          <span className="text-ink-faint">{delivery.attempt_count} attempt(s)</span>
        )}
        <button type="button" className="btn-ghost ml-auto" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide' : 'Attempts'}
        </button>
      </div>
      {delivery.skip_reason && (
        <p className="mt-1 text-[11.5px] text-ink-muted">{SKIP_REASON_LABEL[delivery.skip_reason]}</p>
      )}
      {delivery.quiet_hours_decision?.deferred === true && (
        <p className="mt-1 text-[11.5px] text-amber-800">
          Deferred by quiet hours ({String(delivery.quiet_hours_decision.timezone ?? '')}) until{' '}
          {formatDateTime(delivery.scheduled_for)}.
        </p>
      )}
      {delivery.failure_summary && (
        <p className="mt-1 text-[11.5px] text-rose-800">
          {delivery.failure_code}: {delivery.failure_summary}
        </p>
      )}
      {delivery.telegram_message_id && (
        <p className="mt-1 font-mono text-[11px] text-ink-faint">
          message {delivery.telegram_message_id} · to {delivery.recipient_masked}
        </p>
      )}
      {open && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[11.5px]">
          {(attempts.data ?? []).map((attempt) => (
            <li key={attempt.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">#{attempt.attempt_number}</span>
              <Badge tone={DELIVERY_STATUS_META[attempt.status].tone}>
                {DELIVERY_STATUS_META[attempt.status].label}
              </Badge>
              <span className="text-ink-faint">{formatDateTime(attempt.started_at)}</span>
              {attempt.provider_response_code && (
                <span className="text-ink-faint">HTTP {attempt.provider_response_code}</span>
              )}
              {attempt.failure_summary && <span className="text-rose-800">{attempt.failure_summary}</span>}
              {attempt.retry_scheduled_for && (
                <span className="text-ink-faint">retry {formatDateTime(attempt.retry_scheduled_for)}</span>
              )}
            </li>
          ))}
          {attempts.data?.length === 0 && <li className="text-ink-muted">No attempt yet.</li>}
        </ul>
      )}
    </li>
  )
}
