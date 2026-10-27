import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { formatCount } from '../../lib/format'
import { TONE_DOT, type Tone } from '../../lib/readiness'
import { cn } from '../../lib/cn'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
import { Skeleton } from '../primitives/skeleton'

/**
 * One "needs attention" tile (U1 T1). The number is the hero (`text-3xl`, tabular), the label says
 * what is counted and the hint says what the number is not. A tile is a link: it opens the list
 * already filtered, so a click always lands on the accounts behind the number.
 *
 * Data honesty (U1 section 6.3): a tile whose query failed shows "—" and a retry, never 0; a
 * count of 0 that really came from the server is shown as 0 but with the quiet `muted` accent so
 * a calm row does not read as an alarm — and never with the success tone (rule 5).
 */
export type StatTileState =
  | { status: 'loading' }
  | { status: 'error'; onRetry?: () => void }
  | { status: 'ready'; value: number }

export function StatTile({
  label,
  hint,
  tone,
  to,
  state,
}: {
  label: string
  hint?: string
  tone: Tone
  to: string
  state: StatTileState
}) {
  const { t } = useI18n()

  if (state.status === 'loading') {
    return (
      <Card className="p-4" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-3 h-8 w-1/3" />
        <Skeleton className="mt-3 h-3 w-full" />
      </Card>
    )
  }

  const accent = state.status === 'ready' && state.value === 0 ? 'muted' : tone
  const body = (
    <>
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1 rounded-l-lg', TONE_DOT[accent])} />
      <span className="block text-2xs font-semibold uppercase leading-4 tracking-[0.04em] text-ink-faint">{label}</span>
      <span className="mt-1 block text-3xl font-semibold leading-9 tabular-nums">
        {state.status === 'ready' ? formatCount(state.value) : '—'}
      </span>
      {state.status === 'error' ? (
        <span className="mt-1 block text-xs text-ink-muted">{t('overview.kpi.loadFailed')}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      )}
    </>
  )

  if (state.status === 'error') {
    return (
      <Card className="relative p-4 pl-5" data-testid="stat-tile-error">
        {body}
        {state.onRetry && (
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={state.onRetry}>
            {t('state.retry')}
          </Button>
        )}
      </Card>
    )
  }

  return (
    <Link
      to={to}
      className="relative block rounded-lg border border-line bg-surface p-4 pl-5 transition-colors hover:border-line-strong hover:bg-surface-sunken/40"
    >
      {body}
    </Link>
  )
}
