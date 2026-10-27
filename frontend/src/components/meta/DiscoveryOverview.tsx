import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatRelative } from '../../lib/format'
import type { DiscoverySummaryRow, MetaEnvironment } from '../../lib/types'
import { useI18n } from '../../i18n'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { Skeleton } from '../primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { EmptyState, ErrorState, LoadingRegion } from '../states'
import { CoverageBadge, edgeShortLabel, type T } from './DiscoverySection'

/** A table, not a row of cards. Cards read well up to about four items; this has to stay legible
 * at several Business Managers with eight-plus ad accounts each, and the useful comparison is
 * down a column — coverage against coverage, count against count. */

/** A fake connection's numbers are invented by a local seed. Rendered unlabelled next to a real
 * Business Manager — same badges, same column — they read as an observation of Meta, which is
 * the one thing this product must never let a screen say. */
function EnvironmentBadge({ environment }: { environment: MetaEnvironment }) {
  const { t } = useI18n()
  if (environment === 'production') return null
  if (environment === 'sandbox') return <Badge tone="caution">{t('metaEnv.sandbox')}</Badge>
  return <Badge tone="attention">{t('meta.fakeData')}</Badge>
}

function edgeBreakdown(t: T, edges: Record<string, { items: number }> | undefined): string {
  return Object.entries(edges ?? {})
    .map(([edge, e]) => `${e.items} ${edgeShortLabel(t, edge)}`)
    .join(' · ')
}

/** Presentation only, so it can be rendered from a test with rows as props. */
export function DiscoveryOverviewTable({ rows }: { rows: DiscoverySummaryRow[] }) {
  const { t } = useI18n()
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
      <Table cards>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dov.col.bm')}</TableHead>
            <TableHead>{t('dov.col.adAccounts')}</TableHead>
            <TableHead>{t('dov.col.pixels')}</TableHead>
            <TableHead>{t('dov.col.readAs')}</TableHead>
            <TableHead>{t('dov.col.last')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.connection_id} className="align-top">
              <TableCell label={t('dov.col.bm')}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{row.run?.business_manager.name ?? row.connection_label}</span>
                  <EnvironmentBadge environment={row.environment} />
                  {(seen.get(row.run?.business_manager.reference ?? '') ?? 0) > 1 && (
                    <Badge tone="caution">{t('dov.sameBm')}</Badge>
                  )}
                </span>
                <span className="font-mono text-2xs text-ink-faint">
                  {row.run?.business_manager.reference ?? t('meta.notConfigured')}
                </span>
                {row.run?.business_manager.name &&
                  row.run.business_manager.name.trim().toLowerCase() !==
                    row.connection_label.trim().toLowerCase() && (
                    // The row is a connection, and its label is a nickname somebody typed. It
                    // belongs on screen so a reader can tell two rows apart, but never in place
                    // of the Business Manager that was actually read.
                    <span className="block text-2xs text-ink-faint">
                      {t('dov.connection', { label: row.connection_label })}
                    </span>
                  )}
              </TableCell>
              {row.run === null ? (
                <TableCell colSpan={4} className="text-ink-faint">
                  {t('dov.noRun')}
                </TableCell>
              ) : (
                <>
                  <TableCell label={t('dov.col.adAccounts')}>
                    <span className="mr-1.5">{row.run.ad_accounts.count ?? '—'}</span>
                    <CoverageBadge status={row.run.ad_accounts.coverage_status} />
                    <span className="block text-2xs text-ink-faint">
                      {edgeBreakdown(t, row.run.ad_accounts.edges)}
                    </span>
                  </TableCell>
                  <TableCell label={t('dov.col.pixels')}>
                    <span className="mr-1.5">{row.run.pixels.count ?? '—'}</span>
                    <CoverageBadge status={row.run.pixels.coverage_status} />
                  </TableCell>
                  {/* Never a bare count: the same BM returns different assets to different
                      system users, so the reader travels with the number. */}
                  <TableCell label={t('dov.col.readAs')}>
                    <span className="block">{row.run.read_as.name ?? t('meta.unknownIdentity')}</span>
                    {row.run.business_authority === 'not_established' ? (
                      // The reason behind an `unknown` coverage, said plainly. Without it the
                      // row reads as "this Business Manager is empty", which is the false
                      // conclusion the gate exists to prevent.
                      <span className="text-2xs font-medium text-tone-attention-fg">{t('dov.noAuthority')}</span>
                    ) : (
                      <span className="text-2xs text-ink-faint">{t('dov.narrower')}</span>
                    )}
                  </TableCell>
                  <TableCell label={t('dov.col.last')}>
                    {row.run.completed_at ? formatRelative(row.run.completed_at) : '—'}
                    {row.run.freshness === 'stale' && (
                      <span className="ml-1.5">
                        <Badge tone="caution">{t('coverage.stale')}</Badge>
                      </span>
                    )}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-ink-faint">{t('dov.footnote')}</p>
    </>
  )
}

export function DiscoveryOverview({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n()
  const rows = useQuery({
    queryKey: ['meta-discovery-summary'],
    // Connections are owner-only; asking as anyone else would just produce a refusal to render.
    enabled: isOwner,
    queryFn: () => api.get<DiscoverySummaryRow[]>('/api/v1/meta-connections/discovery-summary'),
  })

  if (!isOwner) return null

  const header = (
    <CardHeader className="items-center">
      <CardTitle className="text-sm">{t('dov.title')}</CardTitle>
      <Link to="/meta-connections" className="text-sm font-medium text-brand-text hover:underline">
        {t('dov.open')}
      </Link>
    </CardHeader>
  )

  if (rows.isLoading) {
    return (
      <Card>
        {header}
        <CardContent>
          <LoadingRegion className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </LoadingRegion>
        </CardContent>
      </Card>
    )
  }

  // A failed read is reported, not hidden. Returning null here once turned a 422 into a card that
  // silently did not exist, which reads from the outside exactly like "nothing was discovered".
  if (rows.isError) {
    return (
      <Card>
        {header}
        <CardContent>
          <ErrorState title={t('dov.error')} error={rows.error} onRetry={() => rows.refetch()} />
        </CardContent>
      </Card>
    )
  }

  // Nothing configured yet is an empty state, not a failure — and not an absent card: a card that
  // is simply not there reads, from the outside, exactly like "nothing was discovered". It says
  // what is missing and where the next step is.
  if (!rows.data || rows.data.length === 0) {
    return (
      <Card>
        {header}
        <CardContent>
          <EmptyState
            title={t('dov.empty.title')}
            description={t('dov.empty.body')}
            action={
              <>
                <Button asChild>
                  <Link to="/meta-connections">{t('dov.empty.add')}</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link to="/settings#meta-readers">{t('dov.empty.facebook')}</Link>
                </Button>
              </>
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {header}
      <CardContent>
        <DiscoveryOverviewTable rows={rows.data} />
      </CardContent>
    </Card>
  )
}
