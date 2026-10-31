import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../lib/api'
import type {
  AdAccount,
  AlertSummary,
  Paged,
  ReadinessSummary,
  SpendSummary,
} from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion } from '../components/states'
import { accountStatusTone } from '../lib/readiness'
import {
  formatShortProfileBadge,
  launchInAssignedChromeProfile,
} from '../lib/chromeProfileLauncher'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import SpendSummaryCard from '../components/SpendSummaryCard'

function useOverview() {
  const summary = useQuery({
    queryKey: ['readiness-summary'],
    queryFn: () => api.get<ReadinessSummary>('/api/v1/ad-accounts/readiness/summary'),
  })
  const attention = useQuery({
    queryKey: ['accounts', 'attention'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ readiness_status: 'not_ready', page_size: 8 })}`,
      ),
  })
  const recent = useQuery({
    queryKey: ['accounts', 'recent'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ sort: 'updated_at', sort_direction: 'desc', page_size: 8 })}`,
      ),
  })
  const alertSummary = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<AlertSummary>('/api/v1/alerts/summary'),
  })
  const spend = useQuery({
    queryKey: ['spend-summary'],
    queryFn: () => api.get<SpendSummary>('/api/v1/spend/summary'),
  })
  return { summary, attention, recent, alertSummary, spend }
}

