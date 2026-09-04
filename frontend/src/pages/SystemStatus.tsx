import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import type {
  ConfigurationReport,
  OperationalRun,
  OperationsOverview,
  TestSendPreview,
} from '../lib/types'
import { Badge, Card, EmptyState, ErrorState, InlineNote, Skeleton } from '../components/ui'
import {
  BAND_META,
  OPERATIONS_DISCLAIMER,
  RUN_KIND_LABEL,
  RUN_STATUS_META,
  STATE_META,
  TEST_SEND_DISCLAIMER,
  TRANSPORT_LABEL,
} from '../lib/operations'
import { formatDateTime, formatRelative, humanise } from '../lib/format'
import type { Tone } from '../lib/readiness'
import type { SystemStatus as Status } from '../lib/types'
import { useAuth } from '../hooks/useAuth'

export default function SystemStatus() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const overview = useQuery({
    queryKey: ['operations-overview'],
    queryFn: () => api.get<OperationsOverview>('/api/v1/operations/overview'),
    refetchInterval: 30_000,
  })

  if (overview.isLoading) return <Skeleton rows={8} />
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />

  const data = overview.data!
  const dispatcher = STATE_META[data.dispatcher_state]
  const backup = STATE_META[data.backup_state]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">System status</h1>
        <p className="text-[12.5px] text-ink-muted">
          What this deployment is running, and whether the things that run on a schedule are
          still running.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Release" value={data.release_version} hint={`App ${data.application_version} · ${data.environment}`} />
        <Tile
          label="Database"
          value={data.database_status}
          tone={data.database_status === 'reachable' ? 'positive' : 'attention'}
          hint={`Migration ${data.migration_revision ?? 'unknown'}`}
        />
        <Tile
          label="Dispatcher"
          value={dispatcher.label}
          tone={dispatcher.tone}
          hint={
            data.dispatcher_last_success_at
              ? `Last success ${formatRelative(data.dispatcher_last_success_at)}`
              : dispatcher.hint
          }
        />
        <Tile
          label="Backup"
          value={backup.label}
          tone={backup.tone}
          hint={
            data.backup_last_success_at
              ? `Last success ${formatRelative(data.backup_last_success_at)}`
              : backup.hint
          }
        />
      </div>

      <ApplicationCard />

      <Card title="Notification delivery">
        <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,240px)_1fr]">
          <dt className="text-ink-faint">Transport</dt>
          <dd>{TRANSPORT_LABEL[data.notification_transport] ?? data.notification_transport}</dd>
          <dt className="text-ink-faint">Telegram configured</dt>
          <dd>
            <Badge tone={data.telegram_transport_configured ? 'positive' : 'caution'}>
              {data.telegram_transport_configured ? 'Yes' : 'No'}
            </Badge>
          </dd>
          <dt className="text-ink-faint">Due deliveries</dt>
          <dd>{data.due_delivery_count}</dd>
          <dt className="text-ink-faint">Oldest due delivery</dt>
          <dd>
            {data.oldest_due_delivery_at
              ? `${data.oldest_due_delivery_minutes} min (${formatDateTime(data.oldest_due_delivery_at)})`
              : 'none waiting'}
          </dd>
          <dt className="text-ink-faint">Failed final deliveries</dt>
          <dd>
            {data.failed_final_delivery_count > 0 ? (
              <Badge tone="attention">{data.failed_final_delivery_count}</Badge>
            ) : (
              '0'
            )}
          </dd>
        </dl>
        {data.dispatcher_state !== 'current' && (
          <InlineNote>
            <strong>{dispatcher.label}.</strong> {dispatcher.hint} Deliveries are not lost — they
            stay in the outbox and go out when the dispatcher runs again.
          </InlineNote>
        )}
      </Card>

      <Card title="Host resources">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="CPU load"
            band={data.host_bands.cpu}
            value={
              data.host.load_percent !== null
                ? `${data.host.load_percent}% (${data.host.load_average_1m} of ${data.host.cpu_count})`
                : null
            }
            threshold={`warn ${data.thresholds.cpu_warning_percent}% · crit ${data.thresholds.cpu_critical_percent}%`}
          />
          <Metric
            label="Memory"
            band={data.host_bands.memory}
            value={
              data.host.memory_used_percent !== null
                ? `${data.host.memory_used_percent}% of ${data.host.memory_total_mb} MB`
                : null
            }
            threshold={`warn ${data.thresholds.memory_warning_percent}% · crit ${data.thresholds.memory_critical_percent}%`}
          />
          <Metric
            label="Disk"
            band={data.host_bands.disk}
            value={
              data.host.disk_used_percent !== null
                ? `${data.host.disk_used_percent}% used · ${data.host.disk_free_gb} GB free`
                : null
            }
            threshold={`warn ${data.thresholds.disk_warning_percent}% · crit ${data.thresholds.disk_critical_percent}%`}
          />
        </div>
        <InlineNote>
          Measured inside the application container from <code>/proc</code>. The Docker socket is
          deliberately not mounted, so container-level restart counts come from the host, not
          from here.
        </InlineNote>
      </Card>

      {isOwner ? (
        <>
          <ConfigurationCard />
          <RunHistoryCard />
          <TestSendCard enabled={data.test_send_enabled} transport={data.notification_transport} />
        </>
      ) : (
        <InlineNote>
          Configuration findings, run history and delivery verification are visible to the
          workspace owner.
        </InlineNote>
      )}

      <InlineNote>{OPERATIONS_DISCLAIMER}</InlineNote>
    </div>
  )
}

