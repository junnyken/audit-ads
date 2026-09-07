import { useLanguage } from '../shared/i18n'
import { LanguageToggle } from '../shared/LanguageToggle'
import { READ_ONLY_NOTE_KEY } from '../shared/presentation'
import { dashboardLink, useConnection, useContext } from '../shared/useExtension'
import { AccountIdentity, Disclaimer, OperationalState, UnresolvedContext } from './ContextView'

export default function PopupApp() {
  const { t } = useLanguage()
  const { connection } = useConnection()
  const connected = Boolean(connection?.connected)
  const { context, error, loading, refresh } = useContext(connected)

  if (!connection) return <div className="wrap muted">{t('common.loading')}</div>

  if (!connected) {
    return (
      <div className="wrap stack">
        <div className="between">
          <h1>{t('common.appTitle')}</h1>
          <LanguageToggle />
        </div>
        <p className="muted">{t('popup.notConnected.body')}</p>
        <button type="button" className="primary" onClick={() => chrome.runtime.openOptionsPage()}>
          {t('common.openSettings')}
        </button>
        <p className="notice">{t(READ_ONLY_NOTE_KEY)}</p>
      </div>
    )
  }

  const confirmed = context?.context_status === 'confirmed'
  const base = connection.dashboardUrl

  return (
    <div className="wrap stack">
      <div className="between">
        <h1>{t('common.appTitle')}</h1>
        <div className="row">
          <LanguageToggle />
          <button type="button" className="link" onClick={() => void refresh()}>
            {t('common.refresh')}
          </button>
        </div>
      </div>
      <p className="faint">
        {connection.workspaceName} · {connection.userEmail}
      </p>

      {error && <p className="notice error">{error}</p>}
      {loading && !context && <p className="muted">{t('popup.readingContext')}</p>}

      {context && confirmed ? (
        <>
          <AccountIdentity context={context} />
          <OperationalState context={context} />
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() =>
                chrome.tabs.create({
                  url: dashboardLink(base, context.dashboard_paths?.account_detail ?? '/'),
                })
              }
            >
              {t('popup.openAccount')}
            </button>
            <button
              type="button"
              onClick={() =>
                chrome.tabs.create({
                  url: dashboardLink(base, context.dashboard_paths?.alerts ?? '/alerts'),
                })
              }
            >
              {t('popup.openAlerts')}
            </button>
          </div>
        </>
      ) : (
        context && (
          <>
            <UnresolvedContext context={context} />
            <div className="row">
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: dashboardLink(base, '/') })}
              >
                {t('popup.openDashboard')}
              </button>
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: dashboardLink(base, '/accounts') })}
              >
                {t('popup.selectAccountManually')}
              </button>
            </div>
          </>
        )
      )}

      <Disclaimer />
      <p className="faint">{t(READ_ONLY_NOTE_KEY)}</p>
    </div>
  )
}
