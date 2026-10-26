import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../../lib/api'
import type { AdAccount, Paged, SpendObservation, SpendView } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import { SPEND_FRESHNESS_META } from '../../lib/readiness'
import { rawMoney, refreshErrorMessage } from '../../lib/spend'
import { formatDateTime } from '../../lib/format'
import { useAuth } from '../../hooks/useAuth'

export default function SpendTab({ account }: { account: AdAccount }) {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const archived = account.archived_at !== null

  const spend = useQuery({
    queryKey: ['spend', account.id],
    queryFn: () => api.get<SpendView>(`/api/v1/ad-accounts/${account.id}/spend`),
  })
  const history = useQuery({
    queryKey: ['spend-observations', account.id, page],
    queryFn: () =>
      api.get<Paged<SpendObservation>>(
        `/api/v1/ad-accounts/${account.id}/spend/observations${query({ page, page_size: 10 })}`,
      ),
  })

  const refresh = useMutation({
    mutationFn: () => api.post<SpendView>(`/api/v1/ad-accounts/${account.id}/spend/refresh`),
    onSuccess: (view) => {
      queryClient.setQueryData(['spend', account.id], view)
      void queryClient.invalidateQueries({ queryKey: ['spend-observations', account.id] })
      void queryClient.invalidateQueries({ queryKey: ['spend-summary'] })
      // The refresh runs a health evaluation, so health views are now out of date.
      void queryClient.invalidateQueries({ queryKey: ['health', account.id] })
      void queryClient.invalidateQueries({ queryKey: ['health-signals', account.id] })
      void queryClient.invalidateQueries({ queryKey: ['account-health'] })
      void queryClient.invalidateQueries({ queryKey: ['health-summary'] })
    },
  })

  if (spend.isLoading) return <Skeleton rows={6} />
  if (spend.isError) return <ErrorState error={spend.error} onRetry={() => spend.refetch()} />

  const data = spend.data!
  const meta = SPEND_FRESHNESS_META[data.freshness]
  const obs = data.latest_observation
  const attempt = data.latest_attempt
  const refreshedFailed = refresh.isSuccess && refresh.data.latest_attempt?.status === 'failed'

  return (
    <div className="space-y-4">
      <Card
        title="Spend freshness"
        action={
          isOwner ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || archived}
              title={archived ? 'Archived accounts cannot be refreshed.' : undefined}
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh'}
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} title={meta.description}>
            {meta.label}
          </Badge>
          {data.reader_source && (
            <span className="text-[12px] text-ink-muted">Read via: {data.reader_source}</span>
          )}
          <span className="text-[12px] text-ink-muted">
            Fresh for {data.stale_after_hours} hours after a successful read
          </span>
        </div>
        <p className="mt-2 text-[12.5px] text-ink-muted">{meta.description}</p>

        {refresh.isError && (
          <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            {refreshErrorMessage(refresh.error)}
          </p>
        )}
        {refreshedFailed && (
          <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            The refresh was recorded as failed ({refresh.data.latest_attempt?.failure_code ?? 'unknown'}
            {refresh.data.latest_attempt?.failure_summary
              ? `: ${refresh.data.latest_attempt.failure_summary}`
              : ''}
            ). The figures below are from the last successful read.
          </p>
        )}

        {attempt?.status === 'failed' && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            <strong>Latest attempt failed</strong> · {formatDateTime(attempt.observed_at)}
            <div>
              <span className="font-mono">{attempt.failure_code ?? 'unknown'}</span>
              {attempt.failure_summary ? ` — ${attempt.failure_summary}` : ''}
            </div>
          </div>
        )}

        {data.currency_mismatch === true && (
          <p className="mt-3 text-[12.5px] text-amber-900">
            Currency differs: registry {data.registry_currency ?? '—'} vs observed{' '}
            {data.observed_currency ?? '—'}.
          </p>
        )}
        {data.insights_currency_conflict && (
          <p className="mt-1 text-[12.5px] text-amber-900">
            The daily rows carry contradictory currencies.
          </p>
        )}
        {data.missing_input && (
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Missing input: <span className="font-mono">{data.missing_input}</span>
          </p>
        )}
        <InlineNote>{data.disclaimer}</InlineNote>
      </Card>

      {!obs ? (
        <EmptyState
          title="No successful spend read yet"
          description={
            data.freshness === 'not_observable'
              ? 'No connection can read this account.'
              : 'Nothing has been read from Meta for this account, so no figure is shown.'
          }
        />
      ) : (
        <>
          <Card title="Latest observation">
            <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2 xl:grid-cols-3">
              <Item label="Observed at" value={formatDateTime(obs.observed_at)} />
              <Item label="Currency" value={obs.currency ?? '—'} />
              <Item label="Timezone" value={obs.timezone_name ?? '—'} />
              <Item label="Amount spent (raw)" value={rawMoney(obs.amount_spent_raw, obs.currency)} mono />
              <Item label="Spend cap (raw)" value={rawMoney(obs.spend_cap_raw, obs.currency)} mono />
              <Item label="Balance (raw)" value={rawMoney(obs.balance_raw, obs.currency)} mono />
            </dl>
            <p className="mt-2 text-[11.5px] text-ink-faint">
              These three values are shown exactly as Meta returned them; their units are not
              verified.
            </p>
          </Card>

          <Card title="Daily spend (complete days)">
            <p className="mb-2 text-[12px] text-ink-muted">
              Latest complete day: {data.latest_complete_day ?? '—'}
            </p>
            {data.latest_complete_day === null ? (
              <p className="text-[12.5px] text-ink-muted">
                No complete day can be determined
                {data.missing_input ? ` (missing ${data.missing_input})` : ''}.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="w-full border-collapse">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="th">Date</th>
                      <th className="th">Spend (raw)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...data.daily.map((d) => ({ date: d.date, raw: d.spend_raw as string | null, cur: d.currency })),
                      ...data.days_without_row.map((date) => ({ date, raw: null, cur: null })),
                    ]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((row) => (
                        <tr key={row.date}>
                          <td className="td font-mono text-[12px]">{row.date}</td>
                          <td
                            className="td font-mono text-[12px]"
                            title={row.raw === null ? 'Meta returned no row for this day' : undefined}
                          >
                            {row.raw === null ? '—' : rawMoney(row.raw, row.cur)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.days_without_row.length > 0 && (
              <p className="mt-2 text-[11.5px] text-ink-faint">
                “—” means Meta returned no row for that day. It is not zero.
              </p>
            )}
            {data.today_partial && (
              <div className="mt-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-[12.5px]">
                <Badge tone="info">Incomplete day</Badge>{' '}
                <span className="font-mono">{data.today_partial.date}</span> ·{' '}
                <span className="font-mono">
                  {rawMoney(data.today_partial.spend_raw, data.today_partial.currency)}
                </span>
                <span className="text-ink-muted"> — still running, not used by any rule.</span>
              </div>
            )}
          </Card>

          <Card title="Baseline">
            {data.baseline ? (
              <p className="text-[12.5px]">
                Median of {data.baseline.days_used.length} earlier complete days:{' '}
                <span className="font-mono">{rawMoney(data.baseline.median_raw, data.baseline.currency)}</span>
              </p>
            ) : (
              <p className="text-[12.5px] text-ink-muted">
                No baseline yet: {data.baseline_days_available} earlier complete day
                {data.baseline_days_available === 1 ? '' : 's'} with a row — not enough to
                compute a baseline.
              </p>
            )}
          </Card>
        </>
      )}

      <Card title="Observation history">
        {history.isLoading ? (
          <Skeleton rows={3} />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : history.data!.items.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">No observation has been recorded.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full border-collapse">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className="th">Observed at</th>
                    <th className="th">Result</th>
                    <th className="th">Trigger</th>
                    <th className="th">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data!.items.map((item) => (
                    <tr key={item.id}>
                      <td className="td whitespace-nowrap text-[12px]">{formatDateTime(item.observed_at)}</td>
                      <td className="td">
                        <Badge tone={item.status === 'failed' ? 'attention' : 'neutral'}>
                          {item.status === 'failed' ? 'Failed' : 'Read'}
                        </Badge>
                      </td>
                      <td className="td text-[12px]">{item.trigger.replace(/_/g, ' ')}</td>
                      <td className="td text-[12px]">
                        {item.status === 'failed' ? (
                          <>
                            <span className="font-mono">{item.failure_code ?? 'unknown'}</span>
                            {item.failure_summary ? ` — ${item.failure_summary}` : ''}
                          </>
                        ) : (
                          `${item.daily.length} daily row${item.daily.length === 1 ? '' : 's'}`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[12px] text-ink-muted">
                Page {history.data!.page} of {history.data!.total_pages || 1}
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page >= (history.data!.total_pages || 1)}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function Item({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{value}</dd>
    </div>
  )
}
