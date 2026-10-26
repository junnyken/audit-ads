import type { UseQueryResult } from '@tanstack/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { AccountStatus, AdAccount, ImportProvenance, Readiness, SpendView } from '../../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import PlatformStatusBadge from '../../components/PlatformStatusBadge'
import { READINESS_META, accountStatusTone, severityTone } from '../../lib/readiness'
import { disableReasonText, platformStatusBadge, recordedStatusSuggestion } from '../../lib/platformStatus'
import { formatDateTime, formatRelative, humanise } from '../../lib/format'
import { useAuth } from '../../hooks/useAuth'

const FRESHNESS_TEXT: Record<string, string> = {
  current: 'Platform data was synced recently.',
  stale: 'Platform data has not been synced recently; treat figures as historical.',
  unknown:
    'This account has never been synced with an advertising platform. A1 stores operator-entered records only — nothing here was fetched from a platform.',
}

/** The `unknown` sentence above was written when every record in A1 was typed by hand, and A10.3's
 * registry import made half of it false: an imported account's name and external id *were* fetched
 * from a platform, by a read-only discovery. "Never synced" stays true — no figures or platform
 * status have been pulled — which is why the wrong half survived: the sentence is half right.
 *
 * So the claim is made per record rather than per freshness status. Seen on a real screen on
 * 2026-09-14 under an imported account. */
export function freshnessText(status: string, imported: ImportProvenance | null | undefined): string {
  if (status !== 'unknown' || !imported) return FRESHNESS_TEXT[status] ?? ''
  return (
    'This account has never been synced with an advertising platform — no figures or platform ' +
    'status have been fetched for it. Its name and external ID came from a read-only discovery ' +
    'of the Business Manager below, which is the only thing that was read.'
  )
}

export default function OverviewTab({
  account,
  readiness,
  onChanged,
  onRecordMetaStatus,
  onOpenSpend,
}: {
  account: AdAccount
  readiness: UseQueryResult<Readiness>
  onChanged: () => void
  /** S2: opens the existing edit drawer, optionally pre-selecting a recorded status. Never saves. */
  onRecordMetaStatus?: (status: AccountStatus | null, note: string) => void
  onOpenSpend?: () => void
}) {
  const { user } = useAuth()
  const canRecord = user?.role === 'owner' || user?.role === 'admin'
  // S2: the full platform-status block lives on the spend view (stored observations only).
  const spend = useQuery({
    queryKey: ['spend', account.id],
    queryFn: () => api.get<SpendView>(`/api/v1/ad-accounts/${account.id}/spend`),
  })
  const platform = spend.data?.platform_status ?? null
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
          <Row label="Recorded status">
            <Badge tone={accountStatusTone(account.status)}>{humanise(account.status)}</Badge>
          </Row>
          <Row label="Meta status">
            {spend.isLoading ? (
              <span className="text-ink-faint">…</span>
            ) : spend.isError ? (
              <span className="text-ink-faint">Could not load</span>
            ) : (
              <PlatformStatusBadge value={platform} inline />
            )}
          </Row>
          {platform && (
            <>
              <Row label="Disable reason">
                <span className="font-mono text-[12px]">
                  {disableReasonText(platform.disable_reason, platform.disable_reason_raw)}
                </span>
              </Row>
              <Row label="Observed at">
                {formatDateTime(platform.observed_at)}
                {platform.observation_status === 'failed' && (
                  <span className="text-ink-muted">
                    {' '}
                    · the spend read failed ({platform.failure_code ?? 'unknown'}); the account
                    node still answered
                  </span>
                )}
                {platform.previous?.account_status_raw && (
                  <span className="block text-[11.5px] text-ink-faint">
                    Before: code {platform.previous.account_status_raw} at{' '}
                    {formatDateTime(platform.previous.observed_at)}
                  </span>
                )}
              </Row>
            </>
          )}
          {spend.data && spend.data.latest_attempt?.status === 'failed' && platform && (
            <Row label="Latest read">
              <span className="text-ink-muted">
                Failed ({spend.data.latest_attempt.failure_code ?? 'unknown'}) at{' '}
                {formatDateTime(spend.data.latest_attempt.observed_at)} — the status above is the
                last one Meta returned.
              </span>
            </Row>
          )}
          <Row label="Country / currency">
            {[account.country, account.currency].filter(Boolean).join(' / ') || '—'}
          </Row>
          <Row label="Timezone">{account.timezone ?? '—'}</Row>
          <Row label="Tags">{account.tags.length ? account.tags.join(', ') : '—'}</Row>
          <Row label="Created">{formatDateTime(account.created_at)}</Row>
        </dl>
        {platform && <InlineNote>{platform.disclaimer}</InlineNote>}
        <div className="mt-2 flex flex-wrap gap-2">
          {onOpenSpend && (
            <button type="button" className="btn-ghost" onClick={onOpenSpend}>
              Status history (Spend tab)
            </button>
          )}
          {canRecord && account.archived_at === null && platform && onRecordMetaStatus && (
            <button
              type="button"
              className="btn-secondary"
              title="Opens the edit form. Nothing is saved until you press Save."
              onClick={() =>
                onRecordMetaStatus(
                  recordedStatusSuggestion(platform.status),
                  `Meta returned account_status ${platform.account_status_raw} (${
                    platformStatusBadge(platform).label
                  }) at ${formatDateTime(platform.observed_at)}. Check it in Ads Manager, then choose the recorded status yourself.`,
                )
              }
            >
              Record Meta status in the registry
            </button>
          )}
        </div>
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
          {readiness.data
            ? freshnessText(readiness.data.data_freshness.status, account.imported_from_discovery)
            : ''}
        </InlineNote>
        {account.imported_from_discovery && (
          // Provenance was always in the Audit History tab, behind a raw action name and a JSON
          // blob. Saying it here costs one sentence and answers the question an operator actually
          // has in front of the record: where did this come from?
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Added to the registry from a read-only discovery of Business Manager{' '}
            <span className="font-mono">
              {account.imported_from_discovery.business_manager_reference ?? 'not recorded'}
            </span>
            {account.imported_from_discovery.source_edge
              ? `, returned by ${account.imported_from_discovery.source_edge}`
              : ''}
            {account.imported_from_discovery.imported_at
              ? ` on ${formatDateTime(account.imported_from_discovery.imported_at)}`
              : ''}
            . Nothing in Meta was created or changed by that import.
          </p>
        )}

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
