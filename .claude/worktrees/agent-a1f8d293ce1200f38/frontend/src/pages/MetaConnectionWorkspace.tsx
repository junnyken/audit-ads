import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { DiscoveryRun, MetaConnection, Paged } from '../lib/types'
import { useI18n } from '../i18n'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/primitives/tabs'
import { ErrorState, LoadingRegion } from '../components/states'
import { AssetInventory, type EdgeFilter, type StatusFilter } from '../components/meta/AssetInventory'
import { AuthorityNote, CoverageBadge, ReadAtSentence, RunFailure } from '../components/meta/DiscoverySection'
import { ReaderSourceBadge, readerSourceNote } from '../components/meta/ReaderSource'
import { ConnectionReaderSwitch } from '../components/meta/ConnectionReaderSwitch'
import { EnvironmentBadge } from '../components/meta/EnvironmentBadge'
import { ReadBackNote } from '../components/meta/confirm'
import { useImportAccount } from '../components/meta/useImportAccount'
import { HistoryTab } from './meta-connection/HistoryTab'
import { DL_CLASS, Note, Panel, Row } from './account/parts'

/** Tab keys are part of the URL (`?tab=`) and so of every bookmark: do not rename them. */
const TAB_KEYS = ['overview', 'ad-accounts', 'pixels', 'history'] as const
type TabKey = (typeof TAB_KEYS)[number]

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value)
}

/** The workspace is keyed by **connection**, not by registry Business Manager.
 *
 * Every discovery run, observation and coverage record in this schema hangs off a connection;
 * `business_managers` is the operator-entered A1 registry and holds no discovery data at all.
 * A BM-keyed workspace would address rows that do not exist until someone has used Add to
 * registry — see `docs/AUDIT_BEFORE_BUILD_O1_1.md` §1a. The Business Manager is shown here as an
 * attribute of the connection, which is what it actually is.
 */
