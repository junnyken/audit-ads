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
    expect(await screen.findByText('0001_a1_registry')).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    for (const leak of ['postgresql', 'adsops:adsops', 'JWT_SECRET']) {
      expect(body.toLowerCase()).not.toContain(leak.toLowerCase())
    }
  })
})
