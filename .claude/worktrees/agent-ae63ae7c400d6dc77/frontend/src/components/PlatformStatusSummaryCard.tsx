import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { PlatformStatusClass, SpendSummary } from '../lib/types'
import { Badge } from './primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from './primitives/card'
import { Skeleton } from './primitives/skeleton'
import { ErrorState, LoadingRegion } from './states'
import { PLATFORM_STATUS_CLASS_META } from '../lib/platformStatus'
import { formatCount } from '../lib/format'
import { useI18n } from '../i18n'

const ORDER: PlatformStatusClass[] = ['blocking', 'pending', 'unknown', 'none', 'active']

/** S2: how many accounts are in each Meta-status class. Counts only — never a score, never green. */
export function PlatformStatusSummaryView({ data }: { data: SpendSummary }) {
  const { t } = useI18n()
  const counts = data.platform_status_counts
  if (!counts) {
    return <p className="text-sm text-ink-muted">{t('overview.meta.unsupported')}</p>
  }
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-2" data-testid="platform-status-counts">
        {ORDER.map((key) => (
          <li key={key}>
            <Badge tone={PLATFORM_STATUS_CLASS_META[key].tone}>
              {`${t(`platformClass.${key}`)}: ${formatCount(counts[key] ?? 0)}`}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        {t('overview.meta.help')}{' '}
        <Link to="/accounts" className="text-brand-text hover:underline">
          {t('nav.item.accounts')}
        </Link>
        .
      </p>
      <p className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        {t('overview.meta.note')}
      </p>
    </div>
  )
}

export default function PlatformStatusSummaryCard() {
  const { t } = useI18n()
  const summary = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.meta.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.isLoading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </LoadingRegion>
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} title={t('overview.meta.title')} />
        ) : (
          <PlatformStatusSummaryView data={summary.data!} />
        )}
      </CardContent>
    </Card>
  )
}
