import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { DiscoveryRun, MetaConnection, Paged } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton, Tabs } from '../components/ui'
import { AssetInventory, type EdgeFilter, type StatusFilter } from '../components/meta/AssetInventory'
import { CoverageBadge } from '../components/meta/DiscoverySection'
import { ReaderSourceBadge, readerSourceNote } from '../components/meta/ReaderSource'
import { HistoryTab } from './meta-connection/HistoryTab'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'ad-accounts', label: 'Ad Accounts' },
  { key: 'pixels', label: 'Pixels' },
  { key: 'history', label: 'Discovery History' },
]

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
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') ?? 'overview'
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

  const importAccount = useMutation({
    // The run id is in the path, not "latest": the operator is acting on the result in front of
    // them, and a run that completed between rendering and clicking must not silently become the
    // evidence for a write.
    mutationFn: (externalId: string) =>
      api.post(`/api/v1/meta-connections/${connectionId}/discoveries/${data?.id}/imports`, {
        external_account_id: externalId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: latestKey })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery-summary'] })
    },
  })

  if (connection.isLoading) return <Skeleton rows={8} />
  if (connection.isError)
    return <ErrorState error={connection.error} onRetry={() => connection.refetch()} />

  const record = connection.data!

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link to="/meta-connections" className="text-[12px] text-ink-muted hover:text-ink">
          ← Meta Connection
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[17px] font-semibold">{record.label}</h1>
          {record.environment === 'fake' && <Badge tone="neutral">Fake (local testing)</Badge>}
          {record.environment === 'sandbox' && <Badge tone="info">Sandbox</Badge>}
          {record.environment === 'production' && <Badge tone="caution">Production</Badge>}
          {record.business_manager_source === 'server' && (
            <Badge tone="neutral">Uses the server&apos;s Business Manager</Badge>
          )}
        </div>
        <p className="text-[12.5px] text-ink-muted">
          Everything below is what this connection&apos;s identity could read at a moment in time.
          Discovery only reads: nothing in Meta is created, shared or changed from this page.
        </p>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {latest.isLoading ? (
        <Skeleton rows={5} />
      ) : latest.isError ? (
        <ErrorState error={latest.error} onRetry={() => latest.refetch()} />
      ) : (
        <>
          {tab === 'overview' && (
            <div className="space-y-3">
              <Card
                title="Latest read-only discovery"
                action={
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => run.mutate()}
                    disabled={run.isPending}
                  >
                    {run.isPending ? 'Reading…' : 'Run read-only discovery'}
                  </button>
                }
              >
                {!data ? (
                  <p className="text-[12.5px] text-ink-faint">
                    No discovery has been run for this connection yet.
                  </p>
                ) : (
                  <div className="space-y-2 text-[12.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-muted">
                        Business Manager:{' '}
                        {data.business_manager.name ?? data.business_manager.reference ?? 'not configured'}
                      </span>
                      {data.freshness === 'stale' && <Badge tone="caution">Stale reading</Badge>}
                      {bmReference &&
                        // Never a guess. A failed lookup says so; it must not read as "absent",
                        // which is the whole discipline this product is built on.
                        (registryBm.isLoading ? (
                          <span className="text-[11.5px] text-ink-faint">Checking the registry…</span>
                        ) : registryBm.isError ? (
                          <Badge tone="neutral">Registry could not be checked</Badge>
                        ) : registryRow ? (
                          <Badge tone="positive">In the registry</Badge>
                        ) : (
                          <Badge tone="neutral">Not in the registry yet</Badge>
                        ))}
                    </div>
                    {bmReference && !registryBm.isLoading && !registryBm.isError && !registryRow && (
                      <p className="text-[11.5px] text-ink-faint">
                        This Business Manager has no record in the registry yet. Adding any ad
                        account from this run creates one — nothing in Meta is touched either way.
                      </p>
                    )}
                    <div className="grid gap-1 sm:grid-cols-2">
                      <span className="flex items-center gap-2">
                        <span className="text-ink-muted">
                          Ad accounts returned: {data.ad_accounts.coverage.total_unique_assets ?? '—'}
                        </span>
                        <CoverageBadge status={data.ad_accounts.coverage_status} />
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-ink-muted">
                          Pixels returned: {data.pixels.coverage.total_unique_assets ?? '—'}
                        </span>
                        <CoverageBadge status={data.pixels.coverage_status} />
                      </span>
                    </div>
                    {data.failure_code && (
                      <p className="text-[11.5px] text-rose-700">
                        {data.failure_summary ?? 'The run did not complete.'} ({data.failure_code})
                      </p>
                    )}
                    <p className="text-[11.5px] text-ink-faint">
                      Read at{' '}
                      {data.completed_at ? formatDateTime(data.completed_at) : 'an unknown time'} as{' '}
                      <strong>
                        {data.read_as?.name || data.read_as?.external_id || 'an unknown identity'}
                      </strong>
                      . A different system user may see a different set — this is what this identity
                      could read, not everything the Business Manager holds.
                    </p>
                    {data.business_authority === 'not_established' && (
                      // Measured on real Meta: a token with no role in a Business Manager still
                      // reads its node, and every asset edge answers 200 with an empty list and no
                      // error. Without this sentence an empty result reads as "this BM is empty".
                      <InlineNote tone="attention">
                        <strong>Access to this Business Manager could not be established.</strong>{' '}
                        Nothing came back, and this identity could not prove it is allowed to read
                        this Business Manager&apos;s assets — so an empty result is not evidence
                        that the Business Manager is empty. No record is being treated as missing on
                        the strength of this run.
                      </InlineNote>
                    )}
                  </div>
                )}
                {run.isError && (
                  <p className="mt-2 text-[11.5px] text-rose-700">
                    The discovery could not be started.
                  </p>
                )}
              </Card>

              <Card title="Connection">
                <div className="space-y-1.5 text-[12.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">Reader credential</span>
                    <ReaderSourceBadge source={record.reader_source} />
                  </div>
                  {readerSourceNote(record.reader_source) && (
                    <p className="text-[11.5px] text-ink-faint">{readerSourceNote(record.reader_source)}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Business Manager in use</span>
                    <span className="font-mono text-[11.5px]">
                      {record.business_manager_reference ?? "the server's"}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-ink-faint">
                    Last capability check:{' '}
                    {record.last_capability_check_at
                      ? formatDateTime(record.last_capability_check_at)
                      : 'never'}
                  </p>
                </div>
              </Card>
            </div>
          )}

          {tab === 'ad-accounts' &&
            (data ? (
              <AssetInventory
                result={data.ad_accounts}
                edge={edgeFilter}
                status={statusFilter}
                onEdgeChange={setEdgeFilter}
                onStatusChange={setStatusFilter}
                onImport={(externalId) => importAccount.mutate(externalId)}
                importingId={importAccount.isPending ? (importAccount.variables ?? null) : null}
              />
            ) : (
              <InlineNote>
                No discovery has been run for this connection yet, so there is no inventory to show.
              </InlineNote>
            ))}

          {tab === 'pixels' &&
            (data ? (
              <AssetInventory
                result={data.pixels}
                edge={edgeFilter}
                status={statusFilter}
                onEdgeChange={setEdgeFilter}
                onStatusChange={setStatusFilter}
                emptyNote={
                  data.pixels.registry_absence_evaluable === false
                    ? 'Pixel Business Manager mapping is not recorded yet, so a registry Pixel cannot be evaluated for absence from this Business Manager.'
                    : undefined
                }
              />
            ) : (
              <InlineNote>
                No discovery has been run for this connection yet, so there is no inventory to show.
              </InlineNote>
            ))}

          {tab === 'history' && <HistoryTab connectionId={connectionId} />}

          {importAccount.isError && (
            // The server's own sentence, not a generic one: "already uses this external account
            // ID" and "was not returned by that discovery run" are different problems with
            // different fixes, and collapsing them hides which one happened.
            <p className="text-[11.5px] text-rose-700">
              {importAccount.error instanceof ApiError
                ? importAccount.error.message
                : 'The account could not be added to the registry.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
