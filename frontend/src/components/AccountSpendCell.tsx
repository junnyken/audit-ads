import { Badge } from './primitives/badge'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { rawMoney } from '../lib/spend'
import { formatDay } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import type { AccountSpendCompact } from '../lib/types'

/**
 * Compact spend for the Accounts list (S1, restyled in U1b). The badge is freshness only and is
 * never success-styled (its tone comes from `SPEND_FRESHNESS_META`, where nothing is positive).
 * The amount is Meta's raw string for the latest complete day, right-aligned in mono. "—" means
 * Meta returned no row for that day, and "Chưa có dữ liệu" means no day has ever been read —
 * neither is ever drawn as 0 (rule 4); a real zero row from Meta is shown as 0.
 */
export default function AccountSpendCell({ spend }: { spend?: AccountSpendCompact | null }) {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()

  if (!spend) {
    return (
      <span title={t('spend.noData')}>
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
        <span className="sr-only">{t('spend.noData')}</span>
      </span>
    )
  }

  const meta = SPEND_FRESHNESS_META[spend.freshness]
  const day = spend.latest_complete_day
  const hasAmount = day !== null && day !== undefined && day.spend_raw !== null && day.spend_raw !== ''

  let figure
  if (hasAmount) {
    figure = (
      <span className="font-mono text-sm font-semibold tabular-nums" title={t('spend.dayTitle', { date: formatDay(day.date, language) })}>
        {rawMoney(day.spend_raw, spend.observed_currency)}
      </span>
    )
  } else if (day) {
    figure = (
      <span className="text-sm">
        <span className="font-mono">—</span> <span className="text-xs text-ink-faint">{t('spend.noRow')}</span>
      </span>
    )
  } else {
    figure = (
      <span className="text-sm text-ink-muted">
        {spend.freshness === 'not_observable' ? t('spend.noReader') : t('spend.noData')}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1 max-[640px]:items-end">
      {figure}
      <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-ink-muted">
        <Badge tone={meta?.tone ?? 'neutral'} title={meta ? t(`spendFreshnessHint.${spend.freshness}`) : undefined}>
          {enumLabel('spendFreshness', spend.freshness)}
        </Badge>
        {day && <span className="tabular-nums">{formatDay(day.date, language)}</span>}
      </span>
    </div>
  )
}
