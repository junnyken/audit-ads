import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { CampaignDraft, Paged } from '../lib/types'
import { Badge, EmptyState, ErrorState, Skeleton } from '../components/ui'
import PreflightDraftFormDrawer from '../components/PreflightDraftFormDrawer'
import { DRAFT_STATUS_META } from '../lib/preflight'
import { formatDateTime, formatRelative } from '../lib/format'

const STATUSES: [string, string][] = [
  ['', 'Any'],
  ['draft', 'Draft'],
  ['submitted_for_review', 'Evaluating'],
  ['needs_changes', 'Needs changes'],
  ['ready_for_manual_review', 'Ready for manual review'],
  ['blocked_by_internal_policy', 'Blocked by internal policy'],
  ['unknown_missing_evidence', 'Unknown — missing evidence'],
]

export default function Preflight() {
  const [params, setParams] = useSearchParams()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const filters = {
    search: params.get('search') ?? '',
    draft_status: params.get('draft_status') ?? '',
    has_blocking_findings: params.get('has_blocking_findings') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: 25,
    sort: params.get('sort') ?? 'updated_at',
    sort_direction: params.get('sort_direction') ?? 'desc',
  }

  function update(patch: Record<string, string | number | boolean | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === false) next.delete(key)
      else next.set(key, String(value))
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const drafts = useQuery({
    queryKey: ['preflight-drafts', filters],
    queryFn: () => api.get<Paged<CampaignDraft>>(`/api/v1/campaign-drafts${query(filters)}`),
  })

  const rows = drafts.data?.items ?? []
  const filtersActive = Boolean(filters.search || filters.draft_status || filters.has_blocking_findings || filters.archived)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Preflight — Campaign Drafts</h1>
          <p className="text-[12.5px] text-ink-muted">
            {drafts.data ? `${drafts.data.total} draft${drafts.data.total === 1 ? '' : 's'}` : '—'} — rule-based
            review before manual publish. Not a platform decision.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          + Create campaign draft
        </button>
      </header>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <label className="label" htmlFor="search">Search</label>
          <input
            id="search"
            className="input"
            placeholder="Title, copy…"
            defaultValue={filters.search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ search: (event.target as HTMLInputElement).value })
            }}
            onBlur={(event) => update({ search: event.target.value })}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input min-w-[170px]" value={filters.draft_status} onChange={(event) => update({ draft_status: event.target.value })}>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Blocking findings</label>
          <select
            className="input min-w-[130px]"
            value={filters.has_blocking_findings}
            onChange={(event) => update({ has_blocking_findings: event.target.value })}
          >
            <option value="">Any</option>
            <option value="true">Has blocking</option>
            <option value="false">None</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px]">
          <input type="checkbox" checked={filters.archived} onChange={(event) => update({ archived: event.target.checked })} />
          Archived only
        </label>
        {filtersActive && (
          <button type="button" className="btn-ghost mb-0.5" onClick={() => setParams({}, { replace: true })}>
            Clear
          </button>
        )}
      </div>

      {drafts.isLoading ? (
        <Skeleton rows={8} />
      ) : drafts.isError ? (
        <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No draft matches these filters' : 'No campaign drafts yet'}
          description={
            filtersActive
              ? 'Adjust or clear the filters to see more drafts.'
              : 'Create a draft to run it through the internal compliance checks before publishing manually on Meta.'
          }
          action={
            filtersActive ? (
              <button type="button" className="btn-secondary" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
                + Create campaign draft
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="card table-scroll">
            <table className="w-full min-w-[1000px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Title</th>
                  <th className="th">Account</th>
                  <th className="th">Status</th>
                  <th className="th">Blocking</th>
                  <th className="th">Warning</th>
                  <th className="th">Last evaluated</th>
                  <th className="th">Updated</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((draft) => {
                  const meta = DRAFT_STATUS_META[draft.draft_status]
                  return (
                    <tr key={draft.id} className="hover:bg-surface-muted">
                      <td className="td">
                        <Link to={`/preflight/${draft.id}`} className="font-medium text-brand hover:underline">
                          {draft.title}
                        </Link>
                        {draft.objective && (
                          <div className="mt-0.5 text-[11.5px] text-ink-faint">{draft.objective}</div>
                        )}
                      </td>
                      <td className="td text-[12.5px]">{draft.account_display_name ?? '—'}</td>
                      <td className="td">
                        <Badge tone={meta.tone} dot title={meta.description}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="td text-center tabular-nums">
                        {draft.open_blocking_count > 0 ? (
                          <span className="font-semibold text-rose-700">{draft.open_blocking_count}</span>
                        ) : (
                          <span className="text-ink-faint">0</span>
                        )}
                      </td>
                      <td className="td text-center tabular-nums">
                        {draft.open_warning_count > 0 ? (
                          <span className="font-semibold text-amber-700">{draft.open_warning_count}</span>
                        ) : (
                          <span className="text-ink-faint">0</span>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {draft.last_evaluated_at ? formatRelative(draft.last_evaluated_at) : 'never'}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {formatDateTime(draft.updated_at)}
                      </td>
                      <td className="td">
                        <Link to={`/preflight/${draft.id}`} className="btn-secondary">
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-ink-muted">
              Page {drafts.data!.page} of {drafts.data!.total_pages || 1}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page <= 1}
                onClick={() => update({ page: filters.page - 1 })}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page >= (drafts.data!.total_pages || 1)}
                onClick={() => update({ page: filters.page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <PreflightDraftFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
