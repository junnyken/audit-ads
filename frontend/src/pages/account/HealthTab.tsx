import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, query } from '../../lib/api'
import type { AccountHealth, AdAccount, EvaluationRun, HealthSignal, Paged } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Skeleton } from '../../components/ui'
import HealthSignalDrawer from '../../components/HealthSignalDrawer'
import {
  FRESHNESS_META,
  HEALTH_META,
  RECALCULATE_EXPLANATION,
  SEVERITY_META,
  SIGNAL_STATUS_META,
} from '../../lib/health'
import { READINESS_META } from '../../lib/readiness'
import { formatDateTime, formatRelative, humanise } from '../../lib/format'

export default function HealthTab({
  account,
  onChanged,
}: {
  account: AdAccount
  onChanged: () => void
}) {
  const [selected, setSelected] = useState<HealthSignal | null>(null)

  const health = useQuery({
    queryKey: ['health', account.id],
    queryFn: () => api.get<AccountHealth>(`/api/v1/ad-accounts/${account.id}/health`),
  })
  const signals = useQuery({
    queryKey: ['health-signals', account.id],
    queryFn: () =>
      api.get<Paged<HealthSignal>>(
        `/api/v1/ad-accounts/${account.id}/health/signals${query({ page_size: 200 })}`,
      ),
  })
  const runs = useQuery({
    queryKey: ['health-runs', account.id],
    queryFn: () =>
      api.get<Paged<EvaluationRun>>(
        `/api/v1/account-health/evaluation-runs${query({ ad_account_id: account.id, page_size: 5 })}`,
      ),
  })

  const recalculate = useMutation({
    mutationFn: () => api.post<AccountHealth>(`/api/v1/ad-accounts/${account.id}/health/recalculate`),
    onSuccess: () => {
      void health.refetch()
      void signals.refetch()
      void runs.refetch()
      onChanged()
    },
  })

  const { open, historical } = useMemo(() => {
    const items = signals.data?.items ?? []
    return {
      open: items.filter((signal) => signal.status === 'open' || signal.status === 'acknowledged'),
      historical: items.filter(
        (signal) => signal.status !== 'open' && signal.status !== 'acknowledged',
      ),
    }
  }, [signals.data])

  if (health.isLoading) return <Skeleton rows={6} />
  if (health.isError) return <ErrorState error={health.error} onRetry={() => health.refetch()} />

  const data = health.data!
  const meta = HEALTH_META[data.health_status]
  const freshness = FRESHNESS_META[data.freshness_status]
  const readiness = READINESS_META[account.readiness_status]

  function refresh() {
    void health.refetch()
    void signals.refetch()
    void runs.refetch()
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Health status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
            <Badge tone={freshness.tone} title={freshness.description}>
              Data: {freshness.label}
            </Badge>
            <span className="font-mono text-[11px] text-ink-faint">{data.engine_version}</span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-muted">{data.status_description}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {(['critical', 'warning', 'attention', 'unknown'] as const).map((key) => (
              <Badge key={key} tone={SEVERITY_META[key].tone}>
                {SEVERITY_META[key].label}: {data.counts[key]}
              </Badge>
            ))}
          </div>

          <InlineNote>{data.disclaimer}</InlineNote>
        </Card>

        <Card title="Readiness (separate state)">
          <div className="flex items-center gap-2">
            <Badge tone={readiness.tone} dot>
              {readiness.label}
            </Badge>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Readiness answers whether the operational records are complete. Health answers what
            currently needs attention. One does not imply the other.
          </p>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Readiness evaluated {formatRelative(account.readiness_evaluated_at)} · health evaluated{' '}
            {formatRelative(data.evaluated_at)}
          </p>

          {account.archived_at === null && (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => recalculate.mutate()}
                disabled={recalculate.isPending}
              >
                {recalculate.isPending ? 'Recalculating…' : 'Recalculate health'}
              </button>
              <p className="text-[11.5px] text-ink-faint">{RECALCULATE_EXPLANATION}</p>
              {recalculate.isError && <ErrorState error={recalculate.error} onRetry={() => recalculate.mutate()} />}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Open and acknowledged signals (${open.length})`}>
        {signals.isLoading ? (
          <Skeleton rows={3} />
        ) : open.length === 0 ? (
          <EmptyState
            title="No open signals"
            description={
              data.health_status === 'clear_signals'
                ? 'No current issues were found by the configured checks at the last evaluation.'
                : 'Nothing is open right now. If health is unknown, the evaluation is missing or not current rather than clear.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onOpen={() => setSelected(signal)} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Resolved, expired and superseded (${historical.length})`}>
        {historical.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            Nothing has been closed yet. Signals are never deleted, so history appears here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {historical.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onOpen={() => setSelected(signal)} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent evaluations">
        {runs.isLoading ? (
          <Skeleton rows={2} />
        ) : (runs.data?.items.length ?? 0) === 0 ? (
          <p className="text-[12.5px] text-ink-muted">No evaluation has run yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {runs.data!.items.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <Badge
                  tone={
                    run.status === 'succeeded'
                      ? 'positive'
                      : run.status === 'failed'
                        ? 'attention'
                        : 'muted'
                  }
                >
                  {humanise(run.status)}
                </Badge>
                <span className="text-ink-muted">{humanise(run.trigger_type)}</span>
                <span className="text-ink-faint">{formatDateTime(run.started_at)}</span>
                {run.error_code && (
                  <span className="font-mono text-[11px] text-rose-700">{run.error_code}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <HealthSignalDrawer
        signal={selected}
        readOnly={account.archived_at !== null}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  )
}

function SignalRow({ signal, onOpen }: { signal: HealthSignal; onOpen: () => void }) {
  const severity = SEVERITY_META[signal.severity]
  const status = SIGNAL_STATUS_META[signal.status]
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity.tone} dot>
            {severity.label}
          </Badge>
          <Badge tone={status.tone} title={status.hint}>
            {status.label}
          </Badge>
          <span className="font-medium">{signal.rule_name ?? signal.rule_key}</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {signal.rule_key} v{signal.rule_version}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {String(signal.evidence_json?.message ?? '')}
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-faint">
          Observed {formatDateTime(signal.observed_at)} · source {humanise(signal.source_type)}
        </p>
      </div>
      <button type="button" className="btn-secondary shrink-0" onClick={onOpen}>
        Details
      </button>
    </li>
  )
}
