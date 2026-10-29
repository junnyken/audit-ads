import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SpendFreshness, SpendSummary } from '../lib/types'
import { Badge } from './primitives/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './primitives/card'
import { Skeleton } from './primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './primitives/table'
import { ErrorState, LoadingRegion, PartialDataNote } from './states'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { formatCount, formatDay } from '../lib/format'
import { rawMoney } from '../lib/spend'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'

const ORDER: SpendFreshness[] = ['current', 'stale', 'never_observed', 'not_observable']

/**
 * How many accounts are in each spend-freshness state. Freshness describes the data, never the
 * account, so no state here is ever success-styled (tones: `SPEND_FRESHNESS_META`).
 */
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

/** One row per observed currency. There is deliberately no cross-currency total. */
export function SpendSummaryView({ data }: { data: SpendSummary }) {
  const { t, language } = useI18n()
  const incompleteCurrencies = data.currencies.filter((group) => !group.complete).map((group) => group.currency)

  return (
    <div className="space-y-3">
      {data.currencies.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('overview.spend.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('overview.spend.colCurrency')}</TableHead>
              <TableHead numeric>{t('overview.spend.colTotal')}</TableHead>
              <TableHead>{t('overview.spend.colDays')}</TableHead>
              <TableHead numeric>{t('overview.spend.colAccounts')}</TableHead>
              <TableHead>{t('overview.spend.colCoverage')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.currencies.map((group) => {
              const reasons = [
                group.accounts_not_current > 0 && t('overview.spend.notCurrent', { count: group.accounts_not_current }),
                group.accounts_without_row > 0 && t('overview.spend.withoutRow', { count: group.accounts_without_row }),
                group.accounts_currency_conflict > 0 &&
                  t('overview.spend.conflict', { count: group.accounts_currency_conflict }),
              ].filter(Boolean)
              return (
                <TableRow key={group.currency}>
                  <TableCell className="font-medium">{group.currency}</TableCell>
                  <TableCell numeric className="font-mono text-sm">
                    {rawMoney(group.total_raw, group.currency)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {group.days.map((day) => formatDay(day, language)).join(', ') || '—'}
                  </TableCell>
                  <TableCell numeric className="text-xs">
                    {t('overview.spend.included', { count: group.accounts_included })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {group.complete ? (
                      <Badge tone="neutral">{t('overview.spend.complete')}</Badge>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="caution">{t('overview.spend.incomplete')}</Badge>
                        <span className="text-ink-muted">{reasons.join(' · ')}</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {data.currencies.some(
        (g) => g.today_partial_raw !== undefined || g.last_7d_raw !== undefined || g.mtd_raw !== undefined,
      ) && (
        <div
          className="rounded-md border border-line bg-surface-muted p-3 space-y-2"
          data-testid="spend-period-breakdown"
        >
          <p className="text-xs font-semibold text-ink">{t('overview.spend.periodTitle')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.currencies.map((group) => (
              <div
                key={group.currency}
                className="rounded border border-line bg-surface p-2.5 text-xs space-y-1.5"
              >
                <div className="font-semibold text-ink">{group.currency}</div>
                <dl className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-2xs text-ink-muted">{t('overview.spend.periodToday')}</dt>
                    <dd className="font-mono font-medium tabular-nums text-ink">
                      {group.today_partial_raw ? rawMoney(group.today_partial_raw, group.currency) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-ink-muted">{t('overview.spend.period7d')}</dt>
                    <dd className="font-mono font-medium tabular-nums text-ink">
                      {group.last_7d_raw ? rawMoney(group.last_7d_raw, group.currency) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-ink-muted">{t('overview.spend.periodMtd')}</dt>
                    <dd className="font-mono font-medium tabular-nums text-ink">
                      {group.mtd_raw ? rawMoney(group.mtd_raw, group.currency) : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.budget_pacing_counts && (
        <div
          className="rounded-md border border-line bg-surface-muted p-3 space-y-2"
          data-testid="spend-budget-pacing-counts"
        >
          <p className="text-xs font-semibold text-ink">{t('sp.pacing.summaryTitle')}</p>
          <ul className="flex flex-wrap items-center gap-2">
            {(
              [
                ['overspending', 'attention'],
                ['approaching_monthly_budget', 'caution'],
                ['underspending', 'caution'],
                ['on_track', 'neutral'],
                ['insufficient_data', 'neutral'],
                ['unconfigured', 'neutral'],
              ] as const
            ).map(([statusKey, tone]) => (
              <li key={statusKey}>
                <Badge tone={tone}>
                  {`${t(`sp.pacing.status.${statusKey}` as never)}: ${formatCount(data.budget_pacing_counts?.[statusKey] ?? 0)}`}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* complete:false is stated, never implied by a number that merely looks final. */}
      {!data.complete && (
        <PartialDataNote>
          {t('overview.spend.overallIncomplete')}
          {incompleteCurrencies.length > 0 && ` (${incompleteCurrencies.join(', ')})`}
        </PartialDataNote>
      )}

      {data.accounts_unattributed > 0 && (
        <p className="text-sm text-ink-muted">
          {t('overview.spend.unattributed', { count: data.accounts_unattributed })}
        </p>
      )}
      <p className="text-xs text-ink-faint">{t('overview.spend.noSum')}</p>
      <p className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        {data.disclaimer}
      </p>
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
      <CardHeader>
        <div>
          <CardTitle>{t('overview.spend.title')}</CardTitle>
          <CardDescription>{t('overview.spend.sub')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {summary.isLoading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
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
