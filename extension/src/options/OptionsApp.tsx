import { useEffect, useState } from 'react'
import { ask } from '../shared/messaging'
import { READ_ONLY_NOTE } from '../shared/presentation'
import { isUsableDashboardUrl } from '../shared/validation'
import { useConnection } from '../shared/useExtension'

const VERSION = chrome.runtime.getManifest().version

export default function OptionsApp() {
  const { connection, refresh } = useConnection()
  const [dashboardUrl, setDashboardUrl] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (connection?.dashboardUrl) setDashboardUrl(connection.dashboardUrl)
  }, [connection?.dashboardUrl])

  const urlOk = dashboardUrl.trim() !== '' && isUsableDashboardUrl(dashboardUrl.trim())
  const canConnect = urlOk && email.trim() !== '' && password !== '' && !busy

  async function connect() {
    setBusy(true)
    setMessage(null)
    const response = await ask({
      kind: 'connect',
      dashboardUrl: dashboardUrl.trim(),
      email: email.trim(),
      password,
      label: label.trim(),
    })
    // Whatever happens, the password does not stay in this page.
    setPassword('')
    setBusy(false)
    setFailed(!response.ok)
    setMessage(response.ok ? 'Connected.' : (response.error ?? 'Could not connect.'))
    await refresh()
  }

  async function disconnect() {
    setBusy(true)
    await ask({ kind: 'disconnect', reason: 'Disconnected from the extension options page.' })
    setBusy(false)
    setFailed(false)
    setMessage('Disconnected. The session was revoked on the server.')
    await refresh()
  }

  return (
    <div className="wrap stack" style={{ maxWidth: 560 }}>
      <h1>AdsOps Control Center — extension settings</h1>
      <p className="faint">Version {VERSION}</p>

      <div className="card">
        <h2>Connection</h2>
        {connection?.connected ? (
          <>
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <span className="badge badge--positive">Connected</span>
              </dd>
              <dt>Workspace</dt>
              <dd>{connection.workspaceName}</dd>
              <dt>Signed in as</dt>
              <dd>{connection.userEmail}</dd>
              <dt>Dashboard</dt>
              <dd>{connection.dashboardUrl}</dd>
              <dt>Session expires</dt>
              <dd>
                {connection.expiresAt
                  ? new Date(connection.expiresAt).toLocaleString()
                  : 'unknown'}
              </dd>
            </dl>
            <button
              type="button"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect and revoke this browser
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Dashboard URL</span>
              <input
                type="url"
                value={dashboardUrl}
                onChange={(event) => setDashboardUrl(event.target.value)}
                placeholder="https://adsops.example.com"
              />
            </label>
            {dashboardUrl.trim() !== '' && !urlOk && (
              <p className="notice error">
                Use an HTTPS address. Plain HTTP is accepted only for localhost during
                development.
              </p>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>Label for this browser (optional)</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Chrome — BM USA profile"
                maxLength={120}
              />
            </label>
            <button type="button" className="primary" disabled={!canConnect} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}
        {message && <p className={failed ? 'notice error' : 'notice'} style={{ marginTop: 10 }}>{message}</p>}
      </div>

      <div className="card">
        <h2>What this extension does with your data</h2>
        <ul className="reasons">
          <li>
            It reads the account id in the Ads Manager URL, the route path, and the page title.
            Nothing else.
          </li>
          <li>
            It never reads cookies, local storage, session storage, network traffic or page
            content, and it never writes to the Ads Manager page.
          </li>
          <li>
            Your password is used once to connect and is never stored. The extension then holds
            a separate, shorter-lived session that cannot change accounts, readiness or alerts.
          </li>
          <li>
            The session is kept in the browser&apos;s in-memory extension storage and is cleared
            when the browser closes.
          </li>
          <li>
            Disconnecting revokes the session on the server, so it stops working immediately
            rather than when it expires.
          </li>
          <li>{READ_ONLY_NOTE}</li>
        </ul>
      </div>
    </div>
  )
}
