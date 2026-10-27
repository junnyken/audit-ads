import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { formatCount } from '../../lib/format'
import { TONE_DOT, type Tone } from '../../lib/readiness'
import { cn } from '../../lib/cn'

export interface Segment {
  key: string
  label: string
  count: number
  tone: Tone
  /** Where the legend entry leads (the list filtered to this state). */
  to?: string
}

/**
 * A distribution bar with a legend (U1 T1). Counts, never percentages: a percentage invites
 * reading the bar as a score (rule 9), and the legend carries the real number.
 *
 * The bar is `role="img"` with the full breakdown as its name, so the information does not rest on
 * colour or on being able to see it. Zero-count states stay in the legend (an absent state is
 * information) but take no width. Tones come from the caller, which takes them from the META maps.
 */
export function SegmentBar({ segments, ariaPrefix }: { segments: Segment[]; ariaPrefix?: string }) {
  const { t } = useI18n()
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const summary = segments.map((segment) => `${segment.label} ${segment.count}`).join(', ')

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`${ariaPrefix ? `${ariaPrefix}: ` : ''}${t('overview.dist.aria', { summary })}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        {total > 0 &&
          segments
            .filter((segment) => segment.count > 0)
            .map((segment) => (
              <span
                key={segment.key}
                data-segment={segment.key}
                className={cn('h-full', TONE_DOT[segment.tone])}
                style={{ width: `${(segment.count / total) * 100}%` }}
              />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
        {segments.map((segment) => {
          const content = (
            <>
              <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', TONE_DOT[segment.tone])} />
              {segment.label}
              <b className="font-semibold tabular-nums text-ink">{formatCount(segment.count)}</b>
            </>
          )
          return (
            <li key={segment.key}>
              {segment.to ? (
                <Link to={segment.to} className="inline-flex items-center gap-1.5 hover:text-ink hover:underline">
                  {content}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">{content}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
