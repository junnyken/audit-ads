import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type {
  AdAccount,
  AlertSummary,
  AuditEntry,
  HealthSummary,
  Paged,
  ReadinessSummary,
  SpendSummary,
} from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion, NoPermissionState, PartialDataNote } from '../components/states'
import { ChecklistProgress } from '../components/dashboard/ChecklistProgress'
import { SegmentBar, type Segment } from '../components/dashboard/SegmentBar'
import { StatTile, type StatTileState } from '../components/dashboard/StatTile'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { HEALTH_META } from '../lib/health'
import { ALERT_SEVERITY_META, DELIVERY_STATUS_META } from '../lib/alerts'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import SpendSummaryCard, { SpendFreshnessCounts } from '../components/SpendSummaryCard'
import PlatformStatusSummaryCard from '../components/PlatformStatusSummaryCard'
import { DiscoveryOverview } from '../components/meta/DiscoveryOverview'

function useOverview() {
  const summary = useQuery({
    queryKey: ['readiness-summary'],
    queryFn: () => api.get<ReadinessSummary>('/api/v1/ad-accounts/readiness/summary'),
  })
  const attention = useQuery({
    queryKey: ['accounts', 'attention'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ readiness_status: 'not_ready', page_size: 6 })}`,
      ),
  })
  const recent = useQuery({
    queryKey: ['accounts', 'recent'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ sort: 'updated_at', sort_direction: 'desc', page_size: 6 })}`,
      ),
  })
  const all = useQuery({
    queryKey: ['accounts', 'distribution'],
    queryFn: () => api.get<Paged<AdAccount>>(`/api/v1/ad-accounts${query({ page_size: 200 })}`),
  })
  const healthSummary = useQuery({
    queryKey: ['health-summary'],
    queryFn: () => api.get<HealthSummary>('/api/v1/account-health/summary'),
  })
  const alertSummary = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<AlertSummary>('/api/v1/alerts/summary'),
  })
  const audit = useQuery({
    queryKey: ['audit', 'latest'],
    queryFn: () => api.get<Paged<AuditEntry>>(`/api/v1/audit-logs${query({ page_size: 8 })}`),
  })
  // Same key as the spend and Meta-status cards, so React Query serves all three from one request.
  const spend = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return { summary, attention, recent, all, audit, healthSummary, alertSummary, spend }
}

type Q<T> = { isLoading: boolean; isError: boolean; data: T | undefined; refetch: () => unknown }

function tileState<T>(q: Q<T>, pick: (data: T) => number): StatTileState {
  if (q.isLoading) return { status: 'loading' }
  if (q.isError || q.data === undefined) return { status: 'error', onRetry: () => void q.refetch() }
  return { status: 'ready', value: pick(q.data) }
}

