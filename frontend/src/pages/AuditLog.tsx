import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { AuditEntry, Paged } from '../lib/types'
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui'
import AuditDiff from '../components/AuditDiff'
import { formatDateTime } from '../lib/format'

export default function AuditLog() {
  const [filters, setFilters] = useState({ action: '', entity_type: '', page: 1 })
  const logs = useQuery({
    queryKey: ['audit', filters],
    queryFn: () =>
      api.get<Paged<AuditEntry>>(`/api/v1/audit-logs${query({ ...filters, page_size: 50 })}`),
  })

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Audit log</h1>
        <p className="text-[12.5px] text-ink-muted">
          Every mutation in this workspace, append-only and redacted before storage.
        </p>
      </header>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div>
          <label className="label" htmlFor="action">Action contains</label>
          <input
            id="action"
            className="input min-w-[200px]"
            placeholder="ad_account.updated"
            defaultValue={filters.action}
            onBlur={(event) => setFilters({ ...filters, action: event.target.value, page: 1 })}
          />
        </div>
        <div>
          <label className="label" htmlFor="entity">Entity type</label>
          <select
            id="entity"
            className="input min-w-[180px]"
            value={filters.entity_type}
            onChange={(event) => setFilters({ ...filters, entity_type: event.target.value, page: 1 })}
          >
            <option value="">Any</option>
            <option value="ad_account">Ad account</option>
            <option value="business_manager">Business Manager</option>
            <option value="personal_account_reference">Personal account reference</option>
            <option value="account_asset_link">Asset link</option>
            <option value="readiness_checklist_item">Checklist item</option>
            <option value="readiness_evidence">Evidence</option>
            <option value="account_event">Account event</option>
          </select>
        </div>
      </div>

      {logs.isLoading ? (
        <Skeleton rows={8} />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : logs.data!.items.length === 0 ? (
        <EmptyState title="No audit entries" description="Nothing matches these filters yet." />
      ) : (
        <Card title={`${logs.data!.total} record${logs.data!.total === 1 ? '' : 's'}`}>
          <ol className="space-y-3">
            {logs.data!.items.map((entry) => (
              <li key={entry.id} className="border-l-2 border-line pl-3">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-mono font-medium">{entry.action}</span>
                  <span className="text-ink-faint">{entry.entity_type}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {entry.entity_id.slice(0, 8)}
                  </span>
                  <span className="text-ink-faint">{formatDateTime(entry.created_at)}</span>
                  <span className="text-ink-faint">{entry.actor_email ?? 'system'}</span>
                  {entry.request_id && (
                    <span className="font-mono text-[11px] text-ink-faint">
                      req {entry.request_id.slice(0, 8)}
                    </span>
                  )}
                </div>
                <AuditDiff
                  before={entry.before_json}
                  after={entry.after_json}
                  metadata={entry.metadata_json}
                />
              </li>
            ))}
          </ol>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12px] text-ink-muted">
              Page {logs.data!.page} of {logs.data!.total_pages || 1}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page <= 1}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page >= (logs.data!.total_pages || 1)}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
