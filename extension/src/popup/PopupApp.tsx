import { READ_ONLY_NOTE } from '../shared/presentation'
import { dashboardLink, useConnection, useContext } from '../shared/useExtension'
import { AccountIdentity, Disclaimer, OperationalState, UnresolvedContext } from './ContextView'

export default function PopupApp() {
  const { connection } = useConnection()
  const connected = Boolean(connection?.connected)
  const { context, error, loading, refresh } = useContext(connected)

  if (!connection) return <div className="wrap muted">Loading…</div>

  if (!connected) {
    return (
      <div className="wrap stack">
        <h1>AdsOps Control Center</h1>
        <p className="muted">The extension is not connected to a dashboard yet.</p>
        <button type="button" className="primary" onClick={() => chrome.runtime.openOptionsPage()}>
          Open settings
        </button>
        <p className="notice">{READ_ONLY_NOTE}</p>
      </div>
    )
  }

  const confirmed = context?.context_status === 'confirmed'
  const base = connection.dashboardUrl

  return (
    <div className="wrap stack">
      <div className="between">
        <h1>AdsOps Control Center</h1>
        <button type="button" className="link" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="faint">
        {connection.workspaceName} · {connection.userEmail}
      </p>

      {error && <p className="notice error">{error}</p>}
      {loading && !context && <p className="muted">Reading page context…</p>}

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
              Open account
            </button>
            <button
              type="button"
              onClick={() =>
                chrome.tabs.create({
                  url: dashboardLink(base, context.dashboard_paths?.alerts ?? '/alerts'),
                })
              }
            >
              Open alerts
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
                Open dashboard
              </button>
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: dashboardLink(base, '/accounts') })}
              >
                Select account manually
              </button>
            </div>
          </>
        )
      )}

      <Disclaimer />
      <p className="faint">{READ_ONLY_NOTE}</p>
    </div>
  )
}
