import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AdAccount, ChecklistEntry } from '../../lib/types'
import { Badge, Card, ErrorState, Field, InlineNote, Skeleton } from '../../components/ui'
import { evidenceTone, itemStateTone, reviewTone } from '../../lib/readiness'
import { formatDateTime, humanise, titleCase } from '../../lib/format'

const STATE_LABEL: Record<string, string> = {
  satisfied: 'Satisfied',
  unknown: 'Incomplete',
  problem: 'Blocking',
  not_required: 'Not required',
}

export default function ReadinessTab({
  account,
  onChanged,
}: {
  account: AdAccount
  onChanged: () => void
}) {
  const checklist = useQuery({
    queryKey: ['checklist', account.id],
    queryFn: () => api.get<ChecklistEntry[]>(`/api/v1/ad-accounts/${account.id}/readiness/checklist`),
  })

  if (checklist.isLoading) return <Skeleton rows={8} />
  if (checklist.isError) return <ErrorState error={checklist.error} onRetry={() => checklist.refetch()} />

  const entries = checklist.data!
  const byCategory = entries.reduce<Record<string, ChecklistEntry[]>>((groups, entry) => {
    const key = entry.item.category
    ;(groups[key] ??= []).push(entry)
    return groups
  }, {})

  return (
    <div className="space-y-4">
      <InlineNote>
        Items marked <strong>derived</strong> are computed from records the system already holds —
        an active mapping or a review timestamp — and cannot be ticked by hand. Every other item
        needs an explicit review, and some also need verified evidence.
      </InlineNote>

      {Object.entries(byCategory).map(([category, items]) => (
        <Card key={category} title={titleCase(category)}>
          <ul className="divide-y divide-line">
            {items.map((entry) => (
              <ChecklistRow
                key={entry.item.id}
                entry={entry}
                account={account}
                onChanged={() => {
                  onChanged()
                  void checklist.refetch()
                }}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function ChecklistRow({
  entry,
  account,
  onChanged,
}: {
  entry: ChecklistEntry
  account: AdAccount
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { item, evaluation, evidence } = entry
  const state = evaluation?.state ?? 'unknown'
  const derived = Boolean(evaluation?.derived_from)
  const editable = account.archived_at === null && !derived && evaluation?.state !== 'not_required'

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.label}</span>
            <Badge tone={itemStateTone(state)}>{STATE_LABEL[state] ?? state}</Badge>
            {evaluation?.required ? (
              <Badge tone="neutral">{item.is_mandatory ? 'Mandatory' : 'Required (conditional)'}</Badge>
            ) : (
              <Badge tone="muted">Not required</Badge>
            )}
            {derived && <Badge tone="muted">Derived</Badge>}
            {evaluation?.requires_evidence && <Badge tone="muted">Evidence required</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">{evaluation?.message}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            <strong>Why required?</strong> {evaluation?.requirement_reason}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
            <Badge tone={reviewTone(item.review_status)}>Review: {humanise(item.review_status)}</Badge>
            <Badge tone={evidenceTone(item.evidence_status)}>
              Evidence: {humanise(item.evidence_status)}
            </Badge>
            {item.expires_at && (
              <span className="text-ink-faint">Expires {formatDateTime(item.expires_at)}</span>
            )}
            {item.reviewed_at && (
              <span className="text-ink-faint">Reviewed {formatDateTime(item.reviewed_at)}</span>
            )}
          </div>
          {item.waiver_reason && (
            <p className="mt-1 text-[11.5px] text-amber-800">Waiver reason: {item.waiver_reason}</p>
          )}
        </div>
        <button type="button" className="btn-secondary shrink-0" onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Hide' : 'Details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-surface-muted p-3">
          <div>
            <h4 className="mb-1.5 text-[12px] font-semibold">Evidence</h4>
            {evidence.length === 0 ? (
              <p className="text-[12px] text-ink-muted">No evidence attached.</p>
            ) : (
              <ul className="space-y-1.5">
                {evidence.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <Badge tone={evidenceTone(record.status)}>{humanise(record.status)}</Badge>
                    <span className="min-w-0 break-words">{record.summary}</span>
                    <span className="text-ink-faint">
                      {formatDateTime(record.provided_at)}
                      {record.expires_at ? ` · expires ${formatDateTime(record.expires_at)}` : ''}
                      {record.archived_at ? ' · archived' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {derived && (
            <InlineNote>
              This item is derived from <code>{evaluation?.derived_from}</code>. Change the
              underlying mapping or review timestamp instead of marking it here.
            </InlineNote>
          )}

          {editable && <ItemActions account={account} entry={entry} onChanged={onChanged} />}
        </div>
      )}
    </li>
  )
}

function ItemActions({
  account,
  entry,
  onChanged,
}: {
  account: AdAccount
  entry: ChecklistEntry
  onChanged: () => void
}) {
  const { item, evaluation } = entry
  const [summary, setSummary] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [waiverReason, setWaiverReason] = useState('')

  const base = `/api/v1/ad-accounts/${account.id}/readiness/checklist/${item.item_key}`

  const addEvidence = useMutation({
    mutationFn: () =>
      api.post(`${base}/evidence`, {
        evidence_type: 'operator_note',
        summary,
        external_url: externalUrl || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        status: 'verified',
      }),
    onSuccess: () => {
      setSummary('')
      setExternalUrl('')
      setExpiresAt('')
      onChanged()
    },
  })

  const setReview = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(base, payload),
    onSuccess: () => {
      setWaiverReason('')
      onChanged()
    },
  })

  return (
    <div className="space-y-3">
      {evaluation?.requires_evidence && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            addEvidence.mutate()
          }}
        >
          <h4 className="text-[12px] font-semibold">Add verified evidence</h4>
          <Field label="What did you verify, and how?" required>
            <textarea
              className="input min-h-[56px]"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={5000}
              required
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Reference link" hint="Must start with http:// or https://">
              <input
                className="input"
                type="url"
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
              />
            </Field>
            <Field label="Expires on" hint="After this date the item stops counting as satisfied.">
              <input
                className="input"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </Field>
          </div>
          {addEvidence.isError && <ErrorState error={addEvidence.error} />}
          <button type="submit" className="btn-primary" disabled={!summary.trim() || addEvidence.isPending}>
            {addEvidence.isPending ? 'Saving…' : 'Attach evidence'}
          </button>
        </form>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <h4 className="text-[12px] font-semibold">Review state</h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setReview.mutate({ review_status: 'in_review' })}
            disabled={setReview.isPending}
          >
            Mark in review
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setReview.mutate({ review_status: 'completed' })}
            disabled={setReview.isPending}
          >
            Mark review complete
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setReview.mutate({ review_status: 'needs_update' })}
            disabled={setReview.isPending}
          >
            Needs update
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Field label="Waiver reason" hint="A waiver is recorded with its reason and still does not satisfy a required item.">
              <input
                className="input"
                value={waiverReason}
                onChange={(event) => setWaiverReason(event.target.value)}
                maxLength={2000}
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={!waiverReason.trim() || setReview.isPending}
            onClick={() => setReview.mutate({ review_status: 'waived', waiver_reason: waiverReason })}
          >
            Record waiver
          </button>
        </div>
        {setReview.isError && <ErrorState error={setReview.error} />}
      </div>
    </div>
  )
}
