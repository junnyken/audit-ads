import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { ConfigurationReport, OperationalRun, OperationsOverview, TestSendPreview } from '../lib/types'
import type { SystemStatus as Status } from '../lib/types'
import {
  BAND_META,
  RUN_STATUS_META,
  STATE_META,
  apiStatusTone,
  databaseStatusTone,
  workerStatusTone,
} from '../lib/operations'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import type { Tone } from '../lib/readiness'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Skeleton } from '../components/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, LoadingRegion, NoPermissionState } from '../components/states'
import { ConfirmDialog } from '../components/page/ConfirmDialog'
import { PageHeader } from '../components/page/PageHeader'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Note } from './account/parts'

const DL = 'grid gap-y-2 text-sm sm:grid-cols-[minmax(0,240px)_1fr]'

export default function SystemStatus() {
  const { t } = useI18n()
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const overview = useQuery({
    queryKey: ['operations-overview'],
    queryFn: () => api.get<OperationsOverview>('/api/v1/operations/overview'),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sys.title')}
        description={t('sys.desc')}
        meta={overview.data ? t('format.updatedAt', { time: formatDateTime(overview.data.server_time) }) : undefined}
      />

      {overview.isLoading ? (
        <LoadingRegion className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Card key={key} className="space-y-2 p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </Card>
          ))}
        </LoadingRegion>
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} title={t('sys.error.title')} />
      ) : (
        <OverviewSections data={overview.data!} />
      )}

      <ApplicationCard />

      {isOwner ? (
        <>
          <ConfigurationCard />
          <RunHistoryCard />
          {overview.data && <TestSendCard enabled={overview.data.test_send_enabled} transport={overview.data.notification_transport} />}
        </>
      ) : (
        <Card>
          <CardContent>
            <NoPermissionState compact description={t('sys.ownerOnly')} />
          </CardContent>
        </Card>
      )}

      <Note>{t('sys.disclaimer')}</Note>
    </div>
  )
}

