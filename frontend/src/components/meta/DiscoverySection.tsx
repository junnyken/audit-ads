import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type {
  CoverageStatus,
  DiscoveryAssetResult,
  DiscoveryRun,
  ReconciliationRow,
  ReconciliationStatus,
} from '../../lib/types'
import { Badge, InlineNote } from '../ui'

/** Coverage is never styled as success unless it is actually complete. `partial`, `incomplete`
 * and `unknown` all mean the same thing to the operator — this run cannot be used to conclude
 * anything is absent — so none of them may look reassuring. */
function CoverageBadge({ status }: { status: CoverageStatus }) {
  if (status === 'complete') return <Badge tone="positive">Complete</Badge>
  if (status === 'not_attempted') return <Badge tone="neutral">Not attempted</Badge>
  if (status === 'partial') return <Badge tone="caution">Partial</Badge>
  if (status === 'stale') return <Badge tone="caution">Stale</Badge>
  return <Badge tone="attention">{status === 'unknown' ? 'Unknown' : 'Incomplete'}</Badge>
}

const RECONCILIATION_LABEL: Record<ReconciliationStatus, string> = {
  matched: 'Matched',
  missing_in_registry: 'Not in registry',
  // Deliberately factual. Never "deleted", "removed" or "lost" — this product only knows what
  // the latest completed discovery returned.
  missing_from_latest_discovery: 'Not returned by the latest completed discovery',
  metadata_mismatch: 'Metadata differs',
  out_of_scope: 'Cannot be evaluated',
  unknown: 'Unknown',
  not_evaluated: 'Not evaluated',
}

function ReconciliationBadge({ status }: { status: ReconciliationStatus }) {
  if (status === 'matched') return <Badge tone="positive">{RECONCILIATION_LABEL[status]}</Badge>
  if (status === 'missing_in_registry') return <Badge tone="info">{RECONCILIATION_LABEL[status]}</Badge>
  if (status === 'missing_from_latest_discovery')
    return <Badge tone="caution">{RECONCILIATION_LABEL[status]}</Badge>
  return <Badge tone="neutral">{RECONCILIATION_LABEL[status]}</Badge>
}

function edgeLabel(edge: string): string {
  if (edge === 'owned_ad_accounts') return 'Owned accounts'
  if (edge === 'client_ad_accounts') return 'Client accounts'
  if (edge === 'adspixels') return 'Business Pixels'
  return edge
}

/** Exported so the wording rules can be tested directly, the way the other component tests in
 * this project work: props in, rendered output asserted, no network. */
