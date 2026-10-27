import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { DiscoveryRunSummary, Paged } from '../../lib/types'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Skeleton } from '../../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion } from '../../components/states'
import { CoverageBadge, edgeLabel, edgeProblem } from '../../components/meta/DiscoverySection'
import { Note } from '../account/parts'

function RunStatusBadge({ status }: { status: DiscoveryRunSummary['status'] }) {
  const label = useEnumLabel()
  const text = label('discRun', status)
  if (status === 'succeeded') return <Badge tone="positive">{text}</Badge>
  if (status === 'succeeded_with_warnings') return <Badge tone="caution">{text}</Badge>
  if (status === 'running') return <Badge tone="neutral">{text}</Badge>
  return <Badge tone="attention">{text}</Badge>
}

/** O3. How a run started, as a badge rather than the raw value. `Scheduled` is neutral on
 * purpose: a run the sweep started is not better or worse than one a person started. */
export function TriggerBadge({ trigger }: { trigger: DiscoveryRunSummary['trigger'] }) {
  const label = useEnumLabel()
  if (trigger === 'manual') return <Badge tone="neutral">{label('trigger', trigger)}</Badge>
  if (trigger === 'scheduled_sweep') return <Badge tone="info">{label('trigger', trigger)}</Badge>
  if (trigger === 'internal_test') return <Badge tone="muted">{label('trigger', trigger)}</Badge>
  return <Badge tone="muted">{trigger}</Badge>
}

/** Every run, newest first — each with the coverage, the authority and the identity that produced
 * it, so two runs that returned different counts can be compared on what they were able to see
 * rather than on the numbers alone.
 *
 * Pure and exported so the wording can be tested without a network. */
export function DiscoveryHistoryList({ runs }: { runs: DiscoveryRunSummary[] }) {
  const { t, language } = useI18n()
  return (
    <div className="space-y-3">
      <Note role="note">{t('hist.note')}</Note>

      <ul aria-label={t('hist.list')} className="space-y-2">
        {runs.map((run) => {
          const edges = {
            ...(run.ad_accounts.coverage.edges ?? {}),
            ...(run.pixels.coverage.edges ?? {}),
          }
          const notCompleted = Object.entries(edges).filter(([, e]) => e.status !== 'completed')
          return (
            <li key={run.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {run.completed_at
                    ? formatDateTime(run.completed_at, language)
                    : run.started_at
                      ? t('hist.started', { time: formatDateTime(run.started_at, language) })
                      : t('hist.timeMissing')}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <RunStatusBadge status={run.status} />
                  <TriggerBadge trigger={run.trigger} />
                  {run.environment === 'fake' && <Badge tone="neutral">{t('meta.fakeData')}</Badge>}
                  {run.business_authority === 'not_established' && (
                    <Badge tone="attention">{t('hist.authorityNot')}</Badge>
                  )}
                </span>
              </div>

              <div className="grid gap-1 text-xs sm:grid-cols-2">
                <span className="flex items-center gap-2">
                  <span className="text-ink-muted">
                    {t('hist.adAccounts', { n: run.ad_accounts.coverage.total_unique_assets ?? '—' })}
                  </span>
                  <CoverageBadge status={run.ad_accounts.coverage_status} />
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-muted">
                    {t('hist.pixels', { n: run.pixels.coverage.total_unique_assets ?? '—' })}
                  </span>
                  <CoverageBadge status={run.pixels.coverage_status} />
                </span>
              </div>

              {notCompleted.length > 0 && (
                <p className="mt-1 text-xs text-tone-caution-fg">
                  {t('hist.notCompleted', {
                    list: notCompleted
                      .map(([name, e]) => `${edgeLabel(t, name)} (${edgeProblem(t, e.status, e.error_code)})`)
                      .join(', '),
                  })}
                </p>
              )}
              {run.auto_import && (
                <p className="mt-1 text-xs text-ink-muted">
                  {t('hist.imported', { n: run.auto_import.imported })}
                  {run.auto_import.awaiting_import > 0 && t('hist.awaiting', { n: run.auto_import.awaiting_import })}
                  {run.auto_import.archived_returned > 0 &&
                    t('hist.archivedReturned', { n: run.auto_import.archived_returned })}
                  {run.auto_import.conflicts > 0 && t('hist.conflicts', { n: run.auto_import.conflicts })}
                </p>
              )}
              {run.failure_code && (
                <p className="mt-1 text-xs text-tone-attention-fg">
                  {t('disc.failure', { summary: run.failure_summary ?? t('disc.runFailed'), code: run.failure_code })}
                </p>
              )}
              <p className="mt-1 text-2xs text-ink-faint">
                {t('hist.bmRead', {
                  bm: run.business_manager.name ?? run.business_manager.reference ?? t('meta.notConfigured'),
                  who: run.read_as.name || run.read_as.external_id || t('meta.unknownIdentity'),
                })}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function HistoryTab({ connectionId }: { connectionId: string }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const history = useQuery({
    queryKey: ['meta-discovery-history', connectionId, page],
    queryFn: () =>
      api.get<Paged<DiscoveryRunSummary>>(
        `/api/v1/meta-connections/${connectionId}/discoveries?page=${page}&page_size=10`,
      ),
  })

  if (history.isLoading) {
    return (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </LoadingRegion>
    )
  }
  if (history.isError) return <ErrorState title={t('hist.error')} error={history.error} onRetry={() => history.refetch()} />

  const data = history.data!
  if (data.total === 0) {
    return <EmptyState title={t('hist.empty.title')} description={t('hist.empty.body')} />
  }

  const totalPages = data.total_pages || 1
  return (
    <div className="space-y-3">
      <DiscoveryHistoryList runs={data.items} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">
          {t('common.page', { page: data.page, total: totalPages })} · {t('hist.runs', { n: data.total })}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.prev')}
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