function OverviewSections({ data }: { data: OperationsOverview }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const dispatcher = STATE_META[data.dispatcher_state]
  const backup = STATE_META[data.backup_state]
  const transportLabel = enumLabel('transport', data.notification_transport)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t('sys.tile.release')}
          value={data.release_version}
          hint={t('sys.tile.release.hint', { app: data.application_version, env: enumLabel('deployEnv', data.environment) })}
        />
        <Tile
          label={t('sys.tile.database')}
          value={enumLabel('dbStatus', data.database_status)}
          tone={databaseStatusTone(data.database_status)}
          hint={t('sys.tile.database.hint', { revision: data.migration_revision ?? t('sys.unknownRevision') })}
        />
        <Tile
          label={t('sys.tile.dispatcher')}
          value={enumLabel('opsState', data.dispatcher_state)}
          tone={dispatcher?.tone ?? 'neutral'}
          hint={
            data.dispatcher_last_success_at
              ? t('sys.tile.lastSuccess', { time: formatRelative(data.dispatcher_last_success_at) })
              : enumLabel('opsStateHint', data.dispatcher_state)
          }
        />
        <Tile
          label={t('sys.tile.backup')}
          value={enumLabel('opsState', data.backup_state)}
          tone={backup?.tone ?? 'neutral'}
          hint={
            data.backup_last_success_at
              ? t('sys.tile.lastSuccess', { time: formatRelative(data.backup_last_success_at) })
              : enumLabel('opsStateHint', data.backup_state)
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('sys.delivery.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className={DL}>
            <dt className="text-ink-faint">{t('sys.delivery.transport')}</dt>
            <dd>{transportLabel}</dd>
            <dt className="text-ink-faint">{t('sys.delivery.telegram')}</dt>
            <dd>
              <Badge tone={data.telegram_transport_configured ? 'positive' : 'caution'}>
                {data.telegram_transport_configured ? t('pg.yes') : t('pg.no')}
              </Badge>
            </dd>
            <dt className="text-ink-faint">{t('sys.delivery.due')}</dt>
            <dd className="font-mono">{formatCount(data.due_delivery_count)}</dd>
            <dt className="text-ink-faint">{t('sys.delivery.oldest')}</dt>
            <dd>
              {data.oldest_due_delivery_at
                ? t('sys.delivery.oldestValue', { minutes: data.oldest_due_delivery_minutes ?? '—', time: formatDateTime(data.oldest_due_delivery_at) })
                : t('sys.delivery.noneWaiting')}
            </dd>
            <dt className="text-ink-faint">{t('sys.delivery.failed')}</dt>
            <dd>
              {data.failed_final_delivery_count > 0 ? (
                <Badge tone="attention">{formatCount(data.failed_final_delivery_count)}</Badge>
              ) : (
                <span className="font-mono">0</span>
              )}
            </dd>
          </dl>
          {data.dispatcher_state !== 'current' && (
            <Note tone={data.dispatcher_state === 'never' ? 'attention' : 'caution'} role="note">
              {t('sys.delivery.notRun', {
                label: enumLabel('opsState', data.dispatcher_state),
                hint: enumLabel('opsStateHint', data.dispatcher_state),
              })}
            </Note>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('sys.host.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={t('sys.host.cpu')}
              band={data.host_bands.cpu}
              value={
                data.host.load_percent !== null
                  ? t('sys.host.cpuValue', { percent: data.host.load_percent, load: data.host.load_average_1m ?? '—', count: data.host.cpu_count ?? '—' })
                  : null
              }
              threshold={t('sys.host.threshold', { warn: data.thresholds.cpu_warning_percent, crit: data.thresholds.cpu_critical_percent })}
            />
            <Metric
              label={t('sys.host.memory')}
              band={data.host_bands.memory}
              value={
                data.host.memory_used_percent !== null
                  ? t('sys.host.memoryValue', { percent: data.host.memory_used_percent, total: data.host.memory_total_mb ?? '—' })
                  : null
              }
              threshold={t('sys.host.threshold', { warn: data.thresholds.memory_warning_percent, crit: data.thresholds.memory_critical_percent })}
            />
            <Metric
              label={t('sys.host.disk')}
              band={data.host_bands.disk}
              value={
                data.host.disk_used_percent !== null
                  ? t('sys.host.diskValue', { percent: data.host.disk_used_percent, free: data.host.disk_free_gb ?? '—' })
                  : null
              }
              threshold={t('sys.host.threshold', { warn: data.thresholds.disk_warning_percent, crit: data.thresholds.disk_critical_percent })}
            />
          </div>
          <Note>{t('sys.host.note')}</Note>
        </CardContent>
      </Card>
    </>
  )
}

/** The A1 identity block, kept intact: what this deployment is, not just how it is doing. */
function ApplicationCard() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<Status>('/api/v1/system/status'),
    refetchInterval: 30_000,
  })
  if (status.isLoading) {
    return (
      <LoadingRegion>
        <Card className="space-y-2 p-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </Card>
      </LoadingRegion>
    )
  }
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} title={t('sys.app.error')} />
  const data = status.data!

  const rows: [string, ReactNode][] = [
    [t('sys.app.application'), `${data.application} ${data.version}`],
    [t('sys.app.environment'), enumLabel('deployEnv', data.environment)],
    // P13: this badge used to be `positive` for any value. It now reflects the value reported.
    [
      t('sys.app.api'),
      <Badge key="api" tone={apiStatusTone(data.api_status)} data-testid="api-status-badge">
        {enumLabel('apiStatus', data.api_status)}
      </Badge>,
    ],
    [
      t('sys.app.database'),
      <Badge key="db" tone={databaseStatusTone(data.database_status)}>
        {enumLabel('dbStatus', data.database_status)}
      </Badge>,
    ],
    [t('sys.app.migration'), <span key="rev" className="font-mono text-xs">{data.database_migration_revision ?? '—'}</span>],
    [t('sys.app.redis'), <Badge key="redis" tone="muted">{enumLabel('redisStatus', data.redis_status)}</Badge>],
    [
      t('sys.app.worker'),
      <Badge key="worker" tone={workerStatusTone(data.worker_status)}>
        {enumLabel('workerStatus', data.worker_status)}
      </Badge>,
    ],
    // "Never recalculated" is its own state, not a date and not "stale" (rule 28).
    [t('sys.app.recalc'), data.last_readiness_recalculation_at ? formatDateTime(data.last_readiness_recalculation_at) : t('format.never')],
    [t('sys.app.accounts'), <span key="n" className="font-mono">{formatCount(data.account_count)}</span>],
    [t('sys.app.serverTime'), formatDateTime(data.server_time)],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('sys.app.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className={DL}>
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <Note>{t('sys.app.note')}</Note>
        <Note>{t('sys.apiNote')}</Note>
      </CardContent>
    </Card>
  )
}

