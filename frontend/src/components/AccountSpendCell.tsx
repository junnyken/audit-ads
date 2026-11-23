import { Badge } from './primitives/badge'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { prettyMoney, rawMoney } from '../lib/spend'
import { formatDay } from '../lib/format'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import type { AccountSpendCompact, AccountSpendPeriods } from '../lib/types'

export default function AccountSpendCell({
  spend,
  periods,
}: {
  spend?: AccountSpendCompact | null
  periods?: AccountSpendPeriods | null
}) {
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
  const isZeroAmount = hasAmount && /^0(\.0+)?$/.test(String(day!.spend_raw).trim())
  if (hasAmount) {
    figure = (
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${isZeroAmount ? 'text-ink-faint opacity-55 font-normal' : 'text-ink'}`}
        title={t('spend.dayTitle', { date: formatDay(day.date, language) })}
      >
        <span aria-hidden="true">{prettyMoney(day.spend_raw, spend.observed_currency)}</span>
        <span className="sr-only">{rawMoney(day.spend_raw, spend.observed_currency)}</span>
      </span>
    )
  } else if (day) {
    figure = (
      <span className="text-sm">
        <span className="font-mono text-ink-muted">—</span>{' '}
        <span aria-hidden="true" className="text-xs text-ink-faint">
          {language === 'vi' ? 'Không phát sinh chi tiêu' : 'No spend recorded'}
        </span>
        <span className="sr-only">{t('spend.noRow')}</span>
      </span>
    )
  } else {
    figure = (
      <span className="text-sm text-ink-muted">
        {spend.freshness === 'not_observable' ? t('spend.noReader') : t('spend.noData')}
      </span>
    )
  }

  const has7d = Boolean(periods?.last_7d_raw)
  const hasMtd = Boolean(periods?.mtd_raw)
  const hasTotal = Boolean(periods?.amount_spent_raw && periods.amount_spent_raw !== '0')

  return (
    <div className="flex flex-col items-end gap-1 max-[640px]:items-end">
      {figure}
      <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-ink-muted">
        <Badge tone={meta?.tone ?? 'neutral'} title={meta ? t(`spendFreshnessHint.${spend.freshness}`) : undefined}>
          {enumLabel('spendFreshness', spend.freshness)}
        </Badge>
        {day && <span className="tabular-nums">{formatDay(day.date, language)}</span>}
      </span>
      {periods && (has7d || hasMtd || hasTotal) && (
        <span
          className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-[11px] font-mono tabular-nums"
          data-testid="account-spend-periods"
        >
          {has7d && (
            <span className="text-brand-text">
              <span className="font-sans font-medium opacity-85">{t('spend.period7dShort')}:</span>{' '}
              <span className="font-semibold">{prettyMoney(periods.last_7d_raw!, spend.observed_currency)}</span>
            </span>
          )}
          {has7d && (hasMtd || hasTotal) && <span className="text-ink-faint">·</span>}
          {hasMtd && (
            <span className="text-ink-muted">
              <span className="font-sans font-medium opacity-85">{t('spend.periodMtdShort')}:</span>{' '}
              <span className="font-semibold text-ink">{prettyMoney(periods.mtd_raw!, spend.observed_currency)}</span>
            </span>
          )}
          {hasMtd && hasTotal && <span className="text-ink-faint">·</span>}
          {hasTotal && (
            <span className="text-tone-caution-fg">
              <span className="font-sans font-medium opacity-90">Lũy kế:</span>{' '}
              <span className="font-semibold">{prettyMoney(periods.amount_spent_raw!, spend.observed_currency)}</span>
            </span>
          )}
        </span>
      )}
    </div>
  )
}
