import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { axe } from 'vitest-axe'
import AccountDetail from '../pages/AccountDetail'
import AccountFormDrawer from '../components/AccountFormDrawer'
import AssetsTab from '../pages/account/AssetsTab'
import ReadinessTab from '../pages/account/ReadinessTab'
import HealthTab from '../pages/account/HealthTab'
import EventsTab from '../pages/account/EventsTab'
import AuditTab from '../pages/account/AuditTab'
import SpendTab from '../pages/account/SpendTab'
import { ApiError } from '../lib/api'
import { vi as viDict } from '../i18n/vi'
import type { AdAccount } from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: authMock.role, workspace: { name: 'WS' } } }),
}))

const SUCCESS = /tone-positive|tone-dot-positive|emerald|green/

function accountFixture(over: Partial<AdAccount> = {}): AdAccount {
  return {
    id: 'acc-1',
    display_name: 'Tài khoản thử',
    external_account_id: 'act_123',
    account_type: 'business_manager',
    business_manager_id: null,
    personal_account_reference_id: null,
    business_manager_name: 'BM Một',
    personal_account_reference_label: null,
    owner_label: '',
    country: 'VN',
    currency: 'VND',
    timezone: null,
    status: 'active',
    readiness_status: 'unknown',
    readiness_evaluated_at: null,
    last_manual_review_at: null,
    last_synced_at: null,
    last_activity_at: null,
    requires_page: false,
    requires_pixel: false,
    landing_page_url: null,
    tags: [],
    notes: '',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    archived_at: null,
    required_item_count: 0,
    completed_item_count: 0,
    platform_status: {
      status: 'active',
      account_status_raw: '1',
      freshness: 'current',
      observed_at: '2026-10-26T01:00:00Z',
    },
    imported_from_discovery: null,
    ...over,
  } as AdAccount
}

const paged = (items: unknown[], extra = {}) => ({ items, page: 1, page_size: 25, total: items.length, total_pages: 1, ...extra })

const healthFixture = (over = {}) => ({
  ad_account_id: 'acc-1',
  health_status: 'unknown',
  status_description: 'd',
  freshness_status: 'unknown',
  evaluated_at: null,
  engine_version: 'v1',
  counts: { critical: 0, warning: 0, attention: 0, unknown: 0 },
  summary_reasons: [],
  readiness: { status: 'unknown', evaluated_at: null },
  disclaimer: 'Health disclaimer from server.',
  ...over,
})

const readinessFixture = (over = {}) => ({
  ad_account_id: 'acc-1',
  readiness_status: 'unknown',
  evaluated_at: '2026-10-26T00:00:00Z',
  required_item_count: 0,
  completed_item_count: 0,
  reasons: [],
  items: [],
  data_freshness: { status: 'unknown', last_synced_at: null },
  disclaimer: 'Readiness disclaimer from server.',
  ...over,
})

const spendFixture = (over = {}) => ({
  ad_account_id: 'acc-1',
  freshness: 'never_observed',
  observable: true,
  reader_source: null,
  meta_connection_id: null,
  stale_after_hours: 26,
  registry_currency: 'VND',
  observed_currency: null,
  currency_mismatch: false,
  insights_currency_conflict: false,
  missing_input: null,
  latest_observation: null,
  latest_attempt: null,
  latest_complete_day: null,
  daily: [],
  days_without_row: [],
  today_partial: null,
  baseline: null,
  baseline_days_available: 0,
  platform_status: null,
  disclaimer: 'Spend disclaimer from server.',
  ...over,
})

type Handler = unknown | Error | (() => unknown)
type Key = string | RegExp
/** Exact endpoints: a bare '/spend' would also catch '/spend/observations'. */
const ACCOUNT = /\/ad-accounts\/acc-1$/
const HEALTH = /\/ad-accounts\/acc-1\/health$/
const SPEND = /\/ad-accounts\/acc-1\/spend$/
let routes: [Key, Handler][] = []

function defaultRoutes(over: [Key, Handler][] = []): [Key, Handler][] {
  return [
    ...over,
    ['/readiness/checklist', []],
    ['/readiness/manual-review', {}],
    ['/readiness', readinessFixture()],
    ['/health/signals', paged([])],
    [HEALTH, healthFixture()],
    ['/evaluation-runs', paged([])],
    ['/alerts', paged([])],
    ['/spend/observations', paged([])],
    [SPEND, spendFixture()],
    ['/events', []],
    ['/asset-links', []],
    ['/audit-logs', paged([])],
    ['/business-managers', paged([])],
    ['/personal-account-references', paged([])],
    ['/api/v1/pages', paged([])],
    ['/api/v1/pixels', paged([])],
    ['/payment-profile-references', paged([])],
    ['/browser-profile-references', paged([])],
    ['/proxy-references', paged([])],
    [ACCOUNT, accountFixture()],
  ]
}

