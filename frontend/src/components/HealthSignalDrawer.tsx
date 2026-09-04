import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { HealthSignal } from '../lib/types'
import { Badge, Drawer, ErrorState, Field, InlineNote } from './ui'
import { RESOLVE_DISCLAIMER, SEVERITY_META, SIGNAL_STATUS_META } from '../lib/health'
import { formatDateTime, humanise, titleCase } from '../lib/format'

/**
 * Signal detail with the two operator actions.
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
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [evidenceReference, setEvidenceReference] = useState('')

  const acknowledge = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/account-health/signals/${signal!.id}/acknowledge`, { note }),
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

  return (
    <Drawer open title={signal.rule_name ?? signal.rule_key} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity.tone} dot>
            {severity.label}
          </Badge>
          <Badge tone={status.tone} title={status.hint}>
            {status.label}
          </Badge>
          <Badge tone="muted">{titleCase(signal.category)}</Badge>
          <span className="font-mono text-[11px] text-ink-faint">
            {signal.rule_key} v{signal.rule_version}
          </span>
        </div>

        <p className="text-[13px]">{String(signal.evidence_json?.message ?? '')}</p>

        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,170px)_1fr]">
          <dt className="text-ink-faint">Signal ID</dt>
          <dd className="font-mono text-[11.5px] break-all">{signal.id}</dd>
          <dt className="text-ink-faint">Observed</dt>
          <dd>{formatDateTime(signal.observed_at)}</dd>
          <dt className="text-ink-faint">Last evaluated</dt>
          <dd>{formatDateTime(signal.last_evaluated_at)}</dd>
          <dt className="text-ink-faint">Source</dt>
          <dd>
            {humanise(signal.source_type)}
            {signal.source_entity_type ? ` · ${humanise(signal.source_entity_type)}` : ''}
          </dd>
        </dl>

        {signal.why_it_matters && (
          <div>
            <h3 className="text-[12px] font-semibold">Why it matters</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">{signal.why_it_matters}</p>
          </div>
        )}
        {signal.recommended_next_step && (
          <div>
            <h3 className="text-[12px] font-semibold">Recommended next step</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">{signal.recommended_next_step}</p>
          </div>
        )}

        {evidence.length > 0 && (
          <div>
            <h3 className="mb-1 text-[12px] font-semibold">Evidence</h3>
            <div className="table-scroll rounded-md border border-line bg-surface-muted p-2">
              <table className="min-w-[320px] text-[11.5px]">
                <tbody>
                  {evidence.map(([key, value]) => (
                    <tr key={key}>
                      <td className="py-0.5 pr-3 align-top text-ink-faint">{humanise(key)}</td>
                      <td className="py-0.5 align-top font-mono break-all">
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
          <h3 className="mb-1 text-[12px] font-semibold">Timeline</h3>
          <ul className="space-y-1 text-[12px] text-ink-muted">
            <li>Created {formatDateTime(signal.created_at)}</li>
            {signal.acknowledged_at && (
              <li>
                Acknowledged {formatDateTime(signal.acknowledged_at)} — {signal.acknowledgement_note}
              </li>
            )}
            {signal.resolved_at && (
              <li>
                Resolved {formatDateTime(signal.resolved_at)} — {signal.resolution_reason}
                {signal.resolved_by === null && ' (closed automatically: the source condition ended)'}
              </li>
            )}
            {signal.superseded_at && (
              <li>Superseded {formatDateTime(signal.superseded_at)} by a newer signal</li>
            )}
          </ul>
        </div>

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
                <h3 className="text-[12px] font-semibold">Acknowledge</h3>
                <InlineNote>
                  Acknowledging records that you have seen this. It does <strong>not</strong> resolve
                  it, and the signal keeps counting towards this account&apos;s health.
                </InlineNote>
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
                  {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
                </button>
              </form>
            )}

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                resolve.mutate()
              }}
            >
              <h3 className="text-[12px] font-semibold">Resolve</h3>
              <InlineNote>{RESOLVE_DISCLAIMER}</InlineNote>
              <Field label="Resolution reason" required>
                <textarea
                  className="input min-h-[56px]"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                  required
                />
              </Field>
              <Field
                label="Evidence reference"
                hint="A non-secret link or label. Connection strings and credentials are refused."
              >
                <input
                  className="input"
                  value={evidenceReference}
                  onChange={(event) => setEvidenceReference(event.target.value)}
                  maxLength={500}
                />
              </Field>
              {resolve.isError && <ErrorState error={resolve.error} />}
              <button type="submit" className="btn-primary" disabled={!reason.trim() || resolve.isPending}>
                {resolve.isPending ? 'Saving…' : 'Resolve signal'}
              </button>
            </form>
          </div>
        )}
      </div>
    </Drawer>
  )
}
