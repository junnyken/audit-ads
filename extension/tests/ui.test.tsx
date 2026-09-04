import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installChromeStub } from './setup'
import PopupApp from '../src/popup/PopupApp'
import SidePanelApp from '../src/sidepanel/SidePanelApp'
import OptionsApp from '../src/options/OptionsApp'
import type { ContextResolution } from '../src/shared/types'

const CONNECTED = {
  connected: true,
  dashboardUrl: 'https://adsops.example.com',
  workspaceName: 'Matbao AdsOps',
  userEmail: 'operator@example.com',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  error: null,
}

const CONFIRMED: ContextResolution = {
  context_status: 'confirmed',
  reason_code: null,
  message: null,
  page_type: 'campaign',
  safe_path: '/adsmanager/manage/campaigns',
  account: {
    id: 'account-uuid',
    display_name: 'BM USA - Account 03',
    external_account_id: 'act_123456789',
    business_manager_name: 'BM USA',
    owner_label: 'Owner 1',
    status: 'active',
    archived: false,
  },
  readiness: {
    status: 'ready_with_warnings',
    evaluated_at: new Date().toISOString(),
    reasons: [{ code: 'payment_method_review_due', message: 'Payment method review is due.' }],
    reason_count: 1,
  },
  health: {
    status: 'warning',
    freshness_status: 'current',
    evaluated_at: new Date().toISOString(),
    top_reasons: [{ severity: 'warning', message: 'Manual review is older than the interval.' }],
    counts: { critical: 0, warning: 1, attention: 0, unknown: 0 },
  },
  alerts: { open_count: 2, critical_count: 0, warning_count: 2, info_count: 0 },
  dashboard_paths: {
    account_detail: '/accounts/account-uuid',
    alerts: '/alerts?ad_account_id=account-uuid',
  },
  disclaimer: 'Operational states recorded in this product.',
  generated_at: new Date().toISOString(),
}

function stubWorker(handlers: Record<string, unknown>) {
  const { stub } = installChromeStub()
  stub.runtime.sendMessage = vi.fn(async (request: { kind: string }) => {
    const value = handlers[request.kind]
    if (value === undefined) return { ok: true }
    return typeof value === 'function' ? (value as (r: unknown) => unknown)(request) : value
  })
  return stub
}

describe('popup', () => {
  beforeEach(() => installChromeStub())

  it('sends the operator to settings when the extension is not connected', async () => {
    stubWorker({ getConnection: { ok: true, data: { ...CONNECTED, connected: false } } })
    render(<PopupApp />)
    expect(await screen.findByText(/not connected to a dashboard/i)).toBeInTheDocument()
    expect(screen.queryByText('BM USA - Account 03')).toBeNull()
  })

  it('shows account, readiness, health and alerts as separate values when confirmed', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: { ok: true, data: CONFIRMED },
    })
    render(<PopupApp />)
    expect(await screen.findByText('BM USA - Account 03')).toBeInTheDocument()
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(await screen.findByText('act_123456789')).toBeInTheDocument()
    expect(await screen.findByText('Ready with warnings')).toBeInTheDocument()
    expect(await screen.findByText('Warning')).toBeInTheDocument()
    expect(await screen.findByText('Warning: 2')).toBeInTheDocument()
    expect(await screen.findByText(/Payment method review is due/)).toBeInTheDocument()
  })

  it('refuses to guess when the context is not confirmed', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: {
        ok: true,
        data: {
          context_status: 'unknown',
          reason_code: 'account_not_registered',
          message: 'No exact registered account matches the detected account id.',
          page_type: 'campaign',
          safe_path: '/adsmanager/manage/campaigns',
        },
      },
    })
    render(<PopupApp />)
    expect(await screen.findByText('Not registered')).toBeInTheDocument()
    expect(await screen.findByText(/will not guess which account/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Select account manually' })).toBeInTheDocument()
    expect(screen.queryByText('Ready with warnings')).toBeNull()
  })

  it('states plainly that it changes nothing in Ads Manager', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: { ok: true, data: CONFIRMED },
    })
    render(<PopupApp />)
    expect(await screen.findByText(/changes nothing in Ads Manager/i)).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    for (const claim of ['protected', 'no ban risk', 'guaranteed', 'bypass', 'unlock']) {
      expect(body.toLowerCase()).not.toContain(claim)
    }
  })
})

