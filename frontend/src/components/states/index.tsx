import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Lock, TriangleAlert } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { TONE_CLASS } from '../../lib/readiness'
import { cn } from '../../lib/cn'

/**
 * The shared data states (U1 section 11): empty, error (four parts), no permission, partial.
 * Loading is the `Skeleton` primitive, shaped like the content by each page.
 *
 * Error copy follows the four-part pattern: what happened, why (the server's already-sanitised
 * message; never a stack trace), what to do next, and a reference id that can be quoted.
 */

/** Wraps skeleton blocks so assistive technology hears one "loading" instead of nothing. */
export function LoadingRegion({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n()
  return (
    <div role="status" aria-busy="true" aria-label={t('common.loading')} className={className}>
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description: string
  /** The next step. An empty state without one is a dead end. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <Inbox className="h-8 w-8 text-ink-faint" aria-hidden="true" />
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function NoPermissionState({
  title,
  description,
  compact = false,
}: {
  title?: string
  description?: string
  /** One line inside a card, instead of a full block. */
  compact?: boolean
}) {
  const { t } = useI18n()
  if (compact) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
        {description ?? t('state.noPermission.body')}
      </p>
    )
  }
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface px-6 py-10 text-center"
    >
      <Lock className="h-8 w-8 text-ink-faint" aria-hidden="true" />
      <p className="text-base font-semibold">{title ?? t('state.noPermission.title')}</p>
      <p className="max-w-md text-sm text-ink-muted">{description ?? t('state.noPermission.body')}</p>
    </div>
  )
}

interface ErrorLike {
  message?: string
  requestId?: string | null
  status?: number
}

export function ErrorState({
  error,
  onRetry,
  title,
  compact = false,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  compact?: boolean
}) {
  const { t } = useI18n()
  const apiError = (error ?? {}) as ErrorLike
  // A refusal for the viewer's role is not a failure of the system: say so instead of "try again".
  if (apiError.status === 403) return <NoPermissionState compact={compact} />
  const reference = apiError.requestId
  return (
    <div role="alert" className={cn('rounded-lg border px-4 py-3 text-sm', TONE_CLASS.attention)}>
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        {title ?? t('state.error.defaultTitle')}
      </p>
      <p className="mt-1">
        {apiError.message ? t('state.error.cause', { message: apiError.message }) : t('state.error.causeUnknown')}
      </p>
      <p className="mt-1">
        {t('state.error.next')}{' '}
        <Link to="/system" className="font-medium underline">
          {t('state.error.systemLink')}
        </Link>
        .
      </p>
      {reference && (
        <p className="mt-1 text-xs">
          {t('state.error.reference')}: <code className="select-all font-mono">{reference}</code>
        </p>
      )}
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('state.retry')}
        </Button>
      )}
    </div>
  )
}

/** A note that the data above is real but incomplete — and says in what way. Never hides the data. */
export function PartialDataNote({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <p role="note" className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs', TONE_CLASS.caution)}>
      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong>{t('state.partial.label')}:</strong> {children}
      </span>
    </p>
  )
}
