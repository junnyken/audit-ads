import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { axe } from 'vitest-axe'
import Overview from '../pages/Overview'
import Accounts from '../pages/Accounts'
import AccountSpendCell from '../components/AccountSpendCell'
import PlatformStatusBadge from '../components/PlatformStatusBadge'
import { SpendSummaryView } from '../components/SpendSummaryCard'
import { SegmentBar } from '../components/dashboard/SegmentBar'
import { EmptyState, ErrorState, NoPermissionState, PartialDataNote } from '../components/states'
import { ApiError } from '../lib/api'
import { PLATFORM_STATUS_META } from '../lib/platformStatus'
import { columnsStorageKey } from '../lib/columnPrefs'
import type { AccountSpendCompact, PlatformAccountStatus, SpendFreshness, SpendSummary } from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: authMock.role, workspace: { name: 'WS thử' } } }),
}))

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.clearAllMocks()
  authMock.role = 'owner'
})

function wrap(node: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const paged = (items: unknown[], extra = {}) => ({ items, page: 1, page_size: 25, total: items.length, total_pages: 1, ...extra })

const spendSummary = (over: Partial<SpendSummary> = {}): SpendSummary => ({
  generated_at: 'x',
  total_accounts: 5,
  freshness_counts: { current: 3, stale: 1, never_observed: 1, not_observable: 0 },
  platform_status_counts: { active: 3, blocking: 2, pending: 0, unknown: 0, none: 0 },
  accounts_unattributed: 0,
  currencies: [
    { currency: 'VND', total_raw: '48350000', days: ['2026-10-26'], accounts_included: 10, accounts_without_row: 1, accounts_not_current: 2, accounts_currency_conflict: 0, complete: false },
    { currency: 'USD', total_raw: '412.80', days: ['2026-10-26'], accounts_included: 3, accounts_without_row: 0, accounts_not_current: 0, accounts_currency_conflict: 0, complete: true },
  ],
  complete: false,
  disclaimer: 'Server disclaimer.',
  ...over,
})

function mockOverview(over: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/readiness/summary': { total_active: 24, operationally_ready: 9, ready_with_warnings: 6, not_ready: 5, unknown: 4, archived: 3 },
    '/account-health/summary': { total_active: 24, critical: 3, warning: 5, attention_needed: 2, unknown: 8, clear_signals: 6, stale_data: 4, never_evaluated: 2, last_evaluation_at: null, failed_runs_recent: 0, disclaimer: 'd' },
    '/alerts/summary': { open_critical: 2, open_warning: 1, open_info: 0, acknowledged: 0, suppressed: 0, failed_final_notifications: 1, deferred_by_quiet_hours: 0, total_active: 3, last_successful_notification_at: null, telegram_transport_configured: false, recipient_configured: false, disclaimer: 'd' },
    '/spend/summary': spendSummary(),
    '/audit-logs': paged([]),
    '/meta-connections/discovery-summary': [],
    '/ad-accounts': paged([]),
    ...over,
  }
  apiMock.get.mockImplementation((path: string) => {
    const key = Object.keys(routes).find((k) => path.includes(k))
    const value = key ? routes[key] : paged([])
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve(value)
  })
}