function mockApi(over: [Key, Handler][] = []) {
  routes = defaultRoutes(over)
  apiMock.get.mockImplementation((path: string) => {
    const hit = routes.find(([key]) => (typeof key === 'string' ? path.includes(key) : key.test(path)))
    const value = hit ? hit[1] : paged([])
    const resolved = typeof value === 'function' ? (value as () => unknown)() : value
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved)
  })
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function wrap(node: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function mountPage(path = '/accounts/acc-1') {
  return wrap(
    <>
      <Routes>
        <Route path="/accounts/:accountId" element={<AccountDetail />} />
        <Route path="/accounts" element={<p>danh sách</p>} />
      </Routes>
      <LocationProbe />
    </>,
    path,
  )
}

beforeEach(() => {
  authMock.role = 'owner'
  mockApi()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

// ------------------------------------------------------------------------------------ header

describe('Account detail header (T3)', () => {
  it('shows the account, its three status badges and the id, in Vietnamese', async () => {
    mountPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Tài khoản thử' })).toBeInTheDocument()
    const statuses = screen.getByRole('list', { name: 'Các trạng thái của tài khoản' })
    expect(within(statuses).getByText('Mức sẵn sàng:')).toBeInTheDocument()
    expect(within(statuses).getByText('Sức khoẻ:')).toBeInTheDocument()
    expect(within(statuses).getByText('Meta:')).toBeInTheDocument()
    await waitFor(() => expect(within(statuses).getAllByText('Không xác định').length).toBeGreaterThanOrEqual(2))
    expect(screen.getAllByText(/act_123/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/BM Một/).length).toBeGreaterThanOrEqual(1)
  })

  it('never gives unknown readiness, unknown health or Meta "active" a success tone', async () => {
    mountPage()
    await screen.findByRole('heading', { level: 1 })
    const statuses = screen.getByRole('list', { name: 'Các trạng thái của tài khoản' })
    await waitFor(() => expect(within(statuses).getAllByText('Không xác định').length).toBeGreaterThanOrEqual(2))
    expect(within(statuses).getByText('Đang hoạt động (theo Meta)')).toBeInTheDocument()
    // The whole status strip, including the Meta badge for "active", carries no success tone.
    expect(statuses.innerHTML).not.toMatch(SUCCESS)
  })

  it('does not paint not_ready or a stale health result as success either', async () => {
    mockApi([
      [ACCOUNT, accountFixture({ readiness_status: 'not_ready' })],
      [HEALTH, healthFixture({ health_status: 'unknown', freshness_status: 'stale' })],
    ])
    mountPage()
    const statuses = await screen.findByRole('list', { name: 'Các trạng thái của tài khoản' })
    await within(statuses).findByText('Chưa sẵn sàng')
    expect(statuses.innerHTML).not.toMatch(SUCCESS)
  })

  it('shows a dash with a reason, never 0, when the checklist has no required items or health fails', async () => {
    mockApi([[HEALTH, new ApiError('boom', 500, 'internal', null, {})]])
    mountPage()
    const health = await screen.findByTestId('header-health')
    await waitFor(() => expect(health).toHaveTextContent('—'))
    expect(health).toHaveTextContent('Chưa tải được sức khoẻ; không có nghĩa là không có vấn đề')
    const header = screen.getByRole('heading', { level: 1 }).closest('div')!.parentElement!
    expect(header).toHaveTextContent('Checklist bắt buộc:')
    expect(header).not.toHaveTextContent(/\b0\/0\b/)
    expect(within(header).getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('shows loading, then an error with a way back when the account cannot be read', async () => {
    mockApi([[ACCOUNT, new ApiError('Không có tài khoản', 404, 'not_found', 'req-9', {})]])
    mountPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được tài khoản này')
    expect(screen.getByRole('alert')).toHaveTextContent('req-9')
    expect(screen.getByRole('link', { name: 'Quay lại danh sách tài khoản' })).toHaveAttribute('href', '/accounts')
  })

  it('shows a loading region while the account is fetched', () => {
    apiMock.get.mockReturnValue(new Promise(() => undefined))
    mountPage()
    expect(screen.getByRole('status', { name: 'Đang tải…' })).toHaveAttribute('aria-busy', 'true')
  })
})

// ------------------------------------------------------------------------------------- tabs

describe('Tabs (Radix, synced to ?tab=)', () => {
  it('has seven tabs, keeps the old keys, and starts on Overview', async () => {
    mountPage()
    const tablist = await screen.findByRole('tablist', { name: 'Các mục của tài khoản' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Tổng quan',
      'Tài sản & tham chiếu',
      'Mức sẵn sàng',
      'Sức khoẻ',
      'Chi tiêu',
      'Sự kiện',
      'Lịch sử kiểm toán',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('moves with the arrow keys, Home and End, and writes ?tab= to the URL', async () => {
    const user = userEvent.setup()
    mountPage()
    const overview = await screen.findByRole('tab', { name: 'Tổng quan' })
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Tài sản & tham chiếu' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('/accounts/acc-1?tab=assets')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Lịch sử kiểm toán' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=audit')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=')
    // Only the selected tab is in the tab order (roving tabindex).
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('opens the tab named in the URL, and falls back to Overview for an unknown key', async () => {
    mountPage('/accounts/acc-1?tab=health')
    expect(await screen.findByRole('tab', { name: 'Sức khoẻ' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Trạng thái sức khoẻ')).toBeInTheDocument()
  })

  it('falls back to Overview for a tab key it does not know', async () => {
    mountPage('/accounts/acc-1?tab=nonsense')
    expect(await screen.findByRole('tab', { name: 'Tổng quan' })).toHaveAttribute('aria-selected', 'true')
  })

  it('only mounts the selected panel, so other tabs do not fetch', async () => {
    mountPage()
    await screen.findByRole('tab', { name: 'Tổng quan' })
    await waitFor(() => expect(screen.getByText('Định danh và trạng thái')).toBeInTheDocument())
    const paths = apiMock.get.mock.calls.map((c) => String(c[0]))
    expect(paths.some((p) => p.includes('/readiness/checklist'))).toBe(false)
    expect(paths.some((p) => p.includes('/asset-links'))).toBe(false)
  })
})

// ------------------------------------------------------------------- archive / restore dialog

describe('Archive and restore use an AlertDialog, not window.confirm', () => {
  async function openArchiveDialog(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Thêm hành động' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Lưu trữ tài khoản' }))
    return screen.findByRole('alertdialog')
  }

  it('never calls window.confirm, and posts nothing before the person confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    mountPage()
    const dialog = await openArchiveDialog(user)
    expect(dialog).toHaveAccessibleName('Lưu trữ tài khoản này?')
    expect(confirm).not.toHaveBeenCalled()
    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('names the object, the effect, the scope and that it can be undone', async () => {
    const user = userEvent.setup()
    mountPage()
    const dialog = await openArchiveDialog(user)
    expect(dialog).toHaveTextContent('Tài khoản thử')
    expect(dialog).toHaveTextContent('act_123')
    expect(dialog).toHaveTextContent('không sửa được cho đến khi khôi phục')
    expect(dialog).toHaveTextContent('Có thể hoàn tác')
    expect(dialog).toHaveTextContent('Không có dữ liệu nào bị xoá')
    expect(dialog).toHaveTextContent('Không có gì trên Meta bị thay đổi')
  })

  it('puts focus on the safe action, cancels with the button and with Esc, writing nothing', async () => {
    const user = userEvent.setup()
    mountPage()
    const dialog = await openArchiveDialog(user)
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    await openArchiveDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('hands focus back to the page (never to <body>) after cancel and after archiving', async () => {
    const user = userEvent.setup()
    let archived = false
    mockApi([[ACCOUNT, () => accountFixture({ archived_at: archived ? '2026-10-27T03:00:00Z' : null })]])
    apiMock.post.mockImplementation(async () => {
      archived = true
      return {}
    })
    mountPage()
    const dialog = await openArchiveDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))

    const again = await openArchiveDialog(user)
    await user.click(within(again).getByRole('button', { name: 'Lưu trữ' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('archives on confirm and then shows what the server reads back', async () => {
    const user = userEvent.setup()
    let archived = false
    mockApi([
      [ACCOUNT, () => accountFixture({ archived_at: archived ? '2026-10-27T03:00:00Z' : null })],
    ])
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/archive')) archived = true
      return {}
    })
    mountPage()
    const dialog = await openArchiveDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Lưu trữ' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/ad-accounts/acc-1/archive'))
    const readBack = await screen.findByText(/Đã đọc lại từ máy chủ: Tài khoản thử hiện ở trạng thái "Đã lưu trữ"/)
    expect(readBack).toHaveAttribute('role', 'status')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // The archived page offers Restore as the primary action and hides Edit.
    expect(screen.getByRole('button', { name: 'Khôi phục' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
  })

  it('says so, instead of "success", when the re-read does not show the change', async () => {
    const user = userEvent.setup()
    apiMock.post.mockResolvedValue({})
    mountPage()
    const dialog = await openArchiveDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Lưu trữ' }))
    expect(await screen.findByText(/máy chủ chưa phản ánh thay đổi/)).toBeInTheDocument()
  })

  it('keeps the dialog open and explains a refusal', async () => {
    const user = userEvent.setup()
    apiMock.post.mockRejectedValue(new ApiError('Không đủ quyền', 403, 'forbidden', null, {}))
    mountPage()
    const dialog = await openArchiveDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Lưu trữ' }))
    expect(await within(dialog).findByText(/không được phép thực hiện thao tác này/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('restores through the same dialog, stating the effect and that it can be archived again', async () => {
    const user = userEvent.setup()
    mockApi([[ACCOUNT, accountFixture({ archived_at: '2026-10-20T00:00:00Z' })]])
    apiMock.post.mockResolvedValue({})
    mountPage()
    await user.click(await screen.findByRole('button', { name: 'Khôi phục' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Khôi phục tài khoản này?')
    expect(dialog).toHaveTextContent('lưu trữ lại bất cứ lúc nào')
    expect(apiMock.post).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/ad-accounts/acc-1/restore'))
  })

  it('no U1c file still calls window.confirm or humanise()', () => {
    const files = [
      'pages/AccountDetail.tsx',
      'pages/account/OverviewTab.tsx',
      'pages/account/AssetsTab.tsx',
      'pages/account/ReadinessTab.tsx',
      'pages/account/HealthTab.tsx',
      'pages/account/SpendTab.tsx',
      'pages/account/EventsTab.tsx',
      'pages/account/AuditTab.tsx',
      'components/AccountFormDrawer.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')
      expect(source, file).not.toMatch(/window\.confirm|\bconfirm\(/)
      expect(source, file).not.toMatch(/humanise\(|titleCase\(/)
      expect(source, file).not.toMatch(/from '\.\.\/(\.\.\/)?components\/ui'|from '\.\/ui'/)
    }
  })
})

// ------------------------------------------------------------------------------------- Sheet

describe('AccountFormDrawer is a Sheet (T4)', () => {
  const full = accountFixture({ status: 'active' })

  it('is a modal dialog with a title, a description and a close button', async () => {
    mockApi()
    wrap(<AccountFormDrawer open account={full} onClose={() => undefined} />)
    const dialog = await screen.findByRole('dialog', { name: 'Sửa tài khoản' })
    expect(dialog).toHaveAccessibleDescription(/không đổi gì trên Meta/)
    expect(within(dialog).getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument()
  })

  it('closes on Esc and calls onClose exactly once', async () => {
    const onClose = vi.fn()
    mockApi()
    wrap(<AccountFormDrawer open account={full} onClose={onClose} />)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps focus: Tab and Shift+Tab never leave the dialog', async () => {
    const user = userEvent.setup()
    mockApi()
    wrap(
      <>
        <button type="button">ngoài hộp</button>
        <AccountFormDrawer open account={full} onClose={() => undefined} />
      </>,
    )
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 40; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement), `tab #${i + 1}`).toBe(true)
    }
    for (let i = 0; i < 12; i += 1) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement), `shift-tab #${i + 1}`).toBe(true)
    }
  })

  it('returns focus to the opener when it closes', async () => {
    const user = userEvent.setup()
    mockApi()
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            mở
          </button>
          <AccountFormDrawer open={open} account={full} onClose={() => setOpen(false)} />
        </>
      )
    }
    wrap(<Host />)
    const opener = screen.getByRole('button', { name: 'mở' })
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('keeps Save disabled with a stated reason until the name is given', async () => {
    mockApi()
    wrap(<AccountFormDrawer open onClose={() => undefined} />)
    const save = await screen.findByRole('button', { name: 'Tạo tài khoản' })
    expect(save).toBeDisabled()
    const name = screen.getByLabelText(/Tên tài khoản/)
    name.focus()
    await userEvent.tab()
    expect(await screen.findByText('Hãy nhập tên tài khoản để có thể lưu.')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows what the server read back after a save (via the detail page)', async () => {
    const user = userEvent.setup()
    let name = 'Tài khoản thử'
    mockApi([[ACCOUNT, () => accountFixture({ display_name: name })]])
    apiMock.patch.mockImplementation(async () => {
      name = 'Tên mới'
      return accountFixture({ display_name: name })
    })
    mountPage()
    await user.click(await screen.findByRole('button', { name: 'Sửa' }))
    const input = await screen.findByLabelText(/Tên tài khoản/)
    await user.clear(input)
    await user.type(input, 'Tên mới')
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await screen.findByText(/Đã đọc lại từ máy chủ sau khi lưu: Tên mới/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

// ------------------------------------------------------------------------------ each tab states

describe.each([
  ['Tài sản', () => <AssetsTab account={accountFixture()} onChanged={() => undefined} />, '/asset-links', 'Không tải được các liên kết tài sản'],
  ['Mức sẵn sàng', () => <ReadinessTab account={accountFixture()} onChanged={() => undefined} />, '/readiness/checklist', 'Không tải được checklist'],
  ['Sức khoẻ', () => <HealthTab account={accountFixture()} onChanged={() => undefined} />, '/health', 'Không tải được sức khoẻ của tài khoản'],
  ['Sự kiện', () => <EventsTab account={accountFixture()} onChanged={() => undefined} />, '/events', 'Không tải được các sự kiện'],
  ['Kiểm toán', () => <AuditTab account={accountFixture()} />, '/audit-logs', 'Không tải được lịch sử kiểm toán'],
  ['Chi tiêu', () => <SpendTab account={accountFixture()} />, '/spend', 'Không tải được số liệu chi tiêu'],
] as [string, () => ReactNode, string, string][])('tab %s: loading, error and no-permission', (_name, tab, path, errorTitle) => {
  // The more specific route must win: '/health' would otherwise also catch '/health/signals'.
  const failOnly = (error: Error): [Key, Handler][] => [[path === '/health' ? HEALTH : path === '/spend' ? SPEND : path, error]]

  it('shows a busy skeleton while loading', () => {
    apiMock.get.mockReturnValue(new Promise(() => undefined))
    wrap(tab())
    expect(screen.getByRole('status', { name: 'Đang tải…' })).toHaveAttribute('aria-busy', 'true')
  })

  it('says what failed, why, what to do next and gives the reference, with a retry', async () => {
    mockApi(failOnly(new ApiError('Cơ sở dữ liệu bận', 500, 'internal', 'req-77', {})))
    wrap(tab())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(errorTitle)
    expect(alert).toHaveTextContent('Vì sao: Cơ sở dữ liệu bận')
    expect(alert).toHaveTextContent('Làm gì tiếp')
    expect(alert).toHaveTextContent('req-77')
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })

  it('says "no permission" for a 403, not "try again"', async () => {
    mockApi(failOnly(new ApiError('forbidden', 403, 'forbidden', null, {})))
    wrap(tab())
    expect((await screen.findAllByText(/chưa có quyền xem mục này|Vai trò hiện tại của bạn không được phép xem/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull()
  })
})

describe('tab empty states give a reason and a next action', () => {
  it('Assets: no references recorded, with a link to the Assets section', async () => {
    wrap(<AssetsTab account={accountFixture()} onChanged={() => undefined} />)
    await waitFor(() => expect(screen.getAllByText(/Chưa ghi .* nào/)).toHaveLength(5))
    const links = screen.getAllByRole('link', { name: 'Mở mục Tài sản' })
    expect(links[0]).toHaveAttribute('href', '/assets')
    expect(screen.getByText(/Chưa có ánh xạ nào bị đóng/)).toBeInTheDocument()
  })

  it('Assets: a reference list that fails to load is a partial error, not a silent empty', async () => {
    mockApi([['/api/v1/pages', new ApiError('x', 500, 'internal', null, {})]])
    wrap(<AssetsTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Không tải được danh sách tham chiếu để gán')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Chưa ghi .* nào/).length).toBeGreaterThanOrEqual(4))
  })

  it('Readiness: no checklist yet says how to get one', async () => {
    wrap(<ReadinessTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Chưa có checklist cho tài khoản này')).toBeInTheDocument()
    expect(screen.getByText(/Tính lại mức sẵn sàng/)).toBeInTheDocument()
  })

  it('Health: nothing open is not "all clear" unless the server said clear_signals, and offers recalculation', async () => {
    wrap(<HealthTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Không có tín hiệu đang mở')).toBeInTheDocument()
    expect(screen.getByText(/không phải kết quả sạch/)).toBeInTheDocument()
    // The status badge for an unknown health is not success-toned.
    const badge = screen.getAllByText('Không xác định', { selector: 'span' })[0]
    expect(badge.className).not.toMatch(SUCCESS)
    expect(screen.getAllByRole('button', { name: 'Tính lại sức khoẻ' }).length).toBeGreaterThanOrEqual(1)
  })

  it('Health: clear_signals uses the permitted wording only (rule 13)', async () => {
    mockApi([[HEALTH, healthFixture({ health_status: 'clear_signals', freshness_status: 'current' })]])
    wrap(<HealthTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText(/Không phát hiện vấn đề nào theo các kiểm tra đã cấu hình/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/an toàn|sẽ được duyệt|không thể bị hạn chế/i)
  })

  it('Health: a failing signals list is flagged as partial while the status stays visible', async () => {
    mockApi([['/health/signals', new ApiError('x', 500, 'internal', null, {})]])
    wrap(<HealthTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Chưa tải được danh sách tín hiệu.')).toBeInTheDocument()
    expect(screen.getByText('Trạng thái sức khoẻ')).toBeInTheDocument()
    expect(screen.getByText('Dữ liệu chưa đầy đủ:')).toBeInTheDocument()
  })

  it('Events: no events explains what to record and focuses the form', async () => {
    const user = userEvent.setup()
    wrap(<EventsTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Chưa có sự kiện nào được ghi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ghi sự kiện đầu tiên' }))
    expect(screen.getByLabelText(/Loại sự kiện/)).toHaveFocus()
  })

  it('Events: an archived account explains why it cannot record, with no form', async () => {
    wrap(<EventsTab account={accountFixture({ archived_at: '2026-10-01T00:00:00Z' })} onChanged={() => undefined} />)
    expect(await screen.findByText(/Tài khoản đã lưu trữ nên không ghi thêm sự kiện được/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Loại sự kiện/)).toBeNull()
  })

  it('Audit: no history yet', async () => {
    wrap(<AuditTab account={accountFixture()} />)
    expect(await screen.findByText('Chưa có lịch sử kiểm toán')).toBeInTheDocument()
  })

  it('Spend: never read says what to do, and never prints a zero', async () => {
    wrap(<SpendTab account={accountFixture()} />)
    expect(await screen.findByText('Chưa có lần đọc chi tiêu thành công')).toBeInTheDocument()
    expect(screen.getByText(/Bấm Làm mới ở thẻ phía trên/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b0 VND\b/)
  })

  it('Spend: not observable points to the Meta connections', async () => {
    mockApi([[SPEND, spendFixture({ freshness: 'not_observable', observable: false })]])
    wrap(<SpendTab account={accountFixture()} />)
    expect(await screen.findByText('Không có kết nối nào đọc được tài khoản này.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mở Kết nối Meta' })).toHaveAttribute('href', '/meta-connections')
  })

  it('Spend: a failing history is partial and the freshness card stays', async () => {
    mockApi([['/spend/observations', new ApiError('x', 500, 'internal', null, {})]])
    wrap(<SpendTab account={accountFixture()} />)
    expect(await screen.findByText('Không tải được lịch sử quan sát')).toBeInTheDocument()
    expect(screen.getByText('Độ mới của số liệu chi tiêu')).toBeInTheDocument()
  })
})

describe('tab data rendering without raw enums', () => {
  it('Readiness: categories, states and review words are translated, tones come from the lib', async () => {
    const item = (over = {}) => ({
      item: {
        id: 'i1', item_key: 'bm_owner', label: 'Nhãn mục', category: 'ownership', is_mandatory: true,
        evidence_status: 'missing', review_status: 'not_reviewed', expires_at: null, reviewed_at: null, waiver_reason: null,
        ...over,
      },
      evidence: [],
      evaluation: { state: 'unknown', required: true, requires_evidence: true, derived_from: null, message: 'Thiếu rà soát', requirement_reason: 'Vì cần thế' },
    })
    mockApi([['/readiness/checklist', [item(), item({ id: 'i2', item_key: 'x', category: 'weird_new_category' })]]])
    wrap(<ReadinessTab account={accountFixture()} onChanged={() => undefined} />)
    expect(await screen.findByText('Sở hữu')).toBeInTheDocument()
    // An unknown category is shown as the code the server sent, not a guessed label.
    expect(screen.getByText('weird_new_category')).toBeInTheDocument()
    expect(screen.getAllByText('Chưa đầy đủ')[0].className).not.toMatch(SUCCESS)
    expect(screen.getAllByText('Rà soát: Chưa rà soát').length).toBe(2)
    expect(screen.getAllByText('Bằng chứng: Thiếu').length).toBe(2)
    expect(document.body.textContent).not.toMatch(/not_reviewed|in_review|needs_update/)
  })

  it('Events: severity and status are translated; a typed event type stays as typed', async () => {
    mockApi([
      ['/events', [
        { id: 'e1', ad_account_id: 'acc-1', event_type: 'billing_issue', severity: 'critical', source: 'chrome_extension',
          occurred_at: '2026-10-20T00:00:00Z', summary: 'Mô tả', evidence_reference: null, status: 'open',
          resolved_at: null, resolution_note: '', archived_at: null },
      ]],
    ])
    wrap(<EventsTab account={accountFixture()} onChanged={() => undefined} />)
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Nghiêm trọng')).toBeInTheDocument()
    expect(within(list).getByText('billing_issue')).toBeInTheDocument()
    expect(within(list).getByText('Đang mở')).toBeInTheDocument()
    expect(list).toHaveTextContent('nguồn: Tiện ích Chrome')
  })

  it('Spend: money is the raw string, a missing day is a dash with its reason, dates are right-aligned numbers', async () => {
    mockApi([
      [SPEND, spendFixture({
        freshness: 'current',
        latest_observation: {
          id: 'o1', observed_at: '2026-10-25T19:00:00+00:00', status: 'succeeded', trigger: 'manual_refresh', failure_code: null,
          failure_summary: null, currency: 'VND', timezone_name: 'Asia/Ho_Chi_Minh', account_status_raw: '1',
          amount_spent_raw: '123456700', spend_cap_raw: null, balance_raw: '0', daily: [],
        },
        latest_complete_day: '2026-10-25',
        daily: [{ date: '2026-10-25', spend_raw: '1600000', currency: 'VND' }],
        days_without_row: ['2026-10-24'],
      })],
    ])
    wrap(<SpendTab account={accountFixture()} />)
    expect(await screen.findByText('123456700 VND')).toBeInTheDocument()
    // A missing cap is a dash, not "0 VND"; a real balance of "0" is shown as Meta sent it.
    expect(screen.getByText('0 VND')).toBeInTheDocument()
    const missing = screen.getByText('24/10/2026').closest('tr')!
    const spendCell = missing.querySelectorAll('td')[1]
    expect(spendCell).toHaveTextContent('—')
    expect(spendCell).toHaveTextContent('Meta không trả dòng cho ngày này')
    expect(spendCell.className).toMatch(/text-right/)
    expect(spendCell.className).toMatch(/tabular-nums/)
    expect(spendCell.className).toMatch(/font-mono/)
    expect(screen.getByText(/Đó không phải số 0/)).toBeInTheDocument()
    expect(screen.getByText('Dữ liệu chưa đầy đủ:')).toBeInTheDocument()
  })

  it('Spend: a refresh read-back reports the observation time the server returned', async () => {
    mockApi([[SPEND, spendFixture({ freshness: 'stale' })]])
    apiMock.post.mockResolvedValue(
      spendFixture({
        freshness: 'current',
        latest_observation: {
          id: 'o9', observed_at: '2026-10-27T01:30:00+00:00', status: 'succeeded', trigger: 'manual_refresh', failure_code: null,
          failure_summary: null, currency: 'VND', timezone_name: null, account_status_raw: '1',
          amount_spent_raw: '5', spend_cap_raw: null, balance_raw: null, daily: [],
        },
      }),
    )
    wrap(<SpendTab account={accountFixture()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Làm mới' }))
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent('Đã đọc lại: lần đọc Meta lúc')
    expect(note).toHaveTextContent('"Còn mới"')
  })
})

// ------------------------------------------------------------------------------------ i18n

describe('i18n for the account pages', () => {
  it('every translation key used by these files exists in the dictionary', () => {
    const files = [
      'pages/AccountDetail.tsx',
      'pages/account/OverviewTab.tsx',
      'pages/account/AssetsTab.tsx',
      'pages/account/ReadinessTab.tsx',
      'pages/account/HealthTab.tsx',
      'pages/account/SpendTab.tsx',
      'pages/account/EventsTab.tsx',
      'pages/account/AuditTab.tsx',
      'pages/account/parts.tsx',
      'components/AccountFormDrawer.tsx',
      'components/primitives/field.tsx',
      'lib/spend.ts',
    ]
    const missing: string[] = []
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')
      for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!(match[1] in viDict)) missing.push(`${file}: ${match[1]}`)
      }
      for (const match of source.matchAll(/translate\(\s*language,\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!(match[1] in viDict)) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has a Vietnamese label for every server enum value these pages show', () => {
    const expected = [
      ...['critical', 'warning', 'attention', 'info', 'unknown'].map((v) => `severity.${v}`),
      ...['open', 'acknowledged', 'resolved', 'expired', 'superseded'].map((v) => `signalStatus.${v}`),
      ...['current', 'stale', 'unknown', 'not_applicable'].map((v) => `healthFreshness.${v}`),
      ...['queued', 'running', 'succeeded', 'failed', 'skipped'].map((v) => `runStatus.${v}`),
      ...['account_mutation', 'checklist_mutation', 'evidence_mutation', 'account_event_mutation', 'manual_recalculate', 'scheduled_recalculate', 'rule_change', 'backfill', 'spend_observation', 'discovery_sweep'].map((v) => `runTrigger.${v}`),
      ...['account_status', 'manual_event', 'readiness_engine', 'checklist_item', 'evaluation_engine', 'provider_observation'].map((v) => `signalSource.${v}`),
      ...['scheduled_sweep', 'manual_refresh'].map((v) => `obsTrigger.${v}`),
      ...['ownership', 'access', 'billing', 'assets', 'compliance', 'operations'].map((v) => `checklistCategory.${v}`),
      ...['not_reviewed', 'in_review', 'completed', 'needs_update', 'waived'].map((v) => `reviewStatus.${v}`),
      ...['missing', 'provided', 'verified', 'expired', 'rejected'].map((v) => `evidenceStatus.${v}`),
      ...['satisfied', 'unknown', 'problem', 'not_required'].map((v) => `itemState.${v}`),
      ...['manual', 'chrome_extension', 'system'].map((v) => `eventSource.${v}`),
    ]
    expect(expected.filter((key) => !(key in viDict))).toEqual([])
  })

  it('never states a guarantee in the new copy (rule 6)', () => {
    const banned = /an toàn|sẽ được duyệt|không thể bị hạn chế|đảm bảo|safe\b|will be approved|cannot be restricted/i
    const offenders = Object.entries(viDict)
      .filter(([key]) => /^(acct|ov|as|rd|hl|ev|au|sp|form|fresh|prov)\./.test(key))
      .filter(([, value]) => banned.test(value))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })
})

// ------------------------------------------------------------------------------------- axe

describe('accessibility (axe, colour-contrast off because jsdom has no layout)', () => {
  const options = { rules: { 'color-contrast': { enabled: false } } }

  it('the account detail page on Overview has no violations', async () => {
    const { container } = mountPage()
    await screen.findByText('Định danh và trạng thái')
    await waitFor(() => expect(screen.queryAllByRole('status', { name: 'Đang tải…' })).toHaveLength(0))
    expect((await axe(container, options)).violations).toEqual([])
  })

  it.each(['assets', 'readiness', 'health', 'spend', 'events', 'audit'])('the %s tab has no violations', async (key) => {
    const { container } = mountPage(`/accounts/acc-1?tab=${key}`)
    await screen.findByRole('tab', { selected: true })
    await waitFor(() => expect(screen.queryAllByRole('status', { name: 'Đang tải…' })).toHaveLength(0))
    expect((await axe(container, options)).violations).toEqual([])
  })

  it('the open Sheet has no violations', async () => {
    mockApi()
    wrap(<AccountFormDrawer open account={accountFixture()} onClose={() => undefined} />)
    const dialog = await screen.findByRole('dialog')
    expect((await axe(dialog, options)).violations).toEqual([])
  })

  it('the open AlertDialog has no violations', async () => {
    const user = userEvent.setup()
    mountPage()
    await user.click(await screen.findByRole('button', { name: 'Thêm hành động' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Lưu trữ tài khoản' }))
    const alertDialog = await screen.findByRole('alertdialog')
    expect((await axe(alertDialog, options)).violations).toEqual([])
  })
})
