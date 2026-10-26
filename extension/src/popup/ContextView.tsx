/**
 * The shared context rendering used by the popup and the side panel.
 *
 * Readiness, health and alerts are three separate values here, exactly as in the dashboard.
 * Nothing merges them, and nothing shows an unconfirmed context as if it were confirmed.
 */
import { useLanguage } from '../shared/i18n'
import {
  CONTEXT_META,
  DISCLAIMER_KEY,
  FRESHNESS_META,
  HEALTH_META,
  READINESS_META,
  SPEND_FRESHNESS_META,
  SPEND_FRESHNESS_UNKNOWN,
  toneClass,
} from '../shared/presentation'
import type { ContextResolution, SpendDay } from '../shared/types'

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const meta = CONTEXT_META[status] ?? CONTEXT_META.unsupported_page
  return <span className={toneClass(meta.tone)}>{t(meta.label)}</span>
}

export function AccountIdentity({ context }: { context: ContextResolution }) {
  const { t } = useLanguage()
  const account = context.account
  if (!account) return null
  return (
    <div className="card">
      <div className="between">
        <strong>{account.display_name}</strong>
        <StatusBadge status={context.context_status} />
      </div>
      <dl className="kv" style={{ marginTop: 6 }}>
        <dt>{t('contextView.accountId')}</dt>
        <dd>{account.external_account_id ?? '—'}</dd>
        <dt>{t('contextView.businessManager')}</dt>
        <dd>{account.business_manager_name ?? '—'}</dd>
        <dt>{t('contextView.owner')}</dt>
        <dd>{account.owner_label ?? '—'}</dd>
        <dt>{t('contextView.page')}</dt>
        <dd>{context.page_type}</dd>
      </dl>
      {account.archived && (
        <p className="notice" style={{ marginTop: 8 }}>
          {t('contextView.archivedNotice')}
        </p>
      )}
    </div>
  )
}

export function OperationalState({ context }: { context: ContextResolution }) {
  const { t } = useLanguage()
  const readiness = context.readiness
  const health = context.health
  const alerts = context.alerts
  if (!readiness || !health || !alerts) return null

  const readinessMeta = READINESS_META[readiness.status] ?? READINESS_META.unknown
  const healthMeta = HEALTH_META[health.status] ?? HEALTH_META.unknown
  const freshnessMeta = FRESHNESS_META[health.freshness_status] ?? FRESHNESS_META.never_evaluated

  return (
    <div className="card">
      <dl className="kv">
        <dt>{t('contextView.readiness')}</dt>
        <dd>
          <span className={toneClass(readinessMeta.tone)}>{t(readinessMeta.label)}</span>
        </dd>
        <dt>{t('contextView.health')}</dt>
        <dd>
          <span className={toneClass(healthMeta.tone)}>{t(healthMeta.label)}</span>
        </dd>
        <dt>{t('contextView.dataFreshness')}</dt>
        <dd>
          <span className={toneClass(freshnessMeta.tone)}>{t(freshnessMeta.label)}</span>
        </dd>
        <dt>{t('contextView.openAlerts')}</dt>
        <dd>
          {alerts.open_count === 0 ? (
            <span className={toneClass('neutral')}>{t('common.none')}</span>
          ) : (
            <span className="row">
              {alerts.critical_count > 0 && (
                <span className={toneClass('attention')}>
                  {t('contextView.critical', { count: alerts.critical_count })}
                </span>
              )}
              {alerts.warning_count > 0 && (
                <span className={toneClass('caution')}>
                  {t('contextView.warning', { count: alerts.warning_count })}
                </span>
              )}
              {alerts.info_count > 0 && (
                <span className={toneClass('info')}>
                  {t('contextView.info', { count: alerts.info_count })}
                </span>
              )}
            </span>
          )}
        </dd>
      </dl>

      {readiness.reasons.length > 0 && (
        <>
          <h2>{t('contextView.readinessReasons')}</h2>
          <ul className="reasons">
            {readiness.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
            {readiness.reason_count > readiness.reasons.length && (
              <li className="faint">
                {t('contextView.moreInDashboard', {
                  count: readiness.reason_count - readiness.reasons.length,
                })}
              </li>
            )}
          </ul>
        </>
      )}

      {health.top_reasons.length > 0 && (
        <>
          <h2>{t('contextView.healthSignals')}</h2>
          <ul className="reasons">
            {health.top_reasons.map((reason, index) => (
              <li key={`${reason.severity}-${index}`}>{reason.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Money is Meta's raw string plus the observed currency. A missing value is "—", never 0. */
function amountText(day: SpendDay | null, currency: string | null): string {
  if (!day || day.spend_raw === null || day.spend_raw === undefined || day.spend_raw === '') return '—'
  return currency ? `${day.spend_raw} ${currency}` : day.spend_raw
}

export function SpendState({ context }: { context: ContextResolution }) {
  const { t } = useLanguage()
  const spend = context.spend
  // Older backends send no spend block: say nothing is known rather than render zeros.
  if (!spend) {
    return (
      <div className="card" data-testid="spend-state">
        <h2>{t('spend.title')}</h2>
        <p className="muted">{t('spend.unavailable')}</p>
      </div>
    )
  }
  const meta = SPEND_FRESHNESS_META[spend.freshness] ?? SPEND_FRESHNESS_UNKNOWN
  const hideAmounts = spend.currency_conflict
  const complete = hideAmounts ? null : spend.latest_complete_day
  const partial = hideAmounts ? null : spend.today_partial
  return (
    <div className="card" data-testid="spend-state">
      <h2>{t('spend.title')}</h2>
      <dl className="kv">
        <dt>{t('spend.freshness')}</dt>
        <dd>
          <span className={toneClass(meta.tone)}>{t(meta.label)}</span>
        </dd>
        <dt>{t('spend.lastCompleteDay')}</dt>
        <dd>
          {amountText(complete, spend.currency)}
          {spend.latest_complete_day && <span className="faint"> ({spend.latest_complete_day.date})</span>}
          {spend.latest_complete_day && spend.latest_complete_day.spend_raw === null && !hideAmounts && (
            <span className="faint"> — {t('spend.noRow')}</span>
          )}
        </dd>
        <dt>{t('spend.todayPartial')}</dt>
        <dd>{amountText(partial, spend.currency)}</dd>
        <dt>{t('spend.observedAt')}</dt>
        <dd>{spend.observed_at ? new Date(spend.observed_at).toLocaleString() : '—'}</dd>
        <dt>{t('spend.signal')}</dt>
        <dd>
          {spend.signal_open ? (
            <span className={toneClass('caution')}>{t('spend.signal.open')}</span>
          ) : (
            <span className={toneClass('neutral')}>{t('spend.signal.none')}</span>
          )}
        </dd>
      </dl>
      {hideAmounts && <p className="notice">{t('spend.conflict')}</p>}
      <p className="faint">{t('spend.note')}</p>
    </div>
  )
}

export function UnresolvedContext({ context }: { context: ContextResolution }) {
  const { t } = useLanguage()
  const meta = CONTEXT_META[context.context_status] ?? CONTEXT_META.unsupported_page
  return (
    <div className="card">
      <div className="row">
        <StatusBadge status={context.context_status} />
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {context.message ?? t(meta.hint)}
      </p>
      <p className="faint">{t('contextView.wontGuess')}</p>
    </div>
  )
}

export function Disclaimer() {
  const { t } = useLanguage()
  return <p className="notice">{t(DISCLAIMER_KEY)}</p>
}