export default function Overview() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const { summary, attention, recent, all, audit, healthSummary, alertSummary, spend } = useOverview()

  const readiness = summary.data
  const registryEmpty = readiness !== undefined && readiness.total_active === 0 && readiness.archived === 0
  const accounts = all.data?.items ?? []
  const allTotal = all.data?.total ?? 0
  const sampled = all.data !== undefined && allTotal > accounts.length

  // ---- "needs attention today" hints (every figure here comes from a summary endpoint) ----------
  const criticalHintParts = [t('overview.kpi.criticalHint')]
  if (healthSummary.data && healthSummary.data.stale_data > 0)
    criticalHintParts.push(t('overview.kpi.criticalStale', { count: formatCount(healthSummary.data.stale_data) }))
  const blocking = spend.data?.platform_status_counts?.blocking
  if (blocking !== undefined && blocking > 0)
    criticalHintParts.push(t('overview.kpi.criticalMeta', { count: formatCount(blocking) }))

  // ---- distribution segments (tones come from the META maps, never chosen here) -----------------
  const readinessKeys = ['operationally_ready', 'ready_with_warnings', 'not_ready', 'unknown'] as const
  const readinessSegments: Segment[] = readiness
    ? readinessKeys.map((key) => ({
        key,
        label: enumLabel('readiness', key),
        count: readiness[key],
        tone: READINESS_META[key].tone,
        to: `/accounts?readiness_status=${key}`,
      }))
    : []
  const healthKeys = ['critical', 'warning', 'attention_needed', 'unknown', 'clear_signals'] as const
  const healthSegments: Segment[] = healthSummary.data
    ? healthKeys.map((key) => ({
        key,
        label: enumLabel('health', key),
        count: healthSummary.data![key],
        tone: HEALTH_META[key].tone,
        to: `/account-health?health_status=${key}`,
      }))
    : []

  // ---- checklist buckets ------------------------------------------------------------------------
  const hasRequired = (a: AdAccount) => (a.required_item_count ?? 0) > 0
  const ratio = (a: AdAccount) => (a.completed_item_count ?? 0) / (a.required_item_count ?? 1)
  const buckets = [
    { key: 'complete', label: t('overview.lists.bucketComplete'), test: (a: AdAccount) => hasRequired(a) && ratio(a) >= 1 },
    { key: 'mid', label: t('overview.lists.bucketMid'), test: (a: AdAccount) => hasRequired(a) && ratio(a) >= 0.5 && ratio(a) < 1 },
    { key: 'low', label: t('overview.lists.bucketLow'), test: (a: AdAccount) => hasRequired(a) && ratio(a) < 0.5 },
    // No required items determined is its own bucket — never counted as "0% complete".
    { key: 'none', label: t('overview.lists.bucketNone'), test: (a: AdAccount) => !hasRequired(a) },
  ]
  const neverSynced = accounts.filter((account) => !account.last_synced_at).length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold leading-7 min-[1024px]:text-2xl min-[1024px]:leading-8">{t('overview.title')}</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          {user?.workspace?.name ? `${t('overview.workspace', { name: user.workspace.name })} · ` : ''}
          {summary.dataUpdatedAt > 0
            ? t('format.updatedAt', { time: formatDateTime(new Date(summary.dataUpdatedAt).toISOString(), language) })
            : '—'}
        </p>
      </header>

      {registryEmpty ? (
        <EmptyState
          title={t('overview.empty.title')}
          description={t('overview.empty.body')}
          action={
            <>
              <Button asChild variant="secondary">
                <Link to="/business-managers">{t('accounts.empty.addBm')}</Link>
              </Button>
              <Button asChild>
                <Link to="/accounts">{t('accounts.register')}</Link>
              </Button>
            </>
          }
        />
      ) : (
        <>
          {readiness?.inventory && (
            <section
              aria-labelledby="overview-inventory"
              className="space-y-3"
              data-testid="overview-inventory-section"
            >
              <h2 id="overview-inventory" className="text-lg font-semibold leading-7">
                {t('overview.inventory.title')}
              </h2>

              {readiness.inventory.ad_account_counts.unassigned_via_count > 0 && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tone-caution-border bg-tone-caution-bg px-4 py-2.5 text-sm text-tone-caution-fg"
                  data-testid="overview-orphan-banner"
                >
                  <span className="font-medium">
                    {t('overview.inventory.orphanWarning', {
                      count: formatCount(readiness.inventory.ad_account_counts.unassigned_via_count),
                    })}
                  </span>
                  <Link
                    to="/accounts?unassigned_identity=true"
                    className="text-xs font-semibold underline hover:no-underline"
                  >
                    {t('overview.inventory.orphanAction')}
                  </Link>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-ink-muted">
                      <Link to="/facebook-accounts" className="hover:underline">
                        {t('overview.inventory.viaTitle')}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-2xl font-bold tabular-nums text-ink">
                      {formatCount(readiness.inventory.via_counts.total)}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge tone="neutral">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.via_counts.active),
                        })}
                      </Badge>
                      <Badge
                        tone={readiness.inventory.via_counts.restricted > 0 ? 'attention' : 'muted'}
                      >
                        {t('overview.inventory.blockedCount', {
                          count: formatCount(readiness.inventory.via_counts.restricted),
                        })}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-ink-muted">
                      <Link to="/business-managers" className="hover:underline">
                        {t('overview.inventory.bmTitle')}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-2xl font-bold tabular-nums text-ink">
                      {formatCount(readiness.inventory.bm_counts.total)}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge tone="neutral">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.bm_counts.active),
                        })}
                      </Badge>
                      <Badge
                        tone={readiness.inventory.bm_counts.restricted > 0 ? 'attention' : 'muted'}
                      >
                        {t('overview.inventory.blockedCount', {
                          count: formatCount(readiness.inventory.bm_counts.restricted),
                        })}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-ink-muted">
                      <Link to="/accounts" className="hover:underline">
                        {t('overview.inventory.adAccountTitle')}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums text-ink">
                        {formatCount(readiness.inventory.ad_account_counts.total)}
                      </span>
                      {Object.keys(readiness.inventory.ad_account_counts.by_currency).length > 0 && (
                        <span className="text-xs font-mono text-ink-muted">
                          {Object.entries(readiness.inventory.ad_account_counts.by_currency)
                            .map(([curr, cnt]) => `${formatCount(cnt)} ${curr}`)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge tone="neutral">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.ad_account_counts.active),
                        })}
                      </Badge>
                      <Badge
                        tone={
                          readiness.inventory.ad_account_counts.blocked > 0 ? 'attention' : 'muted'
                        }
                      >
                        {t('overview.inventory.blockedCount', {
                          count: formatCount(readiness.inventory.ad_account_counts.blocked),
                        })}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-ink-muted">
                      {t('overview.inventory.activityTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-ink-muted">{t('overview.inventory.created7d')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-ink">
                          +{formatCount(readiness.inventory.activity_7d.created_7d)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">{t('overview.inventory.blocked7d')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-ink">
                          {formatCount(readiness.inventory.activity_7d.blocked_7d)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">{t('overview.inventory.recovered7d')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-ink">
                          {formatCount(readiness.inventory.activity_7d.recovered_7d)}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}

          <section aria-labelledby="overview-todo" className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id="overview-todo" className="text-lg font-semibold leading-7">
                {t('overview.todo.title')}
              </h2>
              <span className="text-xs text-ink-muted">{t('overview.todo.hint')}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label={t('overview.kpi.notReady')}
                tone={READINESS_META.not_ready.tone}
                to="/accounts?readiness_status=not_ready"
                hint={readiness ? t('overview.kpi.notReadyHint', { total: formatCount(readiness.total_active) }) : undefined}
                state={tileState(summary, (d) => d.not_ready)}
              />
              <StatTile
                label={t('overview.kpi.critical')}
                tone={HEALTH_META.critical.tone}
                to="/account-health?health_status=critical"
                hint={criticalHintParts.join(' · ')}
                state={tileState(healthSummary, (d) => d.critical)}
              />
              <StatTile
                label={t('overview.kpi.alerts')}
                tone={ALERT_SEVERITY_META.critical.tone}
                to="/alerts?severity=critical&status=open"
                hint={t('overview.kpi.alertsHint')}
                state={tileState(alertSummary, (d) => d.open_critical)}
              />
              <StatTile
                label={t('overview.kpi.failed')}
                tone={DELIVERY_STATUS_META.failed_final.tone}
                to="/alerts?delivery_status=failed_final"
                hint={t('overview.kpi.failedHint')}
                state={tileState(alertSummary, (d) => d.failed_final_notifications)}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t('overview.dist.readinessTitle')}</CardTitle>
                  <CardDescription>{t('overview.dist.readinessSub')}</CardDescription>
                </div>
                <Link to="/accounts" className="text-xs font-medium text-brand-text hover:underline">
                  {t('overview.dist.openList')}
                </Link>
              </CardHeader>
              <CardContent>
                {summary.isLoading ? (
                  <LoadingRegion className="space-y-3">
                    <Skeleton className="h-3 w-full rounded-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </LoadingRegion>
                ) : summary.isError ? (
                  <ErrorState error={summary.error} onRetry={() => summary.refetch()} title={t('overview.dist.readinessTitle')} />
                ) : readinessSegments.every((s) => s.count === 0) ? (
                  <p className="text-sm text-ink-muted">{t('overview.dist.empty')}</p>
                ) : (
                  <div className="space-y-3">
                    <SegmentBar segments={readinessSegments} ariaPrefix={t('overview.dist.readinessTitle')} />
                    <p className="text-xs text-ink-muted">
                      <Link to="/accounts?archived=true" className="hover:underline">
                        {t('overview.dist.archivedOutside', { count: formatCount(readiness!.archived) })}
                      </Link>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t('overview.dist.healthTitle')}</CardTitle>
                  <CardDescription>{t('overview.dist.healthSub')}</CardDescription>
                </div>
                <Link to="/account-health" className="text-xs font-medium text-brand-text hover:underline">
                  {t('overview.dist.openHealth')}
                </Link>
              </CardHeader>
              <CardContent>
                {healthSummary.isLoading ? (
                  <LoadingRegion className="space-y-3">
                    <Skeleton className="h-3 w-full rounded-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </LoadingRegion>
                ) : healthSummary.isError ? (
                  <ErrorState error={healthSummary.error} onRetry={() => healthSummary.refetch()} title={t('overview.dist.healthTitle')} />
                ) : healthSegments.every((s) => s.count === 0) ? (
                  <p className="text-sm text-ink-muted">{t('overview.dist.empty')}</p>
                ) : (
                  <div className="space-y-3">
                    <SegmentBar segments={healthSegments} ariaPrefix={t('overview.dist.healthTitle')} />
                    {healthSummary.data!.stale_data > 0 && (
                      <p className="text-xs text-ink-muted">
                        {t('overview.dist.staleNote', { count: formatCount(healthSummary.data!.stale_data) })}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('overview.sources.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]">
                  <dt className="text-ink-muted">{t('overview.sources.healthEval')}</dt>
                  <dd>
                    {healthSummary.isLoading ? (
                      <Skeleton className="h-4 w-1/2" />
                    ) : healthSummary.isError ? (
                      <ErrorState error={healthSummary.error} onRetry={() => healthSummary.refetch()} compact />
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {healthSummary.data!.last_evaluation_at ? (
                          <span title={formatDateTime(healthSummary.data!.last_evaluation_at, language)}>
                            {formatRelative(healthSummary.data!.last_evaluation_at, language)}
                          </span>
                        ) : (
                          <Badge tone="neutral">{t('overview.sources.never')}</Badge>
                        )}
                        {healthSummary.data!.never_evaluated > 0 && (
                          <span className="text-xs text-ink-muted">
                            {t('overview.sources.neverEvaluated', { count: formatCount(healthSummary.data!.never_evaluated) })}
                          </span>
                        )}
                        {healthSummary.data!.failed_runs_recent > 0 && (
                          <Badge tone="caution">
                            {t('overview.sources.failedRuns', { count: formatCount(healthSummary.data!.failed_runs_recent) })}
                          </Badge>
                        )}
                      </span>
                    )}
                  </dd>

                  <dt className="text-ink-muted">{t('overview.sources.notification')}</dt>
                  <dd>
                    {alertSummary.isLoading ? (
                      <Skeleton className="h-4 w-1/2" />
                    ) : alertSummary.isError ? (
                      <ErrorState error={alertSummary.error} onRetry={() => alertSummary.refetch()} compact />
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {alertSummary.data!.last_successful_notification_at ? (
                          <span title={formatDateTime(alertSummary.data!.last_successful_notification_at, language)}>
                            {formatRelative(alertSummary.data!.last_successful_notification_at, language)}
                          </span>
                        ) : (
                          <Badge tone="neutral">{t('overview.sources.never')}</Badge>
                        )}
                        {(!alertSummary.data!.telegram_transport_configured || !alertSummary.data!.recipient_configured) && (
                          <span className="text-xs text-ink-muted">{t('overview.sources.notConfigured')}</span>
                        )}
                      </span>
                    )}
                  </dd>

                  <dt className="text-ink-muted">{t('overview.sources.spendFreshness')}</dt>
                  <dd>
                    {spend.isLoading ? (
                      <Skeleton className="h-6 w-2/3" />
                    ) : spend.isError ? (
                      <ErrorState error={spend.error} onRetry={() => spend.refetch()} compact />
                    ) : (
                      <SpendFreshnessCounts counts={spend.data!.freshness_counts} />
                    )}
                  </dd>

                  <dt className="text-ink-muted">{t('overview.sources.neverSynced')}</dt>
                  <dd>
                    {all.isLoading ? (
                      <Skeleton className="h-4 w-1/3" />
                    ) : all.isError ? (
                      <ErrorState error={all.error} onRetry={() => all.refetch()} compact />
                    ) : (
                      <span className="tabular-nums">
                        {t('overview.sources.neverSyncedValue', {
                          count: formatCount(neverSynced),
                          total: formatCount(accounts.length),
                        })}
                      </span>
                    )}
                  </dd>
                </dl>
                {sampled && (
                  <PartialDataNote>
                    {t('overview.sources.sample', { count: formatCount(accounts.length), total: formatCount(allTotal) })}
                  </PartialDataNote>
                )}
                <p className="text-xs text-ink-faint">{t('overview.sources.footer')}</p>
              </CardContent>
            </Card>

            <PlatformStatusSummaryCard />
          </section>

          <SpendSummaryCard />
        </>
      )}

      {user?.role === 'owner' ? (
        <DiscoveryOverview isOwner />
      ) : (
        // Not hidden: the card says why it is empty for this role (U1 section 11).
        <Card>
          <CardHeader>
            <CardTitle>{t('overview.discovery.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <NoPermissionState compact description={t('overview.discovery.ownerOnly')} />
          </CardContent>
        </Card>
      )}

      {!registryEmpty && (
        <section className="grid gap-4 xl:grid-cols-2">
          <ListCard
            title={t('overview.lists.reviewTitle')}
            action={<Link to="/readiness" className="text-xs font-medium text-brand-text hover:underline">{t('overview.lists.reviewOpen')}</Link>}
            loading={attention.isLoading}
            error={attention.isError ? { error: attention.error, retry: () => attention.refetch() } : undefined}
            empty={attention.data?.items.length === 0 ? t('overview.lists.reviewEmpty') : undefined}
          >
            <ul className="divide-y divide-line">
              {attention.data?.items.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/accounts/${account.id}`} className="min-w-0 truncate font-medium text-brand-text hover:underline">
                    {account.display_name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={accountStatusTone(account.status)}>{enumLabel('accountStatus', account.status)}</Badge>
                    <ChecklistProgress done={account.completed_item_count} total={account.required_item_count} />
                  </div>
                </li>
              ))}
            </ul>
          </ListCard>

          <ListCard
            title={t('overview.lists.recentTitle')}
            loading={recent.isLoading}
            error={recent.isError ? { error: recent.error, retry: () => recent.refetch() } : undefined}
            empty={recent.data?.items.length === 0 ? t('overview.lists.recentEmpty') : undefined}
          >
            <ul className="divide-y divide-line">
              {recent.data?.items.map((account) => {
                const meta = READINESS_META[account.readiness_status]
                return (
                  <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                    <Link to={`/accounts/${account.id}`} className="min-w-0 truncate font-medium text-brand-text hover:underline">
                      {account.display_name}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={meta?.tone ?? 'neutral'} dot>
                        {enumLabel('readiness', account.readiness_status)}
                      </Badge>
                      <span className="text-xs text-ink-faint">{formatRelative(account.updated_at, language)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </ListCard>

          <ListCard
            title={t('overview.lists.checklistTitle')}
            loading={all.isLoading}
            error={all.isError ? { error: all.error, retry: () => all.refetch() } : undefined}
            empty={all.data && accounts.length === 0 ? t('overview.lists.checklistEmpty') : undefined}
          >
            <ul className="space-y-2">
              {buckets.map((bucket) => {
                const matched = accounts.filter(bucket.test).length
                const percent = accounts.length ? (matched / accounts.length) * 100 : 0
                return (
                  <li key={bucket.key} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm text-ink-muted">{bucket.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
                      <div className="h-full rounded-full bg-ink-faint" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{formatCount(matched)}</span>
                  </li>
                )
              })}
            </ul>
          </ListCard>

          <ListCard
            title={t('overview.lists.auditTitle')}
            action={<Link to="/audit-log" className="text-xs font-medium text-brand-text hover:underline">{t('overview.lists.auditOpen')}</Link>}
            loading={audit.isLoading}
            error={audit.isError ? { error: audit.error, retry: () => audit.refetch() } : undefined}
            empty={audit.data?.items.length === 0 ? t('overview.lists.auditEmpty') : undefined}
          >
            <ul className="divide-y divide-line">
              {audit.data?.items.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                  <code className="min-w-0 truncate font-mono text-xs">{entry.action}</code>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {entry.actor_email ?? t('overview.lists.system')} · {formatRelative(entry.created_at, language)}
                  </span>
                </li>
              ))}
            </ul>
          </ListCard>
        </section>
      )}
    </div>
  )
}

/** A card with its own loading / error / empty states, so one failing query never blanks the page. */
function ListCard({
  title,
  action,
  loading,
  error,
  empty,
  children,
}: {
  title: string
  action?: ReactNode
  loading: boolean
  error?: { error: unknown; retry: () => unknown }
  empty?: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </LoadingRegion>
        ) : error ? (
          <ErrorState error={error.error} onRetry={() => void error.retry()} title={title} />
        ) : empty ? (
          <p className="py-4 text-center text-sm text-ink-muted">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}
