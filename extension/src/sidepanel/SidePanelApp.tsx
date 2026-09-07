/**
 * The side panel: the surface an operator keeps open while working in Ads Manager.
 *
 * Everything it can do is either a read of this product's own records, or an event written
 * through the backend. There is no control here that touches Ads Manager, because there is no
 * such capability anywhere in the extension.
 */
import { useState } from 'react'
import { useLanguage } from '../shared/i18n'
import { LanguageToggle } from '../shared/LanguageToggle'
import { EVENT_LABEL, GUARD_CHECKLIST, READ_ONLY_NOTE_KEY } from '../shared/presentation'
import { ask } from '../shared/messaging'
import { dashboardLink, useConnection, useContext } from '../shared/useExtension'
import type { ExtensionEventType } from '../shared/types'
import { AccountIdentity, Disclaimer, OperationalState, UnresolvedContext } from '../popup/ContextView'

export default function SidePanelApp() {
  const { t } = useLanguage()
  const { connection } = useConnection()
  const connected = Boolean(connection?.connected)
  const { context, error, refresh } = useContext(connected)

  if (!connection) return <div className="wrap muted">{t('common.loading')}</div>
  if (!connected) {
    return (
      <div className="wrap stack">
        <div className="between">
          <h1>{t('common.appTitle')}</h1>
          <LanguageToggle />
        </div>
        <p className="muted">{t('sidepanel.notConnected.body')}</p>
        <button type="button" className="primary" onClick={() => chrome.runtime.openOptionsPage()}>
          {t('common.openSettings')}
        </button>
      </div>
    )
  }

  const confirmed = context?.context_status === 'confirmed'
  const account = context?.account ?? null

  return (
    <div className="wrap stack panel">
      <div className="between">
        <h1>{t('sidepanel.title')}</h1>
        <div className="row">
          <LanguageToggle />
          <button type="button" className="link" onClick={() => void refresh()}>
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {error && <p className="notice error">{error}</p>}
      {context && !confirmed && <UnresolvedContext context={context} />}

      {context && confirmed && account && (
        <>
          <AccountIdentity context={context} />
          <OperationalState context={context} />
          <WorkspaceGuard accountId={account.id} onRecorded={() => void refresh()} />
          <QuickActions accountId={account.id} onRecorded={() => void refresh()} />
          <div className="row">
            <button
              type="button"
              onClick={() =>
                chrome.tabs.create({
                  url: dashboardLink(
                    connection.dashboardUrl,
                    context.dashboard_paths?.account_detail ?? '/',
                  ),
                })
              }
            >
              {t('sidepanel.openAccountDetail')}
            </button>
            <button
              type="button"
              onClick={() =>
                chrome.tabs.create({
                  url: dashboardLink(
                    connection.dashboardUrl,
                    context.dashboard_paths?.alerts ?? '/alerts',
                  ),
                })
              }
            >
              {t('sidepanel.openRelatedAlerts')}
            </button>
          </div>
        </>
      )}

      <Disclaimer />
      <p className="faint">{t(READ_ONLY_NOTE_KEY)}</p>
    </div>
  )
}

/**
 * The Account Workspace Guard.
 *
 * It records that a person checked before acting. It does not — and cannot — stop them: this
 * extension has no ability to block anything in Ads Manager, and claiming otherwise would be
 * a safety promise the product cannot keep.
 */
function WorkspaceGuard({
  accountId,
  onRecorded,
}: {
  accountId: string
  onRecorded: () => void
}) {
  const { t } = useLanguage()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const allChecked = GUARD_CHECKLIST.every((item) => checked[item.id])
  const ready = allChecked && reason.trim().length > 0

  async function save() {
    setBusy(true)
    const response = await ask({
      kind: 'recordEvent',
      adAccountId: accountId,
      eventType: 'campaign_change_intent',
      note: reason.trim(),
    })
    setBusy(false)
    if (response.ok) {
      setResult(t('sidepanel.guard.success'))
      setChecked({})
      setReason('')
      onRecorded()
    } else {
      setResult(response.error ?? t('sidepanel.guard.failure'))
    }
  }

  return (
    <div className="card">
      <h2>{t('sidepanel.guard.title')}</h2>
      {GUARD_CHECKLIST.map((item) => (
        <label className="check" key={item.id}>
          <input
            type="checkbox"
            checked={Boolean(checked[item.id])}
            onChange={(event) =>
              setChecked((current) => ({ ...current, [item.id]: event.target.checked }))
            }
          />
          <span>{t(item.label)}</span>
        </label>
      ))}
      <label className="field">
        <span>{t('sidepanel.guard.reasonLabel')}</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder={t('sidepanel.guard.reasonPlaceholder')}
        />
      </label>
      <button type="button" className="primary" disabled={!ready || busy} onClick={() => void save()}>
        {busy ? t('sidepanel.guard.recording') : t('sidepanel.guard.save')}
      </button>
      {!ready && (
        <p className="faint" style={{ marginTop: 6 }}>
          {t('sidepanel.guard.hint')}
        </p>
      )}
      {result && <p className="notice" style={{ marginTop: 8 }}>{result}</p>}
    </div>
  )
}

const QUICK_EVENTS: ExtensionEventType[] = [
  'manual_review_started',
  'manual_review_completed',
  'campaign_change_completed',
  'account_note_added',
  'policy_issue_reported',
  'payment_issue_reported',
]

/** Notes and manual events. Each one becomes an ordinary account event with an audit row. */
function QuickActions({ accountId, onRecorded }: { accountId: string; onRecorded: () => void }) {
  const { t } = useLanguage()
  const [eventType, setEventType] = useState<ExtensionEventType>('account_note_added')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only `manual_review_started` is a bare breadcrumb; everything else records a decision and
  // therefore needs a reason, which the backend enforces regardless of what this page does.
  const needsNote = eventType !== 'manual_review_started'
  const ready = !needsNote || note.trim().length > 0

  async function record() {
    setBusy(true)
    const response = await ask({
      kind: 'recordEvent',
      adAccountId: accountId,
      eventType,
      note: note.trim(),
    })
    setBusy(false)
    if (response.ok) {
      const label = EVENT_LABEL[eventType] ? t(EVENT_LABEL[eventType]) : eventType
      setResult(t('sidepanel.quick.recorded', { label }))
      setNote('')
      onRecorded()
    } else {
      setResult(response.error ?? t('sidepanel.quick.failure'))
    }
  }

  return (
    <div className="card">
      <h2>{t('sidepanel.quick.title')}</h2>
      <label className="field">
        <span>{t('sidepanel.quick.eventLabel')}</span>
        <select
          value={eventType}
          onChange={(event) => setEventType(event.target.value as ExtensionEventType)}
        >
          {QUICK_EVENTS.map((value) => (
            <option key={value} value={value}>
              {EVENT_LABEL[value] ? t(EVENT_LABEL[value]) : value}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          {t('sidepanel.quick.noteLabel')}
          {needsNote ? '' : t('sidepanel.quick.noteOptionalSuffix')}
        </span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
      </label>
      <button type="button" disabled={!ready || busy} onClick={() => void record()}>
        {busy ? t('sidepanel.quick.recording') : t('sidepanel.quick.record')}
      </button>
      {result && <p className="notice" style={{ marginTop: 8 }}>{result}</p>}
    </div>
  )
}