export function AssetResult({
  title,
  result,
  emptyNote,
  onImport,
  importingId,
}: {
  title: string
  result: DiscoveryAssetResult
  emptyNote?: string
  /** Supplied only for ad accounts. A registry Pixel has no Business Manager relationship in the
   * A1 schema, so there is nothing to import a Pixel *into* — offering the button there would
   * promise a mapping the schema cannot hold. */
  onImport?: (externalId: string) => void
  importingId?: string | null
}) {
  const edges = Object.entries(result.coverage.edges ?? {})
  const completed = edges.filter(([, e]) => e.status === 'completed')
  const notCompleted = edges.filter(([, e]) => e.status !== 'completed')
  const returned = result.coverage.total_unique_assets ?? result.reconciliation.length

  return (
    <div className="rounded-md border border-line p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        {/* "returned", not "discovered": the wording must not imply this is everything in Meta. */}
        <span className="text-[12.5px] font-medium">
          {title} returned: {returned}
        </span>
        <CoverageBadge status={result.coverage_status} />
      </div>

      {completed.length > 0 && (
        <p className="text-[11.5px] text-ink-muted">
          Completed: {completed.map(([edge, e]) => `${edgeLabel(edge)} (${e.items})`).join(', ')}
        </p>
      )}
      {notCompleted.length > 0 && (
        <p className="text-[11.5px] text-amber-700">
          Not completed:{' '}
          {notCompleted
            .map(([edge, e]) => `${edgeLabel(edge)} (${e.error_code ?? e.status.replace('_', ' ')})`)
            .join(', ')}
        </p>
      )}

      {!result.complete && result.coverage_status !== 'not_attempted' && (
        <p className="mt-1 text-[11.5px] text-amber-700">
          No internal record is classified as missing from this run, because not every required
          source was read.
        </p>
      )}
      {emptyNote && <p className="mt-1 text-[11.5px] text-ink-faint">{emptyNote}</p>}

      {result.reconciliation.length > 0 && (
        <ul className="mt-2 space-y-1">
          {result.reconciliation.map((row: ReconciliationRow) => (
            <li
              key={`${row.external_id ?? 'none'}-${row.internal_entity_id ?? 'none'}`}
              className="flex items-start justify-between gap-2 text-[12px]"
            >
              <span className="min-w-0">
                <span className="block truncate">{row.display_name || '(no name)'}</span>
                <span className="font-mono text-[11px] text-ink-faint">{row.external_id ?? '—'}</span>
                {row.detail && <span className="block text-[11px] text-ink-faint">{row.detail}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <ReconciliationBadge status={row.status} />
                {onImport && row.status === 'missing_in_registry' && row.external_id && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onImport(row.external_id as string)}
                    disabled={importingId === row.external_id}
                  >
                    {importingId === row.external_id ? 'Adding…' : 'Add to registry'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DiscoverySection({
  connectionId,
  connectionLabel,
}: {
  connectionId: string
  connectionLabel: string
}) {
  const queryClient = useQueryClient()
  const key = ['meta-discovery', connectionId]

  const latest = useQuery({
    queryKey: key,
    queryFn: () => api.get<DiscoveryRun | null>(`/api/v1/meta-connections/${connectionId}/discoveries/latest`),
  })
  const run = useMutation({
    mutationFn: () => api.post<DiscoveryRun>(`/api/v1/meta-connections/${connectionId}/discoveries`),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data)
    },
  })

  const data = latest.data

  const importAccount = useMutation({
    // The run id is in the path, not "latest": the operator is acting on the result in front of
    // them, and a run that completed between rendering and clicking must not silently become the
    // evidence for a write.
    mutationFn: (externalId: string) =>
      api.post(
        `/api/v1/meta-connections/${connectionId}/discoveries/${data?.id}/imports`,
        { external_account_id: externalId },
      ),
    onSuccess: () => {
      // The discovery view recomputes reconciliation against the registry, so this row flips from
      // "Not in registry" to "Matched" on its own. Accounts and Business Managers are invalidated
      // too — the record now exists on those pages, and leaving them stale would show an empty
      // registry seconds after an import said it succeeded.
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-discovery-summary'] })
    },
  })

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium">Read-only discovery</span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => run.mutate()}
          disabled={run.isPending}
        >
          {run.isPending ? 'Reading…' : 'Run read-only discovery'}
        </button>
      </div>
      <p className="mb-2 text-[11.5px] text-ink-faint">
        Reads the ad accounts and Pixels returned for the configured Business Manager. Nothing in
        Meta is created, shared or changed.
      </p>

      {latest.isLoading && <p className="text-[12px] text-ink-faint">Loading…</p>}
      {!latest.isLoading && !data && (
        <p className="text-[12px] text-ink-faint">No discovery has been run for this connection yet.</p>
      )}

      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-ink-muted">
              Business Manager:{' '}
              {data.business_manager.name ?? data.business_manager.reference ?? 'not configured'}
            </span>
            {data.business_manager.name &&
              data.business_manager.name.trim().toLowerCase() !== connectionLabel.trim().toLowerCase() && (
                // The connection label is a nickname an operator typed; the Business Manager is
                // whatever the server is configured to read. Today every connection reads the
                // same configured BM, so a card headed "Triu Shop" can list another business's
                // accounts. Both facts are true, and side by side they invite one false reading.
                <Badge tone="caution">Label differs from the Business Manager read</Badge>
              )}
            {data.freshness === 'stale' && <Badge tone="caution">Stale reading</Badge>}
          </div>
          {data.failure_code && (
            <p className="text-[11.5px] text-rose-700">
              {data.failure_summary ?? 'The run did not complete.'} ({data.failure_code})
            </p>
          )}
          <AssetResult
            title="Ad accounts"
            result={data.ad_accounts}
            onImport={(externalId) => importAccount.mutate(externalId)}
            importingId={importAccount.isPending ? (importAccount.variables ?? null) : null}
          />
          <AssetResult
            title="Pixels"
            result={data.pixels}
            emptyNote={
              data.pixels.registry_absence_evaluable === false
                ? 'Pixel Business Manager mapping is not recorded yet, so a registry Pixel cannot be evaluated for absence from this Business Manager.'
                : undefined
            }
          />
          <p className="text-[11.5px] text-ink-faint">
            Assets returned for this configured Business Manager at{' '}
            {data.completed_at ? formatDateTime(data.completed_at) : 'an unknown time'}, as seen
            by{' '}
            <strong>{data.read_as?.name || data.read_as?.external_id || 'an unknown identity'}</strong>
            . A different system user may see a different set — this is what this identity could
            read, not everything the Business Manager holds.
          </p>
          {data.business_authority === 'not_established' && (
            // Measured on real Meta: a token with no role in a Business Manager still reads its
            // node, and every asset edge answers 200 with an empty list and no error. Without
            // this sentence an empty result reads as "this Business Manager is empty".
            <InlineNote tone="attention">
              <strong>Access to this Business Manager could not be established.</strong> Nothing
              came back, and this identity could not prove it is allowed to read this Business
              Manager&apos;s assets — so an empty result is not evidence that the Business Manager
              is empty. No record is being treated as missing on the strength of this run.
            </InlineNote>
          )}
        </div>
      )}
      {run.isError && <p className="mt-2 text-[11.5px] text-rose-700">The discovery could not be started.</p>}
      {importAccount.isError && (
        // The server's own sentence, not a generic one: "already uses this external account ID"
        // and "was not returned by that discovery run" are different problems with different
        // fixes, and collapsing them into "import failed" hides which one happened.
        <p className="mt-2 text-[11.5px] text-rose-700">
          {importAccount.error instanceof ApiError
            ? importAccount.error.message
            : 'The account could not be added to the registry.'}
        </p>
      )}
    </div>
  )
}
