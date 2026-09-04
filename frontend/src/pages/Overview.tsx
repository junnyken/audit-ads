import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, query } from '../lib/api'
import type { AdAccount, AuditEntry, HealthSummary, Paged, ReadinessSummary } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Progress, Skeleton, StatTile } from '../components/ui'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { FRESHNESS_META, HEALTH_META } from '../lib/health'
import { formatRelative, humanise } from '../lib/format'

function useOverview() {
  const summary = useQuery({
    queryKey: ['readiness-summary'],
    queryFn: () => api.get<ReadinessSummary>('/api/v1/ad-accounts/readiness/summary'),
  })
  const attention = useQuery({
    queryKey: ['accounts', 'attention'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ readiness_status: 'not_ready', page_size: 6 })}`,
      ),
  })
  const recent = useQuery({
    queryKey: ['accounts', 'recent'],
    queryFn: () =>
      api.get<Paged<AdAccount>>(
        `/api/v1/ad-accounts${query({ sort: 'updated_at', sort_direction: 'desc', page_size: 6 })}`,
      ),
  })
  const all = useQuery({
    queryKey: ['accounts', 'distribution'],
    queryFn: () => api.get<Paged<AdAccount>>(`/api/v1/ad-accounts${query({ page_size: 200 })}`),
  })
  const healthSummary = useQuery({
    queryKey: ['health-summary'],
    queryFn: () => api.get<HealthSummary>('/api/v1/account-health/summary'),
  })
  const audit = useQuery({
    queryKey: ['audit', 'latest'],
    queryFn: () => api.get<Paged<AuditEntry>>(`/api/v1/audit-logs${query({ page_size: 8 })}`),
  })
  return { summary, attention, recent, all, audit, healthSummary }
}

export default function Overview() {
  const navigate = useNavigate()
  const { summary, attention, recent, all, audit, healthSummary } = useOverview()

  if (summary.isLoading) return <Skeleton rows={6} />
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />

  const counts = summary.data!
  const accounts = all.data?.items ?? []
  const buckets = [
    { label: 'Complete', test: (a: AdAccount) => (a.required_item_count ?? 0) > 0 && a.completed_item_count === a.required_item_count },
    { label: '50–99%', test: (a: AdAccount) => ratio(a) >= 0.5 && ratio(a) < 1 },
    { label: 'Under 50%', test: (a: AdAccount) => ratio(a) < 0.5 },
  ]
  const neverSynced = accounts.filter((account) => !account.last_synced_at).length

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[17px] font-semibold">Overview</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Readiness below is an internal operational state built from records you entered. It is
          not a platform approval and does not predict whether an account will be restricted.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active accounts" value={counts.total_active} tone="neutral" onClick={() => navigate('/accounts')} />
        <StatTile
          label={READINESS_META.operationally_ready.label}
          value={counts.operationally_ready}
          tone="positive"
          hint={READINESS_META.operationally_ready.description}
          onClick={() => navigate('/accounts?readiness_status=operationally_ready')}
        />
        <StatTile
          label={READINESS_META.ready_with_warnings.label}
          value={counts.ready_with_warnings}
          tone="caution"
          hint={READINESS_META.ready_with_warnings.description}
          onClick={() => navigate('/accounts?readiness_status=ready_with_warnings')}
        />
        <StatTile
          label={READINESS_META.not_ready.label}
          value={counts.not_ready}
          tone="attention"
          hint={READINESS_META.not_ready.description}
          onClick={() => navigate('/accounts?readiness_status=not_ready')}
        />
        <StatTile
          label={READINESS_META.unknown.label}
          value={counts.unknown}
          tone="neutral"
          hint={READINESS_META.unknown.description}
          onClick={() => navigate('/accounts?readiness_status=unknown')}
        />
        <StatTile label="Archived" value={counts.archived} tone="muted" onClick={() => navigate('/accounts?archived=true')} />
      </div>

      <section className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Account health</h2>
            <p className="text-[12.5px] text-ink-muted">
              What needs attention right now. This is a separate question from readiness above:
              an account can be operationally ready and still have an open signal, and vice versa.
            </p>
          </div>
          <Link to="/account-health" className="text-[12px] font-medium text-brand hover:underline">
            Open account health
          </Link>
        </header>

        {healthSummary.isLoading ? (
          <Skeleton rows={2} />
        ) : healthSummary.isError ? (
          <ErrorState error={healthSummary.error} onRetry={() => healthSummary.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatTile
                label={HEALTH_META.critical.label}
                value={healthSummary.data!.critical}
                tone={HEALTH_META.critical.tone}
                hint={HEALTH_META.critical.description}
                onClick={() => navigate('/account-health?health_status=critical')}
              />
              <StatTile
                label="Warnings"
                value={healthSummary.data!.warning}
                tone={HEALTH_META.warning.tone}
                hint={HEALTH_META.warning.description}
                onClick={() => navigate('/account-health?health_status=warning')}
              />
              <StatTile
                label={HEALTH_META.attention_needed.label}
                value={healthSummary.data!.attention_needed}
                tone={HEALTH_META.attention_needed.tone}
                hint={HEALTH_META.attention_needed.description}
                onClick={() => navigate('/account-health?health_status=attention_needed')}
              />
              <StatTile
                label={HEALTH_META.unknown.label}
                value={healthSummary.data!.unknown}
                tone={HEALTH_META.unknown.tone}
                hint={HEALTH_META.unknown.description}
                onClick={() => navigate('/account-health?health_status=unknown')}
              />
              <StatTile
                label={HEALTH_META.clear_signals.label}
                value={healthSummary.data!.clear_signals}
                tone={HEALTH_META.clear_signals.tone}
                hint={HEALTH_META.clear_signals.description}
                onClick={() => navigate('/account-health?health_status=clear_signals')}
              />
              <StatTile
                label="Stale data"
                value={healthSummary.data!.stale_data}
                tone={FRESHNESS_META.stale.tone}
                hint={FRESHNESS_META.stale.description}
                onClick={() => navigate('/account-health?freshness_status=stale')}
              />
            </div>

            <InlineNote>
              <strong>Last health evaluation:</strong>{' '}
              {healthSummary.data!.last_evaluation_at
                ? formatRelative(healthSummary.data!.last_evaluation_at)
                : 'never'}
              {healthSummary.data!.never_evaluated > 0 &&
                ` · ${healthSummary.data!.never_evaluated} account(s) have never been evaluated`}
              {healthSummary.data!.failed_runs_recent > 0 &&
                ` · ${healthSummary.data!.failed_runs_recent} evaluation(s) failed in the last 24 hours`}
              . Health is recalculated when an account changes and when you ask for it; nothing is
              fetched from an advertising platform.
            </InlineNote>
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Accounts needing manual review now"
          action={
            <Link to="/readiness" className="text-[12px] font-medium text-brand hover:underline">
              Open readiness
            </Link>
          }
        >
          {attention.isLoading ? (
            <Skeleton rows={3} />
          ) : attention.data?.items.length ? (
            <ul className="divide-y divide-line">
              {attention.data.items.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/accounts/${account.id}`} className="min-w-0 truncate font-medium text-brand hover:underline">
                    {account.display_name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={accountStatusTone(account.status)}>{humanise(account.status)}</Badge>
                    <Progress value={account.completed_item_count ?? 0} total={account.required_item_count ?? 0} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-[12.5px] text-ink-muted">
              No account is currently in the <strong>not ready</strong> state.
            </p>
          )}
        </Card>

        <Card title="Recently changed accounts">
          {recent.isLoading ? (
            <Skeleton rows={3} />
          ) : recent.data?.items.length ? (
            <ul className="divide-y divide-line">
              {recent.data.items.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/accounts/${account.id}`} className="min-w-0 truncate font-medium text-brand hover:underline">
                    {account.display_name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={READINESS_META[account.readiness_status].tone} dot>
                      {READINESS_META[account.readiness_status].label}
                    </Badge>
                    <span className="text-[11.5px] text-ink-faint">{formatRelative(account.updated_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-[12.5px] text-ink-muted">Nothing recorded yet.</p>
          )}
        </Card>

        <Card title="Checklist completion">
          {all.isLoading ? (
            <Skeleton rows={3} />
          ) : accounts.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-ink-muted">No accounts registered yet.</p>
          ) : (
            <ul className="space-y-2">
              {buckets.map((bucket) => {
                const matched = accounts.filter(bucket.test).length
                const percent = Math.round((matched / accounts.length) * 100)
                return (
                  <li key={bucket.label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-[12.5px] text-ink-muted">{bucket.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className={`h-full rounded-full ${bucket.label === 'Complete' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-[12px] text-ink-muted">
                      {matched} ({percent}%)
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Latest audit activity" action={<Link to="/audit-log" className="text-[12px] font-medium text-brand hover:underline">Open audit log</Link>}>
          {audit.isLoading ? (
            <Skeleton rows={4} />
          ) : audit.data?.items.length ? (
            <ul className="divide-y divide-line">
              {audit.data.items.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-[11.5px]">{entry.action}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-faint">
                    {entry.actor_email ?? 'system'} · {formatRelative(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-[12.5px] text-ink-muted">No activity recorded yet.</p>
          )}
        </Card>
      </div>

      <InlineNote>
        <strong>Data freshness:</strong>{' '}
        {accounts.length === 0
          ? 'No accounts registered yet.'
          : `${neverSynced} of ${accounts.length} account${accounts.length === 1 ? '' : 's'} have never been synced with an advertising platform. A1 stores operator-entered records only, so "last synced" stays empty until a later phase adds an authorised integration.`}
      </InlineNote>
    </div>
  )
}

function ratio(account: AdAccount): number {
  const required = account.required_item_count ?? 0
  if (required === 0) return 0
  return (account.completed_item_count ?? 0) / required
}
