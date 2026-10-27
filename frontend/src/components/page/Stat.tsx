import { Card } from '../primitives/card'
import { TONE_DOT, type Tone } from '../../lib/readiness'
import { cn } from '../../lib/cn'

/**
 * A plain (non-link) figure tile. The value is a real number or "—" with a stated reason; a
 * missing value is never drawn as 0. The tone marks the dot only — no success styling here.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: number | string | null | undefined
  hint?: string
  tone?: Tone
}) {
  const missing = value === null || value === undefined
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_DOT[tone])} />
        <span className="text-2xs font-semibold uppercase leading-4 tracking-[0.04em] text-ink-faint">{label}</span>
      </div>
      <p className="mt-1 text-3xl font-semibold leading-9 tabular-nums">{missing ? '—' : value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  )
}
