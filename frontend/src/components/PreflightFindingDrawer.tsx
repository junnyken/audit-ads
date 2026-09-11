import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PreflightFinding } from '../lib/types'
import { Badge, Drawer, ErrorState, Field, InlineNote } from './ui'
import { FINDING_SEVERITY_META, FINDING_STATUS_META } from '../lib/preflight'
import { formatDateTime, humanise } from '../lib/format'

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
  const [ackReason, setAckReason] = useState('')
  const [resolveReason, setResolveReason] = useState('')

  const acknowledge = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/preflight-findings/${finding!.id}/acknowledge`, { reason: ackReason }),
    onSuccess: () => {
      setAckReason('')
      onChanged()
      onClose()
    },
  })

  const resolve = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/preflight-findings/${finding!.id}/resolve`, { reason: resolveReason }),
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

  return (
    <Drawer open title={finding.rule_key} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity.tone} dot>
            {severity.label}
          </Badge>
          <Badge tone={status.tone} title={status.hint}>
            {status.label}
          </Badge>
          <Badge tone="muted">{humanise(finding.category)}</Badge>
          <span className="font-mono text-[11px] text-ink-faint">rule v{finding.rule_version}</span>
        </div>

        <p className="text-[13px]">{finding.message}</p>

        {finding.recommended_action && (
          <div>
            <h3 className="text-[12px] font-semibold">Recommended action</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">{finding.recommended_action}</p>
          </div>
        )}

        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,150px)_1fr]">
          {finding.field_reference && (
            <>
              <dt className="text-ink-faint">Field</dt>
              <dd className="font-mono text-[11.5px]">{finding.field_reference}</dd>
            </>
          )}
          <dt className="text-ink-faint">Found</dt>
          <dd>{formatDateTime(finding.created_at)}</dd>
        </dl>

        {(finding.resolved_at || finding.resolution_reason) && (
          <div>
            <h3 className="mb-1 text-[12px] font-semibold">Timeline</h3>
            <ul className="space-y-1 text-[12px] text-ink-muted">
              {finding.resolved_at && (
                <li>
                  Resolved {formatDateTime(finding.resolved_at)} — {finding.resolution_reason}
                </li>
              )}
            </ul>
          </div>
        )}

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
                <h3 className="text-[12px] font-semibold">Acknowledge</h3>
                <InlineNote>
                  Acknowledging records that an operator saw this. It does <strong>not</strong>{' '}
                  resolve it and does not change the draft&apos;s status — the finding keeps
                  counting until it is resolved or a fresh evaluation supersedes it.
                </InlineNote>
                <Field label="Reason" required>
                  <textarea
                    className="input min-h-[56px]"
                    value={ackReason}
                    onChange={(event) => setAckReason(event.target.value)}
                    maxLength={2000}
                    required
                  />
                </Field>
                {acknowledge.isError && <ErrorState error={acknowledge.error} />}
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={!ackReason.trim() || acknowledge.isPending}
                >
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
              <InlineNote>
                Resolving closes this finding. It does not itself change the draft&apos;s status —
                run the evaluation again to get a fresh verdict.
              </InlineNote>
              <Field label="Resolution reason" required>
                <textarea
                  className="input min-h-[56px]"
                  value={resolveReason}
                  onChange={(event) => setResolveReason(event.target.value)}
                  maxLength={2000}
                  required
                />
              </Field>
              {resolve.isError && <ErrorState error={resolve.error} />}
              <button type="submit" className="btn-primary" disabled={!resolveReason.trim() || resolve.isPending}>
                {resolve.isPending ? 'Saving…' : 'Resolve finding'}
              </button>
            </form>
          </div>
        )}
      </div>
    </Drawer>
  )
}
