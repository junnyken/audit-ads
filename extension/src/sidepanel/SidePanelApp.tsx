/**
 * The side panel: the surface an operator keeps open while working in Ads Manager.
 *
 * Everything it can do is either a read of this product's own records, or an event written
 * through the backend. There is no control here that touches Ads Manager, because there is no
 * such capability anywhere in the extension.
 */
import { useState } from 'react'
import { EVENT_LABEL, GUARD_CHECKLIST, READ_ONLY_NOTE } from '../shared/presentation'
import { ask } from '../shared/messaging'
import { dashboardLink, useConnection, useContext } from '../shared/useExtension'
import type { ExtensionEventType } from '../shared/types'
import { AccountIdentity, Disclaimer, OperationalState, UnresolvedContext } from '../popup/ContextView'

export default function SidePanelApp() {
  const { connection } = useConnection()
  const connected = Boolean(connection?.connected)
  const { context, error, refresh } = useContext(connected)

  if (!connection) return <div className="wrap muted">Loading…</div>
  if (!connected) {
    return (
      <div className="wrap stack">
        <h1>AdsOps Control Center</h1>
        <p className="muted">Connect the extension to your dashboard to see account context.</p>
        <button type="button" className="primary" onClick={() => chrome.runtime.openOptionsPage()}>
          Open settings
        </button>
      </div>
    )
  }

  const confirmed = context?.context_status === 'confirmed'
  const account = context?.account ?? null

  return (
    <div className="wrap stack panel">
      <div className="between">
        <h1>Account context</h1>
        <button type="button" className="link" onClick={() => void refresh()}>
          Refresh
        </button>
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
              Open account detail
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
              Open related alerts
            </button>
          </div>
        </>
      )}

      <Disclaimer />
      <p className="faint">{READ_ONLY_NOTE}</p>
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
      setResult('Change intent recorded in the account timeline.')
      setChecked({})
      setReason('')
      onRecorded()
    } else {
      setResult(response.error ?? 'Could not record the change intent.')
    }
  }

  return (
    <div className="card">
      <h2>Before you change campaign settings</h2>
      {GUARD_CHECKLIST.map((item) => (
        <label className="check" key={item.id}>
          <input
            type="checkbox"
            checked={Boolean(checked[item.id])}
            onChange={(event) =>
              setChecked((current) => ({ ...current, [item.id]: event.target.checked }))
            }
          />
          <span>{item.label}</span>
        </label>
      ))}
      <label className="field">
        <span>Why are you making this change?</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder="Recorded in the account timeline and the audit log."
        />
      </label>
      <button type="button" className="primary" disabled={!ready || busy} onClick={() => void save()}>
        {busy ? 'Recording…' : 'Save change intent'}
      </button>
      {!ready && (
        <p className="faint" style={{ marginTop: 6 }}>
          Tick every item and record a reason first. This checklist records what you checked; it
          does not block anything in Ads Manager.
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
      setResult(`${EVENT_LABEL[eventType] ?? eventType} recorded.`)
      setNote('')
      onRecorded()
    } else {
      setResult(response.error ?? 'Could not record that event.')
    }
  }

  return (
    <div className="card">
      <h2>Record an event</h2>
      <label className="field">
        <span>Event</span>
        <select
          value={eventType}
          onChange={(event) => setEventType(event.target.value as ExtensionEventType)}
        >
          {QUICK_EVENTS.map((value) => (
            <option key={value} value={value}>
              {EVENT_LABEL[value] ?? value}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note{needsNote ? '' : ' (optional)'}</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
      </label>
      <button type="button" disabled={!ready || busy} onClick={() => void record()}>
        {busy ? 'Recording…' : 'Record event'}
      </button>
      {result && <p className="notice" style={{ marginTop: 8 }}>{result}</p>}
    </div>
  )
}
