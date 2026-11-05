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
import { launchInAssignedChromeProfile } from '../../lib/chromeProfileLauncher'

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
        connection.capabilities?.reason === 'not_supported' && connection.capabilities?.list_business_managers ? (
          <div className="rounded-lg border border-brand/40 bg-brand-light/30 p-3.5 text-xs space-y-2">
            <div className="font-bold text-ink">
              🛡️ Chế độ Bảo vệ BM Thật ({connection.label}): Thao tác trực tiếp trên Hồ sơ Chrome của Via
            </div>
            <p className="leading-relaxed text-ink-muted">
              Để tránh Meta quét <strong>Bất thường IP quản trị (Checkpoint 956 / Khóa tạo TKQC)</strong> khi máy chủ Cloud gửi lệnh Ghi (<code>POST</code>) khác dải IP với trình duyệt nuôi Via, hệ thống tự động khóa lệnh Ghi từ Server đối với BM Production. Bạn hãy bấm nút bên dưới để mở thẳng trang quản trị của BM <strong>{connection.label}</strong> trên đúng cửa sổ Chrome của Via:
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const bmId = connection.business_manager_reference || connection.business_managers?.[0]?.external_id || ''
                  const targetUrl = bmId
                    ? `https://business.facebook.com/settings/ad-accounts?business_id=${encodeURIComponent(bmId)}`
                    : 'https://business.facebook.com/settings'
                  launchInAssignedChromeProfile(
                    targetUrl,
                    'Chrome — Default · trieu (thientrieu753@gmail.com)',
                    connection.reader_credential?.label || 'Tài Khoản Chính',
                  )
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg hover:opacity-90"
              >
                🚀 Mở Cài đặt BM ({connection.label}) trên Chrome của Via ↗
              </button>
              <Link
                to="/meta-connections"
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
              >
                Xem trạng thái Kết nối Meta →
              </Link>
            </div>
          </div>
        ) : (
          <Note tone="attention" role="alert">
            {t('op.conn.denied', {
              capability,
              reason: connection.capabilities?.reason ? ` (${connection.capabilities.reason})` : '',
            })}{' '}
            <Link to="/meta-connections" className="font-medium underline">
              {t('op.conn.openMeta')}
            </Link>
          </Note>
        )
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
