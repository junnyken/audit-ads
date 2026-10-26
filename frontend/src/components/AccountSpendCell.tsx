import { Badge } from './ui'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { rawMoney } from '../lib/spend'
import type { AccountSpendCompact } from '../lib/types'

/**
 * Compact spend for the Accounts list. The badge is freshness only (never success styling); the
 * amount is Meta's raw string for the latest complete day, "—" when Meta returned no row — a
 * missing day is never shown as 0 (rule 4).
 */
export default function AccountSpendCell({ spend }: { spend?: AccountSpendCompact | null }) {
  if (!spend) return <span className="text-ink-faint">—</span>
  const meta = SPEND_FRESHNESS_META[spend.freshness]
  const day = spend.latest_complete_day
  return (
    <div className="space-y-0.5">
      <Badge tone={meta.tone} title={meta.description}>
        {meta.label}
      </Badge>
      {day && (
        <div className="whitespace-nowrap text-[11.5px] text-ink-muted" title={`Complete day ${day.date}`}>
          {rawMoney(day.spend_raw, spend.observed_currency)}
        </div>
      )}
    </div>
  )
}
