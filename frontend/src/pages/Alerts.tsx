import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { AlertRow, AlertSummary, Paged } from '../lib/types'
import { Badge, EmptyState, ErrorState, InlineNote, Skeleton } from '../components/ui'
import AlertDrawer from '../components/AlertDrawer'
import {
  ALERT_DISCLAIMER,
  ALERT_SEVERITY_META,
  ALERT_STATUS_META,
  DELIVERY_STATUS_META,
  SKIP_REASON_LABEL,
  TRANSPORT_NOT_CONFIGURED,
} from '../lib/alerts'
import { HEALTH_META } from '../lib/health'
import { READINESS_META } from '../lib/readiness'
import { formatDateTime, formatRelative } from '../lib/format'

const SORTS = [
  { value: 'severity', label: 'Severity' },
  { value: 'last_observed_at', label: 'Last observed' },
  { value: 'first_observed_at', label: 'First observed' },
  { value: 'title', label: 'Alert' },
]

export default function Alerts() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)

  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    severity: params.get('severity') ?? '',
    source_type: params.get('source_type') ?? '',
    health_status: params.get('health_status') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    ad_account_id: params.get('ad_account_id') ?? '',
    delivery_status: params.get('delivery_status') ?? '',
    suppressed: params.get('suppressed') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
    sort: params.get('sort') ?? 'severity',
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
    queryKey: ['alerts', filters],
    queryFn: () => api.get<Paged<AlertRow>>(`/api/v1/alerts${query(filters)}`),
  })
  const summary = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<AlertSummary>('/api/v1/alerts/summary'),
  })

  function refresh() {
    void rows.refetch()
    void summary.refetch()
  }

  const filtersActive = Object.entries(filters).some(
    ([key, value]) =>
      !['page', 'page_size', 'sort', 'sort_direction'].includes(key) && value !== '' && value !== false,
  )
  const transportMissing =
    summary.data && (!summary.data.telegram_transport_configured || !summary.data.recipient_configured)

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">Alerts</h1>
        <p className="text-[12.5px] text-ink-muted">
          Attention items derived from account health. Acknowledging or resolving an alert records
          your workflow; it does not change the health signal behind it.
        </p>
      </header>

      {transportMissing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <strong>{TRANSPORT_NOT_CONFIGURED}</strong>{' '}
          <Link to="/settings" className="underline">
            Open notification settings
          </Link>
          .
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[180px] flex-1">
          <label className="label" htmlFor="alert-search">Search</label>
          <input
            id="alert-search"
            className="input"
            placeholder="Alert title, summary, account"
            defaultValue={filters.search}
            onBlur={(event) => update({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ search: (event.target as HTMLInputElement).value })
            }}
          />
        </div>
        <Select label="Severity" value={filters.severity} onChange={(value) => update({ severity: value })}
          options={[['', 'Any'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']]} />
        <Select label="Status" value={filters.status} onChange={(value) => update({ status: value })}
          options={[['', 'Active'], ['open', 'Open'], ['acknowledged', 'Acknowledged'], ['suppressed', 'Suppressed'], ['resolved', 'Resolved'], ['expired', 'Expired']]} />
        <Select label="Source" value={filters.source_type} onChange={(value) => update({ source_type: value })}
          options={[['', 'Any'], ['health_signal', 'Health signal'], ['health_evaluation_run', 'Health evaluation']]} />
        <Select label="Health" value={filters.health_status} onChange={(value) => update({ health_status: value })}
          options={[['', 'Any'], ['critical', 'Critical'], ['warning', 'Warning'], ['attention_needed', 'Attention needed'], ['unknown', 'Unknown health'], ['clear_signals', 'Clear signals']]} />
        <Select label="Readiness" value={filters.readiness_status} onChange={(value) => update({ readiness_status: value })}
          options={[['', 'Any'], ['operationally_ready', 'Operationally ready'], ['ready_with_warnings', 'Ready with warnings'], ['not_ready', 'Not ready'], ['unknown', 'Unknown']]} />
        <Select label="Delivery" value={filters.delivery_status} onChange={(value) => update({ delivery_status: value })}
          options={[['', 'Any'], ['pending', 'Pending'], ['sent', 'Sent'], ['failed_transient', 'Retrying'], ['failed_final', 'Failed'], ['skipped', 'Not sent'], ['cancelled', 'Cancelled']]} />
        <Select label="Sort" value={filters.sort} onChange={(value) => update({ sort: value })}
          options={SORTS.map((sort) => [sort.value, sort.label] as [string, string])} />
        <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px]">
          <input
            type="checkbox"
            checked={filters.suppressed === 'true'}
            onChange={(event) => update({ suppressed: event.target.checked ? 'true' : '' })}
          />
          Suppressed only
        </label>
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
          title={filtersActive ? 'No alert matches these filters' : 'No alerts'}
          description={
            filtersActive
              ? 'Adjust or clear the filters to see more.'
              : 'Alerts appear here when account health raises a signal or an evaluation fails. Nothing needs attention right now.'
          }
          action={
            filtersActive ? (
              <button type="button" className="btn-secondary" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            ) : (
              <Link to="/account-health" className="btn-secondary">
                Open account health
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="card table-scroll">
            <table className="w-full min-w-[1250px] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="th">Severity</th>
                  <th className="th">Alert</th>
                  <th className="th">Account</th>
                  <th className="th">Health</th>
                  <th className="th">Readiness</th>
                  <th className="th">Source</th>
                  <th className="th">Status</th>
                  <th className="th">First observed</th>
                  <th className="th">Last observed</th>
                  <th className="th">Delivery</th>
                  <th className="th">Last notified</th>
                  <th className="th">Suppression / quiet hours</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.data!.items.map((row) => {
                  const severity = ALERT_SEVERITY_META[row.severity]
                  const status = ALERT_STATUS_META[row.status]
                  const delivery = row.delivery_status ? DELIVERY_STATUS_META[row.delivery_status] : null
                  return (
                    <tr key={row.id} className="hover:bg-surface-muted">
                      <td className="td">
                        <Badge tone={severity.tone} dot title={severity.description}>
                          {severity.label}
                        </Badge>
                      </td>
                      <td className="td max-w-[300px]">
                        <button
                          type="button"
                          className="text-left font-medium text-brand hover:underline"
                          onClick={() => setSelected(row.id)}
                        >
                          {row.title}
                        </button>
                        <p className="text-[11.5px] text-ink-muted">{row.summary}</p>
                      </td>
                      <td className="td">
                        {row.ad_account_id ? (
                          <Link
                            to={`/accounts/${row.ad_account_id}?tab=health`}
                            className="text-brand hover:underline"
                          >
                            {row.account_display_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <div className="font-mono text-[11px] text-ink-faint">
                          {row.account_reference ?? '—'}
                        </div>
                      </td>
                      <td className="td">
                        <Badge tone={HEALTH_META[row.health_status].tone}>
                          {HEALTH_META[row.health_status].label}
                        </Badge>
                      </td>
                      <td className="td">
                        <Badge tone={READINESS_META[row.readiness_status].tone}>
                          {READINESS_META[row.readiness_status].label}
                        </Badge>
                      </td>
                      <td className="td text-[12px]">{row.source_label}</td>
                      <td className="td">
                        <Badge tone={status.tone} title={status.hint}>
                          {status.label}
                        </Badge>
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {formatRelative(row.first_observed_at)}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {formatRelative(row.last_observed_at)}
                      </td>
                      <td className="td">
                        {delivery ? (
                          <Badge tone={delivery.tone} title={delivery.hint}>
                            {delivery.label}
                          </Badge>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                        {row.delivery_skip_reason && (
                          <p className="mt-0.5 max-w-[220px] text-[11px] text-ink-faint">
                            {SKIP_REASON_LABEL[row.delivery_skip_reason]}
                          </p>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                        {row.last_notified_at ? formatRelative(row.last_notified_at) : 'never'}
                      </td>
                      <td className="td text-[12px] text-ink-muted">
                        {row.suppressed_until
                          ? `Suppressed until ${formatDateTime(row.suppressed_until)}`
                          : row.quiet_hours_deferred
                            ? `Deferred by quiet hours to ${formatDateTime(row.delivery_scheduled_for)}`
                            : '—'}
                      </td>
                      <td className="td">
                        <button type="button" className="btn-secondary" onClick={() => setSelected(row.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-ink-muted">
              Page {rows.data!.page} of {rows.data!.total_pages || 1} · {rows.data!.total} alert
              {rows.data!.total === 1 ? '' : 's'}
              {summary.data?.last_successful_notification_at
                ? ` · last successful notification ${formatRelative(summary.data.last_successful_notification_at)}`
                : ''}
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

      <InlineNote>{ALERT_DISCLAIMER}</InlineNote>

      <AlertDrawer alertId={selected} onClose={() => setSelected(null)} onChanged={refresh} />
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

