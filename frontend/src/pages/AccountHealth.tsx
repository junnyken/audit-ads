import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { AccountHealthRow, HealthRule, Paged } from '../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Skeleton } from '../components/ui'
import { FRESHNESS_META, HEALTH_DISCLAIMER, HEALTH_META, SEVERITY_META } from '../lib/health'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { formatRelative, humanise } from '../lib/format'

const SORTS = [
  { value: 'health_severity', label: 'Health severity' },
  { value: 'last_evaluated_at', label: 'Last evaluated' },
  { value: 'display_name', label: 'Account name' },
]

export default function AccountHealth() {
  /** Filters live in the URL, matching the A1 registry convention. */
  const [params, setParams] = useSearchParams()
  const [showRules, setShowRules] = useState(false)

  const filters = {
    search: params.get('search') ?? '',
    health_status: params.get('health_status') ?? '',
    freshness_status: params.get('freshness_status') ?? '',
    severity: params.get('severity') ?? '',
    rule_key: params.get('rule_key') ?? '',
    account_type: params.get('account_type') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
    sort: params.get('sort') ?? 'health_severity',
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

  const rows = useQuery({
    queryKey: ['account-health', filters],
    queryFn: () => api.get<Paged<AccountHealthRow>>(`/api/v1/account-health${query(filters)}`),
  })
  const rules = useQuery({
    queryKey: ['health-rules'],
    queryFn: () => api.get<HealthRule[]>('/api/v1/account-health/rules'),
  })

  const filtersActive = Object.entries(filters).some(
    ([key, value]) =>
      !['page', 'page_size', 'sort', 'sort_direction'].includes(key) && value !== '' && value !== false,
  )

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Account health</h1>
          <p className="text-[12.5px] text-ink-muted">
            What currently needs attention, and why. Readiness is shown alongside it and is a
            separate question.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setShowRules((open) => !open)}>
          {showRules ? 'Hide rules' : `Configured checks (${rules.data?.length ?? 0})`}
        </button>
      </header>

      {showRules && (
        <Card title="Configured checks">
          <p className="mb-2 text-[12px] text-ink-muted">
            These are the only checks that produce signals. They are versioned and read-only in
            this release.
          </p>
          <ul className="divide-y divide-line">
            {(rules.data ?? []).map((rule) => (
              <li key={`${rule.rule_key}-${rule.version}`} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_META[rule.severity].tone}>{SEVERITY_META[rule.severity].label}</Badge>
                  <span className="font-medium">{rule.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {rule.rule_key} v{rule.version}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => update({ rule_key: rule.rule_key })}
                  >
                    Filter
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-muted">{rule.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[180px] flex-1">
          <label className="label" htmlFor="health-search">Search</label>
          <input
            id="health-search"
            className="input"
            placeholder="Account name, external ID, owner"
            defaultValue={filters.search}
            onBlur={(event) => update({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ search: (event.target as HTMLInputElement).value })
            }}
          />
        </div>
        <Select label="Health" value={filters.health_status} onChange={(value) => update({ health_status: value })}
          options={[['', 'Any'], ['critical', 'Critical'], ['warning', 'Warning'], ['attention_needed', 'Attention needed'], ['unknown', 'Unknown health'], ['clear_signals', 'Clear signals']]} />
        <Select label="Data freshness" value={filters.freshness_status} onChange={(value) => update({ freshness_status: value })}
          options={[['', 'Any'], ['current', 'Current'], ['stale', 'Stale'], ['unknown', 'Not evaluated']]} />
        <Select label="Signal severity" value={filters.severity} onChange={(value) => update({ severity: value })}
          options={[['', 'Any'], ['critical', 'Critical'], ['warning', 'Warning'], ['attention', 'Attention'], ['unknown', 'Unknown']]} />
        <Select label="Readiness" value={filters.readiness_status} onChange={(value) => update({ readiness_status: value })}
          options={[['', 'Any'], ['operationally_ready', 'Operationally ready'], ['ready_with_warnings', 'Ready with warnings'], ['not_ready', 'Not ready'], ['unknown', 'Unknown']]} />
        <Select label="Sort" value={filters.sort} onChange={(value) => update({ sort: value })}
          options={SORTS.map((sort) => [sort.value, sort.label] as [string, string])} />
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

      {rows.isLoading ? (
        <Skeleton rows={8} />
      ) : rows.isError ? (
        <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
      ) : rows.data!.items.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No account matches these filters' : 'No health signals available yet'}
          description={
            filtersActive
              ? 'Adjust or clear the filters to see more accounts.'
              : 'Health is evaluated when an account changes, or when you recalculate it. Register an account to see its health here.'
          }
          action={
            filtersActive ? (
              <button type="button" className="btn-secondary" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            ) : (
              <Link to="/accounts" className="btn-primary">
                Open the registry
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="card table-scroll">
            <table className="w-full min-w-[1150px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Account</th>
                  <th className="th">BM / Owner</th>
                  <th className="th">Account status</th>
                  <th className="th">Readiness</th>
                  <th className="th">Health</th>
                  <th className="th">Data freshness</th>
                  <th className="th">Open critical</th>
                  <th className="th">Open warnings</th>
                  <th className="th">Attention items</th>
                  <th className="th">Last evaluated</th>
                  <th className="th">Top reason</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.data!.items.map((row) => {
                  const health = HEALTH_META[row.health_status]
                  const freshness = FRESHNESS_META[row.freshness_status]
                  const readiness = READINESS_META[row.readiness_status]
                  return (
                    <tr key={row.ad_account_id} className="hover:bg-surface-muted">
                      <td className="td">
                        <Link
                          to={`/accounts/${row.ad_account_id}?tab=health`}
                          className="font-medium text-brand hover:underline"
                        >
                          {row.display_name}
                        </Link>
                        <div className="font-mono text-[11px] text-ink-faint">
                          {row.external_account_id ?? '—'}
                        </div>
                      </td>
                      <td className="td">
                        {row.business_manager_name ?? row.personal_account_reference_label ?? (row.owner_label || '—')}
                      </td>
                      <td className="td">
                        <Badge tone={accountStatusTone(row.account_status)}>{humanise(row.account_status)}</Badge>
                      </td>
                      <td className="td">
                        <Badge tone={readiness.tone} title={readiness.description}>
                          {readiness.label}
                        </Badge>
                      </td>
                      <td className="td">
                        <Badge tone={health.tone} dot title={health.description}>
                          {health.label}
                        </Badge>
                      </td>
                      <td className="td">
                        <Badge tone={freshness.tone} title={freshness.description}>
                          {freshness.label}
                        </Badge>
                      </td>
                      <td className="td tabular-nums">{row.open_critical_count}</td>
                      <td className="td tabular-nums">{row.open_warning_count}</td>
                      <td className="td tabular-nums">{row.open_attention_count}</td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {row.last_evaluated_at ? formatRelative(row.last_evaluated_at) : 'never'}
                      </td>
                      <td className="td max-w-[280px] text-[12px] text-ink-muted">
                        {row.top_reason ? row.top_reason.message : '—'}
                      </td>
                      <td className="td">
                        <Link to={`/accounts/${row.ad_account_id}?tab=health`} className="btn-secondary">
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
            <span className="text-[12px] text-ink-muted">
              Page {rows.data!.page} of {rows.data!.total_pages || 1} · {rows.data!.total} account
              {rows.data!.total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={filters.page >= (rows.data!.total_pages || 1)}
                onClick={() => update({ page: filters.page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <InlineNote>{HEALTH_DISCLAIMER}</InlineNote>
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
      <select className="input min-w-[140px]" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}
