import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import FacebookAccounts from '../pages/FacebookAccounts'
import FacebookAccountDetail, { isHttpsLink } from '../pages/FacebookAccountDetail'
import { LoginToFixPanel } from '../components/facebook/LoginToFixPanel'
import { RevealEmailDialog } from '../components/facebook/RevealEmailDialog'
import { ApiError } from '../lib/api'
import { axeOptions, mountAt, paged, wrap } from './u1d-helpers'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }))
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: apiMock }))

const profile = { id: 'fb1', label: 'FB2 – Nguyễn A', display_name: '', status: 'unknown', owner_member_id: null, two_factor_method: 'none', vault_reference: 'javascript:alert(1)', recovery_note: '', email_hint: 'ng***@gmail.com' }
const detail = { business_links: [], ad_accounts: [], readers: [], owner_member_name: null, has_full_email: true, can_reveal_email: true }

beforeEach(() => { apiMock.get.mockImplementation((path: string) => Promise.resolve(path.endsWith('/personal-account-references/fb1') ? profile : path.includes('/profile') ? detail : path.includes('summary') ? [{ id: 'fb1', business_manager_count: 0, ad_account_count: 0, owner_member_name: null }] : path.includes('/members') ? [] : paged([profile]))) })
afterEach(() => vi.clearAllMocks())

describe('F1 Facebook identities', () => {
  it('lists unknown and none without success styling', async () => {
    const { container } = wrap(<FacebookAccounts />, '/facebook-accounts')
    expect(await screen.findByRole('link', { name: 'FB2 – Nguyễn A' })).toBeInTheDocument()
    expect(screen.getByText('Không dùng 2FA').closest('span')?.className).not.toMatch(/tone-positive|green|emerald/)
    expect((await axe(container, axeOptions)).violations).toEqual([])
  })
  it('shows the unknown-account state on an ad account', () => {
    wrap(<LoginToFixPanel identities={[]} />)
    expect(screen.getByText('Chưa biết tài khoản FB nào. Nối BM với tài khoản FB.')).toBeInTheDocument()
  })
  it('renders a vault reference as a link only for https', async () => {
    expect(isHttpsLink('https://vault.example/path')).toBe(true)
    expect(isHttpsLink('javascript:alert(1)')).toBe(false)
    mountAt('/facebook-accounts/:identityId', <FacebookAccountDetail />, '/facebook-accounts/fb1')
    expect(await screen.findByText('javascript:alert(1)')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mở chỗ cất mật khẩu' })).not.toBeInTheDocument()
  })
  it('reveals only after a six-digit PIN and describes a lockout', async () => {
    const user = userEvent.setup(); apiMock.post.mockResolvedValueOnce({ email: 'nguyen.van.a@gmail.com' })
    wrap(<RevealEmailDialog identityId="fb1" open onOpenChange={() => undefined} />)
    const input = screen.getByLabelText(/Mã PIN 6 số/); await user.type(input, '482913'); await user.click(screen.getByRole('button', { name: 'Xem email' }))
    expect(await screen.findByText('nguyen.van.a@gmail.com')).toBeInTheDocument()
    expect(apiMock.post).toHaveBeenCalledWith('/api/v1/personal-account-references/fb1/reveal-email', { pin: '482913' })
  })
  it('does not allow a lockout to look like a generic success', async () => {
    const user = userEvent.setup(); apiMock.post.mockRejectedValueOnce(new ApiError('locked', 423, 'pin_locked', null, {}))
    wrap(<RevealEmailDialog identityId="fb1" open onOpenChange={() => undefined} />)
    await user.type(screen.getByLabelText(/Mã PIN 6 số/), '482913'); await user.click(screen.getByRole('button', { name: 'Xem email' }))
    await waitFor(() => expect(screen.getByText('PIN đang bị khóa. Hãy thử lại sau.')).toBeInTheDocument())
  })
})
