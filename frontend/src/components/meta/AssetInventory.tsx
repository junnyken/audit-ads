import type { DiscoveryAssetResult, ReconciliationRow } from '../../lib/types'
import { CoverageBadge, ReconciliationBadge, edgeLabel, whyNotMissing } from './DiscoverySection'
import { EmptyState, InlineNote } from '../ui'

export type EdgeFilter = 'all' | string
export type StatusFilter = 'all' | ReconciliationRow['status']

export function filterRows(
  rows: ReconciliationRow[],
  edge: EdgeFilter,
  status: StatusFilter,
): ReconciliationRow[] {
  return rows.filter((row) => {
    // A row with no edge came from the registry, not from an observation. Filtering by edge must
    // therefore drop it rather than sweep it into whichever edge is selected: it was not returned
    // by that edge, and showing it there would assert a reading that never happened.
    if (edge !== 'all' && row.source_edge !== edge) return false
    if (status !== 'all' && row.status !== status) return false
    return true
  })
}

/** The inventory of one asset type for one run: what was read, whether that read can support a
 * conclusion about absence, and every row with the edge that produced it.
 *
 * Pure and exported so the wording and the filtering can be tested without a network.
 */
export function AssetInventory({
  result,
  edge,
  status,
  onEdgeChange,
  onStatusChange,
  onImport,
  importingId,
  emptyNote,
}: {
  result: DiscoveryAssetResult
  edge: EdgeFilter
  status: StatusFilter
  onEdgeChange: (edge: EdgeFilter) => void
  onStatusChange: (status: StatusFilter) => void
  /** Ad accounts only. A registry Pixel has no Business Manager relationship in the A1 schema,
   * so there is nothing to import a Pixel into. */
  onImport?: (externalId: string) => void
  importingId?: string | null
  emptyNote?: string
}) {
  const edges = Object.entries(result.coverage.edges ?? {})
  const rows = filterRows(result.reconciliation, edge, status)
  const returned = result.coverage.total_unique_assets ?? result.reconciliation.length

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-line p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {/* "returned", not "discovered": this is what one identity could read at one moment,
              never a claim about everything the Business Manager holds. */}
          <span className="text-[13px] font-medium">Returned by this run: {returned}</span>
          <CoverageBadge status={result.coverage_status} />
        </div>
        {edges.length > 0 && (
          <ul className="space-y-1">
            {edges.map(([name, coverage]) => (
              <li key={name} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-muted">
                  {edgeLabel(name)}
                  {coverage.required ? '' : ' (optional)'}
                </span>
                <span className="flex items-center gap-2">
                  {coverage.status === 'completed' ? (
                    <span className="text-ink-muted">
                      {coverage.items} item{coverage.items === 1 ? '' : 's'} · {coverage.pages} page
                      {coverage.pages === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-amber-700">
                      {coverage.error_code ?? coverage.status.replace('_', ' ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!result.complete && result.coverage_status !== 'not_attempted' && (
          <p className="mt-2 text-[11.5px] text-amber-700">
            No internal record is classified as missing from this run,{' '}
            {whyNotMissing(result.coverage_status)}.
          </p>
        )}
        {emptyNote && <p className="mt-2 text-[11.5px] text-ink-faint">{emptyNote}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-ink-muted" htmlFor="inventory-edge">
          Source
        </label>
        <select
          id="inventory-edge"
          className="input max-w-[200px]"
          value={edge}
          onChange={(event) => onEdgeChange(event.target.value)}
        >
          <option value="all">All sources</option>
          {edges.map(([name]) => (
            <option key={name} value={name}>
              {edgeLabel(name)}
            </option>
          ))}
        </select>
        <label className="text-[12px] text-ink-muted" htmlFor="inventory-status">
          Status
        </label>
        <select
          id="inventory-status"
          className="input max-w-[220px]"
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="matched">Matched</option>
          <option value="missing_in_registry">Not in registry</option>
          <option value="missing_from_latest_discovery">
            Not returned by the latest completed discovery
          </option>
          <option value="out_of_scope">Cannot be evaluated</option>
          <option value="unknown">Unknown</option>
        </select>
        <span className="text-[12px] text-ink-faint">
          Showing {rows.length} of {result.reconciliation.length}
        </span>
      </div>

      {result.reconciliation.length === 0 ? (
        <EmptyState
          title="Nothing to reconcile yet"
          description="This run returned no assets and no internal record was evaluated against it."
        />
      ) : rows.length === 0 ? (
        <InlineNote>
          No row matches this filter. That is a statement about the filter, not about the Business
          Manager.
        </InlineNote>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {rows.map((row) => (
            <li
              key={`${row.external_id ?? 'none'}-${row.internal_entity_id ?? 'none'}`}
              className="flex items-start justify-between gap-3 px-3 py-2 text-[12.5px]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.display_name || '(no name)'}</span>
                <span className="font-mono text-[11px] text-ink-faint">{row.external_id ?? '—'}</span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  {row.source_edge
                    ? `Returned by ${edgeLabel(row.source_edge)}`
                    : 'No observation from this run matched this internal record'}
                  {row.detail ? ` · ${row.detail}` : ''}
                </span>
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
