import type { UseQueryResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { AdAccount, Readiness } from '../../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import { READINESS_META, severityTone } from '../../lib/readiness'
import { formatDateTime, formatRelative, humanise } from '../../lib/format'

const FRESHNESS_TEXT: Record<string, string> = {
  current: 'Platform data was synced recently.',
  stale: 'Platform data has not been synced recently; treat figures as historical.',
  unknown:
    'This account has never been synced with an advertising platform. A1 stores operator-entered records only — nothing here was fetched from a platform.',
}

export default function OverviewTab({
  account,
  readiness,
  onChanged,
}: {
  account: AdAccount
  readiness: UseQueryResult<Readiness>
  onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const recordReview = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/ad-accounts/${account.id}/readiness/manual-review`, { note }),
    onSuccess: () => {
      setNote('')
      onChanged()
    },
  })

  const meta = READINESS_META[account.readiness_status]

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Identity and status">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Account name">{account.display_name}</Row>
          <Row label="External account ID">
            <span className="font-mono">{account.external_account_id ?? '—'}</span>
          </Row>
          <Row label="Account type">{humanise(account.account_type)}</Row>
          <Row label="Platform status">{humanise(account.status)}</Row>
          <Row label="Country / currency">
            {[account.country, account.currency].filter(Boolean).join(' / ') || '—'}
          </Row>
          <Row label="Timezone">{account.timezone ?? '—'}</Row>
          <Row label="Tags">{account.tags.length ? account.tags.join(', ') : '—'}</Row>
          <Row label="Created">{formatDateTime(account.created_at)}</Row>
        </dl>
      </Card>

      <Card title="Ownership mapping">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Business Manager">{account.business_manager_name ?? 'Not mapped'}</Row>
          <Row label="Personal reference">
            {account.personal_account_reference_label ?? 'Not mapped'}
          </Row>
          <Row label="Owner label">{account.owner_label || '—'}</Row>
          <Row label="Landing page">
            {account.landing_page_url ? (
              <a
                className="text-brand hover:underline"
                href={account.landing_page_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {account.landing_page_url}
              </a>
            ) : (
              'None assigned'
            )}
          </Row>
          <Row label="Workflow needs">
            {[account.requires_page && 'Page', account.requires_pixel && 'Pixel']
              .filter(Boolean)
              .join(', ') || 'No conditional asset requirement'}
          </Row>
        </dl>
      </Card>

      <Card title="Readiness summary">
        {readiness.isLoading ? (
          <Skeleton rows={4} />
        ) : readiness.isError ? (
          <ErrorState error={readiness.error} onRetry={() => readiness.refetch()} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
              <span className="text-[12px] text-ink-muted">
                {readiness.data!.completed_item_count} of {readiness.data!.required_item_count}{' '}
                required items satisfied
              </span>
            </div>
            <p className="text-[12.5px] text-ink-muted">{meta.description}</p>
            <ul className="space-y-1.5">
              {readiness.data!.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`} className="flex items-start gap-2">
                  <Badge tone={severityTone(reason.severity)}>{reason.severity}</Badge>
                  <span className="text-[12.5px]">{reason.message}</span>
                </li>
              ))}
            </ul>
            <InlineNote>{readiness.data!.disclaimer}</InlineNote>
          </div>
        )}
      </Card>

      <Card title="Manual review and data freshness">
        <dl className="grid grid-cols-[minmax(0,150px)_1fr] gap-y-2 text-[12.5px]">
          <Row label="Last manual review">
            {account.last_manual_review_at
              ? `${formatDateTime(account.last_manual_review_at)} (${formatRelative(account.last_manual_review_at)})`
              : 'Never reviewed'}
          </Row>
          <Row label="Readiness evaluated">{formatDateTime(account.readiness_evaluated_at)}</Row>
          <Row label="Last synced">
            {readiness.data ? humanise(readiness.data.data_freshness.status) : '—'}
          </Row>
        </dl>
        <InlineNote>
          {readiness.data ? FRESHNESS_TEXT[readiness.data.data_freshness.status] : ''}
        </InlineNote>

        {account.archived_at === null && (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              recordReview.mutate()
            }}
          >
            <label className="label" htmlFor="review-note">
              Record a manual review
            </label>
            <textarea
              id="review-note"
              className="input min-h-[64px]"
              placeholder="What did you check, and what did you find?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              required
            />
            {recordReview.isError && <ErrorState error={recordReview.error} />}
            <button type="submit" className="btn-primary" disabled={!note.trim() || recordReview.isPending}>
              {recordReview.isPending ? 'Recording…' : 'Record manual review'}
            </button>
          </form>
        )}
      </Card>

      <Card title="Notes" className="xl:col-span-2">
        <p className="whitespace-pre-wrap text-[12.5px] text-ink-muted">
          {account.notes || 'No notes recorded.'}
        </p>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}
