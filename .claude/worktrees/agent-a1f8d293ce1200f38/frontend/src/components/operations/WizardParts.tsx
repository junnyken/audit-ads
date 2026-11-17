import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import type { MetaCapabilities, MetaConnection, MetaBatchItemStatus } from '../../lib/types'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Button } from '../primitives/button'
import { Card, CardContent, CardHeader } from '../primitives/card'
import { Field } from '../primitives/field'
import { Skeleton } from '../primitives/skeleton'
import { EmptyState, ErrorState, LoadingRegion } from '../states'
import { Note } from '../../pages/account/parts'
import { cn } from '../../lib/cn'

/** Breadcrumb + the stepper (an ordered list; the current step is `aria-current="step"`). */
export function WizardHeader({
  crumb,
  steps,
  current,
}: {
  crumb: string
  steps: string[]
  current: number
}) {
  const { t } = useI18n()
  return (
    <>
      <nav aria-label={t('op.breadcrumb')} className="flex items-center gap-1 text-xs text-ink-muted">
        <Link to="/operations" className="hover:underline">
          {t('op.title')}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span aria-current="page" className="text-ink">
          {crumb}
        </span>
      </nav>
      <h1 tabIndex={-1} className="sr-only">
        {crumb}
      </h1>
      <ol aria-label={t('op.stepper')} className="flex flex-wrap gap-2 text-xs">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              'rounded-full border px-2.5 py-1',
              index === current
                ? 'border-brand bg-brand-light font-medium text-brand-text'
                : index < current
                  ? 'border-line-strong text-ink-muted'
                  : 'border-line text-ink-faint',
            )}
          >
            {index + 1}. {label}
            {index === current && <span className="sr-only"> ({t('op.step.current')})</span>}
          </li>
        ))}
      </ol>
    </>
  )
}

export function StepCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold leading-6">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

/**
 * Connection picker shared by the three wizards. It has the three states the old wizards lacked:
 * loading, failed to load, and "no connection at all". A connection that was never capability-
 * checked (`capabilities === null`) is NOT the same as one the check refused — the message says
 * which, because "not allowed" for something nobody asked would be an invented answer.
 */
export function ConnectionPicker({
  connectionId,
  onChange,
  capability,
  children,
}: {
  connectionId: string
  onChange: (id: string, connection: MetaConnection | null) => void
  capability: keyof Omit<MetaCapabilities, 'reason'>
  /** Extra fields shown after the picker (e.g. the BM id). */
  children?: (connection: MetaConnection | null, allowed: boolean) => ReactNode
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const connections = useQuery({
    queryKey: ['meta-connections'],
    queryFn: () => api.get<MetaConnection[]>('/api/v1/meta-connections'),
  })
  const list = connections.data ?? []
  const connection = list.find((item) => item.id === connectionId) ?? null
  const allowed = connection?.capabilities?.[capability] === true

  if (connections.isLoading) {
    return (
      <LoadingRegion className="space-y-3">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-9 w-full" />
      </LoadingRegion>
    )
  }
  if (connections.isError) {
    return <ErrorState error={connections.error} onRetry={() => connections.refetch()} title={t('op.conn.error')} />
  }
  if (list.length === 0) {
    return (
      <EmptyState
        title={t('op.conn.empty.title')}
        description={t('op.conn.empty.body')}
        action={
          <Button asChild>
            <Link to="/meta-connections">{t('op.conn.setup')}</Link>
          </Button>
        }
      />
    )
  }
  return (
    <div className="space-y-3">
      <Field label={t('op.conn.label')} required htmlFor="op-connection">
        <select
          id="op-connection"
          className="input"
          value={connectionId}
          onChange={(event) => onChange(event.target.value, list.find((item) => item.id === event.target.value) ?? null)}
        >
          <option value="">{t('op.conn.choose')}</option>
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {t('op.conn.option', { label: item.label, env: enumLabel('metaEnv', item.environment) })}
            </option>
          ))}
        </select>
      </Field>
      {connection && <EnvironmentNote environment={connection.environment} />}
      {connection && connection.capabilities === null && <Note tone="caution" role="status">{t('op.conn.unchecked')}</Note>}
      {connection && connection.capabilities !== null && !allowed && (
        <Note tone="attention" role="alert">
          {t('op.conn.denied', {
            capability,
            reason: connection.capabilities?.reason ? ` (${connection.capabilities.reason})` : '',
          })}{' '}
          <Link to="/meta-connections" className="font-medium underline">
            {t('op.conn.openMeta')}
          </Link>
        </Note>
      )}
      {children?.(connection, allowed)}
    </div>
  )
}

/** Says what running a batch in this environment actually does. Production is the heavy case. */
export function EnvironmentNote({ environment }: { environment: string }) {
  const { t } = useI18n()
  if (environment === 'production') return <Note tone="caution" role="note">{t('op.env.production')}</Note>
  if (environment === 'sandbox') return <Note tone="info" role="note">{t('op.env.sandbox')}</Note>
  if (environment === 'fake') return <Note role="note">{t('op.env.fake')}</Note>
  return null
}

/**
 * What the server reports about a batch, counted from each item's own status. It never says
 * "success" on its own: any failed or undetermined item turns it into a caution (rule 4/28).
 */
export function ResultSummary({ statuses }: { statuses: MetaBatchItemStatus[] }) {
  const { t } = useI18n()
  const count = (status: MetaBatchItemStatus) => statuses.filter((s) => s === status).length
  const succeeded = count('succeeded')
  const failed = count('failed')
  const unknown = count('unknown')
  const pending = count('queued') + count('running')
  if (statuses.length === 0) return <Note>{t('op.result.empty')}</Note>
  const allGood = succeeded === statuses.length
  return (
    <div className="space-y-2">
      <Note role="status" tone={allGood ? 'info' : 'caution'}>
        {t('op.result.summary', { succeeded, failed, unknown, pending })} {t('op.result.summaryNote')}
      </Note>
      {(failed > 0 || unknown > 0) && <Note tone="attention" role="alert">{t('op.result.needsReview')}</Note>}
      {pending === statuses.length && <Note>{t('op.result.nothingRun')}</Note>}
    </div>
  )
}
