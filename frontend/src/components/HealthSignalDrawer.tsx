import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { HealthSignal } from '../lib/types'
import { SEVERITY_META, SIGNAL_STATUS_META } from '../lib/health'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { Field } from './primitives/field'
import { ErrorState } from './states'
import { FormSheet } from './page/FormSheet'
import { Note } from '../pages/account/parts'

/**
 * Signal detail with the two operator actions, in a right-hand Sheet (template T4).
 *
 * Acknowledge and resolve are kept visually and textually distinct because they mean different
 * things: acknowledging records that you saw it and leaves the signal counting towards health;
 * resolving closes it and says why.
 */
export default function HealthSignalDrawer({
  signal,
  readOnly,
  onClose,
  onChanged,
}: {
  signal: HealthSignal | null
  readOnly: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [evidenceReference, setEvidenceReference] = useState('')

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/api/v1/account-health/signals/${signal!.id}/acknowledge`, { note }),
    onSuccess: () => {
      setNote('')
      onChanged()
      onClose()
    },
  })

  const resolve = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/account-health/signals/${signal!.id}/resolve`, {
        reason,
        evidence_reference: evidenceReference || null,
      }),
    onSuccess: () => {
      setReason('')
      setEvidenceReference('')
      onChanged()
      onClose()
    },
  })

  if (!signal) return null
  const severity = SEVERITY_META[signal.severity]
  const status = SIGNAL_STATUS_META[signal.status]
  const active = signal.status === 'open' || signal.status === 'acknowledged'
  const evidence = Object.entries(signal.evidence_json ?? {}).filter(([key]) => key !== 'message')
  const label = 'text-ink-faint'

  return (
    <FormSheet open onClose={onClose} title={signal.rule_name ?? signal.rule_key} description={t('hs.desc')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity.tone} dot>
            {enumLabel('severity', signal.severity)}
          </Badge>
          <Badge tone={status.tone} title={enumLabel('signalStatusHint', signal.status)}>
            {enumLabel('signalStatus', signal.status)}
          </Badge>
          <Badge tone="muted">{enumLabel('signalCategory', signal.category)}</Badge>
          <span className="font-mono text-xs text-ink-faint">
            {signal.rule_key} v{signal.rule_version}
          </span>
        </div>

        <p className="text-sm">{String(signal.evidence_json?.message ?? '')}</p>

        <dl className="grid gap-y-2 text-sm sm:grid-cols-[minmax(0,170px)_1fr]">
          <dt className={label}>{t('hs.id')}</dt>
          <dd className="break-all font-mono text-xs">{signal.id}</dd>
          <dt className={label}>{t('hs.observed')}</dt>
          <dd>{formatDateTime(signal.observed_at)}</dd>
          <dt className={label}>{t('hs.lastEvaluated')}</dt>
          <dd>{formatDateTime(signal.last_evaluated_at)}</dd>
          <dt className={label}>{t('hs.source')}</dt>
          <dd>
            {enumLabel('signalSource', signal.source_type)}
            {signal.source_entity_type && (
              <>
                {' · '}
                <span className="font-mono text-xs">{signal.source_entity_type}</span>
              </>
            )}
          </dd>
        </dl>

        {signal.why_it_matters && (
          <div>
            <h3 className="text-xs font-semibold">{t('hs.why')}</h3>
            <p className="mt-0.5 text-sm text-ink-muted">{signal.why_it_matters}</p>
          </div>
        )}
        {signal.recommended_next_step && (
          <div>
            <h3 className="text-xs font-semibold">{t('hs.next')}</h3>
            <p className="mt-0.5 text-sm text-ink-muted">{signal.recommended_next_step}</p>
          </div>
        )}

        {evidence.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('hs.evidence')}</h3>
            <div className="table-scroll rounded-md border border-line bg-surface-muted p-2">
              <table className="min-w-[320px] text-xs">
                <tbody>
                  {evidence.map(([key, value]) => (
                    <tr key={key}>
                      <td className="py-0.5 pr-3 align-top font-mono text-ink-faint">{key}</td>
                      <td className="break-all py-0.5 align-top font-mono">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-xs font-semibold">{t('hs.timeline')}</h3>
          <ul className="space-y-1 text-xs text-ink-muted">
            <li>{t('hs.created', { time: formatDateTime(signal.created_at) })}</li>
            {signal.acknowledged_at && (
              <li>
                {t('hs.acknowledged', { time: formatDateTime(signal.acknowledged_at), note: signal.acknowledgement_note ?? '—' })}
              </li>
            )}
            {signal.resolved_at && (
              <li>
                {t('hs.resolved', { time: formatDateTime(signal.resolved_at), reason: signal.resolution_reason ?? '—' })}
                {signal.resolved_by === null && ` ${t('hs.resolved.auto')}`}
              </li>
            )}
            {signal.superseded_at && <li>{t('hs.superseded', { time: formatDateTime(signal.superseded_at) })}</li>}
          </ul>
        </div>

        {readOnly && active && <Note>{t('hs.readOnly')}</Note>}

        {!readOnly && active && (
          <div className="space-y-4 border-t border-line pt-4">
            {signal.status === 'open' && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  acknowledge.mutate()
                }}
              >
                <h3 className="text-xs font-semibold">{t('hs.ack.title')}</h3>
                <Note>{t('hs.ack.hint')}</Note>
                <Field label={t('hs.ack.note')} required>
                  <textarea
                    className="input min-h-[56px]"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={2000}
                    required
                  />
                </Field>
                {acknowledge.isError && (
                  <ErrorState error={acknowledge.error} title={t('hs.error.ack')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
                )}
                <Button type="submit" variant="secondary" disabled={!note.trim() || acknowledge.isPending}>
                  {acknowledge.isPending ? t('pg.saving') : t('hs.ack.submit')}
                </Button>
              </form>
            )}

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                resolve.mutate()
              }}
            >
              <h3 className="text-xs font-semibold">{t('hs.resolve.title')}</h3>
              <Note>{t('hs.resolve.hint')}</Note>
              <Field label={t('hs.resolve.reason')} required>
                <textarea
                  className="input min-h-[56px]"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                  required
                />
              </Field>
              <Field label={t('hs.resolve.evidence')} hint={t('hs.resolve.evidenceHint')}>
                <input
                  className="input"
                  value={evidenceReference}
                  onChange={(event) => setEvidenceReference(event.target.value)}
                  maxLength={500}
                />
              </Field>
              {resolve.isError && (
                <ErrorState error={resolve.error} title={t('hs.error.resolve')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
              )}
              <Button type="submit" disabled={!reason.trim() || resolve.isPending}>
                {resolve.isPending ? t('pg.saving') : t('hs.resolve.submit')}
              </Button>
            </form>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
