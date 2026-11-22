import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Code2,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UserRoundCog,
  Wallet,
} from 'lucide-react'
import { api } from '../lib/api'
import type { GoogleAdsScriptConfig } from '../lib/types'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { ErrorState, LoadingRegion } from '../components/states'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { useAuth } from '../hooks/useAuth'
import { usePlatformScope } from '../hooks/usePlatformScope'
import { useI18n } from '../i18n'

type ScriptTab = 'mcc' | 'standalone'
type CopiedKind = 'url' | 'script' | null

export default function GoogleAdsConnections() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { setPlatformScope } = usePlatformScope()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<ScriptTab>('mcc')
  const [copied, setCopied] = useState<CopiedKind>(null)
  const [rotatedBanner, setRotatedBanner] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 2200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const configQuery = useQuery<GoogleAdsScriptConfig>({
    queryKey: ['google-ads-script-config'],
    queryFn: () => api.get<GoogleAdsScriptConfig>('/api/v1/google-ads/script-config'),
  })

  const rotateMutation = useMutation({
    mutationFn: () => api.post<GoogleAdsScriptConfig>('/api/v1/google-ads/rotate-key'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['google-ads-script-config'], updated)
      setRotatedBanner(true)
    },
  })

  const isOwner = user?.role === 'owner'
  const data = configQuery.data
  const activeScriptCode = data
    ? activeTab === 'mcc'
      ? data.mcc_script_code
      : data.single_account_script_code
    : ''

  async function handleCopy(kind: Exclude<CopiedKind, null>, value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
    } catch {
      // Fallback selection handled silently if clipboard API is denied.
    }
  }

  function handleRotateKey() {
    if (!isOwner || rotateMutation.isPending) return
    if (!window.confirm(t('gads.rotate.confirm'))) return
    setRotatedBanner(false)
    rotateMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold leading-7 text-ink">{t('gads.title')}</h1>
          <p className="max-w-3xl text-sm text-ink-muted">{t('gads.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void configQuery.refetch()}
            disabled={configQuery.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('gads.script.refresh')}
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to="/facebook-accounts" onClick={() => setPlatformScope('google_ads')}>
              <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" />
              {t('gads.links.identities')}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/accounts" onClick={() => setPlatformScope('google_ads')}>
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              {t('gads.links.accounts')}
            </Link>
          </Button>
        </div>
      </header>

      <Card className="border-tone-info-border bg-tone-info-bg/40">
        <CardContent className="flex flex-wrap items-start gap-3 p-4">
          <div className="rounded-lg border border-tone-info-border bg-surface p-2 text-tone-info-fg">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-[240px] flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" dot>
                {t('gads.silo.badge')}
              </Badge>
              <h2 className="text-sm font-semibold text-ink">{t('gads.silo.title')}</h2>
            </div>
            <p className="text-xs leading-relaxed text-ink-muted">{t('gads.silo.desc')}</p>
          </div>
        </CardContent>
      </Card>

      {configQuery.isLoading ? (
        <LoadingRegion className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="space-y-2 rounded-lg border border-line bg-surface p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-6 w-36" />
              </div>
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </LoadingRegion>
      ) : configQuery.isError || !data ? (
        <ErrorState
          title={t('gads.error.load')}
          error={configQuery.error}
          onRetry={() => void configQuery.refetch()}
        />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-ink-muted">{t('gads.kpi.status')}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Badge tone={data.key_configured ? 'positive' : 'caution'} dot>
                  {data.key_configured ? t('gads.kpi.ready') : t('gads.kpi.pending')}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-ink-muted">
                  {t('gads.kpi.syncedAccounts')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xl font-semibold tabular-nums text-ink">
                  {formatCount(data.synced_accounts_count)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-ink-muted">{t('gads.kpi.lastPush')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5 pt-0">
                <p className="text-sm font-semibold text-ink">
                  {data.last_push_at ? formatRelative(data.last_push_at) : t('gads.kpi.neverPushed')}
                </p>
                {data.last_push_at && (
                  <p className="text-xs tabular-nums text-ink-muted">{formatDateTime(data.last_push_at)}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-ink-muted">{t('gads.kpi.keyMasked')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
                <code className="rounded border border-line bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink">
                  {data.key_masked}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRotateKey}
                  disabled={!isOwner || rotateMutation.isPending}
                  title={!isOwner ? t('gads.rotate.ownerOnly') : undefined}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {rotateMutation.isPending ? t('gads.rotate.rotating') : t('gads.rotate.btn')}
                </Button>
              </CardContent>
            </Card>
          </section>

          {!isOwner && (
            <p className="text-xs text-ink-muted">{t('gads.rotate.ownerOnly')}</p>
          )}

          {rotateMutation.isError && (
            <ErrorState
              title={t('gads.error.rotate')}
              error={rotateMutation.error}
              compact
            />
          )}

          {rotatedBanner && (
            <div className="flex items-center gap-2 rounded-lg border border-tone-positive-border bg-tone-positive-bg px-3 py-2 text-xs font-medium text-tone-positive-fg">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('gads.rotate.done')}</span>
            </div>
          )}

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-[260px] flex-1 space-y-1">
                <span className="text-xs font-medium text-ink-muted">{t('gads.endpoint.label')}</span>
                <div className="overflow-x-auto rounded-md border border-line bg-surface-sunken px-3 py-1.5 font-mono text-xs text-ink">
                  {data.ingest_url}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleCopy('url', data.ingest_url)}
              >
                {copied === 'url' ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied === 'url' ? t('gads.endpoint.copied') : t('gads.endpoint.copy')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div role="tablist" aria-label={t('gads.title')} className="flex flex-wrap gap-2">
                <Button
                  id="gads-tab-mcc"
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'mcc'}
                  aria-controls="gads-tabpanel"
                  variant={activeTab === 'mcc' ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setActiveTab('mcc')}
                >
                  <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('gads.tab.mcc')}
                </Button>
                <Button
                  id="gads-tab-standalone"
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'standalone'}
                  aria-controls="gads-tabpanel"
                  variant={activeTab === 'standalone' ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setActiveTab('standalone')}
                >
                  <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('gads.tab.standalone')}
                </Button>
              </div>

              <Button
                size="sm"
                onClick={() => void handleCopy('script', activeScriptCode)}
                disabled={!activeScriptCode}
              >
                {copied === 'script' ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied === 'script' ? t('gads.script.copied') : t('gads.script.copy')}
              </Button>
            </CardHeader>

            <CardContent
              id="gads-tabpanel"
              className="space-y-3 pt-4"
              role="tabpanel"
              aria-labelledby={activeTab === 'mcc' ? 'gads-tab-mcc' : 'gads-tab-standalone'}
            >
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-ink">
                  {activeTab === 'mcc' ? t('gads.mcc.title') : t('gads.standalone.title')}
                </h2>
                <p className="text-xs leading-relaxed text-ink-muted">
                  {activeTab === 'mcc' ? t('gads.mcc.desc') : t('gads.standalone.desc')}
                </p>
              </div>

              <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-xs leading-5 text-ink">
                <code>{activeScriptCode}</code>
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('gads.steps.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-xs leading-relaxed text-ink-muted">
                {[t('gads.steps.1'), t('gads.steps.2'), t('gads.steps.3'), t('gads.steps.4')].map(
                  (step, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-sunken font-mono text-[11px] font-semibold text-ink">
                        {idx + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ),
                )}
              </ol>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
