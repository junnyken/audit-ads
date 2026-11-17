import { useRef, useState } from 'react'
import type { DiscoveryAssetResult, ReconciliationRow } from '../../lib/types'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { EmptyState } from '../states'
import { Note } from '../../pages/account/parts'
import { CoverageBadge, ReconciliationBadge, edgeLabel, edgeProblem, reconciliationLabel, whyNotMissing } from './DiscoverySection'
import { ImportConfirmDialog } from './ImportConfirmDialog'

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

const STATUS_OPTIONS: ReconciliationRow['status'][] = [
  'matched',
  'missing_in_registry',
  'missing_from_latest_discovery',
  'out_of_scope',
  'unknown',
]

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
   * so there is nothing to import a Pixel into. Resolves when the write and its read-back are done. */
  onImport?: (externalId: string, name: string) => Promise<unknown> | void
  importingId?: string | null
  emptyNote?: string
}) {
  const { t } = useI18n()
  const [pending, setPending] = useState<{ external_id: string; name: string } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const edges = Object.entries(result.coverage.edges ?? {})
  const rows = filterRows(result.reconciliation, edge, status)
  const returned = result.coverage.total_unique_assets ?? result.reconciliation.length

  return (
    <div ref={rootRef} tabIndex={-1} className="space-y-3 outline-none">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {/* "returned", not "discovered": this is what one identity could read at one moment,
              never a claim about everything the Business Manager holds. */}
          <span className="text-sm font-medium">{t('inv.returned', { n: returned })}</span>
          <CoverageBadge status={result.coverage_status} />
        </div>
        {edges.length > 0 && (
          <ul className="space-y-1">
            {edges.map(([name, coverage]) => (
              <li key={name} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-muted">
                  {edgeLabel(t, name)}
                  {coverage.required ? '' : ` ${t('inv.optional')}`}
                </span>
                {coverage.status === 'completed' ? (
                  <span className="text-ink-muted">{t('inv.items', { items: coverage.items, pages: coverage.pages })}</span>
                ) : (
                  <span className="text-tone-caution-fg">{edgeProblem(t, coverage.status, coverage.error_code)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!result.complete && result.coverage_status !== 'not_attempted' && (
          <p className="mt-2 text-xs text-tone-caution-fg">
            {t('disc.noMissing', { why: whyNotMissing(t, result.coverage_status) })}
          </p>
        )}
        {emptyNote && <p className="mt-2 text-xs text-ink-faint">{emptyNote}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-muted" htmlFor="inventory-edge">
          {t('inv.source')}
        </label>
        <select
          id="inventory-edge"
          className="input max-w-[200px]"
          value={edge}
          onChange={(event) => onEdgeChange(event.target.value)}
        >
          <option value="all">{t('inv.allSources')}</option>
          {edges.map(([name]) => (
            <option key={name} value={name}>
              {edgeLabel(t, name)}
            </option>
          ))}
        </select>
        <label className="text-xs text-ink-muted" htmlFor="inventory-status">
          {t('inv.status')}
        </label>
        <select
          id="inventory-status"
          className="input max-w-[260px]"
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
        >
          <option value="all">{t('inv.allStatuses')}</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {reconciliationLabel(t, option)}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">
          {t('inv.showing', { shown: rows.length, total: result.reconciliation.length })}
        </span>
      </div>

      {result.reconciliation.length === 0 ? (
        <EmptyState title={t('inv.empty.title')} description={t('inv.empty.body')} />
      ) : rows.length === 0 ? (
        <Note role="note">{t('inv.noMatch')}</Note>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((row) => (
            <li
              key={`${row.external_id ?? 'none'}-${row.internal_entity_id ?? 'none'}`}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.display_name || t('meta.noName')}</span>
                <span className="font-mono text-2xs text-ink-faint">{row.external_id ?? '—'}</span>
                <span className="mt-0.5 block text-2xs text-ink-faint">
                  {row.source_edge
                    ? t('disc.returnedBy', { edge: edgeLabel(t, row.source_edge) })
                    : t('disc.noObservation')}
                  {row.detail ? ` · ${row.detail}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <ReconciliationBadge status={row.status} />
                {onImport && row.status === 'missing_in_registry' && row.external_id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPending({ external_id: row.external_id as string, name: row.display_name })}
                    disabled={importingId === row.external_id}
                  >
                    {importingId === row.external_id ? t('disc.adding') : t('disc.addToRegistry')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {onImport && (
        <ImportConfirmDialog
          row={pending}
          onClose={() => setPending(null)}
          onConfirm={(externalId, name) => onImport(externalId, name)}
          fallbackFocus={() => rootRef.current?.focus()}
        />
      )}
    </div>
  )
}
