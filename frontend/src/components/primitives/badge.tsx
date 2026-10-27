import * as React from 'react'
import { Clock, TriangleAlert } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TONE_CLASS, TONE_DOT, type Tone } from '../../lib/readiness'

/**
 * Badge (shadcn-style, token-driven). The colour comes ONLY from `TONE_CLASS`, whose values are
 * decided in `lib/readiness.ts`; this component never chooses a tone. A badge always carries text.
 * `attention` and `caution` also carry an icon so the state never rests on colour alone
 * (U1 section 10b); `dot` is the quieter marker for every other tone.
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  dot?: boolean
  /** Set false to drop the warning/clock icon on attention/caution (rare). */
  icon?: boolean
}

export function Badge({ tone = 'neutral', dot = false, icon = true, className, children, ...props }: BadgeProps) {
  const Icon = icon ? (tone === 'attention' ? TriangleAlert : tone === 'caution' ? Clock : null) : null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-4',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : dot ? (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  )
}
