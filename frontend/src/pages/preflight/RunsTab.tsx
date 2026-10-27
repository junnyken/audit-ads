import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { CampaignDraft, PreflightEvaluationRun } from '../../lib/types'
import { formatDateTime } from '../../lib/format'
import type { Tone } from '../../lib/readiness'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Badge } from '../../components/primitives/badge'
import { Card, CardHeader, CardTitle } from '../../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/primitives/table'
import { EmptyState, ErrorState } from '../../components/states'
import { TableSkeleton } from '../../components/page/TableSkeleton'

const RUN_STATUS_TONE: Record<string, Tone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'positive',
  failed: 'attention',
}

export default function RunsTab({ draft }: { draft: CampaignDraft }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const runs = useQuery({
    queryKey: ['preflight-runs', draft.id],
    queryFn: () => api.get<PreflightEvaluationRun[]>(`/api/v1/campaign-drafts/${draft.id}/evaluation-runs`),
  })

  const columns = [t('pf.runs.col.started'), t('pf.runs.col.status'), t('pf.runs.col.engine'), t('pf.runs.col.duration'), t('pf.runs.col.result')]
  if (runs.isLoading) return <TableSkeleton columns={columns} rows={4} />
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} title={t('pf.runs.error')} />

  const rows = runs.data ?? []
  if (rows.length === 0) {
    return <EmptyState title={t('pf.runs.empty.title')} description={t('pf.runs.empty.body')} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('pf.runs.title', { count: rows.length })}</CardTitle>
      </CardHeader>
      <Table cards aria-label={t('pf.tab.runs')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((name, index) => (
              <TableHead key={name} numeric={index === 3}>
                {name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((run) => {
            const durationMs = run.completed_at ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime() : null
            const summary = run.result_summary_json as
              | { draft_status?: string; blocking_count?: number; warning_count?: number }
              | null
            return (
              <TableRow key={run.id}>
                <TableCell label={columns[0]} className="whitespace-nowrap">
                  {formatDateTime(run.started_at)}
                </TableCell>
                <TableCell label={columns[1]}>
                  <Badge tone={RUN_STATUS_TONE[run.status] ?? 'neutral'} dot>
                    {enumLabel('runStatus', run.status)}
                  </Badge>
                </TableCell>
                <TableCell label={columns[2]} className="font-mono text-xs text-ink-muted">
                  v{run.engine_version}
                </TableCell>
                <TableCell label={columns[3]} numeric className="font-mono text-ink-muted">
                  {durationMs !== null ? `${(durationMs / 1000).toFixed(1)} s` : '—'}
                </TableCell>
                <TableCell label={columns[4]}>
                  {run.status === 'failed' ? (
                    <span className="text-tone-attention-fg">{run.error_summary ?? run.error_code ?? t('pf.runs.failedFallback')}</span>
                  ) : summary ? (
                    t('pf.runs.summary', {
                      status: summary.draft_status ? enumLabel('draftStatus', summary.draft_status) : '—',
                      blocking: summary.blocking_count ?? '—',
                      warning: summary.warning_count ?? '—',
                    })
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