function Tile({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <Card className="p-4">
      <p className="text-2xs font-semibold uppercase leading-4 tracking-[0.04em] text-ink-faint">{label}</p>
      <p className="mt-1.5">
        <Badge tone={tone}>{value}</Badge>
      </p>
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </Card>
  )
}

function Metric({ label, band, value, threshold }: { label: string; band: string; value: string | null; threshold: string }) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const meta = BAND_META[band] ?? BAND_META.unknown
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge tone={meta.tone}>{enumLabel('band', BAND_META[band] ? band : 'unknown')}</Badge>
      </div>
      <p className="mt-1 text-sm">{value ?? <span className="text-ink-muted">{t('sys.host.unavailable')}</span>}</p>
      <p className="mt-0.5 text-2xs text-ink-faint">{threshold}</p>
    </div>
  )
}

function ConfigurationCard() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const report = useQuery({
    queryKey: ['operations-configuration'],
    queryFn: () => api.get<ConfigurationReport>('/api/v1/operations/configuration'),
  })
  if (report.isLoading) {
    return (
      <LoadingRegion>
        <Card className="space-y-2 p-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-full" />
        </Card>
      </LoadingRegion>
    )
  }
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} title={t('sys.cfg.error')} />
  const data = report.data!

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('sys.cfg.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone={data.production_mode ? 'info' : 'neutral'}>
            {data.production_mode ? t('sys.cfg.production') : enumLabel('deployEnv', data.environment)}
          </Badge>
          <Badge tone={data.error_count > 0 ? 'attention' : 'positive'}>{t('sys.cfg.errors', { count: data.error_count })}</Badge>
          <Badge tone={data.warning_count > 0 ? 'caution' : 'positive'}>{t('sys.cfg.warnings', { count: data.warning_count })}</Badge>
          <Badge tone={data.api_docs_enabled ? 'caution' : 'positive'}>
            {data.api_docs_enabled ? t('sys.cfg.docs.published') : t('sys.cfg.docs.hidden')}
          </Badge>
          <Badge tone={data.public_app_url_is_https ? 'positive' : 'caution'}>
            {data.public_app_url_is_https ? t('sys.cfg.https') : t('sys.cfg.notHttps')}
          </Badge>
        </div>

        {data.findings.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('sys.cfg.none')}</p>
        ) : (
          <ul className="space-y-1.5">
            {data.findings.map((finding) => (
              <li key={finding.code} className="flex gap-2 text-sm">
                <Badge tone={finding.severity === 'error' ? 'attention' : 'caution'}>
                  {finding.severity === 'error' ? t('sys.cfg.severity.error') : t('sys.cfg.severity.warning')}
                </Badge>
                <span>
                  <span className="font-mono text-xs text-ink-faint">{finding.code}</span> {finding.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Note>{t('sys.cfg.note')}</Note>
      </CardContent>
    </Card>
  )
}

function RunHistoryCard() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const runs = useQuery({
    queryKey: ['operations-runs'],
    queryFn: () => api.get<OperationalRun[]>('/api/v1/operations/runs?limit=25'),
  })
  const columns = [t('sys.runs.col.run'), t('sys.runs.col.result'), t('sys.runs.col.started'), t('sys.runs.col.duration'), t('sys.runs.col.detail')]
  if (runs.isLoading) return <TableSkeleton columns={columns} rows={4} />
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} title={t('sys.runs.error')} />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('sys.runs.title')}</CardTitle>
      </CardHeader>
      {runs.data!.length === 0 ? (
        <div className="p-4">
          <EmptyState title={t('sys.runs.empty.title')} description={t('sys.runs.empty.body')} />
        </div>
      ) : (
        <Table cards aria-label={t('sys.runs.title')}>
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
            {runs.data!.map((run) => {
              const status = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.failed
              return (
                <TableRow key={run.id}>
                  <TableCell label={columns[0]} className="cell-title">{enumLabel('runKind', run.kind)}</TableCell>
                  <TableCell label={columns[1]}>
                    <Badge tone={status.tone}>{enumLabel('opsRunStatus', RUN_STATUS_META[run.status] ? run.status : 'failed')}</Badge>
                  </TableCell>
                  <TableCell label={columns[2]} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(run.started_at)}>
                    {formatRelative(run.started_at)}
                  </TableCell>
                  <TableCell label={columns[3]} numeric className="font-mono text-xs text-ink-muted">
                    {run.duration_ms !== null ? `${formatCount(run.duration_ms)} ms` : '—'}
                  </TableCell>
                  <TableCell label={columns[4]} className="font-mono text-2xs text-ink-muted">
                    {Object.entries(run.summary)
                      .filter(([, value]) => value !== 0)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(' ') || (run.error_code ?? '—')}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function TestSendCard({ enabled, transport }: { enabled: boolean; transport: string }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<TestSendPreview | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const buildPreview = useMutation({
    mutationFn: () => api.post<TestSendPreview>('/api/v1/operations/test-send/preview', {}),
    onSuccess: (data) => {
      setPreview(data)
      setResult(null)
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('sys.test.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Note>{t('sys.test.disclaimer')}</Note>

        <div className="flex flex-wrap gap-2">
          {/* "Switched off" is the quiet default, not a verified-good state: neutral, never green. */}
          <Badge tone={enabled ? 'caution' : 'neutral'}>{enabled ? t('sys.test.armed') : t('sys.test.off')}</Badge>
          <Badge tone={transport === 'telegram' ? 'info' : 'neutral'}>{t('sys.test.transport', { transport })}</Badge>
        </div>

        <Button type="button" variant="secondary" onClick={() => buildPreview.mutate()} disabled={buildPreview.isPending}>
          {buildPreview.isPending ? t('sys.test.rendering') : t('sys.test.render')}
        </Button>

        {buildPreview.isError && <ErrorState error={buildPreview.error} title={t('sys.test.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}

        {preview && (
          <div className="space-y-3">
            <div>
              <p className="label">{t('sys.test.exact')}</p>
              <pre className="table-scroll whitespace-pre-wrap rounded-md border border-line bg-surface-sunken p-3 text-xs">{preview.message}</pre>
              <p className="mt-1 text-xs text-ink-muted">
                {t('sys.test.to', { to: preview.recipient_masked ?? t('sys.test.noChat'), template: preview.template_version, tz: preview.timezone })}
              </p>
            </div>

            <div>
              <p className="label">{t('sys.test.checks')}</p>
              <ul className="space-y-1">
                {preview.checks.map((check) => (
                  <li key={check.code} className="flex gap-2 text-sm">
                    <Badge tone={check.passed ? 'positive' : 'caution'}>{check.passed ? t('sys.test.pass') : t('sys.test.blocked')}</Badge>
                    <span>{check.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            {preview.already_sent && <Note>{t('sys.test.alreadySent')}</Note>}

            {!preview.ready_to_send ? (
              <Note>{t('sys.test.notReady')}</Note>
            ) : (
              <SendConfirmation preview={preview} onResult={setResult} />
            )}

            {result && (
              <Note role="status" tone={result.ok ? 'info' : 'caution'}>
                {result.text}
              </Note>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The one control that sends a REAL Telegram message (rule 22: never without explicit approval of
 * the send). The dialog names the recipient, says what it does and cannot undo, and needs the
 * word typed exactly. Nothing is sent from this component until that is typed.
 */
function SendConfirmation({ preview, onResult }: { preview: TestSendPreview; onResult: (value: { ok: boolean; text: string }) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const send = useMutation({
    mutationFn: () =>
      api.post<{ sent: boolean; detail: string; message_id: string | null }>('/api/v1/operations/test-send/execute', {
        approval_code: preview.approval_code,
        confirm: true,
      }),
    onSuccess: (data) => {
      setOpen(false)
      onResult(
        data.sent
          ? { ok: true, text: t('sys.test.result.sent', { id: data.message_id ?? '—' }) }
          : { ok: false, text: t('sys.test.result.notSent', { detail: data.detail }) },
      )
    },
  })
  const to = preview.recipient_masked ?? t('sys.test.noChat')

  return (
    <div>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('sys.test.sendOne')}
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={() => {
          setOpen(false)
          send.reset()
        }}
        title={t('sys.test.dialog.title')}
        object={t('sys.test.dialog.object', { to })}
        effects={[t('sys.test.dialog.effect'), t('sys.test.dialog.scope'), t('sys.test.dialog.reversible')]}
        confirmLabel={t('sys.test.dialog.confirm')}
        typedPhrase={t('sys.test.phrase')}
        pending={send.isPending}
        error={send.isError ? send.error : undefined}
        onConfirm={() => send.mutate()}
      />
    </div>
  )
}
