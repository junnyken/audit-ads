import { Badge } from './ui'
import { platformStatusBadge } from '../lib/platformStatus'
import type { PlatformStatusCompact } from '../lib/types'

/**
 * Meta's latest account status (S2). Colour comes from `lib/platformStatus.ts` only, and no state
 * is ever success-styled. The observation time is always shown beside it — a status without its
 * time would read as a standing fact. "—" when no read has carried a status code.
 */
export default function PlatformStatusBadge({
  value,
  inline = false,
}: {
  value?: PlatformStatusCompact | null
  inline?: boolean
}) {
  const badge = platformStatusBadge(value)
  if (!value) {
    return (
      <span className="text-ink-faint" title={badge.title} data-testid="platform-status-none">
        —
      </span>
    )
  }
  return (
    <span className={inline ? 'inline-flex flex-wrap items-center gap-1.5' : 'block space-y-0.5'}>
      <Badge tone={badge.tone} title={badge.title}>
        {badge.label}
      </Badge>
      {badge.context && (
        <span className={`${inline ? '' : 'block '}whitespace-nowrap text-[11.5px] text-ink-muted`}>
          {badge.context}
        </span>
      )}
    </span>
  )
}
