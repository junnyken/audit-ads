import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { DiscoveryRunSummary, Paged } from '../../lib/types'
import { Badge, EmptyState, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import { CoverageBadge, edgeLabel } from '../../components/meta/DiscoverySection'

function RunStatusBadge({ status }: { status: DiscoveryRunSummary['status'] }) {
  if (status === 'succeeded') return <Badge tone="positive">Succeeded</Badge>
  if (status === 'succeeded_with_warnings') return <Badge tone="caution">Succeeded with warnings</Badge>
  if (status === 'running') return <Badge tone="neutral">Running</Badge>
  return <Badge tone="attention">Failed</Badge>
}

/** Every run, newest first — each with the coverage, the authority and the identity that produced
 * it, so two runs that returned different counts can be compared on what they were able to see
 * rather than on the numbers alone.
 *
 * Pure and exported so the wording can be tested without a network. */
export function DiscoveryHistoryList({ runs }: { runs: DiscoveryRunSummary[] }) {
  return (
    <div className="space-y-3">
      <InlineNote>
        Reconciliation against the registry is deliberately not shown here. It is recomputed
        against the registry as it is <strong>now</strong>, so pinning it to an older reading would
        put two different moments side by side. Each row states what that run itself saw.
      </InlineNote>

      <ul className="space-y-2">
        {runs.map((run) => {
          const edges = {
            ...(run.ad_accounts.coverage.edges ?? {}),
            ...(run.pixels.coverage.edges ?? {}),
          }
          const notCompleted = Object.entries(edges).filter(([, e]) => e.status !== 'completed')
          return (
            <li key={run.id} className="rounded-md border border-line p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium">
                  {run.completed_at
                    ? formatDateTime(run.completed_at)
                    : run.started_at
                      ? `Started ${formatDateTime(run.started_at)}`
                      : 'Time not recorded'}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <RunStatusBadge status={run.status} />
                  {run.environment === 'fake' && <Badge tone="neutral">Fake data</Badge>}
                  {run.business_authority === 'not_established' && (
                    <Badge tone="attention">Access to the Business Manager not established</Badge>
                  )}
                </span>
              </div>

              <div className="grid gap-1 text-[12px] sm:grid-cols-2">
                <span className="flex items-center gap-2">
                  <span className="text-ink-muted">
                    Ad accounts: {run.ad_accounts.coverage.total_unique_assets ?? '—'}
                  </span>
                  <CoverageBadge status={run.ad_accounts.coverage_status} />
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-muted">
                    Pixels: {run.pixels.coverage.total_unique_assets ?? '—'}
                  </span>
                  <CoverageBadge status={run.pixels.coverage_status} />
                </span>
              </div>

              {notCompleted.length > 0 && (
                <p className="mt-1 text-[11.5px] text-amber-700">
                  Not completed:{' '}
                  {notCompleted
                    .map(([name, e]) => `${edgeLabel(name)} (${e.error_code ?? e.status.replace('_', ' ')})`)
                    .join(', ')}
                </p>
              )}
              {run.failure_code && (
                <p className="mt-1 text-[11.5px] text-rose-700">
                  {run.failure_summary ?? 'The run did not complete.'} ({run.failure_code})
                </p>
              )}
              <p className="mt-1 text-[11px] text-ink-faint">
                Business Manager {run.business_manager.name ?? run.business_manager.reference ?? 'not configured'} · read
                as {run.read_as.name || run.read_as.external_id || 'an unknown identity'} · {run.trigger}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function HistoryTab({ connectionId }: { connectionId: string }) {
  const [page, setPage] = useState(1)
  const history = useQuery({
    queryKey: ['meta-discovery-history', connectionId, page],
    queryFn: () =>
      api.get<Paged<DiscoveryRunSummary>>(
        `/api/v1/meta-connections/${connectionId}/discoveries?page=${page}&page_size=10`,
      ),
  })

  if (history.isLoading) return <Skeleton rows={5} />
  if (history.isError) return <ErrorState error={history.error} onRetry={() => history.refetch()} />

  const data = history.data!
  if (data.total === 0) {
    return (
      <EmptyState
        title="No discovery has been run for this connection yet"
        description="Run one from the Overview tab. Discovery only reads; nothing in Meta is created, shared or changed."
      />
    )
  }

  return (
    <div className="space-y-3">
      <DiscoveryHistoryList runs={data.items} />

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">
          Page {data.page} of {data.total_pages || 1} · {data.total} run{data.total === 1 ? '' : 's'}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= (data.total_pages || 1)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
