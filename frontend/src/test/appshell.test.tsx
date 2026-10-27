import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { axe } from 'vitest-axe'
import AppShell from '../components/AppShell'
import { NAV_GROUPS, NAV_ITEMS } from '../components/shell/nav'
import Login from '../pages/Login'
import { I18nProvider } from '../i18n'
import { ThemeProvider } from '../theme/ThemeProvider'

const authMock = vi.hoisted(() => ({
  signOut: vi.fn(),
  signIn: vi.fn(),
  role: 'owner',
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'owner@example.test', role: authMock.role, workspace: { name: 'Không gian thử' } },
    signOut: authMock.signOut,
    signIn: authMock.signIn,
    loading: false,
  }),
}))

function renderShell(path = '/') {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
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
  vi.clearAllMocks()
})

describe('AppShell navigation', () => {
  it('renders seven labelled groups and fifteen links, in Vietnamese', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    expect(within(nav).getAllByRole('heading', { level: 2 })).toHaveLength(7)
    expect(NAV_GROUPS).toHaveLength(7)
    expect(within(nav).getAllByRole('link')).toHaveLength(15)
    for (const label of [
      'Tài khoản quảng cáo',
      'Sức khoẻ tài khoản',
      'Mức sẵn sàng',
      'Kiểm tra trước khi chạy',
      'Nhật ký kiểm toán',
      'Trạng thái hệ thống',
      'Thiết bị đăng nhập',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('links every route the app declares (the five A7-hidden routes included)', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const paths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => `/${m[1]}`).filter((p) => p !== '/*')
    expect(paths.length).toBeGreaterThanOrEqual(20)
    const targets = NAV_ITEMS.map((item) => item.to)
    for (const path of paths) {
      const covered = targets.some((to) => to === path || (to !== '/' && path.startsWith(`${to}/`)))
      expect(covered, `${path} is reachable from the menu`).toBe(true)
    }
    for (const to of targets.filter((t) => t !== '/')) {
      expect(paths, `${to} is a real route`).toContain(to)
    }
    for (const hidden of ['/readiness', '/account-health', '/preflight', '/audit-log', '/system']) {
      expect(targets).toContain(hidden)
    }
  })

  it('marks the current page with aria-current and keeps a parent highlighted on a detail route', () => {
    renderShell('/accounts/abc')
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    expect(within(nav).getByRole('link', { name: 'Tài khoản quảng cáo' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current')
  })

  it('has a skip link that targets the main landmark, and a single disclaimer', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: /Bỏ qua thanh điều hướng/ })
    expect(skip).toHaveAttribute('href', '#main-content')
    expect(document.getElementById('main-content')).toBe(screen.getByRole('main'))
    expect(screen.getAllByText(/không bảo đảm tài khoản tránh được hạn chế/)).toHaveLength(1)
  })

  it('shows the translated role and email, and signs out from the user menu', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Tài khoản người dùng' }))
    expect(await screen.findByText('Chủ workspace')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }))
    expect(authMock.signOut).toHaveBeenCalledTimes(1)
  })

  it('switches the whole shell to English and remembers it', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Ngôn ngữ' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ad accounts' })).toBeInTheDocument()
    expect(localStorage.getItem('adsops.language')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('AppShell mobile menu (Sheet)', () => {
  it('opens from a labelled button, closes with Escape and returns focus to the button', async () => {
    renderShell()
    const opener = screen.getByRole('button', { name: 'Mở menu điều hướng' })
    await userEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Menu điều hướng' })
    expect(within(dialog).getAllByRole('link')).toHaveLength(15)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes after choosing a destination', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Mở menu điều hướng' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('link', { name: 'Cảnh báo' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('accessibility basics', () => {
  it('every button in the shell has an accessible name', () => {
    renderShell()
    for (const button of screen.getAllByRole('button')) {
      expect(button, button.outerHTML).toHaveAccessibleName()
    }
  })

  it('has no axe violations in the shell', async () => {
    const { container } = renderShell()
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('has no axe violations on the Vietnamese login page, and its buttons are named', async () => {
    const { container } = render(
      <ThemeProvider>
        <I18nProvider>
          <Login />
        </I18nProvider>
      </ThemeProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Mật khẩu/)).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAccessibleName()
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
