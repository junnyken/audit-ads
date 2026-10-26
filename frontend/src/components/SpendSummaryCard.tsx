import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SpendFreshness, SpendSummary } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from './ui'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { rawMoney } from '../lib/spend'

const ORDER: SpendFreshness[] = ['current', 'stale', 'never_observed', 'not_observable']

/** One row per observed currency. There is deliberately no cross-currency total. */
export function SpendSummaryView({ data }: { data: SpendSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ORDER.map((key) => (
          <Badge key={key} tone={SPEND_FRESHNESS_META[key].tone} title={SPEND_FRESHNESS_META[key].description}>
            {SPEND_FRESHNESS_META[key].label}: {data.freshness_counts[key] ?? 0}
          </Badge>
        ))}
        <Badge tone={data.complete ? 'neutral' : 'caution'}>
          {data.complete ? 'Complete' : 'Incomplete'}
        </Badge>
      </div>

      {data.currencies.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">
          No account has a successful spend read, so there is no figure to show.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Currency</th>
                <th className="th">Latest complete day total (raw)</th>
                <th className="th">Day</th>
                <th className="th">Accounts</th>
                <th className="th">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.currencies.map((group) => (
                <tr key={group.currency}>
                  <td className="td font-medium">{group.currency}</td>
                  <td className="td font-mono text-[12px]">{rawMoney(group.total_raw, group.currency)}</td>
                  <td className="td font-mono text-[12px]">{group.days.join(', ') || '—'}</td>
                  <td className="td text-[12px]">{group.accounts_included} included</td>
                  <td className="td text-[12px]">
                    {group.complete ? (
                      <Badge tone="neutral">Complete</Badge>
                    ) : (
                      <span>
                        <Badge tone="caution">Incomplete</Badge>{' '}
                        <span className="text-ink-muted">
                          {[
                            group.accounts_not_current > 0 && `${group.accounts_not_current} not current`,
                            group.accounts_without_row > 0 && `${group.accounts_without_row} without a row`,
                            group.accounts_currency_conflict > 0 &&
                              `${group.accounts_currency_conflict} currency conflict`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.accounts_unattributed > 0 && (
        <p className="text-[12.5px] text-amber-900">
          {data.accounts_unattributed} account{data.accounts_unattributed === 1 ? '' : 's'} with no
          successful read are not in any currency row.
        </p>
      )}
      <p className="text-[11.5px] text-ink-faint">
        Currencies are never added together; each row is a separate currency.
      </p>
      <InlineNote>{data.disclaimer}</InlineNote>
    </div>
  )
}

export default function SpendSummaryCard() {
  const summary = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return (
    <Card title="Spend (latest complete day)">
      {summary.isLoading ? (
        <Skeleton rows={3} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <SpendSummaryView data={summary.data!} />
      )}
    </Card>
  )
}
