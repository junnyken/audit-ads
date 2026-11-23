import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { AuthProvider, useAuth } from '../hooks/useAuth'
import { I18nProvider } from '../i18n'
import { api, getToken, setToken } from '../lib/api'
import Login from '../pages/Login'
import Settings from '../pages/Settings'
import { ThemeProvider } from '../theme/ThemeProvider'

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <AuthProvider>{ui}</AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>,
  )
}

function SignOutProbe() {
  const { user, signOut } = useAuth()
  return (
    <div>
      <span data-testid="probe-user">{user ? user.email : 'anonymous'}</span>
      <button type="button" onClick={() => signOut()}>
        Trigger Logout
      </button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('v5.2 WebApp Security & Email Verification Frontend', () => {
  it('auto-verifies email from ?verify_token=, strips URL token cleanly, and passes axe', async () => {
    window.history.replaceState({}, '', '/?verify_token=tok_email_verify_9876543210')
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      status: 'ok',
      email_verified: true,
      email: 'verified@gmail.com',
    })

    const { container } = renderWithProviders(<Login />)

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/verify-email', {
        token: 'tok_email_verify_9876543210',
      })
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Xác nhận địa chỉ email thành công/i)
    expect(window.location.search).toBe('')

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('calls /auth/precheck-signup on register email blur and fails open if network fails', async () => {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/bot-challenge')) {
        return Promise.resolve({
          challenge_token: 'tok.sig',
          captcha_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
          math_question: '6 + 9 = ?',
          turnstile_enabled: false,
          turnstile_site_key: '',
        })
      }
      return Promise.resolve({})
    })
    const postSpy = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({
        ok: false,
        reason: 'email_already_registered',
        message: 'Email này đã có tài khoản trên hệ thống.',
        normalized_email: 'taken@gmail.com',
      })
      .mockRejectedValueOnce(new Error('Transient network failure'))
      .mockResolvedValueOnce({
        ok: true,
        reason: null,
        message: null,
        normalized_email: 'vip@partner-agency.io',
      })

    renderWithProviders(<Login />)
    await userEvent.click(screen.getByRole('button', { name: /Đăng ký Tài khoản/i }))

    const emailInput = screen.getByLabelText(/Email chính thống/i)
    await userEvent.type(emailInput, 'taken@gmail.com')
    fireEvent.blur(emailInput)

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/precheck-signup', { email: 'taken@gmail.com' })
    })
    expect(await screen.findByText(/Email này đã có tài khoản trên hệ thống/i)).toBeInTheDocument()

    // Clearing/typing reputable email after network failure must fail open (submit enabled)
    await userEvent.clear(emailInput)
    await userEvent.type(emailInput, 'fresh.operator@gmail.com')
    fireEvent.blur(emailInput)
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2))
    const submitBtn = screen.getByRole('button', { name: /Xác thực & Tạo Tài khoản Workspace Riêng/i })
    expect(submitBtn).not.toBeDisabled()

    // Admin-allowlisted non-standard domain returning { ok: true, message: null } must ALSO enable submit
    await userEvent.clear(emailInput)
    await userEvent.type(emailInput, 'vip@partner-agency.io')
    fireEvent.blur(emailInput)
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(3))
    expect(await screen.findByText(/Allowlist/i)).toBeInTheDocument()
    expect(submitBtn).not.toBeDisabled()
  })

  it('dispatches server-side POST /api/v1/auth/logout before clearing local token on signOut', async () => {
    setToken('jwt-active-device-token')
    vi.spyOn(api, 'get').mockResolvedValue({
      id: 'u-1',
      email: 'owner@gmail.com',
      full_name: 'Owner',
      role: 'owner',
      email_verified: true,
      workspace: { id: 'ws-1', name: 'Agency Alpha', slug: 'alpha' },
    })

    let tokenWhenLogoutCalled: string | null = null
    const postSpy = vi.spyOn(api, 'post').mockImplementation((path: string) => {
      if (path === '/api/v1/auth/logout') {
        tokenWhenLogoutCalled = getToken()
      }
      return Promise.resolve({ status: 'ok', revoked: true })
    })

    renderWithProviders(<SignOutProbe />)
    expect(await screen.findByTestId('probe-user')).toHaveTextContent('owner@gmail.com')

    await userEvent.click(screen.getByRole('button', { name: /Trigger Logout/i }))
    expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/logout', {})
    expect(tokenWhenLogoutCalled).toBe('jwt-active-device-token')
    expect(getToken()).toBeNull()
    expect(await screen.findByTestId('probe-user')).toHaveTextContent('anonymous')
  })

  it('renders AccountPasswordAndEmailSecuritySection in Settings, submits /change-password, and passes axe', async () => {
    setToken('jwt-settings-token')
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/auth/me')) {
        return Promise.resolve({
          id: 'u-1',
          email: 'owner@gmail.com',
          full_name: 'Owner',
          role: 'owner',
          is_platform_admin: false,
          email_verified: false,
          workspace: { id: 'ws-1', name: 'Agency Alpha', slug: 'alpha' },
        })
      }
      if (path.includes('/meta-reader-credentials')) {
        return Promise.resolve({ configured: false, business_managers_count: 0, items: [] })
      }
      if (path.includes('/me/reveal-pin')) {
        return Promise.resolve({ configured: false, locked: false, attempts_remaining: 5 })
      }
      if (path.includes('/notification-policies/current')) {
        return Promise.resolve({
          enabled: false,
          timezone: 'Asia/Ho_Chi_Minh',
          quiet_hours_enabled: false,
          quiet_hours_start: '23:00:00',
          quiet_hours_end: '07:00:00',
          critical_bypasses_quiet_hours: true,
          warning_telegram_enabled: false,
          attention_telegram_enabled: false,
          reminder_enabled: false,
          reminder_interval_hours: 24,
          telegram_chat_id_masked: null,
          telegram_configured: false,
        })
      }
      if (path.includes('/automation-cron/status')) {
        return Promise.resolve({
          auto_meta_sync_enabled: false,
          sync_interval_minutes: 60,
          auto_page_warmup_enabled: false,
          warmup_min_gap_hours: 8,
        })
      }
      if (path.includes('/ai-studio/config')) {
        return Promise.resolve({
          enabled: false,
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          key_configured: false,
          key_mask: '',
          available_models: {
            gemini: 'gemini-2.0-flash',
            openai: 'gpt-4o-mini',
            claude: 'claude-3-5-haiku-latest',
          },
          updated_at: null,
        })
      }
      if (path.includes('/domain-seo/config')) {
        return Promise.resolve({
          custom_domain: '',
          cors_trusted: false,
          effective_public_url: 'https://adsops.example.com',
          default_env_cors_count: 1,
          updated_at: null,
          seo_checklist: [],
        })
      }
      if (path.includes('/telegram-bot/config')) {
        return Promise.resolve({ enabled: false, configured: false, bot_token_masked: '', chat_id_masked: '' })
      }
      if (path.includes('/community/my-quota')) {
        return Promise.resolve({
          plan_tier: 'agency',
          vias_used: 0,
          max_vias: 500,
          ad_accounts_used: 0,
          max_ad_accounts: 500,
          members_used: 1,
          max_members: 25,
        })
      }
      return Promise.resolve([])
    })
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      status: 'ok',
      revoked_other_sessions: 2,
    })

    const { container } = renderWithProviders(<Settings />)
    expect(await screen.findByText(/Chưa xác nhận email/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Gửi lại email xác nhận/i }))
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/resend-verification', {})
    })

    const pwdForm = screen.getByText('Đổi mật khẩu tài khoản').closest('form')
    expect(pwdForm).not.toBeNull()
    const pwdWithin = within(pwdForm!)
    await userEvent.type(pwdWithin.getByLabelText(/Mật khẩu hiện tại/i), 'OldStrong99!')
    await userEvent.type(pwdWithin.getByLabelText(/^Mật khẩu mới/i), 'NewStrong99!')
    await userEvent.type(pwdWithin.getByLabelText(/Xác nhận mật khẩu mới/i), 'NewStrong99!')
    await userEvent.click(pwdWithin.getByRole('button', { name: /Cập nhật mật khẩu/i }))

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/change-password', {
        current_password: 'OldStrong99!',
        new_password: 'NewStrong99!',
      })
    })
    expect(await screen.findByText(/đăng xuất 2 phiên thiết bị khác/i)).toBeInTheDocument()

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