export default function Overview() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const { summary, attention, recent, alertSummary, spend } = useOverview()

  const readiness = summary.data
  const registryEmpty = readiness !== undefined && readiness.total_active === 0 && readiness.archived === 0
  const openCriticalAlerts = alertSummary.data?.open_critical ?? 0
  const metaActiveCount = spend.data?.platform_status_counts?.active ?? readiness?.inventory?.ad_account_counts.active ?? 0
  const metaBlockedCount = spend.data?.platform_status_counts?.blocking ?? readiness?.inventory?.ad_account_counts.blocked ?? 0

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold leading-7 min-[1024px]:text-2xl min-[1024px]:leading-8">
          {t('overview.title')}
        </h1>
        <p className="text-xs font-medium text-ink-muted">
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
          {/* Hàng 1: 4 Thẻ Tổng Quan Tài Sản & Cảnh Báo */}
          {readiness?.inventory && (
            <section aria-label={t('overview.inventory.title')} data-testid="overview-inventory-section">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wide text-ink-muted">
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
                      <Badge tone="positive">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.via_counts.active),
                        })}
                      </Badge>
                      {readiness.inventory.via_counts.restricted > 0 && (
                        <Badge tone="attention">
                          {t('overview.inventory.blockedCount', {
                            count: formatCount(readiness.inventory.via_counts.restricted),
                          })}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-1.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wide text-ink-muted">
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
                      <Badge tone="positive">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.bm_counts.active),
                        })}
                      </Badge>
                      {readiness.inventory.bm_counts.restricted > 0 && (
                        <Badge tone="attention">
                          {t('overview.inventory.blockedCount', {
                            count: formatCount(readiness.inventory.bm_counts.restricted),
                          })}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-1.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wide text-ink-muted">
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
                        <span className="font-mono text-xs font-semibold text-ink-muted">
                          {Object.entries(readiness.inventory.ad_account_counts.by_currency)
                            .map(([curr, cnt]) => `${formatCount(cnt)} ${curr}`)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge tone="positive">
                        {t('overview.inventory.activeCount', {
                          count: formatCount(readiness.inventory.ad_account_counts.active),
                        })}
                      </Badge>
                      {readiness.inventory.ad_account_counts.blocked > 0 && (
                        <Badge tone="attention">
                          {t('overview.inventory.blockedCount', {
                            count: formatCount(readiness.inventory.ad_account_counts.blocked),
                          })}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-1.5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                      <Link to="/alerts" className="hover:underline">
                        Trạng thái Meta & Cảnh báo
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums text-ink">
                        {formatCount(metaBlockedCount)}
                      </span>
                      <span className="text-xs font-semibold text-ink-muted">TKQC cần kiểm tra</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Link to="/accounts">
                        <Badge tone="positive">Meta hoạt động: {formatCount(metaActiveCount)}</Badge>
                      </Link>
                      <Link to="/alerts?status=open">
                        <Badge tone={openCriticalAlerts > 0 ? 'attention' : 'neutral'}>
                          Cảnh báo mở: {formatCount(openCriticalAlerts)}
                        </Badge>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}

          {/* Hàng 2: Tổng hợp chi tiêu */}
          <SpendSummaryCard />

          {/* Hàng 3: 2 Bảng Hành động nhanh */}
          <section className="grid gap-4 xl:grid-cols-2">
            <ListCard
              title="Tài khoản cần kiểm tra / Kháng nghị"
              action={
                <Link to="/accounts?readiness_status=not_ready" className="text-xs font-semibold text-brand-text hover:underline">
                  Xem tất cả →
                </Link>
              }
              loading={attention.isLoading}
              error={attention.isError ? { error: attention.error, retry: () => attention.refetch() } : undefined}
              empty={attention.data?.items.length === 0 ? 'Tất cả tài khoản đều đang hoạt động ổn định.' : undefined}
            >
              <ul className="divide-y divide-line">
                {attention.data?.items.map((account) => {
                  const primaryVia = account.facebook_identities?.[0]
                  const actDigits = (account.external_account_id || '').replace(/^act[-_]/i, '').trim()
                  const appealUrl = actDigits
                    ? `https://business.facebook.com/accountquality/?landing_page=overview&act=${encodeURIComponent(actDigits)}`
                    : 'https://business.facebook.com/accountquality'
                  return (
                    <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link to={`/accounts/${account.id}`} className="font-semibold text-brand-text hover:underline">
                          {account.display_name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          {account.external_account_id}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={accountStatusTone(account.status)}>
                          {enumLabel('accountStatus', account.status)}
                        </Badge>
                        {primaryVia && (
                          <button
                            type="button"
                            onClick={() =>
                              launchInAssignedChromeProfile(
                                appealUrl,
                                primaryVia.browser_profile_label,
                                primaryVia.label,
                                primaryVia.network_label,
                              )
                            }
                            className="inline-flex items-center rounded border border-emerald-600/50 bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-300"
                            title={`Mở trang Kháng nghị bằng Chrome (${formatShortProfileBadge(primaryVia)})`}
                          >
                            🚀 Mở Chrome
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </ListCard>

            <ListCard
              title="Tài khoản quảng cáo cập nhật gần đây"
              action={
                <Link to="/accounts" className="text-xs font-semibold text-brand-text hover:underline">
                  Mở danh sách TKQC →
                </Link>
              }
              loading={recent.isLoading}
              error={recent.isError ? { error: recent.error, retry: () => recent.refetch() } : undefined}
              empty={recent.data?.items.length === 0 ? t('overview.lists.recentEmpty') : undefined}
            >
              <ul className="divide-y divide-line">
                {recent.data?.items.map((account) => {
                  const primaryVia = account.facebook_identities?.[0]
                  const actDigits = (account.external_account_id || '').replace(/^act[-_]/i, '').trim()
                  const adsMgrUrl = actDigits
                    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actDigits)}`
                    : 'https://business.facebook.com/overview'
                  return (
                    <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link to={`/accounts/${account.id}`} className="font-semibold text-brand-text hover:underline">
                          {account.display_name}
                        </Link>
                        <span className="ml-1.5 text-xs text-ink-muted">
                          · {account.business_manager_name ?? 'Cá nhân'}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {primaryVia && (
                          <button
                            type="button"
                            onClick={() =>
                              launchInAssignedChromeProfile(
                                adsMgrUrl,
                                primaryVia.browser_profile_label,
                                primaryVia.label,
                                primaryVia.network_label,
                              )
                            }
                            className="inline-flex items-center rounded border border-emerald-600/50 bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-300"
                          >
                            🚀 Mở Chrome
                          </button>
                        )}
                        <span className="text-xs font-medium text-ink-muted">
                          {formatRelative(account.updated_at, language)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </ListCard>
          </section>
        </>
      )}
    </div>
  )
}

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
      <CardHeader className="pb-2">
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
