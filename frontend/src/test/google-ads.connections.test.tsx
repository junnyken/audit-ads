import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { axe } from 'vitest-axe'
import GoogleAdsConnections from '../pages/GoogleAdsConnections'
import { I18nProvider } from '../i18n'
import { PlatformScopeProvider } from '../hooks/usePlatformScope'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { GoogleAdsScriptConfig } from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' as string }))

vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'owner@example.test',
      full_name: 'Nguyễn Triều',
      role: authMock.role,
      workspace: { id: 'w1', name: 'Agency Silo WS', slug: 'agency-silo' },
    },
    loading: false,
  }),
}))

function configFixture(over: Partial<GoogleAdsScriptConfig> = {}): GoogleAdsScriptConfig {
  return {
    workspace_id: 'w1',
    ingest_url: 'https://audit-ads-backend.vibe1.tinhgon.xyz/api/v1/google-ads/script-report',
    key_configured: true,
    key_masked: 'gads_****9a1f',
    mcc_script_code: 'function main() { /* AdsManagerApp.accounts() MCC SYNC */ }',
    single_account_script_code: 'function main() { /* AdsApp.currentAccount() 1:1 ISOLATED */ }',
    synced_accounts_count: 7,
    last_push_at: '2026-11-22T15:00:00Z',
    ...over,
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <ThemeProvider>
      <I18nProvider>
        <PlatformScopeProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter>
              <GoogleAdsConnections />
            </MemoryRouter>
          </QueryClientProvider>
        </PlatformScopeProvider>
      </I18nProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  authMock.role = 'owner'
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GoogleAdsConnections page', () => {
  it('renders Multi-MCC script by default and switches cleanly to 1:1 Standalone Gmail tab', async () => {
    apiMock.get.mockResolvedValue(configFixture())
    renderPage()

    expect(await screen.findByText(/AdsManagerApp\.accounts\(\) MCC SYNC/)).toBeInTheDocument()
    expect(screen.getByText('gads_****9a1f')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()

    const standaloneTab = screen.getByRole('tab', { name: /Script 2: Tài khoản Gmail Độc lập 1:1/ })
    await userEvent.click(standaloneTab)

    expect(standaloneTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/AdsApp\.currentAccount\(\) 1:1 ISOLATED/)).toBeInTheDocument()
  })

  it('allows owner to rotate key with confirmation and disables rotate button for viewer/admin', async () => {
    apiMock.get.mockResolvedValue(configFixture())
    apiMock.post.mockResolvedValue(
      configFixture({
        key_masked: 'gads_****NEW8',
        mcc_script_code: 'function main() { /* NEW_ROTATED_KEY */ }',
      }),
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const first = renderPage()
    const rotateBtn = await screen.findByRole('button', { name: /Xoay \/ Tạo khóa mới/ })
    expect(rotateBtn).toBeEnabled()

    await userEvent.click(rotateBtn)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/google-ads/rotate-key'))
    expect(await screen.findByText('gads_****NEW8')).toBeInTheDocument()
    expect(screen.getByText(/NEW_ROTATED_KEY/)).toBeInTheDocument()
    first.unmount()

    // Non-owner role sees disabled rotate control
    authMock.role = 'admin'
    renderPage()
    const disabledBtn = await screen.findByRole('button', { name: /Xoay \/ Tạo khóa mới/ })
    expect(disabledBtn).toBeDisabled()
  })

  it('switches platform scope to google_ads when navigating to Google ad accounts', async () => {
    apiMock.get.mockResolvedValue(configFixture())
    renderPage()

    const accountsLink = await screen.findByRole('link', { name: /Xem TKQC Google đã đồng bộ/ })
    await userEvent.click(accountsLink)
    expect(localStorage.getItem('adsops.platform_scope')).toBe('google_ads')
  })

  it('has no axe accessibility violations', async () => {
    apiMock.get.mockResolvedValue(configFixture())
    const { container } = renderPage()
    await screen.findByText(/AdsManagerApp\.accounts\(\) MCC SYNC/)
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
