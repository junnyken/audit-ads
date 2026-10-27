import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PreflightFinding } from '../lib/types'
import { FINDING_SEVERITY_META, FINDING_STATUS_META } from '../lib/preflight'
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
 * Finding detail with the two operator actions — same shape as A2's HealthSignalDrawer:
 * acknowledging records that an operator saw it and leaves it counting toward the draft's
 * verdict; resolving closes it and requires a reason. Neither changes the draft's status —
 * only a fresh evaluation run does that.
 */
export default function PreflightFindingDrawer({
  finding,
  readOnly,
  onClose,
  onChanged,
}: {
  finding: PreflightFinding | null
  readOnly: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [ackReason, setAckReason] = useState('')
  const [resolveReason, setResolveReason] = useState('')

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/api/v1/preflight-findings/${finding!.id}/acknowledge`, { reason: ackReason }),
    onSuccess: () => {
      setAckReason('')
      onChanged()
      onClose()
    },
  })

  const resolve = useMutation({
    mutationFn: () => api.post(`/api/v1/preflight-findings/${finding!.id}/resolve`, { reason: resolveReason }),
    onSuccess: () => {
      setResolveReason('')
      onChanged()
      onClose()
    },
  })

  if (!finding) return null
  const severity = FINDING_SEVERITY_META[finding.severity]
  const status = FINDING_STATUS_META[finding.status]
  const active = finding.status === 'open' || finding.status === 'acknowledged'
  const noWrite = t('acct.error.noPermissionWrite')

  return (
    <FormSheet open onClose={onClose} title={finding.rule_key} description={t('pf.finding.desc')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity?.tone ?? 'neutral'} dot>
            {enumLabel('findingSeverity', finding.severity)}
          </Badge>
          <Badge tone={status?.tone ?? 'neutral'} title={enumLabel('findingStatusHint', finding.status)}>
            {enumLabel('findingStatus', finding.status)}
          </Badge>
          <Badge tone="muted">{enumLabel('findingCategory', finding.category)}</Badge>
          <span className="font-mono text-xs text-ink-faint">{t('pf.finding.rule', { version: finding.rule_version })}</span>
        </div>

        <p className="text-sm">{finding.message}</p>

        {finding.recommended_action && (
          <div>
            <h3 className="text-xs font-semibold">{t('pf.finding.action')}</h3>
            <p className="mt-0.5 text-sm text-ink-muted">{finding.recommended_action}</p>
          </div>
        )}

        <dl className="grid gap-y-2 text-sm sm:grid-cols-[minmax(0,150px)_1fr]">
          {finding.field_reference && (
            <>
              <dt className="text-ink-faint">{t('pf.finding.field')}</dt>
              <dd className="font-mono text-xs">{finding.field_reference}</dd>
            </>
          )}
          <dt className="text-ink-faint">{t('pf.finding.found')}</dt>
          <dd>{formatDateTime(finding.created_at)}</dd>
        </dl>

        {(finding.resolved_at || finding.resolution_reason) && (
          <div>
            <h3 className="mb-1 text-xs font-semibold">{t('pf.finding.timeline')}</h3>
            <ul className="space-y-1 text-xs text-ink-muted">
              {finding.resolved_at && (
                <li>{t('pf.finding.resolved', { time: formatDateTime(finding.resolved_at), reason: finding.resolution_reason ?? '—' })}</li>
              )}
            </ul>
          </div>
        )}

        {readOnly && active && <Note>{t('pf.finding.readOnly')}</Note>}

        {!readOnly && active && (
          <div className="space-y-4 border-t border-line pt-4">
            {finding.status === 'open' && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  acknowledge.mutate()
                }}
              >
                <h3 className="text-xs font-semibold">{t('pf.finding.ack.title')}</h3>
                <Note>{t('pf.finding.ack.hint')}</Note>
                <Field label={t('pf.finding.ack.reason')} required>
                  <textarea className="input min-h-[56px]" value={ackReason} onChange={(event) => setAckReason(event.target.value)} maxLength={2000} required />
                </Field>
                {acknowledge.isError && <ErrorState error={acknowledge.error} title={t('pf.finding.error.ack')} noPermissionText={noWrite} compact />}
                <Button type="submit" variant="secondary" disabled={!ackReason.trim() || acknowledge.isPending}>
                  {acknowledge.isPending ? t('pg.saving') : t('pf.finding.ack.submit')}
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
              <h3 className="text-xs font-semibold">{t('pf.finding.resolve.title')}</h3>
              <Note>{t('pf.finding.resolve.hint')}</Note>
              <Field label={t('pf.finding.resolve.reason')} required>
                <textarea className="input min-h-[56px]" value={resolveReason} onChange={(event) => setResolveReason(event.target.value)} maxLength={2000} required />
              </Field>
              {resolve.isError && <ErrorState error={resolve.error} title={t('pf.finding.error.resolve')} noPermissionText={noWrite} compact />}
              <Button type="submit" disabled={!resolveReason.trim() || resolve.isPending}>
                {resolve.isPending ? t('pg.saving') : t('pf.finding.resolve.submit')}
              </Button>
            </form>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
