import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, PreflightEvaluationRun } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import type { Tone } from '../../lib/readiness'

const RUN_STATUS_TONE: Record<string, Tone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'positive',
  failed: 'attention',
}

export default function RunsTab({ draft }: { draft: CampaignDraft }) {
  const runs = useQuery({
    queryKey: ['preflight-runs', draft.id],
    queryFn: () => api.get<PreflightEvaluationRun[]>(`/api/v1/campaign-drafts/${draft.id}/evaluation-runs`),
  })

  if (runs.isLoading) return <Skeleton rows={6} />
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} />

  const rows = runs.data ?? []
  if (rows.length === 0) {
    return <EmptyState title="Never evaluated" description="Run the evaluation from the header above to see history here." />
  }

  return (
    <Card title={`Evaluation runs — ${rows.length}`}>
      <div className="table-scroll">
        <table className="w-full min-w-[700px] border-collapse">
          <thead className="bg-surface-muted">
            <tr>
              <th className="th">Started</th>
              <th className="th">Status</th>
              <th className="th">Engine</th>
              <th className="th">Duration</th>
              <th className="th">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => {
              const durationMs =
                run.completed_at ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime() : null
              const summary = run.result_summary_json as
                | { draft_status?: string; blocking_count?: number; warning_count?: number }
                | null
              return (
                <tr key={run.id} className="hover:bg-surface-muted">
                  <td className="td whitespace-nowrap text-[12.5px]">{formatDateTime(run.started_at)}</td>
                  <td className="td">
                    <Badge tone={RUN_STATUS_TONE[run.status] ?? 'neutral'} dot>
                      {run.status}
                    </Badge>
                  </td>
                  <td className="td text-[11.5px] text-ink-faint">v{run.engine_version}</td>
                  <td className="td text-[12.5px] text-ink-muted">
                    {durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="td text-[12.5px]">
                    {run.status === 'failed' ? (
                      <span className="text-rose-700">{run.error_summary ?? run.error_code ?? 'Failed'}</span>
                    ) : summary ? (
                      `${summary.draft_status ?? '—'} (${summary.blocking_count ?? 0} blocking, ${summary.warning_count ?? 0} warning)`
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