describe('side panel workspace guard', () => {
  beforeEach(() => installChromeStub())

  it('requires every checklist item and a reason before it will record an intent', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: { ok: true, data: CONFIRMED },
    })
    const user = userEvent.setup()
    render(<SidePanelApp />)

    const save = await screen.findByRole('button', { name: 'Save change intent' })
    expect(save).toBeDisabled()

    for (const box of screen.getAllByRole('checkbox')) await user.click(box)
    expect(save).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/Recorded in the account timeline/), 'Budget fix.')
    await waitFor(() => expect(save).toBeEnabled())
  })

  it('says the checklist records, and does not block', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: { ok: true, data: CONFIRMED },
    })
    render(<SidePanelApp />)
    expect(
      await screen.findByText(/does not block anything in Ads Manager/i),
    ).toBeInTheDocument()
  })

  it('records a change intent through the worker and never touches the page', async () => {
    const stub = stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: { ok: true, data: CONFIRMED },
      recordEvent: { ok: true, data: { id: 'event-1' } },
    })
    const user = userEvent.setup()
    render(<SidePanelApp />)

    for (const box of await screen.findAllByRole('checkbox')) await user.click(box)
    await user.type(screen.getByPlaceholderText(/Recorded in the account timeline/), 'Budget fix.')
    await user.click(screen.getByRole('button', { name: 'Save change intent' }))

    await waitFor(() =>
      expect(screen.getByText(/recorded in the account timeline/i)).toBeInTheDocument(),
    )
    const calls = (stub.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    const recorded = calls.find((call) => call.kind === 'recordEvent')
    expect(recorded).toMatchObject({
      adAccountId: 'account-uuid',
      eventType: 'campaign_change_intent',
      note: 'Budget fix.',
    })
    // The extension has no control over Ads Manager, and the panel must offer none.
    const buttons = screen.getAllByRole('button').map((b) => (b.textContent ?? '').toLowerCase())
    for (const banned of ['pause', 'publish', 'duplicate', 'apply to meta', 'launch']) {
      expect(buttons.some((label) => label.includes(banned))).toBe(false)
    }
  })

  it('offers no guard or actions at all when the context is not confirmed', async () => {
    stubWorker({
      getConnection: { ok: true, data: CONNECTED },
      getContext: {
        ok: true,
        data: { ...CONFIRMED, context_status: 'ambiguous', account: null, message: 'Not sure.' },
      },
    })
    render(<SidePanelApp />)
    expect(await screen.findByText('Not confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save change intent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record event' })).toBeNull()
  })
})

describe('options', () => {
  beforeEach(() => installChromeStub())

  it('refuses a non-HTTPS dashboard URL for a real host', async () => {
    stubWorker({ getConnection: { ok: true, data: { ...CONNECTED, connected: false, dashboardUrl: '' } } })
    const user = userEvent.setup()
    render(<OptionsApp />)
    await user.type(await screen.findByLabelText('Dashboard URL'), 'http://adsops.example.com')
    expect(await screen.findByText(/Use an HTTPS address/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('clears the password field after connecting', async () => {
    stubWorker({
      getConnection: { ok: true, data: { ...CONNECTED, connected: false, dashboardUrl: '' } },
      connect: { ok: true, data: CONNECTED },
    })
    const user = userEvent.setup()
    render(<OptionsApp />)
    await user.type(await screen.findByLabelText('Dashboard URL'), 'https://adsops.example.com')
    await user.type(screen.getByLabelText('Email'), 'operator@example.com')
    const password = screen.getByLabelText('Password') as HTMLInputElement
    await user.type(password, 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(password.value).toBe(''))
  })

  it('explains exactly what is read and what is never read', async () => {
    stubWorker({ getConnection: { ok: true, data: CONNECTED } })
    render(<OptionsApp />)
    expect(await screen.findByText(/never reads cookies, local storage/i)).toBeInTheDocument()
    expect(await screen.findByText(/password is used once to connect and is never stored/i)).toBeInTheDocument()
    expect(await screen.findByText(/revokes the session on the server/i)).toBeInTheDocument()
  })
})
