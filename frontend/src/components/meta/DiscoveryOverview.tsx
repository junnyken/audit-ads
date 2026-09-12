import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatRelative } from '../../lib/format'
import type { CoverageStatus, DiscoverySummaryRow, MetaEnvironment } from '../../lib/types'
import { Badge, Card, ErrorState } from '../ui'

/** A table, not a row of cards. Cards read well up to about four items; this has to stay legible
 * at several Business Managers with eight-plus ad accounts each, and the useful comparison is
 * down a column — coverage against coverage, count against count. */

function CoverageBadge({ status }: { status: CoverageStatus }) {
  if (status === 'complete') return <Badge tone="positive">Complete</Badge>
  if (status === 'not_attempted') return <Badge tone="neutral">Not attempted</Badge>
  if (status === 'partial' || status === 'stale') return <Badge tone="caution">{status === 'stale' ? 'Stale' : 'Partial'}</Badge>
  return <Badge tone="attention">{status === 'unknown' ? 'Unknown' : 'Incomplete'}</Badge>
}

/** A fake connection's numbers are invented by a local seed. Rendered unlabelled next to a real
 * Business Manager — same badges, same column — they read as an observation of Meta, which is
 * the one thing this product must never let a screen say. */
function EnvironmentBadge({ environment }: { environment: MetaEnvironment }) {
  if (environment === 'production') return null
  if (environment === 'sandbox') return <Badge tone="caution">Sandbox</Badge>
  return <Badge tone="attention">Fake data</Badge>
}

function edgeBreakdown(edges: Record<string, { items: number }> | undefined): string {
  const parts = Object.entries(edges ?? {}).map(([edge, e]) => {
    const label = edge === 'owned_ad_accounts' ? 'owned' : edge === 'client_ad_accounts' ? 'client' : edge
    return `${e.items} ${label}`
  })
  return parts.join(' · ')
}

/** Presentation only, so it can be rendered from a test with rows as props. */
export function DiscoveryOverviewTable({ rows }: { rows: DiscoverySummaryRow[] }) {
  // Every connection reads the same configured Business Manager today, so two connections put
  // two rows carrying one business on this table. Each row is true on its own; stacked, they
  // read as two Business Managers and invite adding 8 and 8 into 16. Name the repeat instead.
  const seen = new Map<string, number>()
  for (const row of rows) {
    const reference = row.run?.business_manager.reference
    if (reference) seen.set(reference, (seen.get(reference) ?? 0) + 1)
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-ink-muted">
              <th className="pb-1.5 pr-3 font-medium">Business Manager</th>
              <th className="pb-1.5 pr-3 font-medium">Ad accounts</th>
              <th className="pb-1.5 pr-3 font-medium">Pixels</th>
              <th className="pb-1.5 pr-3 font-medium">Read as</th>
              <th className="pb-1.5 font-medium">Last observed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.connection_id} className="border-b border-line last:border-0 align-top">
                <td className="py-2 pr-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">
                      {row.run?.business_manager.name ?? row.connection_label}
                    </span>
                    <EnvironmentBadge environment={row.environment} />
                    {(seen.get(row.run?.business_manager.reference ?? '') ?? 0) > 1 && (
                      <Badge tone="caution">Same Business Manager as another row</Badge>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {row.run?.business_manager.reference ?? 'not configured'}
                  </span>
                  {row.run?.business_manager.name &&
                    row.run.business_manager.name.trim().toLowerCase() !==
                      row.connection_label.trim().toLowerCase() && (
                      // The row is a connection, and its label is a nickname somebody typed. It
                      // belongs on screen so a reader can tell two rows apart, but never in place
                      // of the Business Manager that was actually read.
                      <span className="block text-[11px] text-ink-faint">
                        connection: {row.connection_label}
                      </span>
                    )}
                </td>
                {row.run === null ? (
                  <td className="py-2 pr-3 text-ink-faint" colSpan={4}>
                    No discovery has been run yet.
                  </td>
                ) : (
                  <>
                    <td className="py-2 pr-3">
                      <span className="mr-1.5">{row.run.ad_accounts.count ?? '—'}</span>
                      <CoverageBadge status={row.run.ad_accounts.coverage_status} />
                      <span className="block text-[11px] text-ink-faint">
                        {edgeBreakdown(row.run.ad_accounts.edges)}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="mr-1.5">{row.run.pixels.count ?? '—'}</span>
                      <CoverageBadge status={row.run.pixels.coverage_status} />
                    </td>
                    {/* Never a bare count: the same BM returns different assets to different
                        system users, so the reader travels with the number. */}
                    <td className="py-2 pr-3">
                      <span className="block">{row.run.read_as.name ?? 'unknown identity'}</span>
                      {row.run.business_authority === 'not_established' ? (
                        // The reason behind an `unknown` coverage, said plainly. Without it the
                        // row reads as "this Business Manager is empty", which is the false
                        // conclusion the gate exists to prevent.
                        <span className="text-[11px] font-medium text-rose-700">
                          could not prove access to this Business Manager
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-faint">
                          a narrower identity would see less
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {row.run.completed_at ? formatRelative(row.run.completed_at) : '—'}
                      {row.run.freshness === 'stale' && (
                        <span className="ml-1.5">
                          <Badge tone="caution">Stale</Badge>
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-faint">
        What each connection&apos;s most recent read returned. Counts are only meaningful next to
        their coverage and the identity that read them — a run that missed a required source, or
        one made by a narrower system user, legitimately returns fewer assets. Discovery reads
        Meta; it does not create records here, so these Business Managers do not appear under
        Business Managers or Accounts until someone registers them.
      </p>
    </>
  )
}

export function DiscoveryOverview({ isOwner }: { isOwner: boolean }) {
  const rows = useQuery({
    queryKey: ['meta-discovery-summary'],
    // Connections are owner-only; asking as anyone else would just produce a refusal to render.
    enabled: isOwner,
    queryFn: () => api.get<DiscoverySummaryRow[]>('/api/v1/meta-connections/discovery-summary'),
  })

  if (!isOwner) return null
  if (rows.isLoading) return null

  // A failed read is reported, not hidden. Returning null here once turned a 422 into a card that
  // silently did not exist, which reads from the outside exactly like "nothing was discovered".
  if (rows.isError) {
    return (
      <Card title="Business Manager discovery">
        <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
      </Card>
    )
  }

  // Nothing configured yet is a genuinely empty state, not a failure: stay quiet.
  if (!rows.data || rows.data.length === 0) return null

  return (
    <Card
      title="Business Manager discovery"
      action={
        <Link to="/meta-connections" className="text-[12px] font-medium text-brand hover:underline">
          Open Meta connection
        </Link>
      }
    >
      <DiscoveryOverviewTable rows={rows.data} />
    </Card>
  )
}
