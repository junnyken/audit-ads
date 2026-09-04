import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { Badge, EmptyState, ErrorState, Progress, Skeleton } from '../components/ui'
import AccountFormDrawer from '../components/AccountFormDrawer'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { formatDateTime, formatRelative, humanise } from '../lib/format'

const SORTS = [
  { value: 'updated_at', label: 'Last updated' },
  { value: 'last_manual_review_at', label: 'Last manual review' },
  { value: 'readiness_status', label: 'Readiness' },
  { value: 'display_name', label: 'Name' },
]

export default function Accounts() {
  /** Filters live in the URL so a filtered view can be bookmarked and shared. */
  const [params, setParams] = useSearchParams()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    account_type: params.get('account_type') ?? '',
    business_manager_id: params.get('business_manager_id') ?? '',
    has_browser_reference: params.get('has_browser_reference') ?? '',
    has_proxy_reference: params.get('has_proxy_reference') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
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

  const businessManagers = useQuery({
    queryKey: ['business-managers', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/business-managers${query({ page_size: 200 })}`),
  })

  const accounts = useQuery({
    queryKey: ['accounts', 'list', filters],
    queryFn: () => api.get<Paged<AdAccount>>(`/api/v1/ad-accounts${query(filters)}`),
  })

  const rows = accounts.data?.items ?? []
  const filtersActive = Boolean(
    filters.search ||
      filters.status ||
      filters.readiness_status ||
      filters.account_type ||
      filters.business_manager_id ||
      filters.has_browser_reference ||
      filters.has_proxy_reference ||
      filters.archived,
  )

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Accounts</h1>
          <p className="text-[12.5px] text-ink-muted">
            {accounts.data ? `${accounts.data.total} record${accounts.data.total === 1 ? '' : 's'}` : '—'}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          Register account
        </button>
      </header>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <label className="label" htmlFor="search">Search</label>
          <input
            id="search"
            className="input"
            placeholder="Name, external ID, owner, BM, tag"
            defaultValue={filters.search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ search: (event.target as HTMLInputElement).value })
            }}
            onBlur={(event) => update({ search: event.target.value })}
          />
        </div>
        <Select label="Readiness" value={filters.readiness_status} onChange={(value) => update({ readiness_status: value })}
          options={[['', 'Any'], ['operationally_ready', 'Operationally ready'], ['ready_with_warnings', 'Ready with warnings'], ['not_ready', 'Not ready'], ['unknown', 'Unknown']]} />
        <Select label="Status" value={filters.status} onChange={(value) => update({ status: value })}
          options={[['', 'Any'], ['unknown', 'Unknown'], ['active', 'Active'], ['warning', 'Warning'], ['restricted', 'Restricted'], ['disabled', 'Disabled']]} />
        <Select label="Type" value={filters.account_type} onChange={(value) => update({ account_type: value })}
          options={[['', 'Any'], ['business_manager', 'Business Manager'], ['personal_reference', 'Personal reference'], ['unknown', 'Unknown']]} />
        <Select label="Business Manager" value={filters.business_manager_id} onChange={(value) => update({ business_manager_id: value })}
          options={[['', 'Any'], ...(businessManagers.data?.items ?? []).map((bm) => [bm.id, String(bm.name)] as [string, string])]} />
        <Select label="Browser ref" value={filters.has_browser_reference} onChange={(value) => update({ has_browser_reference: value })}
          options={[['', 'Any'], ['true', 'Assigned'], ['false', 'Not assigned']]} />
        <Select label="Proxy ref" value={filters.has_proxy_reference} onChange={(value) => update({ has_proxy_reference: value })}
          options={[['', 'Any'], ['true', 'Assigned'], ['false', 'Not assigned']]} />
        <Select label="Sort" value={filters.sort} onChange={(value) => update({ sort: value })}
          options={SORTS.map((sort) => [sort.value, sort.label] as [string, string])} />
        <Select label="Order" value={filters.sort_direction} onChange={(value) => update({ sort_direction: value })}
          options={[['desc', 'Descending'], ['asc', 'Ascending']]} />
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

      {accounts.isLoading ? (
        <Skeleton rows={8} />
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No account matches these filters' : 'No accounts registered yet'}
          description={
            filtersActive
              ? 'Adjust or clear the filters to see more records.'
              : 'Start by adding a Business Manager or a personal-account reference, then register your first ad account against it.'
          }
          action={
            filtersActive ? (
              <button type="button" className="btn-secondary" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            ) : (
              <div className="flex gap-2">
                <Link to="/business-managers" className="btn-secondary">Add a Business Manager</Link>
                <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
                  Register account
                </button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="card table-scroll">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th w-8">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="th">Account</th>
                  <th className="th">External ID</th>
                  <th className="th">Type</th>
                  <th className="th">BM / Personal reference</th>
                  <th className="th">Status</th>
                  <th className="th">Readiness</th>
                  <th className="th">Checklist</th>
                  <th className="th">Last manual review</th>
                  <th className="th">Browser ref</th>
                  <th className="th">Proxy ref</th>
                  <th className="th">Last updated</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => {
                  const meta = READINESS_META[account.readiness_status]
                  return (
                    <tr key={account.id} className="hover:bg-surface-muted">
                      <td className="td">
                        <input
                          type="checkbox"
                          aria-label={`Select ${account.display_name}`}
                          checked={selected.has(account.id)}
                          onChange={(event) => {
                            const next = new Set(selected)
                            if (event.target.checked) next.add(account.id)
                            else next.delete(account.id)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td className="td">
                        <Link to={`/accounts/${account.id}`} className="font-medium text-brand hover:underline">
                          {account.display_name}
                        </Link>
                        {account.tags.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {account.tags.map((tag) => (
                              <span key={tag} className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10.5px] text-ink-muted">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="td font-mono text-[11.5px]">{account.external_account_id ?? '—'}</td>
                      <td className="td">{humanise(account.account_type)}</td>
                      <td className="td">
                        {account.business_manager_name ?? account.personal_account_reference_label ?? '—'}
                      </td>
                      <td className="td">
                        <Badge tone={accountStatusTone(account.status)}>{humanise(account.status)}</Badge>
                      </td>
                      <td className="td">
                        <Badge tone={meta.tone} dot title={meta.description}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="td">
                        <Progress value={account.completed_item_count ?? 0} total={account.required_item_count ?? 0} />
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {account.last_manual_review_at ? formatRelative(account.last_manual_review_at) : 'never'}
                      </td>
                      <td className="td">
                        {account.has_browser_reference ? (
                          <Badge tone="positive">Assigned</Badge>
                        ) : (
                          <Badge tone="neutral">None</Badge>
                        )}
                      </td>
                      <td className="td">
                        {account.has_proxy_reference ? (
                          <Badge tone="neutral">Assigned</Badge>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {formatDateTime(account.updated_at)}
                      </td>
                      <td className="td">
                        <Link to={`/accounts/${account.id}`} className="btn-secondary">
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
              {selected.size > 0
                ? `${selected.size} selected — selection is for reading only in this release; there is no bulk action.`
                : `Page ${accounts.data!.page} of ${accounts.data!.total_pages || 1}`}
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
                disabled={filters.page >= (accounts.data!.total_pages || 1)}
                onClick={() => update({ page: filters.page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <AccountFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: [string, string][]
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input min-w-[130px]" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}
