import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { axe } from 'vitest-axe'
import AppShell from '../components/AppShell'
import Login, { normalizeCanonicalEmail } from '../pages/Login'
import { I18nProvider } from '../i18n'
import { api } from '../lib/api'
import type { WorkspaceLicenseInfo } from '../lib/types'
import { ThemeProvider } from '../theme/ThemeProvider'

const authMock = vi.hoisted(() => ({
  signOut: vi.fn(),
  signIn: vi.fn(),
  registerAccount: vi.fn(),
  license: undefined as WorkspaceLicenseInfo | undefined,
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'owner@example.test',
      full_name: 'Owner',
      role: 'owner',
      workspace: {
        id: 'ws-1',
        name: 'Không gian thử',
        slug: 'ws-1',
        license: authMock.license,
      },
    },
    signOut: authMock.signOut,
    signIn: authMock.signIn,
    registerAccount: authMock.registerAccount,
    loading: false,
  }),
}))

function renderShellWithLicense(license?: WorkspaceLicenseInfo) {
  authMock.license = license
  return render(
    <ThemeProvider>
      <I18nProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<h1>Trang thử</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
  authMock.license = undefined
})

describe('Commercial Auth & License Hardening', () => {
  it('canonicalizes Gmail dotted addresses cleanly without altering non-Gmail or + aliases', () => {
    expect(normalizeCanonicalEmail(' A.B.C@Gmail.com ')).toBe('abc@gmail.com')
    expect(normalizeCanonicalEmail('abc.def@googlemail.com')).toBe('abcdef@gmail.com')
    expect(normalizeCanonicalEmail('ten+1@gmail.com')).toBe('ten+1@gmail.com')
    expect(normalizeCanonicalEmail('User.Name@Company.vn')).toBe('user.name@company.vn')
  })

  it('supports Forgot Password request flow cleanly with zero axe violations', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      status: 'ok',
      message: 'Nếu email đã đăng ký trên hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.',
    })
    const { container } = render(
      <ThemeProvider>
        <I18nProvider>
          <Login />
        </I18nProvider>
      </ThemeProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: /Quên mật khẩu/i }))
    expect(screen.getByRole('heading', { name: /Khôi phục Mật khẩu/i })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Email/i), 'User.Demo@Gmail.com')
    await userEvent.click(screen.getByRole('button', { name: /Gửi Liên Kết Đặt Lại Mật Khẩu/i }))

    expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/forgot-password', { email: 'userdemo@gmail.com' })
    expect(await screen.findByRole('status')).toHaveTextContent(/hướng dẫn đặt lại mật khẩu/i)

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('auto-opens Reset Password mode from ?reset_token= and submits new strong password', async () => {
    window.history.replaceState({}, '', '/?reset_token=tok_reset_1234567890abcdef')
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ status: 'ok', revoked_sessions: 2 })
    const { container } = render(
      <ThemeProvider>
        <I18nProvider>
          <Login />
        </I18nProvider>
      </ThemeProvider>,
    )

    expect(screen.getByRole('heading', { name: /Đặt Lại Mật khẩu Mới/i })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/^Mật khẩu bảo mật/i), 'NewStrong99!')
    await userEvent.type(screen.getByLabelText(/Xác nhận Mật khẩu Mới/i), 'NewStrong99!')
    await userEvent.click(screen.getByRole('button', { name: /Xác Nhận Đổi Mật Khẩu/i }))

    expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/reset-password', {
      token: 'tok_reset_1234567890abcdef',
      new_password: 'NewStrong99!',
    })
    expect(await screen.findByRole('heading', { name: /Đăng nhập Bảng điều khiển/i })).toBeInTheDocument()
    expect(window.location.search).toBe('')

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('renders AppShell grace and read_only license banners with accessible settings link', async () => {
    const { container, rerender } = renderShellWithLicense({
      status: 'grace',
      is_read_only: false,
      plan_tier: 'pro',
      plan_expires_at: '2026-11-21T00:00:00Z',
      grace_ends_at: '2026-11-24T00:00:00Z',
      days_remaining: -2,
      max_desktop_devices: 2,
      active_desktop_devices: 1,
    })

    const graceBanner = screen.getByRole('status')
    expect(graceBanner).toHaveTextContent(/ân hạn 3 ngày/i)
    expect(screen.getByRole('link', { name: /Cài đặt & Nhập mã gia hạn/i })).toHaveAttribute('href', '/settings')
    const resGrace = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(resGrace.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])

    authMock.license = {
      status: 'read_only',
      is_read_only: true,
      plan_tier: 'pro',
      plan_expires_at: '2026-11-18T00:00:00Z',
      grace_ends_at: '2026-11-21T00:00:00Z',
      days_remaining: -5,
      max_desktop_devices: 2,
      active_desktop_devices: 1,
    }
    rerender(
      <ThemeProvider>
        <I18nProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="*" element={<h1>Trang thử</h1>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/Chỉ-đọc/i)
  })
})
