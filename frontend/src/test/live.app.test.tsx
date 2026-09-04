/**
 * Live UI verification: renders the real pages against a running API.
 *
 * Skipped unless ADSOPS_LIVE_API points at a reachable backend, so the ordinary suite stays
 * hermetic. Run with:
 *   ADSOPS_LIVE_API=http://127.0.0.1:8009 ADSOPS_LIVE_EMAIL=... ADSOPS_LIVE_PASSWORD=... npx vitest run
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { AuthProvider } from '../hooks/useAuth'
import { setToken } from '../lib/api'

const BASE = process.env.ADSOPS_LIVE_API
const EMAIL = process.env.ADSOPS_LIVE_EMAIL ?? ''
const PASSWORD = process.env.ADSOPS_LIVE_PASSWORD ?? ''

const suite = BASE ? describe : describe.skip

function renderApp(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

suite('live application', () => {
  beforeAll(async () => {
    const response = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    if (!response.ok) throw new Error(`live login failed: ${response.status}`)
    setToken(((await response.json()) as { access_token: string }).access_token)
  })

  it('renders the overview with live readiness counts', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(await screen.findByText('Operationally ready')).toBeInTheDocument()
    // The disclaimer appears on the page and again in the app footer, by design.
    expect((await screen.findAllByText(/internal operational state/i)).length).toBeGreaterThan(0)
  })

  it('renders the registry table with the pilot accounts and their readiness', async () => {
    renderApp('/accounts')
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(await screen.findByText('Pilot A - complete record')).toBeInTheDocument()
    expect(await screen.findByText('Pilot B - payment review missing')).toBeInTheDocument()
    expect(await screen.findByText('Pilot C - restricted with critical event')).toBeInTheDocument()
    expect(await screen.findAllByText('Operationally ready')).not.toHaveLength(0)
    expect(await screen.findAllByText('Unknown')).not.toHaveLength(0)
  })

  it('opens an account and shows the readiness reasons behind its state', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    const link = await screen.findByRole('link', { name: 'Pilot B - payment review missing' })
    await user.click(link)

    expect(await screen.findByRole('heading', { name: /Pilot B/ })).toBeInTheDocument()
    await waitFor(async () =>
      expect(await screen.findByText(/Payment method reviewed/i)).toBeInTheDocument(),
    )
    expect((await screen.findAllByText(/not a platform approval/i)).length).toBeGreaterThan(0)
  })

  it('shows the readiness checklist with per-item requirement reasons', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await user.click(await screen.findByRole('link', { name: 'Pilot A - complete record' }))
    await user.click(await screen.findByRole('tab', { name: 'Readiness' }))

    expect(await screen.findByText('Browser profile reference assigned')).toBeInTheDocument()
    expect((await screen.findAllByText(/Why required\?/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Derived')).length).toBeGreaterThan(0)
  })

  it('renders the audit history with a redacted-safe diff', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await user.click(await screen.findByRole('link', { name: 'Pilot A - complete record' }))
    await user.click(await screen.findByRole('tab', { name: 'Audit History' }))

    expect(await screen.findByText('ad_account.created')).toBeInTheDocument()
    expect(await screen.findByText(/Append-only/i)).toBeInTheDocument()
  })

  it('renders the cross-account readiness board grouped by reason', async () => {
    renderApp('/readiness')
    expect(await screen.findByRole('heading', { name: 'Readiness' })).toBeInTheDocument()
    expect(await screen.findByText('Grouped by blocking reason')).toBeInTheDocument()
    expect(await screen.findByText(/no bulk/i)).toBeInTheDocument()
  })

  it('renders system status without exposing infrastructure values', async () => {
    renderApp('/system')
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument()
    expect((await screen.findAllByText('0004_a4_operational_runs')).length).toBeGreaterThan(0)
    const body = document.body.textContent ?? ''
    for (const leak of ['postgresql', 'adsops:adsops', 'JWT_SECRET']) {
      expect(body.toLowerCase()).not.toContain(leak.toLowerCase())
    }
  })

  it('renders the Account Health section on the overview with all six cards', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Account health' })).toBeInTheDocument()
    for (const card of [
      'Critical',
      'Warnings',
      'Attention needed',
      'Unknown health',
      'Clear signals',
      'Stale data',
    ]) {
      expect((await screen.findAllByText(card)).length).toBeGreaterThan(0)
    }
    expect(await screen.findByText(/Last health evaluation/i)).toBeInTheDocument()
    // The cards must never be labelled as safety.
    expect(screen.queryByText(/safe accounts/i)).toBeNull()
    expect(screen.queryByText(/no ban risk/i)).toBeNull()
  })

  it('renders the account health list with health, readiness and freshness as separate columns', async () => {
    renderApp('/account-health')
    expect(await screen.findByRole('heading', { name: 'Account health' })).toBeInTheDocument()
    expect(await screen.findByText('A2 Pilot A - clear signals')).toBeInTheDocument()
    expect(await screen.findByText('A2 Pilot B - missing evidence')).toBeInTheDocument()

    const header = (await screen.findByRole('table')).querySelectorAll('th')
    const labels = Array.from(header).map((cell) => cell.textContent)
    expect(labels).toContain('Readiness')
    expect(labels).toContain('Health')
    expect(labels).toContain('Data freshness')
    expect(labels).toContain('Top reason')

    expect((await screen.findAllByText('Clear signals')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Operationally ready')).length).toBeGreaterThan(0)
  })

  it('shows the health tab with its signals, rule versions and the readiness state beside it', async () => {
    const user = userEvent.setup()
    renderApp('/account-health')
    await user.click(await screen.findByRole('link', { name: 'A2 Pilot B - missing evidence' }))

    expect(await screen.findByRole('heading', { name: /A2 Pilot B/ })).toBeInTheDocument()
    expect(await screen.findByText('Readiness (separate state)')).toBeInTheDocument()
    expect((await screen.findAllByText(/Required readiness evidence is missing/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/mandatory_readiness_evidence_missing v1/)).length).toBeGreaterThan(0)
    expect(await screen.findByText(/does not contact any advertising platform/i)).toBeInTheDocument()
  })

  it('opens a signal and shows its evidence, guidance and both operator actions', async () => {
    const user = userEvent.setup()
    renderApp('/accounts?search=A2%20Pilot%20B')
    await user.click(await screen.findByRole('link', { name: 'A2 Pilot B - missing evidence' }))
    await user.click(await screen.findByRole('tab', { name: 'Health' }))
    const [details] = await screen.findAllByRole('button', { name: 'Details' })
    await user.click(details)

    expect(await screen.findByText('Why it matters')).toBeInTheDocument()
    expect(await screen.findByText('Recommended next step')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeDisabled()
    expect(await screen.findByRole('button', { name: 'Resolve signal' })).toBeDisabled()
    expect(await screen.findByText(/does not assert that any platform/i)).toBeInTheDocument()
  })

  it('never presents unknown health as a clear result', async () => {
    renderApp('/account-health?health_status=unknown')
    expect(await screen.findByRole('heading', { name: 'Account health' })).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body.toLowerCase()).not.toContain('no ban risk')
    expect(body.toLowerCase()).not.toContain('safe account')
  })

  it('renders the Alert Center section on the overview with all six cards', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Alert Center' })).toBeInTheDocument()
    for (const card of [
      'Open critical alerts',
      'Open warnings',
      'Acknowledged alerts',
      'Suppressed alerts',
      'Failed final notifications',
      'Deferred by quiet hours',
    ]) {
      expect((await screen.findAllByText(card)).length).toBeGreaterThan(0)
    }
    expect(await screen.findByText(/Last successful notification/i)).toBeInTheDocument()
    const body = (document.body.textContent ?? '').toLowerCase()
    for (const banned of ['safe account', 'no ban risk', 'account protected', 'bot_token']) {
      expect(body).not.toContain(banned)
    }
  })

  it('renders the Alert Center with severity, status, source, health, readiness and delivery apart', async () => {
    renderApp('/alerts')
    expect(await screen.findByRole('heading', { name: 'Alerts' })).toBeInTheDocument()
    const header = (await screen.findByRole('table')).querySelectorAll('th')
    const labels = Array.from(header).map((cell) => cell.textContent)
    for (const column of ['Severity', 'Alert', 'Account', 'Health', 'Readiness', 'Source', 'Status', 'Delivery']) {
      expect(labels).toContain(column)
    }
    expect((await screen.findAllByText('Critical')).length).toBeGreaterThan(0)
    expect(await screen.findByText(/not a platform decision/i)).toBeInTheDocument()
  })

  it('opens an alert and shows its source rule, delivery history and both required inputs', async () => {
    const user = userEvent.setup()
    renderApp('/alerts?severity=critical')
    const [openButton] = await screen.findAllByRole('button', { name: 'Open' })
    await user.click(openButton)

    expect(await screen.findByText('Current policy decision')).toBeInTheDocument()
    expect((await screen.findAllByText(/Notification history/)).length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: 'Resolve alert' })).toBeDisabled()
    expect((await screen.findAllByText(/does not change the health signal/i)).length).toBeGreaterThan(0)
    // No way to force a message out from the UI.
    const buttons = (await screen.findAllByRole('button')).map((b) => (b.textContent ?? '').toLowerCase())
    expect(buttons.some((label) => label.includes('send now'))).toBe(false)
  })

  it('shows the notification policy in settings without a bot token and with a masked recipient', async () => {
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Notification policy' })).toBeInTheDocument()
    expect(await screen.findByText(/Recipient chat: Configured/)).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).toContain('…7890')
    expect(body).not.toContain('1001234567890')
    // The page explains that the token is server-side; what must be absent is a token *value*.
    expect(body).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/)
    expect(await screen.findByText(/never displayed here/i)).toBeInTheDocument()
  })

  it('renders System Status with release, dispatcher, backup and host bands', async () => {
    renderApp('/system')
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument()
    for (const tile of ['Release', 'Database', 'Dispatcher', 'Backup']) {
      expect((await screen.findAllByText(tile)).length).toBeGreaterThan(0)
    }
    expect(await screen.findByText('a4-stage-a')).toBeInTheDocument()
    expect((await screen.findAllByText(/0004_a4_operational_runs/)).length).toBeGreaterThan(0)
    expect(await screen.findByRole('heading', { name: 'Host resources' })).toBeInTheDocument()
    for (const metric of ['CPU load', 'Memory', 'Disk']) {
      expect((await screen.findAllByText(metric)).length).toBeGreaterThan(0)
    }
  })

  it('shows configuration findings and run history without any secret value', async () => {
    renderApp('/system')
    expect(await screen.findByRole('heading', { name: 'Configuration' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Operational run history' })).toBeInTheDocument()
    // The local pilot credential is flagged by code, and its value never appears.
    expect(await screen.findByText(/bootstrap_password_is_pilot_credential/)).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('pilot-local-password')
    expect(body).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/)
    expect(body).not.toContain('postgresql')
    expect(await screen.findByText(/never contain the offending value/i)).toBeInTheDocument()
  })

  it('renders the delivery verification without arming or sending anything', async () => {
    const user = userEvent.setup()
    renderApp('/system')
    expect(
      await screen.findByRole('heading', { name: 'Controlled delivery verification' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Test send is switched off')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Render preview' }))
    expect(await screen.findByText(/\[AdsOps\] TEST NOTIFICATION/)).toBeInTheDocument()
    expect(await screen.findByText(/Pre-send checks/)).toBeInTheDocument()
    // Blocked, so no confirmation control is offered at all.
    expect(
      await screen.findByText(/This preview cannot be sent yet/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send one test message' })).toBeNull()

    const message = (await screen.findByText(/\[AdsOps\] TEST NOTIFICATION/)).textContent ?? ''
    for (const banned of ['account', 'token', 'password', '127.0.0.1', 'readiness']) {
      expect(message.toLowerCase()).not.toContain(banned)
    }
  })
})