/** The A1 identity block, kept intact: what this deployment is, not just how it is doing. */
function ApplicationCard() {
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<Status>('/api/v1/system/status'),
    refetchInterval: 30_000,
  })
  if (status.isLoading) return <Skeleton rows={4} />
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
    ['Notification dispatcher', <Badge key="worker" tone="muted">{humanise(data.worker_status)}</Badge>],
    ['Last readiness recalculation', formatDateTime(data.last_readiness_recalculation_at)],
    ['Active accounts', data.account_count],
    ['Server time', formatDateTime(data.server_time)],
  ]

  return (
    <Card title="Application">
      <dl className="grid gap-y-2 text-[12.5px] sm:grid-cols-[minmax(0,240px)_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <InlineNote>
        Redis still reports <strong>not configured</strong> because this release runs none: the
        notification outbox lives in the database. The dispatcher state above is derived from its
        recorded runs, not from a process this API can see. This view never shows hostnames,
        connection strings or environment values.
      </InlineNote>
    </Card>
  )
}

function Tile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: Tone
}) {
  return (
    <div className="card p-3">
      <p className="text-[11.5px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1">
        <Badge tone={tone}>{value}</Badge>
      </p>
      {hint && <p className="mt-1 text-[11.5px] text-ink-muted">{hint}</p>}
    </div>
  )
}

function Metric({
  label,
  band,
  value,
  threshold,
}: {
  label: string
  band: string
  value: string | null
  threshold: string
}) {
  const meta = BAND_META[band] ?? BAND_META.unknown
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium">{label}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <p className="mt-1 text-[13px]">{value ?? 'Not available in this environment'}</p>
      <p className="mt-0.5 text-[11px] text-ink-faint">{threshold}</p>
    </div>
  )
}

