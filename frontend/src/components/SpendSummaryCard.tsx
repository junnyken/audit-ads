import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SpendFreshness, SpendSummary } from '../lib/types'
import { Badge } from './primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from './primitives/card'
import { Skeleton } from './primitives/skeleton'
import { ErrorState, LoadingRegion } from './states'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { formatCount, formatDay } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'

const ORDER: SpendFreshness[] = ['current', 'stale', 'never_observed', 'not_observable']

function formatCleanMoney(amountRaw?: string | null, currency?: string | null): string {
  if (!amountRaw) return '—'
  const num = Number(amountRaw)
  const curr = (currency || '').toUpperCase()
  if (!Number.isFinite(num)) return `${amountRaw} ${curr}`.trim()
  if (curr === 'VND') {
    return `${Math.round(num).toLocaleString('vi-VN')} ₫`
  }
  if (curr === 'USD') {
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${num.toLocaleString('vi-VN')} ${curr}`.trim()
}

export function SpendFreshnessCounts({ counts }: { counts: SpendSummary['freshness_counts'] }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  return (
    <ul className="flex flex-wrap items-center gap-2" data-testid="spend-freshness-counts">
      {ORDER.map((key) => (
        <li key={key}>
          <Badge tone={SPEND_FRESHNESS_META[key].tone} title={t(`spendFreshnessHint.${key}`)}>
            {`${enumLabel('spendFreshness', key)}: ${formatCount(counts[key] ?? 0)}`}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function SpendSummaryView({ data }: { data: SpendSummary }) {
  const { t, language } = useI18n()

  if (data.currencies.length === 0) {
    return <p className="text-sm text-ink-muted">{t('overview.spend.empty')}</p>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="spend-period-breakdown">
      {data.currencies.map((group) => {
        const latestDayLabel = group.days.map((day) => formatDay(day, language)).join(', ') || 'Gần nhất'
        return (
          <div
            key={group.currency}
            className="rounded-lg border border-line-strong bg-surface-muted/40 p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="font-mono text-sm font-bold text-ink">
                Tiền tệ: {group.currency}
              </span>
              <Badge tone="neutral">
                {t('overview.spend.included', { count: group.accounts_included })}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="font-semibold text-ink-muted">{t('overview.spend.periodToday')}</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-teal-700 dark:text-teal-300">
                  {formatCleanMoney(group.today_partial_raw, group.currency)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">Ngày ({latestDayLabel})</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCleanMoney(group.total_raw, group.currency)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">{t('overview.spend.period7d')}</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-sky-700 dark:text-sky-300">
                  {formatCleanMoney(group.last_7d_raw, group.currency)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">{t('overview.spend.periodMtd')}</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  {formatCleanMoney(group.mtd_raw, group.currency)}
                </dd>
              </div>
            </dl>
          </div>
        )
      })}
    </div>
  )
}

export default function SpendSummaryCard() {
  const { t } = useI18n()
  const summary = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('overview.spend.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.isLoading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-16 w-full" />
          </LoadingRegion>
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} title={t('overview.spend.title')} />
        ) : (
          <SpendSummaryView data={summary.data!} />
        )}
      </CardContent>
    </Card>
  )
}
