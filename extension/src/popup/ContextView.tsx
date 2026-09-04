/**
 * The shared context rendering used by the popup and the side panel.
 *
 * Readiness, health and alerts are three separate values here, exactly as in the dashboard.
 * Nothing merges them, and nothing shows an unconfirmed context as if it were confirmed.
 */
import {
  CONTEXT_META,
  DISCLAIMER,
  FRESHNESS_META,
  HEALTH_META,
  READINESS_META,
  toneClass,
} from '../shared/presentation'
import type { ContextResolution } from '../shared/types'

export function StatusBadge({ status }: { status: string }) {
  const meta = CONTEXT_META[status] ?? CONTEXT_META.unsupported_page
  return <span className={toneClass(meta.tone)}>{meta.label}</span>
}

export function AccountIdentity({ context }: { context: ContextResolution }) {
  const account = context.account
  if (!account) return null
  return (
    <div className="card">
      <div className="between">
        <strong>{account.display_name}</strong>
        <StatusBadge status={context.context_status} />
      </div>
      <dl className="kv" style={{ marginTop: 6 }}>
        <dt>Account ID</dt>
        <dd>{account.external_account_id ?? '—'}</dd>
        <dt>Business Manager</dt>
        <dd>{account.business_manager_name ?? '—'}</dd>
        <dt>Owner</dt>
        <dd>{account.owner_label ?? '—'}</dd>
        <dt>Page</dt>
        <dd>{context.page_type}</dd>
      </dl>
      {account.archived && (
        <p className="notice" style={{ marginTop: 8 }}>
          This account is archived and is no longer actively managed.
        </p>
      )}
    </div>
  )
}

export function OperationalState({ context }: { context: ContextResolution }) {
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
        <dt>Readiness</dt>
        <dd>
          <span className={toneClass(readinessMeta.tone)}>{readinessMeta.label}</span>
        </dd>
        <dt>Health</dt>
        <dd>
          <span className={toneClass(healthMeta.tone)}>{healthMeta.label}</span>
        </dd>
        <dt>Data freshness</dt>
        <dd>
          <span className={toneClass(freshnessMeta.tone)}>{freshnessMeta.label}</span>
        </dd>
        <dt>Open alerts</dt>
        <dd>
          {alerts.open_count === 0 ? (
            <span className={toneClass('neutral')}>None</span>
          ) : (
            <span className="row">
              {alerts.critical_count > 0 && (
                <span className={toneClass('attention')}>Critical: {alerts.critical_count}</span>
              )}
              {alerts.warning_count > 0 && (
                <span className={toneClass('caution')}>Warning: {alerts.warning_count}</span>
              )}
              {alerts.info_count > 0 && (
                <span className={toneClass('info')}>Info: {alerts.info_count}</span>
              )}
            </span>
          )}
        </dd>
      </dl>

      {readiness.reasons.length > 0 && (
        <>
          <h2>Readiness reasons</h2>
          <ul className="reasons">
            {readiness.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
            {readiness.reason_count > readiness.reasons.length && (
              <li className="faint">
                and {readiness.reason_count - readiness.reasons.length} more in the dashboard
              </li>
            )}
          </ul>
        </>
      )}

      {health.top_reasons.length > 0 && (
        <>
          <h2>Health signals</h2>
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

export function UnresolvedContext({ context }: { context: ContextResolution }) {
  const meta = CONTEXT_META[context.context_status] ?? CONTEXT_META.unsupported_page
  return (
    <div className="card">
      <div className="row">
        <StatusBadge status={context.context_status} />
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {context.message ?? meta.hint}
      </p>
      <p className="faint">
        The extension will not guess which account this is. Open the account in the dashboard if
        you need to be certain.
      </p>
    </div>
  )
}

export function Disclaimer() {
  return <p className="notice">{DISCLAIMER}</p>
}