export default function MetaConnectionWorkspace() {
  const { connectionId = '' } = useParams()
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: TabKey = isTabKey(requested) ? requested : 'overview'
  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }

  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const connection = useQuery({
    queryKey: ['meta-connection', connectionId],
    queryFn: () => api.get<MetaConnection>(`/api/v1/meta-connections/${connectionId}`),
  })
  const latestKey = ['meta-discovery', connectionId]
  const latest = useQuery({
    queryKey: latestKey,
    queryFn: () =>
      api.get<DiscoveryRun | null>(`/api/v1/meta-connections/${connectionId}/discoveries/latest`),
  })

  const run = useMutation({
    mutationFn: () => api.post<DiscoveryRun>(`/api/v1/meta-connections/${connectionId}/discoveries`),
    onSuccess: (data) => {
      queryClient.setQueryData(latestKey, data)
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery-history', connectionId] })
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery-summary'] })
    },
  })

  const data = latest.data ?? null
  const imports = useImportAccount(connectionId, data, latestKey)

  // Whether the Business Manager this run read has a row in the A1 registry. Read-only, and asked
  // of the registry rather than of Meta. The import invalidates ['business-managers'], and this
  // key sits under that prefix, so the answer refreshes itself after an import creates the row.
  const bmReference = data?.business_manager.reference ?? null
  const registryBm = useQuery({
    queryKey: ['business-managers', 'workspace-lookup', bmReference],
    enabled: Boolean(bmReference),
    queryFn: () =>
      api.get<Paged<{ id: string; name: string; external_id: string | null }>>(
        `/api/v1/business-managers?search=${encodeURIComponent(bmReference!)}&page_size=25`,
      ),
  })
  // `search` may match loosely; the claim being made is exact, so the comparison is exact too.
  const registryRow = registryBm.data?.items.find((item) => item.external_id === bmReference)

  if (connection.isLoading) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-48 w-full" />
      </LoadingRegion>
    )
  }
  if (connection.isError) {
    return (
      <div className="space-y-3">
        <ErrorState title={t('ws.error')} error={connection.error} onRetry={() => connection.refetch()} />
        <Link to="/meta-connections" className="text-sm font-medium text-brand-text hover:underline">
          {t('ws.back')}
        </Link>
      </div>
    )
  }

  const record = connection.data!

  return (
    <div className="space-y-4">
      <nav aria-label={t('ws.breadcrumb')} className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to="/meta-connections" className="hover:underline">
          {t('nav.item.metaConnections')}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span aria-current="page" className="text-ink">
          {record.label}
        </span>
      </nav>

      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-7">{record.label}</h1>
          <EnvironmentBadge environment={record.environment} />
          {record.business_manager_source === 'server' && <Badge tone="neutral">{t('meta.usesServerBm')}</Badge>}
        </div>
        <p className="max-w-3xl text-sm text-ink-muted">{t('ws.intro')}</p>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('ws.tabs.label')}>
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`ws.tab.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Panel
              title={t('ws.latest')}
              action={
                <Button variant="secondary" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
                  {run.isPending ? t('disc.running') : t('disc.run')}
                </Button>
              }
            >
              {latest.isLoading ? (
                <LoadingRegion className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </LoadingRegion>
              ) : latest.isError ? (
                <ErrorState title={t('ws.latestFailed')} error={latest.error} onRetry={() => latest.refetch()} compact />
              ) : !data ? (
                <p className="text-sm text-ink-faint">{t('ws.none')}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-muted">
                      {t('ws.bm', {
                        name: data.business_manager.name ?? data.business_manager.reference ?? t('meta.notConfigured'),
                      })}
                    </span>
                    {data.freshness === 'stale' && <Badge tone="caution">{t('disc.staleReading')}</Badge>}
                    {bmReference &&
                      // Never a guess. A failed lookup says so; it must not read as "absent",
                      // which is the whole discipline this product is built on.
                      (registryBm.isLoading ? (
                        <span className="text-xs text-ink-faint">{t('ws.registry.checking')}</span>
                      ) : registryBm.isError ? (
                        <Badge tone="neutral">{t('ws.registry.unchecked')}</Badge>
                      ) : registryRow ? (
                        <Badge tone="positive">{t('ws.registry.in')}</Badge>
                      ) : (
                        <Badge tone="neutral">{t('ws.registry.notIn')}</Badge>
                      ))}
                  </div>
                  {bmReference && !registryBm.isLoading && !registryBm.isError && !registryRow && (
                    <p className="text-xs text-ink-faint">{t('ws.registry.hint')}</p>
                  )}
                  <div className="grid gap-1 sm:grid-cols-2">
                    <span className="flex items-center gap-2">
                      <span className="text-ink-muted">
                        {t('ws.adAccountsReturned', { n: data.ad_accounts.coverage.total_unique_assets ?? '—' })}
                      </span>
                      <CoverageBadge status={data.ad_accounts.coverage_status} />
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-ink-muted">
                        {t('ws.pixelsReturned', { n: data.pixels.coverage.total_unique_assets ?? '—' })}
                      </span>
                      <CoverageBadge status={data.pixels.coverage_status} />
                    </span>
                  </div>
                  {data.failure_code && <RunFailure code={data.failure_code} summary={data.failure_summary} />}
                  <ReadAtSentence
                    keyPrefix="ws"
                    completedAt={data.completed_at}
                    identity={data.read_as?.name || data.read_as?.external_id || t('meta.unknownIdentity')}
                  />
                  {data.business_authority === 'not_established' && <AuthorityNote />}
                </div>
              )}
              {run.isError && <ErrorState title={t('disc.startFailed')} error={run.error} compact />}
            </Panel>

            <Panel title={t('ws.conn.title')}>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-muted">{t('ws.conn.reader')}</span>
                  <ReaderSourceBadge source={record.reader_source} readerLabel={record.reader_credential?.label} />
                </div>
                {readerSourceNote(record.reader_source, language) && (
                  <p className="text-xs text-ink-faint">{readerSourceNote(record.reader_source, language)}</p>
                )}
                <ConnectionReaderSwitch connection={record} />
                <dl className={DL_CLASS}>
                  <Row label={t('ws.conn.bmInUse')}>
                    <span className="font-mono text-xs">{record.business_manager_reference ?? t('ws.conn.serverBm')}</span>
                  </Row>
                </dl>
                <p className="text-xs text-ink-faint">
                  {t('ws.conn.lastCheck', {
                    time: record.last_capability_check_at
                      ? formatDateTime(record.last_capability_check_at, language)
                      : t('format.never'),
                  })}
                </p>
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="ad-accounts" className="space-y-3">
          <ReadBackNote readBack={imports.readBack} onDismiss={imports.clearReadBack} />
          {latest.isLoading ? (
            <LoadingRegion className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </LoadingRegion>
          ) : latest.isError ? (
            <ErrorState title={t('ws.latestFailed')} error={latest.error} onRetry={() => latest.refetch()} />
          ) : data ? (
            <AssetInventory
              result={data.ad_accounts}
              edge={edgeFilter}
              status={statusFilter}
              onEdgeChange={setEdgeFilter}
              onStatusChange={setStatusFilter}
              onImport={imports.importAccount}
              importingId={imports.importingId}
            />
          ) : (
            <Note role="note">{t('ws.noInventory')}</Note>
          )}
        </TabsContent>

        <TabsContent value="pixels" className="space-y-3">
          {latest.isLoading ? (
            <LoadingRegion className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </LoadingRegion>
          ) : latest.isError ? (
            <ErrorState title={t('ws.latestFailed')} error={latest.error} onRetry={() => latest.refetch()} />
          ) : data ? (
            <AssetInventory
              result={data.pixels}
              edge={edgeFilter}
              status={statusFilter}
              onEdgeChange={setEdgeFilter}
              onStatusChange={setStatusFilter}
              emptyNote={data.pixels.registry_absence_evaluable === false ? t('disc.pixelNoMapping') : undefined}
            />
          ) : (
            <Note role="note">{t('ws.noInventory')}</Note>
          )}
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab connectionId={connectionId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