function ConfigurationCard() {
  const report = useQuery({
    queryKey: ['operations-configuration'],
    queryFn: () => api.get<ConfigurationReport>('/api/v1/operations/configuration'),
  })
  if (report.isLoading) return <Skeleton rows={4} />
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />
  const data = report.data!

  return (
    <Card title="Configuration">
      <div className="mb-2 flex flex-wrap gap-2">
        <Badge tone={data.production_mode ? 'info' : 'neutral'}>
          {data.production_mode ? 'Production mode' : data.environment}
        </Badge>
        <Badge tone={data.error_count > 0 ? 'attention' : 'positive'}>
          {data.error_count} error{data.error_count === 1 ? '' : 's'}
        </Badge>
        <Badge tone={data.warning_count > 0 ? 'caution' : 'positive'}>
          {data.warning_count} warning{data.warning_count === 1 ? '' : 's'}
        </Badge>
        <Badge tone={data.api_docs_enabled ? 'caution' : 'positive'}>
          API docs {data.api_docs_enabled ? 'published' : 'not published'}
        </Badge>
        <Badge tone={data.public_app_url_is_https ? 'positive' : 'caution'}>
          Public URL {data.public_app_url_is_https ? 'HTTPS' : 'not HTTPS'}
        </Badge>
      </div>

      {data.findings.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">
          No configuration findings. Nothing here inspects a secret's value — only whether it is
          set, long enough, and not a known placeholder.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.findings.map((finding) => (
            <li key={finding.code} className="flex gap-2 text-[12.5px]">
              <Badge tone={finding.severity === 'error' ? 'attention' : 'caution'}>
                {finding.severity}
              </Badge>
              <span>
                <span className="font-mono text-[11.5px] text-ink-faint">{finding.code}</span>{' '}
                {finding.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <InlineNote>
        Findings never contain the offending value. No secret, connection string or hostname is
        shown on this page or returned by the endpoint behind it.
      </InlineNote>
    </Card>
  )
}

function RunHistoryCard() {
  const runs = useQuery({
    queryKey: ['operations-runs'],
    queryFn: () => api.get<OperationalRun[]>('/api/v1/operations/runs?limit=25'),
  })
  if (runs.isLoading) return <Skeleton rows={4} />
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} />

  return (
    <Card title="Operational run history">
      {runs.data!.length === 0 ? (
        <EmptyState
          title="No recorded runs"
          description="Dispatch passes, backups, restore drills and migration releases appear here once they run."
        />
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="bg-surface-muted">
              <tr>
                <th className="th">Run</th>
                <th className="th">Result</th>
                <th className="th">Started</th>
                <th className="th">Duration</th>
                <th className="th">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.data!.map((run) => {
                const status = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.failed
                return (
                  <tr key={run.id} className="hover:bg-surface-muted">
                    <td className="td">{RUN_KIND_LABEL[run.kind] ?? run.kind}</td>
                    <td className="td">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                      {formatRelative(run.started_at)}
                    </td>
                    <td className="td text-[12px] text-ink-muted">
                      {run.duration_ms !== null ? `${run.duration_ms} ms` : '—'}
                    </td>
                    <td className="td text-[11.5px] text-ink-muted">
                      {Object.entries(run.summary)
                        .filter(([, value]) => value !== 0)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(' ') || (run.error_code ?? '—')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function TestSendCard({ enabled, transport }: { enabled: boolean; transport: string }) {
  const [preview, setPreview] = useState<TestSendPreview | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const buildPreview = useMutation({
    mutationFn: () => api.post<TestSendPreview>('/api/v1/operations/test-send/preview', {}),
    onSuccess: (data) => {
      setPreview(data)
      setResult(null)
    },
  })

  return (
    <Card title="Controlled delivery verification">
      <InlineNote>{TEST_SEND_DISCLAIMER}</InlineNote>

      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone={enabled ? 'caution' : 'positive'}>
          {enabled ? 'Test send is armed on this server' : 'Test send is switched off'}
        </Badge>
        <Badge tone={transport === 'telegram' ? 'info' : 'neutral'}>Transport: {transport}</Badge>
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={() => buildPreview.mutate()}
        disabled={buildPreview.isPending}
      >
        {buildPreview.isPending ? 'Rendering…' : 'Render preview'}
      </button>

      {buildPreview.isError && <ErrorState error={buildPreview.error} />}

      {preview && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="label">Exact message</p>
            <pre className="table-scroll rounded-md border border-line bg-surface-sunken p-3 text-[12px] whitespace-pre-wrap">
              {preview.message}
            </pre>
            <p className="mt-1 text-[11.5px] text-ink-muted">
              To: {preview.recipient_masked ?? 'no chat configured'} · template{' '}
              {preview.template_version} · {preview.timezone}
            </p>
          </div>

          <div>
            <p className="label">Pre-send checks</p>
            <ul className="space-y-1">
              {preview.checks.map((check) => (
                <li key={check.code} className="flex gap-2 text-[12.5px]">
                  <Badge tone={check.passed ? 'positive' : 'caution'}>
                    {check.passed ? 'pass' : 'blocked'}
                  </Badge>
                  <span>{check.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          {preview.already_sent && (
            <InlineNote>
              A verification message has already been sent for this destination and environment.
              It will not be sent again.
            </InlineNote>
          )}

          {!preview.ready_to_send ? (
            <InlineNote>
              This preview cannot be sent yet. Every check above must pass first, and the server
              switch must be on for one approved verification.
            </InlineNote>
          ) : (
            <SendConfirmation preview={preview} onResult={setResult} />
          )}

          {result && <InlineNote>{result}</InlineNote>}
        </div>
      )}
    </Card>
  )
}

function SendConfirmation({
  preview,
  onResult,
}: {
  preview: TestSendPreview
  onResult: (value: string) => void
}) {
  const [typed, setTyped] = useState('')
  const send = useMutation({
    mutationFn: () =>
      api.post<{ sent: boolean; detail: string; message_id: string | null }>(
        '/api/v1/operations/test-send/execute',
        { approval_code: preview.approval_code, confirm: true },
      ),
    onSuccess: (data) =>
      onResult(
        data.sent
          ? `One message was sent. Provider message id: ${data.message_id}.`
          : `Nothing was sent: ${data.detail}.`,
      ),
  })

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-[12.5px] text-amber-900">
        This sends a real message to {preview.recipient_masked}. Type <strong>SEND</strong> to
        confirm.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className="input max-w-[160px]"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-label="Type SEND to confirm"
        />
        <button
          type="button"
          className="btn-primary"
          disabled={typed !== 'SEND' || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? 'Sending…' : 'Send one test message'}
        </button>
      </div>
      {send.isError && <ErrorState error={send.error} />}
    </div>
  )
}
