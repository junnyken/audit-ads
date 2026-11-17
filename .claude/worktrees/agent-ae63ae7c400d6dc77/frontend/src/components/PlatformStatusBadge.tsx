import { Badge } from './primitives/badge'
import { platformStatusBadge } from '../lib/platformStatus'
import { useI18n } from '../i18n'
import type { PlatformStatusCompact } from '../lib/types'

/**
 * Meta's latest account status (S2, restyled in U1b). Colour comes from `lib/platformStatus.ts`
 * only, and no state is ever success-styled. The observation time is always shown beside it — a
 * status without its time would read as a standing fact. "—" when no read has carried a status
 * code (with the words "Chưa quan sát" for assistive technology).
 */
export default function PlatformStatusBadge({
  value,
  inline = false,
}: {
  value?: PlatformStatusCompact | null
  inline?: boolean
}) {
  const { language } = useI18n()
  const badge = platformStatusBadge(value, language)
  if (!value) {
    return (
      <span title={badge.title} data-testid="platform-status-none">
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
        <span className="sr-only">{badge.title}</span>
      </span>
    )
  }
  return (
    <span className={inline ? 'inline-flex flex-wrap items-center gap-1.5' : 'flex flex-col items-start gap-1'}>
      <Badge tone={badge.tone} title={badge.title}>
        {badge.label}
      </Badge>
      {badge.context && <span className="text-xs text-ink-muted">{badge.context}</span>}
    </span>
  )
}
