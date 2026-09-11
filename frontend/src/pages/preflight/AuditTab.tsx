import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, query } from '../../lib/api'
import type { AuditEntry, CampaignDraft, Paged } from '../../lib/types'
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'
import AuditDiff from '../../components/AuditDiff'
import { formatDateTime } from '../../lib/format'

/**
 * Scoped to the draft row's own audit trail (created/updated/archived/restored). Finding
 * acknowledge/resolve and evaluation-run events have their own audit rows too, under
 * `entity_type=preflight_finding` / `preflight_evaluation_run` — not merged in here, a scoped
 * simplification versus A1's account audit tab (documented, not silent).
 */
export default function AuditTab({ draft }: { draft: CampaignDraft }) {
  const [page, setPage] = useState(1)
  const logs = useQuery({
    queryKey: ['preflight-audit', draft.id, page],
    queryFn: () =>
      api.get<Paged<AuditEntry>>(
        `/api/v1/audit-logs${query({ entity_type: 'campaign_draft', entity_id: draft.id, page, page_size: 25 })}`,
      ),
  })

  if (logs.isLoading) return <Skeleton rows={6} />
  if (logs.isError) return <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
  if (logs.data!.items.length === 0) {
    return <EmptyState title="No audit history" description="Mutations on this draft will appear here." />
  }

  return (
    <Card title={`Audit history — ${logs.data!.total} record${logs.data!.total === 1 ? '' : 's'}`}>
      <p className="mb-3 text-[11.5px] text-ink-faint">
        Append-only. Entries are never edited or deleted, and payloads are redacted before they
        are written.
      </p>
      <ol className="space-y-3">
        {logs.data!.items.map((entry) => (
          <li key={entry.id} className="border-l-2 border-line pl-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-mono font-medium">{entry.action}</span>
              <span className="text-ink-faint">{formatDateTime(entry.created_at)}</span>
              <span className="text-ink-faint">{entry.actor_email ?? 'system'}</span>
              {entry.request_id && (
                <span className="font-mono text-[11px] text-ink-faint">req {entry.request_id.slice(0, 8)}</span>
              )}
            </div>
            <AuditDiff before={entry.before_json} after={entry.after_json} metadata={entry.metadata_json} />
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">
          Page {logs.data!.page} of {logs.data!.total_pages || 1}
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= (logs.data!.total_pages || 1)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </Card>
  )
}
