import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, query } from '../../lib/api'
import type { AccountHealth, AdAccount, AlertRow, EvaluationRun, HealthSignal, Paged } from '../../lib/types'
import { Badge } from '../../components/primitives/badge'
import { Button } from '../../components/primitives/button'
import { EmptyState, ErrorState, PartialDataNote } from '../../components/states'
import HealthSignalDrawer from '../../components/HealthSignalDrawer'
import { ALERT_SEVERITY_META } from '../../lib/alerts'
import { FRESHNESS_META, HEALTH_META, SEVERITY_META, SIGNAL_STATUS_META } from '../../lib/health'
import { READINESS_META } from '../../lib/readiness'
import { formatDateTime, formatRelative } from '../../lib/format'
import { useEnumLabel } from '../../i18n/labels'
import { useI18n } from '../../i18n'
import { Note, Panel, TabSkeleton } from './parts'

export default function HealthTab({
  account,
  onChanged,
}: {
  account: AdAccount
  onChanged: () => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [selected, setSelected] = useState<HealthSignal | null>(null)

  const health = useQuery({
    queryKey: ['health', account.id],
    queryFn: () => api.get<AccountHealth>(`/api/v1/ad-accounts/${account.id}/health`),
  })
  const signals = useQuery({
    queryKey: ['health-signals', account.id],
    queryFn: () =>
      api.get<Paged<HealthSignal>>(`/api/v1/ad-accounts/${account.id}/health/signals${query({ page_size: 200 })}`),
  })
  const relatedAlerts = useQuery({
    queryKey: ['account-alerts', account.id],
    queryFn: () => api.get<Paged<AlertRow>>(`/api/v1/alerts${query({ ad_account_id: account.id, page_size: 100 })}`),
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
      void relatedAlerts.refetch()
      onChanged()
    },
  })

  const { open, historical } = useMemo(() => {
    const items = signals.data?.items ?? []
    return {
      open: items.filter((signal) => signal.status === 'open' || signal.status === 'acknowledged'),
      historical: items.filter((signal) => signal.status !== 'open' && signal.status !== 'acknowledged'),
    }
  }, [signals.data])

  if (health.isLoading) return <TabSkeleton cards={3} />
  if (health.isError) return <ErrorState error={health.error} onRetry={() => health.refetch()} title={t('hl.error.title')} />

  const data = health.data!
  const meta = HEALTH_META[data.health_status]
  const freshness = FRESHNESS_META[data.freshness_status]
  const readiness = READINESS_META[account.readiness_status]
  const archived = account.archived_at !== null

  function refresh() {
    void health.refetch()
    void signals.refetch()
    void runs.refetch()
    void relatedAlerts.refetch()
    onChanged()
  }

  const recalculateButton = !archived && (
    <Button variant="secondary" onClick={() => recalculate.mutate()} disabled={recalculate.isPending}>
      {recalculate.isPending ? t('hl.recalculating') : t('hl.recalculate')}
    </Button>
  )

  return (
    <div className="space-y-4">
      {(signals.isError || relatedAlerts.isError || runs.isError) && (
        <PartialDataNote>
          {[
            signals.isError && t('hl.partial.signals'),
            relatedAlerts.isError && t('hl.partial.alerts'),
            runs.isError && t('hl.partial.runs'),
          ]
            .filter(Boolean)
            .join(' ')}
        </PartialDataNote>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title={t('hl.status.title')}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone} dot>
              {enumLabel('health', data.health_status)}
            </Badge>
            <Badge tone={freshness.tone} title={t(`healthFreshnessHint.${data.freshness_status}`)}>
              {t('hl.data', { value: enumLabel('healthFreshness', data.freshness_status) })}
            </Badge>
            <span className="font-mono text-xs text-ink-muted">{data.engine_version}</span>
          </div>
          <p className="text-sm text-ink-muted">{t(`healthHint.${data.health_status}`)}</p>

          <div className="flex flex-wrap gap-2">
            {(['critical', 'warning', 'attention', 'unknown'] as const).map((key) => (
              <Badge key={key} tone={SEVERITY_META[key].tone}>
                {enumLabel('severity', key)}: <span className="tabular-nums">{data.counts[key]}</span>
              </Badge>
            ))}
          </div>

          <Note>{data.disclaimer}</Note>

          {relatedAlerts.data && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-sm text-ink-muted">
                {relatedAlerts.data.total === 0
                  ? t('hl.alerts.none')
                  : t('hl.alerts.count', { count: relatedAlerts.data.total })}
              </span>
              {(['critical', 'warning', 'info'] as const).map((severity) => {
                const count = relatedAlerts.data!.items.filter((row) => row.severity === severity).length
                return count > 0 ? (
                  <Badge key={severity} tone={ALERT_SEVERITY_META[severity].tone}>
                    {enumLabel('severity', severity)}: <span className="tabular-nums">{count}</span>
                  </Badge>
                ) : null
              })}
              <Link to={`/alerts?ad_account_id=${account.id}`} className="text-xs font-medium text-brand-text hover:underline">
                {t('hl.alerts.open')}
              </Link>
            </div>
          )}
        </Panel>

        <Panel title={t('hl.readiness.title')}>
          <Badge tone={readiness.tone} dot className="w-fit">
            {enumLabel('readiness', account.readiness_status)}
          </Badge>
          <p className="text-sm text-ink-muted">{t('hl.readiness.body')}</p>
          <p className="text-xs text-ink-muted">
            {t('hl.readiness.evaluated', {
              readiness: formatRelative(account.readiness_evaluated_at),
              health: formatRelative(data.evaluated_at),
            })}
          </p>

          {!archived && (
            <div className="space-y-2">
              <Button className="w-full" onClick={() => recalculate.mutate()} disabled={recalculate.isPending}>
                {recalculate.isPending ? t('hl.recalculating') : t('hl.recalculate')}
              </Button>
              <p className="text-xs text-ink-muted">{t('hl.recalculate.explain')}</p>
              {recalculate.isError && <ErrorState error={recalculate.error} onRetry={() => recalculate.mutate()} compact />}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('hl.open.title', { count: open.length })}>
        {signals.isLoading ? (
          <TabSkeleton cards={1} />
        ) : signals.isError ? (
          <ErrorState error={signals.error} onRetry={() => signals.refetch()} title={t('hl.signals.error')} compact />
        ) : open.length === 0 ? (
          <EmptyState
            className="py-8"
            title={t('hl.open.empty.title')}
            description={
              data.health_status === 'clear_signals' ? t('hl.open.empty.clear') : t('hl.open.empty.other')
            }
            action={recalculateButton || undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onOpen={() => setSelected(signal)} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('hl.closed.title', { count: historical.length })}>
        {signals.isError ? (
          <p className="text-sm text-ink-muted">{t('hl.signals.error')}</p>
        ) : historical.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('hl.closed.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {historical.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onOpen={() => setSelected(signal)} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('hl.runs.title')}>
        {runs.isLoading ? (
          <TabSkeleton cards={1} />
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} title={t('hl.runs.error')} compact />
        ) : (runs.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-muted">{t('hl.runs.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {runs.data!.items.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={run.status === 'succeeded' ? 'positive' : run.status === 'failed' ? 'attention' : 'muted'}>
                  {enumLabel('runStatus', run.status)}
                </Badge>
                <span className="text-ink-muted">{enumLabel('runTrigger', run.trigger_type)}</span>
                <span className="text-ink-muted tabular-nums">{formatDateTime(run.started_at)}</span>
                {run.error_code && <span className="font-mono text-tone-attention-fg">{run.error_code}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <HealthSignalDrawer
        signal={selected}
        readOnly={archived}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  )
}

function SignalRow({ signal, onOpen }: { signal: HealthSignal; onOpen: () => void }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const severity = SEVERITY_META[signal.severity]
  const status = SIGNAL_STATUS_META[signal.status]
  const name = signal.rule_name ?? signal.rule_key
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity.tone} dot>
            {enumLabel('severity', signal.severity)}
          </Badge>
          <Badge tone={status.tone} title={t(`signalStatusHint.${signal.status}`)}>
            {enumLabel('signalStatus', signal.status)}
          </Badge>
          <span className="font-medium">{name}</span>
          <span className="font-mono text-xs text-ink-muted">
            {signal.rule_key} v{signal.rule_version}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">{String(signal.evidence_json?.message ?? '')}</p>
        <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
          {t('hl.signal.observed', {
            time: formatDateTime(signal.observed_at),
            source: enumLabel('signalSource', signal.source_type),
          })}
        </p>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={onOpen}>
        {t('hl.signal.details')}
        <span className="sr-only"> — {name}</span>
      </Button>
    </li>
  )
}
