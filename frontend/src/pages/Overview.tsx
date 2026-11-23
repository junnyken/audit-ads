import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Calculator,
  CheckCircle2,
  CreditCard,
  Download,
  Flag,
  Globe,
  Layers,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { api, query } from '../lib/api'
import type {
  AdAccount,
  AlertSummary,
  OperationalTelemetrySummary,
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
  downloadChromeExtensionZip,
  downloadDesktopProSecure,
  downloadWindowsChromeLauncherBat,
  formatShortProfileBadge,
  launchInAssignedChromeProfile,
} from '../lib/chromeProfileLauncher'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { usePlatformScope } from '../hooks/usePlatformScope'
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
  const opsTelemetry = useQuery({
    queryKey: ['automation-operational-telemetry'],
    queryFn: () => api.get<OperationalTelemetrySummary>('/api/v1/automation/operational-telemetry'),
  })
  return { summary, attention, recent, alertSummary, spend, opsTelemetry }
}

export default function Overview() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const { platformScope } = usePlatformScope()
  const { summary, attention, recent, alertSummary, spend, opsTelemetry } = useOverview()

  const tel = opsTelemetry.data
  const scopedRisks = (Array.isArray(tel?.early_risks) ? tel.early_risks : []).filter((r) =>
    platformScope === 'all' ? true : r.platform === platformScope,
  )
  const proxyClusters = Array.isArray(tel?.proxy_clusters) ? tel.proxy_clusters : []
  const thresholdRiskCount = scopedRisks.filter(
    (r) => r.kind === 'billing_threshold_80' || r.kind === 'spend_cap_85',
  ).length
  const spikeRiskCount = scopedRisks.filter((r) => r.kind === 'daily_spend_spike').length

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

      {/* THANH BẮT ĐẦU NHANH 4 BƯỚC (THU GỌN MẶC ĐỊNH ĐỂ MÀN HÌNH TỔNG QUAN THOÁNG ĐÃNG) */}
      <details open={registryEmpty} className="group rounded-xl border border-brand/30 bg-surface px-3.5 py-2.5 shadow-xs">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info" className="gap-1">
              <Zap className="h-3 w-3" aria-hidden="true" />
              Sơ đồ 4 Bước Vận hành &amp; Công cụ Chrome
            </Badge>
            <span className="text-xs font-medium text-ink-muted">
              Tải tiện ích Chrome (.bat/.zip), phân tầng Via 3 lớp, cô lập Fanpage/Thẻ &amp; Quyết toán khách hàng
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/operations-guide"
              className="inline-flex items-center gap-1 text-xs font-bold text-brand-text hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Cẩm nang Chống Die →
            </Link>
            <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted group-open:hidden">
              Mở hướng dẫn ▾
            </span>
            <span className="hidden rounded bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted group-open:inline">
              Thu gọn ▴
            </span>
          </div>
        </summary>

        <div className="mt-3 grid gap-2.5 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted/40 p-2.5 text-xs space-y-1.5">
            <div className="font-bold text-ink">Bước 1: Kích hoạt Mở Chrome &amp; Tiện ích (.zip)</div>
            <p className="text-[11px] text-ink-muted">
              Chạy file <code>.bat</code> (1 lần) để mở đúng Hồ sơ Chrome từ Web &amp; cài gói Tiện ích v2.11.0 Pro (Tab Automatic, 2FA tự điền, Khiên khóa Via Lớp 1 / 72h, khóa IP Leak/WebRTC).
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => void downloadDesktopProSecure()}
                className="inline-flex items-center gap-1 rounded border border-brand bg-brand px-2 py-1 text-[11px] font-bold text-brand-fg hover:bg-brand-dark"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                App Win v5.1
              </button>
              <button
                type="button"
                onClick={downloadWindowsChromeLauncherBat}
                className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand-light px-2 py-1 text-[11px] font-bold text-brand-text hover:opacity-90"
              >
                <Terminal className="h-3 w-3" aria-hidden="true" />
                File .bat
              </button>
              <button
                type="button"
                onClick={() => void downloadChromeExtensionZip()}
                className="rounded border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-muted"
              >
                Tải .zip
              </button>
              <Link to="/chrome-extension" className="text-[11px] font-bold text-brand-text hover:underline ml-auto">
                Chi tiết →
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-2.5 text-xs space-y-1.5">
            <div className="font-bold text-ink">Bước 2: Phân tầng 3 Lớp Via &amp; Lấy mã 2FA</div>
            <p className="text-[11px] text-ink-muted">
              Tách biệt <strong>Via Tổng giữ BM</strong>, <strong>Via Lên Camp</strong> và <strong>Via Dự Phòng</strong> kèm mã 2FA 6 số trực tiếp.
            </p>
            <div className="pt-0.5">
              <Link
                to="/facebook-accounts"
                className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand-text hover:opacity-90"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Mở Bảng Via &amp; 2FA →
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-2.5 text-xs space-y-1.5">
            <div className="font-bold text-ink">Bước 3: Cô lập Fanpage, Pixel &amp; Thẻ</div>
            <p className="text-[11px] text-ink-muted">
              Giữ chuẩn <strong>1 Fanpage ≤ 3 TKQC</strong>, <strong>1 Thẻ ≤ 3 TKQC</strong> và chia sẻ Pixel qua Partner chống khóa ngược tài sản.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Link
                to="/pages"
                className="inline-flex items-center gap-1 rounded border border-brand/40 bg-brand-light px-2 py-1 text-[11px] font-bold text-brand-text hover:opacity-90"
              >
                <Flag className="h-3 w-3" aria-hidden="true" />
                Fanpages →
              </Link>
              <Link
                to="/assets"
                className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-muted"
              >
                <Layers className="h-3 w-3" aria-hidden="true" />
                Tài sản →
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-tone-positive-border bg-tone-positive-bg/50 p-2.5 text-xs space-y-1.5">
            <div className="font-bold text-ink">Bước 4: Ngân sách Cam kết &amp; Quyết Toán KH</div>
            <p className="text-[11px] text-ink-muted">
              Gom nhiều TKQC vào 1 Hợp đồng Khách hàng, đo tiến độ Pacing &amp; tự động xuất <strong>Phiếu Quyết Toán (+Phí Agency &amp; Thuế Meta)</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Link
                to="/retainers"
                className="inline-flex items-center gap-1 rounded border border-tone-positive-border bg-tone-positive-bg px-2.5 py-1 text-[11px] font-bold text-tone-positive-fg hover:opacity-90"
              >
                <Calculator className="h-3 w-3" aria-hidden="true" />
                Mở Bảng Quyết Toán KH →
              </Link>
              <Link
                to="/accounts"
                className="text-[11px] font-bold text-brand-text hover:underline ml-auto"
              >
                DS TKQC →
              </Link>
            </div>
          </div>
        </div>
      </details>


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
              <div className="studio-strip grid sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0">
                <div className="p-4 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    <Link to="/facebook-accounts" className="hover:text-ink transition-colors">
                      {t('overview.inventory.viaTitle')}
                    </Link>
                  </div>
                  <div className="font-mono text-2xl font-bold tabular-nums text-ink">
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
                </div>

                <div className="p-4 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    <Link to="/business-managers" className="hover:text-ink transition-colors">
                      {t('overview.inventory.bmTitle')}
                    </Link>
                  </div>
                  <div className="font-mono text-2xl font-bold tabular-nums text-ink">
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
                </div>

                <div className="p-4 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    <Link to="/accounts" className="hover:text-ink transition-colors">
                      {t('overview.inventory.adAccountTitle')}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold tabular-nums text-ink">
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
                </div>

                <div className="p-4 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    <Link to="/alerts" className="hover:text-ink transition-colors">
                      Trạng thái Meta &amp; Cảnh báo
                    </Link>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                      {formatCount(metaBlockedCount)}
                    </span>
                    <span className="text-xs font-medium text-ink-muted">TKQC cần kiểm tra</span>
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
                </div>
              </div>
            </section>
          )}

          {/* Hàng 2: Tổng hợp chi tiêu */}
          <SpendSummaryCard />

          {/* Hàng 2b: Đo lường Hiệu quả 7 Ngày, Sức khỏe Proxy & Cảnh báo Sớm Thẻ (>=80%) / Vọt Chi tiêu */}
          <section aria-label={t('overview.telemetry.sectionTitle')} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">{t('overview.telemetry.sectionTitle')}</h2>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <Link to="/facebook-accounts" className="text-brand-text hover:underline">
                  {t('overview.telemetry.manageProxiesLink')}
                </Link>
                <Link to="/alerts?status=open" className="text-brand-text hover:underline">
                  {t('overview.telemetry.openAlertsLink')}
                </Link>
              </div>
            </div>

            {opsTelemetry.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <>
                <div className="studio-strip grid sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      <Activity className="h-3.5 w-3.5 text-brand-text" aria-hidden="true" />
                      {t('overview.telemetry.opsRateTitle')}
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums text-ink">
                      {tel?.automation_health?.success_rate_pct !== null &&
                      tel?.automation_health?.success_rate_pct !== undefined
                        ? `${tel.automation_health.success_rate_pct.toFixed(1)}%`
                        : t('overview.telemetry.noRuns7d')}
                    </div>
                    <p className="text-xs text-ink-muted tabular-nums">
                      {t('overview.telemetry.opsBreakdown', {
                        ok: formatCount(tel?.automation_health?.ok_ops_7d ?? 0),
                        fail: formatCount(tel?.automation_health?.fail_ops_7d ?? 0),
                      })}
                    </p>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      <Globe className="h-3.5 w-3.5 text-tone-positive-fg" aria-hidden="true" />
                      {t('overview.telemetry.proxyCardTitle')}
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums text-ink">
                      {formatCount(tel?.proxy_summary?.total_clusters ?? 0)}
                    </div>
                    <p className="text-xs text-ink-muted tabular-nums">
                      {t('overview.telemetry.proxyBreakdown', {
                        healthy: formatCount(tel?.proxy_summary?.healthy_clusters ?? 0),
                        crowded: formatCount(tel?.proxy_summary?.crowded_clusters ?? 0),
                        incident: formatCount(tel?.proxy_summary?.incident_clusters ?? 0),
                      })}
                    </p>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      <CreditCard className="h-3.5 w-3.5 text-tone-caution-fg" aria-hidden="true" />
                      {t('overview.telemetry.threshCardTitle')}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                        {formatCount(thresholdRiskCount)}
                      </span>
                      {thresholdRiskCount > 0 && (
                        <Badge tone="caution">≥ 80%</Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted">{t('overview.telemetry.threshSub')}</p>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      <TrendingUp className="h-3.5 w-3.5 text-tone-attention-fg" aria-hidden="true" />
                      {t('overview.telemetry.spikeCardTitle')}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                        {formatCount(spikeRiskCount)}
                      </span>
                      {spikeRiskCount > 0 && (
                        <Badge tone="attention">Spike</Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted">{t('overview.telemetry.spikeSub')}</p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-bold text-ink">
                        <AlertTriangle className="h-4 w-4 text-tone-caution-fg" aria-hidden="true" />
                        {t('overview.telemetry.risksPanelTitle')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      {scopedRisks.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-tone-positive-border bg-tone-positive-bg px-3 py-2.5 text-xs font-medium text-tone-positive-fg">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{t('overview.telemetry.risksEmpty')}</span>
                        </div>
                      ) : (
                        <ul className="divide-y divide-line">
                          {scopedRisks.slice(0, 6).map((risk) => {
                            const isCrit = risk.severity === 'critical'
                            const barPct = Math.min(100, Math.max(8, Math.round(risk.ratio_pct)))
                            return (
                              <li key={`${risk.ad_account_id}-${risk.kind}`} className="space-y-1.5 py-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="min-w-0 flex items-center gap-1.5">
                                    <Badge tone={risk.platform === 'google_ads' ? 'info' : 'neutral'}>
                                      {risk.platform === 'google_ads' ? 'Google' : 'Meta'}
                                    </Badge>
                                    <Link
                                      to={`/accounts/${risk.ad_account_id}`}
                                      className="truncate font-semibold text-brand-text hover:underline"
                                    >
                                      {risk.display_name}
                                    </Link>
                                  </div>
                                  <Badge tone={isCrit ? 'attention' : 'caution'} className="font-mono tabular-nums">
                                    {risk.ratio_pct.toFixed(0)}%
                                  </Badge>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                                  <div
                                    className={isCrit ? 'h-full bg-tone-attention-fg' : 'h-full bg-tone-caution-fg'}
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                                  <span className="truncate">{risk.summary}</span>
                                  {risk.payment_card && (
                                    <span className="shrink-0 font-mono text-[11px]">{risk.payment_card}</span>
                                  )}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-bold text-ink">
                        <Globe className="h-4 w-4 text-brand-text" aria-hidden="true" />
                        {t('overview.telemetry.proxyPanelTitle')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      {proxyClusters.length === 0 ? (
                        <p className="text-xs text-ink-muted">{t('overview.telemetry.proxyEmpty')}</p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {proxyClusters.slice(0, 6).map((cluster) => {
                            const tone =
                              cluster.status === 'incident'
                                ? 'attention'
                                : cluster.status === 'crowded'
                                  ? 'caution'
                                  : 'positive'
                            const statusText =
                              cluster.status === 'incident'
                                ? t('overview.telemetry.proxyStatusIncident')
                                : cluster.status === 'crowded'
                                  ? t('overview.telemetry.proxyStatusCrowded')
                                  : t('overview.telemetry.proxyStatusHealthy')
                            return (
                              <li key={cluster.proxy_key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-xs font-semibold text-ink">
                                    {cluster.proxy_key}
                                  </div>
                                  <div className="truncate text-[11px] text-ink-muted">
                                    {(cluster.via_labels ?? []).join(', ')}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <Badge tone="neutral" className="font-mono tabular-nums">
                                    {t('overview.telemetry.viaCountLabel', { count: cluster.via_count })}
                                  </Badge>
                                  {cluster.incident_count_7d > 0 && (
                                    <Badge tone="attention" className="font-mono tabular-nums">
                                      {t('overview.telemetry.incidents7dLabel', { count: cluster.incident_count_7d })}
                                    </Badge>
                                  )}
                                  <Badge tone={tone}>{statusText}</Badge>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </section>

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
                            className="inline-flex items-center rounded-md border border-line-strong bg-surface-sunken/70 px-2 py-0.5 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand-text transition-colors"
                            title={`Mở trang Kháng nghị bằng Chrome (${formatShortProfileBadge(primaryVia)})`}
                          >
                            Mở Chrome
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
                            className="inline-flex items-center rounded-md border border-line-strong bg-surface-sunken/70 px-2 py-0.5 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand-text transition-colors"
                          >
                            Mở Chrome
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