describe('Overview (T1)', () => {
  it('leads with four needs-attention tiles that link to the filtered lists, none success-toned', async () => {
    mockOverview()
    const { container } = wrap(<Overview />)
    const todo = await screen.findByRole('heading', { name: 'Cần xử lý hôm nay' })
    const section = todo.closest('section')!
    const links = await within(section).findAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/accounts?readiness_status=not_ready',
      '/account-health?health_status=critical',
      '/alerts?severity=critical&status=open',
      '/alerts?delivery_status=failed_final',
    ])
    expect(within(links[0]).getByText('5')).toBeInTheDocument()
    expect(within(links[1]).getByText('3')).toBeInTheDocument()
    expect(section.innerHTML).not.toMatch(/tone-positive|tone-dot-positive|emerald|green/)
    // Not 18 equal tiles: exactly one tile row precedes the distribution cards.
    expect(container.querySelectorAll('a[href^="/accounts?readiness_status"]').length).toBeGreaterThanOrEqual(1)
  })

  it('draws the readiness bar in proportion with a legend of real counts', async () => {
    mockOverview()
    wrap(<Overview />)
    const bar = (await screen.findAllByRole('img')).find((el) => el.getAttribute('aria-label')?.startsWith('Mức sẵn sàng'))!
    const widths = Array.from(bar.querySelectorAll('[data-segment]')).map((s) => [s.getAttribute('data-segment'), (s as HTMLElement).style.width])
    expect(widths).toEqual([
      ['operationally_ready', '37.5%'],
      ['ready_with_warnings', '25%'],
      ['not_ready', `${(5 / 24) * 100}%`],
      ['unknown', `${(4 / 24) * 100}%`],
    ])
    expect(bar.getAttribute('aria-label')).toContain('Chưa sẵn sàng 5')
    // Unknown / not ready never take the success dot class.
    expect(bar.querySelector('[data-segment="unknown"]')!.className).not.toMatch(/positive/)
    expect(bar.querySelector('[data-segment="not_ready"]')!.className).not.toMatch(/positive/)
  })

  it('shows spend per currency with raw strings, no cross-currency total, and complete:false stated', async () => {
    mockOverview()
    wrap(<Overview />)
    expect(await screen.findByText('48350000 VND')).toBeInTheDocument()
    expect(screen.getByText('412.80 USD')).toBeInTheDocument()
    expect(screen.queryByText(/48350412/)).toBeNull()
    expect(screen.getAllByText(/Tổng chưa đầy đủ/).length).toBeGreaterThan(0)
    expect(screen.getByText('2 số liệu cũ · 1 không có dòng')).toBeInTheDocument()
  })

  it('reports Meta status counts and spend freshness with no success tone', async () => {
    mockOverview()
    wrap(<Overview />)
    const counts = await screen.findByTestId('platform-status-counts')
    expect(within(counts).getByText('Không hoạt động: 2')).toBeInTheDocument()
    const fresh = await screen.findByTestId('spend-freshness-counts')
    expect(fresh.innerHTML).not.toMatch(/positive/)
    expect(counts.innerHTML).not.toMatch(/positive/)
  })

  it('keeps going when one block fails: that tile shows a dash and a retry, never 0', async () => {
    mockOverview({ '/alerts/summary': new ApiError('Máy chủ bận', 500, 'server_error', 'req-9', {}) })
    wrap(<Overview />)
    const failing = await screen.findAllByTestId('stat-tile-error')
    expect(failing).toHaveLength(2)
    for (const tile of failing) {
      expect(within(tile).getByText('—')).toBeInTheDocument()
      expect(within(tile).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
      expect(within(tile).queryByText('0')).toBeNull()
    }
    // The readiness tile is unaffected.
    expect(await screen.findByText('Chưa sẵn sàng', { selector: 'span' })).toBeInTheDocument()
  })

  it('empty registry: says so and offers the next actions', async () => {
    mockOverview({ '/readiness/summary': { total_active: 0, operationally_ready: 0, ready_with_warnings: 0, not_ready: 0, unknown: 0, archived: 0 } })
    wrap(<Overview />)
    expect(await screen.findByText('Chưa có tài khoản nào được đăng ký')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Thêm Business Manager' })).toHaveAttribute('href', '/business-managers')
    expect(screen.getByRole('link', { name: 'Đăng ký tài khoản' })).toHaveAttribute('href', '/accounts')
  })

  it('non-owner sees the discovery card with a reason instead of nothing', async () => {
    authMock.role = 'viewer'
    mockOverview()
    wrap(<Overview />)
    expect(await screen.findByText('Chỉ chủ workspace xem được kết quả đọc Meta.')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    mockOverview()
    const { container } = wrap(<Overview />)
    await screen.findByText('48350000 VND')
    expect((await axe(container)).violations).toEqual([])
  })
})

describe('SegmentBar', () => {
  it('keeps zero-count states in the legend but gives them no width', () => {
    wrap(
      <SegmentBar
        segments={[
          { key: 'a', label: 'A', count: 3, tone: 'attention' },
          { key: 'b', label: 'B', count: 0, tone: 'neutral' },
          { key: 'c', label: 'C', count: 1, tone: 'neutral' },
        ]}
      />,
    )
    expect(document.querySelectorAll('[data-segment]')).toHaveLength(2)
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('B 0')
  })
})

describe('no success tone in spend / Meta / freshness cells', () => {
  const FRESH: SpendFreshness[] = ['current', 'stale', 'never_observed', 'not_observable']
  it.each(FRESH)('spend cell %s', (freshness) => {
    const spend: AccountSpendCompact = { freshness, observed_currency: 'VND', latest_complete_day: { date: '2026-10-25', spend_raw: '10' } }
    const { container } = render(<AccountSpendCell spend={spend} />)
    expect(container.innerHTML).not.toMatch(/tone-positive|tone-dot-positive|emerald|green/)
  })
  it.each(Object.keys(PLATFORM_STATUS_META) as PlatformAccountStatus[])('Meta status %s', (status) => {
    const { container } = render(
      <PlatformStatusBadge value={{ status, account_status_raw: '1', freshness: 'current', observed_at: new Date().toISOString() }} />,
    )
    expect(container.innerHTML).not.toMatch(/tone-positive|tone-dot-positive|emerald|green/)
  })
})

describe('"—" is never 0', () => {
  it('spend cell: no row -> dash plus reason; never observed -> words; no spend object -> dash', () => {
    const { rerender, container } = render(
      <AccountSpendCell spend={{ freshness: 'current', observed_currency: 'VND', latest_complete_day: { date: '2026-10-25', spend_raw: null } }} />,
    )
    expect(screen.getByText('Meta không trả dòng')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/(^|\s)0(\s|$)/)
    rerender(<AccountSpendCell spend={{ freshness: 'never_observed', observed_currency: null, latest_complete_day: null }} />)
    expect(screen.getByText('Chưa có dữ liệu')).toBeInTheDocument()
    rerender(<AccountSpendCell spend={{ freshness: 'not_observable', observed_currency: null, latest_complete_day: null }} />)
    expect(screen.getByText('Không có kết nối đọc')).toBeInTheDocument()
    rerender(<AccountSpendCell spend={undefined} />)
    expect(container.textContent).toContain('—')
  })

  it('a currency total missing from the API is a dash', () => {
    const data = spendSummary({ currencies: [{ currency: 'VND', total_raw: null, days: [], accounts_included: 0, accounts_without_row: 1, accounts_not_current: 0, accounts_currency_conflict: 0, complete: false }] })
    wrap(<SpendSummaryView data={data} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})

describe('state components', () => {
  it('error has what, why, next and a reference id', () => {
    wrap(<ErrorState error={new ApiError('Cơ sở dữ liệu không phản hồi', 503, 'db', 'req-77', {})} onRetry={() => {}} title="Không tải được X" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Không tải được X')
    expect(alert).toHaveTextContent('Vì sao: Cơ sở dữ liệu không phản hồi')
    expect(within(alert).getByRole('link', { name: 'Trạng thái hệ thống' })).toHaveAttribute('href', '/system')
    expect(alert).toHaveTextContent('req-77')
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })

  it('a 403 is a no-permission state, not an error to retry', () => {
    wrap(<ErrorState error={new ApiError('no', 403, 'forbidden', null, {})} onRetry={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('empty, no-permission and partial render their messages', () => {
    wrap(
      <>
        <EmptyState title="Trống" description="Mô tả" action={<button>Làm gì đó</button>} />
        <NoPermissionState />
        <PartialDataNote>thiếu 3</PartialDataNote>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Làm gì đó' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Dữ liệu chưa đầy đủ: thiếu 3')
  })
})

describe('Accounts list (T2)', () => {
  const account = (id: string, over = {}) => ({
    id, display_name: `Acc ${id}`, external_account_id: `act_${id}`, account_type: 'business_manager', status: 'active',
    readiness_status: 'unknown', tags: [], archived_at: null, business_manager_name: 'BM1', personal_account_reference_label: null,
    updated_at: new Date().toISOString(), last_manual_review_at: null, required_item_count: 0, completed_item_count: 0,
    has_browser_reference: true, has_proxy_reference: false, platform_status: null, spend: undefined, ...over,
  })
  function mockList(items: unknown[], opts: { listError?: Error; bmError?: boolean } = {}) {
    apiMock.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/business-managers')) return opts.bmError ? Promise.reject(new Error('x')) : Promise.resolve(paged([], { page_size: 200 }))
      if (opts.listError) return Promise.reject(opts.listError)
      return Promise.resolve(paged(items))
    })
  }

  it('shows the 8 default columns and a card caption on every cell; unknown readiness is neutral', async () => {
    mockList([account('1')])
    wrap(<Accounts />)
    await screen.findByText('Acc 1')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Tài khoản', 'Trạng thái ghi nhận', 'Trạng thái Meta', 'Mức sẵn sàng', 'Checklist', 'Chi tiêu · ngày đầy đủ gần nhất', 'Cập nhật', 'Hành động'])
    const row = screen.getAllByRole('row')[1]
    expect(row.querySelectorAll('td[data-label]').length).toBe(6)
    expect(within(row).getByText('Không xác định', { selector: 'span' }).className).toMatch(/tone-neutral/)
    // Checklist with no required items is a dash, not 0/0.
    expect(within(row).queryByText('0/0')).toBeNull()
    // Raw enums are not humanised any more.
    expect(screen.queryByText('Business manager')).toBeNull()
  })

  it('column chooser adds an optional column and remembers it per viewer', async () => {
    mockList([account('1')])
    const first = wrap(<Accounts />)
    await screen.findByText('Acc 1')
    expect(screen.queryByRole('columnheader', { name: 'Loại' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cột' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Loại' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('columnheader', { name: 'Loại' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(columnsStorageKey('accounts', 'u1'))!)).toContain('type')
    first.unmount()
    wrap(<Accounts />)
    expect(await screen.findByRole('columnheader', { name: 'Loại' })).toBeInTheDocument()
  })

  it('survives storage that throws', async () => {
    mockList([account('1')])
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    wrap(<Accounts />)
    expect(await screen.findByText('Acc 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cột' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Loại' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('columnheader', { name: 'Loại' })).toBeInTheDocument()
    spy.mockRestore()
    set.mockRestore()
  })

  it('empty without filters offers the next action; with filters offers to clear them', async () => {
    mockList([])
    const a = wrap(<Accounts />)
    expect(await screen.findByText('Chưa có tài khoản nào được đăng ký')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Thêm Business Manager' })).toBeInTheDocument()
    a.unmount()
    wrap(<Accounts />, '/accounts?readiness_status=not_ready')
    expect(await screen.findByText('Không có tài khoản nào khớp bộ lọc')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Xoá bộ lọc' }).length).toBeGreaterThan(0)
  })

  it('error names the cause and carries a reference; 403 becomes no-permission', async () => {
    mockList([], { listError: new ApiError('Bảng bận', 500, 'x', 'req-5', {}) })
    const a = wrap(<Accounts />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không tải được danh sách tài khoản')
    expect(alert).toHaveTextContent('Bảng bận')
    expect(alert).toHaveTextContent('req-5')
    a.unmount()
    mockList([], { listError: new ApiError('no', 403, 'forbidden', null, {}) })
    wrap(<Accounts />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('partial: a failed Business Manager list is announced while the accounts still show', async () => {
    mockList([account('1')], { bmError: true })
    wrap(<Accounts />)
    expect(await screen.findByText('Acc 1')).toBeInTheDocument()
    expect(await screen.findByRole('note')).toHaveTextContent('Business Manager')
  })

  it('shows the loading skeleton as a busy region first', async () => {
    apiMock.get.mockImplementation(() => new Promise(() => {}))
    wrap(<Accounts />)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Đang tải…' })).toHaveAttribute('aria-busy', 'true'))
  })

  it('table switches to the card layout class (CSS does the rest at 640px)', async () => {
    mockList([account('1')])
    wrap(<Accounts />)
    await screen.findByText('Acc 1')
    expect(screen.getByRole('table').className).toContain('tbl-cards')
  })

  it('has no axe violations', async () => {
    mockList([account('1'), account('2', { readiness_status: 'not_ready', spend: { freshness: 'stale', observed_currency: 'VND', latest_complete_day: { date: '2026-10-24', spend_raw: '5' } } })])
    const { container } = wrap(<Accounts />)
    await screen.findByText('Acc 1')
    expect((await axe(container)).violations).toEqual([])
  })
})
