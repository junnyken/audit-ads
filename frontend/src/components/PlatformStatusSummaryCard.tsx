import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { PlatformStatusClass, SpendSummary } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from './ui'
import { PLATFORM_STATUS_CLASS_META } from '../lib/platformStatus'

const ORDER: PlatformStatusClass[] = ['blocking', 'pending', 'unknown', 'none', 'active']

/** S2: how many accounts are in each Meta-status class. Counts only — never a score, never green. */
export function PlatformStatusSummaryView({ data }: { data: SpendSummary }) {
  const counts = data.platform_status_counts
  if (!counts) {
    return <p className="text-[12.5px] text-ink-muted">This server does not report Meta account status yet.</p>
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-testid="platform-status-counts">
        {ORDER.map((key) => (
          <Badge key={key} tone={PLATFORM_STATUS_CLASS_META[key].tone}>
            {PLATFORM_STATUS_CLASS_META[key].label}: {counts[key] ?? 0}
          </Badge>
        ))}
      </div>
      <p className="text-[12px] text-ink-muted">
        From the latest account_status code Meta returned for each account. “Not observed” means no
        read has carried a status code. Open{' '}
        <Link to="/accounts" className="text-brand hover:underline">
          Accounts
        </Link>{' '}
        to see which.
      </p>
      <InlineNote>
        Codes as Meta returned them, at the time of each read. Not a decision of this product, and not
        a substitute for checking in Ads Manager.
      </InlineNote>
    </div>
  )
}

export default function PlatformStatusSummaryCard() {
  const summary = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return (
    <Card title="Meta account status">
      {summary.isLoading ? (
        <Skeleton rows={2} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <PlatformStatusSummaryView data={summary.data!} />
      )}
    </Card>
  )
}
