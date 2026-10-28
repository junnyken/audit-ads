import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api, query } from '../../lib/api'
import type { AdAccount, Paged, SpendObservation, SpendView } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/primitives/table'
import { EmptyState, ErrorState, PartialDataNote } from '../../components/states'
import { SPEND_FRESHNESS_META } from '../../lib/readiness'
import { rawMoney, refreshErrorMessage } from '../../lib/spend'
import { formatDateTime, formatDay } from '../../lib/format'
import { useEnumLabel } from '../../i18n/labels'
import { useI18n } from '../../i18n'
import { useAuth } from '../../hooks/useAuth'
import { NotObservableReason } from '../../components/meta/NotObservableReason'
import { readerSourceLabel } from '../../lib/metaReaders'
import { DisabledReason, Note, Panel, TabSkeleton } from './parts'
import { BudgetPacingPanel } from '../../components/spend/BudgetPacingPanel'

export default function SpendTab({ account }: { account: AdAccount }) {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
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

  if (spend.isLoading) return <TabSkeleton cards={3} />
  if (spend.isError) return <ErrorState error={spend.error} onRetry={() => spend.refetch()} title={t('sp.error.title')} />

  const data = spend.data!
  const meta = SPEND_FRESHNESS_META[data.freshness]
  const obs = data.latest_observation
  const attempt = data.latest_attempt
  const refreshedFailed = refresh.isSuccess && refresh.data.latest_attempt?.status === 'failed'
  const refreshedOk = refresh.isSuccess && !refreshedFailed
  const refuseReason = !isOwner ? t('sp.refresh.ownerOnly') : archived ? t('sp.refresh.archived') : null

  const refreshButton = (
    <DisabledReason reason={refuseReason} id="spend-refresh-reason">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending || refuseReason !== null}
      >
        <RefreshCw className={refresh.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
        {refresh.isPending ? t('sp.refresh.working') : t('sp.refresh')}
      </Button>
    </DisabledReason>
  )

  // Only meaningful once a successful read exists; an account never read has no daily rows.
  const days = !obs ? [] : [
    ...data.daily.map((d) => ({ date: d.date, raw: d.spend_raw as string | null, cur: d.currency })),
    ...data.days_without_row.map((date) => ({ date, raw: null, cur: null })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="space-y-4">
      <Panel title={t('sp.freshness.title')} action={refreshButton}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} title={t(`spendFreshnessHint.${data.freshness}`)}>
            {enumLabel('spendFreshness', data.freshness)}
          </Badge>
          {readerSourceLabel(data.reader_source, language) && (
            <span className="text-xs text-ink-muted">
              {t('sp.readVia')} {readerSourceLabel(data.reader_source, language)}
            </span>
          )}
          <span className="text-xs text-ink-muted">{t('sp.freshFor', { hours: data.stale_after_hours })}</span>
        </div>
        <p className="text-sm text-ink-muted">{t(`spendFreshnessHint.${data.freshness}`)}</p>
        {!data.observable && <NotObservableReason reason={data.not_observable_reason} />}

        {refresh.isError && (
          <Note role="alert" tone="attention">
            {refreshErrorMessage(refresh.error)}
          </Note>
        )}
        {refreshedFailed && (
          <Note role="alert" tone="attention">
            {t('sp.refresh.failed', {
              code: refresh.data.latest_attempt?.failure_code ?? t('common.unknownCode'),
              detail: refresh.data.latest_attempt?.failure_summary ? `: ${refresh.data.latest_attempt.failure_summary}` : '',
            })}
          </Note>
        )}
        {refreshedOk && (
          // Read-back (skill 6.4): what the server now holds, not just "done".
          <Note role="status" tone="info">
            {t('sp.refresh.readback', {
              time: formatDateTime(refresh.data.latest_observation?.observed_at),
              state: enumLabel('spendFreshness', refresh.data.freshness),
            })}
          </Note>
        )}

        {attempt?.status === 'failed' && (
          <Note tone="attention">
            <strong>{t('sp.attemptFailed')}</strong> · <span className="tabular-nums">{formatDateTime(attempt.observed_at)}</span>
            <span className="block">
              <span className="font-mono">{attempt.failure_code ?? t('common.unknownCode')}</span>
              {attempt.failure_summary ? ` — ${attempt.failure_summary}` : ''}
            </span>
            {obs && <span className="block">{t('sp.attemptFailed.older')}</span>}
          </Note>
        )}

        {data.currency_mismatch === true && (
          <Note tone="caution">
            {t('sp.currencyDiffers', { registry: data.registry_currency ?? '—', observed: data.observed_currency ?? '—' })}
          </Note>
        )}
        {data.insights_currency_conflict && <Note tone="caution">{t('sp.currencyConflict')}</Note>}
        {data.missing_input && (
          <p className="text-sm text-ink-muted">
            {t('sp.missingInput')} <span className="font-mono">{data.missing_input}</span>
          </p>
        )}
        <Note>{data.disclaimer}</Note>
      </Panel>

      <BudgetPacingPanel account={account} spend={data} />

      {!obs ? (
        <EmptyState
          title={t('sp.empty.title')}
          description={data.freshness === 'not_observable' ? t('sp.empty.notObservable') : t('sp.empty.never')}
          action={
            data.freshness === 'not_observable' ? (
              <Button asChild variant="secondary" size="sm">
                <Link to="/meta-connections">{t('sp.empty.openConnections')}</Link>
              </Button>
            ) : (
              <span className="text-sm text-ink-muted">
                {isOwner && !archived ? t('sp.empty.pressRefresh') : t('sp.empty.askOwner')}
              </span>
            )
          }
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Panel title={t('sp.latest.title')}>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Item label={t('sp.observedAt')} value={formatDateTime(obs.observed_at)} />
              <Item label={t('sp.currency')} value={obs.currency ?? '—'} />
              <Item label={t('sp.timezone')} value={obs.timezone_name ?? '—'} />
              <Item label={t('sp.amountSpent')} value={rawMoney(obs.amount_spent_raw, obs.currency)} money />
              <Item label={t('sp.spendCap')} value={rawMoney(obs.spend_cap_raw, obs.currency)} money />
              <Item label={t('sp.balance')} value={rawMoney(obs.balance_raw, obs.currency)} money />
            </dl>
            <p className="text-xs text-ink-muted">{t('sp.latest.note')}</p>
          </Panel>

          <Panel title={t('sp.baseline.title')}>
            {data.baseline ? (
              <p className="text-sm">
                {t('sp.baseline.median', { count: data.baseline.days_used.length })}{' '}
                <span className="font-mono tabular-nums">{rawMoney(data.baseline.median_raw, data.baseline.currency)}</span>
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{t('sp.baseline.none', { count: data.baseline_days_available })}</p>
            )}
          </Panel>

          <Panel title={t('sp.daily.title')} className="xl:col-span-2">
            <p className="text-xs text-ink-muted">
              {t('sp.daily.latest', { day: data.latest_complete_day ? formatDay(data.latest_complete_day) : '—' })}
            </p>
            {data.latest_complete_day === null ? (
              <p className="text-sm text-ink-muted">
                {t('sp.daily.none')}
                {data.missing_input ? ` ${t('sp.daily.noneMissing', { input: data.missing_input })}` : ''}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sp.col.date')}</TableHead>
                    <TableHead numeric>{t('sp.col.spend')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((row) => (
                    <TableRow key={row.date}>
                      <TableCell className="font-mono text-xs">{formatDay(row.date)}</TableCell>
                      <TableCell numeric className="font-mono text-xs">
                        {row.raw === null ? (
                          <span title={t('sp.noRow')}>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{t('sp.noRow')}</span>
                          </span>
                        ) : (
                          rawMoney(row.raw, row.cur)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {data.days_without_row.length > 0 && (
              <>
                <PartialDataNote>{t('sp.daily.partial', { count: data.days_without_row.length })}</PartialDataNote>
                <p className="text-xs text-ink-muted">{t('sp.daily.dashNote')}</p>
              </>
            )}
            {data.today_partial && (
              <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm">
                <Badge tone="info">{t('sp.today.badge')}</Badge>{' '}
                <span className="font-mono tabular-nums">{formatDay(data.today_partial.date)}</span> ·{' '}
                <span className="font-mono tabular-nums">
                  {rawMoney(data.today_partial.spend_raw, data.today_partial.currency)}
                </span>
                <span className="text-ink-muted"> — {t('sp.today.note')}</span>
              </div>
            )}
          </Panel>
        </div>
      )}

      <Panel title={t('sp.history.title')}>
        {history.isLoading ? (
          <TabSkeleton cards={1} />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} title={t('sp.history.error')} compact />
        ) : history.data!.items.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('sp.history.empty')}</p>
        ) : (
          <>
            <Table cards>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sp.col.observedAt')}</TableHead>
                  <TableHead>{t('sp.col.result')}</TableHead>
                  <TableHead>{t('sp.col.trigger')}</TableHead>
                  <TableHead title={t('sp.col.statusCodeHint')}>{t('sp.col.statusCode')}</TableHead>
                  <TableHead>{t('sp.col.detail')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data!.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell label={t('sp.col.observedAt')} className="whitespace-nowrap text-xs tabular-nums">
                      {formatDateTime(item.observed_at)}
                    </TableCell>
                    <TableCell label={t('sp.col.result')}>
                      <Badge tone={item.status === 'failed' ? 'attention' : 'neutral'}>
                        {item.status === 'failed' ? t('sp.result.failed') : t('sp.result.read')}
                      </Badge>
                    </TableCell>
                    <TableCell label={t('sp.col.trigger')} className="text-xs">
                      {enumLabel('obsTrigger', item.trigger)}
                    </TableCell>
                    <TableCell label={t('sp.col.statusCode')} className="text-xs">
                      {item.account_status_raw === null ? (
                        <span title={t('sp.noStatus')}>
                          <span aria-hidden="true" className="text-ink-faint" data-testid="history-status-code">
                            —
                          </span>
                          <span className="sr-only">{t('sp.noStatus')}</span>
                        </span>
                      ) : (
                        <span className="font-mono" data-testid="history-status-code">
                          {item.account_status_raw}
                        </span>
                      )}
                    </TableCell>
                    <TableCell label={t('sp.col.detail')} className="text-xs">
                      {item.status === 'failed' ? (
                        <>
                          <span className="font-mono">{item.failure_code ?? t('common.unknownCode')}</span>
                          {item.failure_summary ? ` — ${item.failure_summary}` : ''}
                        </>
                      ) : (
                        t('sp.dailyRows', { count: item.daily.length })
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-muted tabular-nums">
                {t('common.page', { page: history.data!.page, total: history.data!.total_pages || 1 })}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t('common.prev')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= (history.data!.total_pages || 1)}
                  onClick={() => setPage(page + 1)}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

function Item({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={money ? 'font-mono tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
