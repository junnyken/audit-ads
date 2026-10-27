import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AdAccount, ChecklistEntry } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Field } from '../../components/primitives/field'
import { EmptyState, ErrorState } from '../../components/states'
import { evidenceTone, itemStateTone, reviewTone } from '../../lib/readiness'
import { formatDateTime } from '../../lib/format'
import { useEnumLabel } from '../../i18n/labels'
import { useI18n } from '../../i18n'
import { Note, Panel, TabSkeleton } from './parts'

export default function ReadinessTab({
  account,
  onChanged,
}: {
  account: AdAccount
  onChanged: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const checklist = useQuery({
    queryKey: ['checklist', account.id],
    queryFn: () => api.get<ChecklistEntry[]>(`/api/v1/ad-accounts/${account.id}/readiness/checklist`),
  })

  if (checklist.isLoading) return <TabSkeleton cards={4} />
  if (checklist.isError) {
    return <ErrorState error={checklist.error} onRetry={() => checklist.refetch()} title={t('rd.error.title')} />
  }

  const entries = checklist.data!
  if (entries.length === 0) {
    return <EmptyState title={t('rd.empty.title')} description={t('rd.empty.body')} />
  }
  const byCategory = entries.reduce<Record<string, ChecklistEntry[]>>((groups, entry) => {
    const key = entry.item.category
    ;(groups[key] ??= []).push(entry)
    return groups
  }, {})

  return (
    <div className="space-y-4">
      <Note>{t('rd.intro')}</Note>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {Object.entries(byCategory).map(([category, items]) => (
          <Panel key={category} title={enumLabel('checklistCategory', category)}>
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
          </Panel>
        ))}
      </div>
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
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [expanded, setExpanded] = useState(false)
  const { item, evaluation, evidence } = entry
  const state = evaluation?.state ?? 'unknown'
  const derived = Boolean(evaluation?.derived_from)
  const editable = account.archived_at === null && !derived && evaluation?.state !== 'not_required'

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.label}</span>
            <Badge tone={itemStateTone(state)}>{enumLabel('itemState', state)}</Badge>
            {evaluation?.required ? (
              <Badge tone="neutral">{item.is_mandatory ? t('rd.mandatory') : t('rd.conditional')}</Badge>
            ) : (
              <Badge tone="muted">{t('rd.notRequired')}</Badge>
            )}
            {derived && <Badge tone="muted">{t('rd.derived')}</Badge>}
            {evaluation?.requires_evidence && <Badge tone="muted">{t('rd.evidenceRequired')}</Badge>}
          </div>
          {/* Sentences below come from the server's readiness engine, shown as sent. */}
          <p className="mt-1 text-sm text-ink-muted">{evaluation?.message}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            <strong>{t('rd.why')}</strong> {evaluation?.requirement_reason}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={reviewTone(item.review_status)}>
              {t('rd.review', { value: enumLabel('reviewStatus', item.review_status) })}
            </Badge>
            <Badge tone={evidenceTone(item.evidence_status)}>
              {t('rd.evidence', { value: enumLabel('evidenceStatus', item.evidence_status) })}
            </Badge>
            {item.expires_at && (
              <span className="text-ink-muted tabular-nums">{t('rd.expires', { time: formatDateTime(item.expires_at) })}</span>
            )}
            {item.reviewed_at && (
              <span className="text-ink-muted tabular-nums">{t('rd.reviewedAt', { time: formatDateTime(item.reviewed_at) })}</span>
            )}
          </div>
          {item.waiver_reason && (
            <Note tone="caution" className="mt-1.5">
              {t('rd.waiver.reason', { reason: item.waiver_reason })}
            </Note>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t('rd.hide') : t('rd.details')}
          <span className="sr-only"> — {item.label}</span>
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-surface-muted p-3">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold">{t('rd.evidenceHeading')}</h3>
            {evidence.length === 0 ? (
              <p className="text-xs text-ink-muted">{t('rd.noEvidence')}</p>
            ) : (
              <ul className="space-y-1.5">
                {evidence.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={evidenceTone(record.status)}>{enumLabel('evidenceStatus', record.status)}</Badge>
                    <span className="min-w-0 break-words">{record.summary}</span>
                    <span className="text-ink-muted tabular-nums">
                      {formatDateTime(record.provided_at)}
                      {record.expires_at ? ` · ${t('rd.expires', { time: formatDateTime(record.expires_at) })}` : ''}
                      {record.archived_at ? ` · ${t('rd.evArchived')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {derived && <Note>{t('rd.derivedNote', { source: evaluation?.derived_from ?? '' })}</Note>}

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
  const { t } = useI18n()
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
          <h3 className="text-xs font-semibold">{t('rd.addEvidence')}</h3>
          <Field label={t('rd.ev.summary')} required>
            <textarea
              className="input min-h-[56px]"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={5000}
              required
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('rd.ev.url')} hint={t('rd.ev.urlHint')}>
              <input className="input" type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} />
            </Field>
            <Field label={t('rd.ev.expires')} hint={t('rd.ev.expiresHint')}>
              <input className="input" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </Field>
          </div>
          {addEvidence.isError && <ErrorState error={addEvidence.error} compact />}
          <Button type="submit" disabled={!summary.trim() || addEvidence.isPending}>
            {addEvidence.isPending ? t('rd.ev.saving') : t('rd.ev.submit')}
          </Button>
        </form>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="text-xs font-semibold">{t('rd.reviewState')}</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReview.mutate({ review_status: 'in_review' })}
            disabled={setReview.isPending}
          >
            {t('rd.markInReview')}
          </Button>
          <Button size="sm" onClick={() => setReview.mutate({ review_status: 'completed' })} disabled={setReview.isPending}>
            {t('rd.markComplete')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReview.mutate({ review_status: 'needs_update' })}
            disabled={setReview.isPending}
          >
            {t('rd.needsUpdate')}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Field label={t('rd.waiver.label')} hint={t('rd.waiver.hint')}>
              <input className="input" value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)} maxLength={2000} />
            </Field>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!waiverReason.trim() || setReview.isPending}
            onClick={() => setReview.mutate({ review_status: 'waived', waiver_reason: waiverReason })}
          >
            {t('rd.waiver.submit')}
          </Button>
        </div>
        {setReview.isError && <ErrorState error={setReview.error} compact />}
      </div>
    </div>
  )
}
