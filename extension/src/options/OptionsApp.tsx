import { useEffect, useState } from 'react'
import { ask } from '../shared/messaging'
import { useLanguage } from '../shared/i18n'
import { LanguageToggle } from '../shared/LanguageToggle'
import { READ_ONLY_NOTE_KEY } from '../shared/presentation'
import { isUsableDashboardUrl } from '../shared/validation'
import { useConnection } from '../shared/useExtension'

const VERSION = chrome.runtime.getManifest().version

export default function OptionsApp() {
  const { t } = useLanguage()
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
    setMessage(response.ok ? t('options.connection.connected') : (response.error ?? t('options.connection.connectFailed')))
    await refresh()
  }

  async function disconnect() {
    setBusy(true)
    await ask({ kind: 'disconnect', reason: 'Disconnected from the extension options page.' })
    setBusy(false)
    setFailed(false)
    setMessage(t('options.connection.disconnected'))
    await refresh()
  }

  return (
    <div className="wrap stack" style={{ maxWidth: 560 }}>
      <div className="between">
        <h1>{t('options.title')}</h1>
        <LanguageToggle />
      </div>
      <p className="faint">{t('options.version', { version: VERSION })}</p>

      <div className="card">
        <h2>{t('options.connection.title')}</h2>
        {connection?.connected ? (
          <>
            <dl className="kv">
              <dt>{t('options.connection.status')}</dt>
              <dd>
                <span className="badge badge--positive">{t('options.connection.connectedBadge')}</span>
              </dd>
              <dt>{t('options.connection.workspace')}</dt>
              <dd>{connection.workspaceName}</dd>
              <dt>{t('options.connection.signedInAs')}</dt>
              <dd>{connection.userEmail}</dd>
              <dt>{t('options.connection.dashboard')}</dt>
              <dd>{connection.dashboardUrl}</dd>
              <dt>{t('options.connection.sessionExpires')}</dt>
              <dd>
                {connection.expiresAt
                  ? new Date(connection.expiresAt).toLocaleString()
                  : t('options.connection.unknown')}
              </dd>
            </dl>
            <button
              type="button"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {t('options.connection.disconnect')}
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t('options.connection.dashboardUrlLabel')}</span>
              <input
                type="url"
                value={dashboardUrl}
                onChange={(event) => setDashboardUrl(event.target.value)}
                placeholder={t('options.connection.dashboardUrlPlaceholder')}
              />
            </label>
            {dashboardUrl.trim() !== '' && !urlOk && (
              <p className="notice error">{t('options.connection.urlHint')}</p>
            )}
            <label className="field">
              <span>{t('options.connection.emailLabel')}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>{t('options.connection.passwordLabel')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>{t('options.connection.labelLabel')}</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t('options.connection.labelPlaceholder')}
                maxLength={120}
              />
            </label>
            <button type="button" className="primary" disabled={!canConnect} onClick={() => void connect()}>
              {busy ? t('options.connection.connecting') : t('options.connection.connect')}
            </button>
          </>
        )}
        {message && <p className={failed ? 'notice error' : 'notice'} style={{ marginTop: 10 }}>{message}</p>}
      </div>

      <div className="card">
        <h2>{t('options.privacy.title')}</h2>
        <ul className="reasons">
          <li>{t('options.privacy.item1')}</li>
          <li>{t('options.privacy.item2')}</li>
          <li>{t('options.privacy.item3')}</li>
          <li>{t('options.privacy.item4')}</li>
          <li>{t('options.privacy.item5')}</li>
          <li>{t(READ_ONLY_NOTE_KEY)}</li>
        </ul>
      </div>
    </div>
  )
}
