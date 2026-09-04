import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SystemStatus as Status } from '../lib/types'
import { Badge, Card, ErrorState, InlineNote, Skeleton } from '../components/ui'
import { formatDateTime, humanise } from '../lib/format'

export default function SystemStatus() {
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<Status>('/api/v1/system/status'),
    refetchInterval: 30_000,
  })

  if (status.isLoading) return <Skeleton rows={6} />
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />

  const data = status.data!
  const rows: [string, React.ReactNode][] = [
    ['Application', `${data.application} ${data.version}`],
    ['Environment', humanise(data.environment)],
    ['API', <Badge key="api" tone="positive">{humanise(data.api_status)}</Badge>],
    [
      'Database',
      <Badge key="db" tone={data.database_status === 'reachable' ? 'positive' : 'attention'}>
        {humanise(data.database_status)}
      </Badge>,
    ],
    ['Migration revision', data.database_migration_revision ?? '—'],
    ['Redis', <Badge key="redis" tone="muted">{humanise(data.redis_status)}</Badge>],
    ['Worker', <Badge key="worker" tone="muted">{humanise(data.worker_status)}</Badge>],
    ['Last readiness recalculation', formatDateTime(data.last_readiness_recalculation_at)],
    ['Active accounts', data.account_count],
    ['Server time', formatDateTime(data.server_time)],
  ]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">System status</h1>
        <p className="text-[12.5px] text-ink-muted">Operational health of this deployment.</p>
      </header>

      <Card>
        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,240px)_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <InlineNote>
        Redis and the worker report <strong>not configured</strong> because this release does not
        run either. Readiness is recalculated inside the request that changes the data, so there
        is no queue to fall behind. This view never shows hostnames, connection strings or
        environment values.
      </InlineNote>
    </div>
  )
}
