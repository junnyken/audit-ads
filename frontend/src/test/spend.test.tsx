import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpendTab from '../pages/account/SpendTab'
import { SpendSummaryView } from '../components/SpendSummaryCard'
import { SPEND_FRESHNESS_META } from '../lib/readiness'
import { ApiError } from '../lib/api'
import type { AdAccount, SpendFreshness, SpendSummary, SpendView } from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: authMock.role } }),
}))

const account = { id: 'acc-1', archived_at: null } as AdAccount

function view(over: Partial<SpendView> = {}): SpendView {
  return {
    ad_account_id: 'acc-1',
    freshness: 'current',
    observable: true,
    reader_source: 'server_default',
    meta_connection_id: 'c1',
    stale_after_hours: 26,
    registry_currency: 'VND',
    observed_currency: 'VND',
    currency_mismatch: false,
    insights_currency_conflict: false,
    missing_input: null,
    latest_observation: {
      id: 'o1', observed_at: '2026-10-25T19:00:00+00:00', status: 'succeeded', trigger: 'manual_refresh',
      failure_code: null, failure_summary: null, meta_connection_id: 'c1', reader_source: 'server_default',
      read_as: null, currency: 'VND', timezone_name: 'Asia/Ho_Chi_Minh', account_status_raw: '1',
      disable_reason_raw: '0', amount_spent_raw: '123456700', spend_cap_raw: '200000000', balance_raw: '0',
      window_since: '2026-10-19', window_until: '2026-10-26', daily: [],
    },
    latest_attempt: { id: 'o1', observed_at: '2026-10-25T19:00:00+00:00', status: 'succeeded', failure_code: null, failure_summary: null },
    latest_complete_day: '2026-10-25',
    daily: [
      { date: '2026-10-25', spend_raw: '1600000', currency: 'VND', observation_id: 'o1', observed_at: 'x' },
      { date: '2026-10-23', spend_raw: '0', currency: 'VND', observation_id: 'o1', observed_at: 'x' },
    ],
    days_without_row: ['2026-10-24'],
    today_partial: { date: '2026-10-26', spend_raw: '77', currency: 'VND', observation_id: 'o1', observed_at: 'x', label: 'incomplete_day' },
    baseline: null,
    baseline_days_available: 2,
    disclaimer: 'Disclaimer from backend.',
    ...over,
  }
}

function mount(v: SpendView) {
  apiMock.get.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/spend/observations')
        ? { items: [], page: 1, page_size: 10, total: 0, total_pages: 0 }
        : v,
    ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SpendTab account={account} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
  authMock.role = 'owner'
})

describe('spend freshness styling', () => {
  it('has no positive tone for any freshness state', () => {
    for (const key of Object.keys(SPEND_FRESHNESS_META) as SpendFreshness[]) {
      expect(SPEND_FRESHNESS_META[key].tone).not.toBe('positive')
    }
  })

  it.each(['current', 'stale', 'never_observed', 'not_observable'] as SpendFreshness[])(
    'renders %s without success styling',
    async (freshness) => {
      mount(view({ freshness }))
      const badge = await screen.findByText(SPEND_FRESHNESS_META[freshness].label, { selector: 'span' })
      expect(badge.className).not.toMatch(/emerald|green/)
    },
  )

  it('keeps never observed and stale as different labels', () => {
    expect(SPEND_FRESHNESS_META.never_observed.label).not.toBe(SPEND_FRESHNESS_META.stale.label)
  })
})

describe('daily table', () => {
  it('shows a dash for a day without a row, a real zero for a zero row, and today separately', async () => {
    mount(view())
    const missing = (await screen.findByText('2026-10-24')).closest('tr')!
    expect(missing).toHaveTextContent('—')
    expect(missing).not.toHaveTextContent(/\b0\b/)
    expect(screen.getByText('2026-10-23').closest('tr')).toHaveTextContent('0 VND')
    expect(screen.getByText('Incomplete day')).toBeInTheDocument()
    expect(screen.getByText('77 VND')).toBeInTheDocument()
    expect(screen.getByText('Disclaimer from backend.')).toBeInTheDocument()
    expect(screen.getByText('123456700 VND')).toBeInTheDocument()
  })

  it('shows the latest failed attempt code and summary', async () => {
    mount(
      view({
        latest_attempt: { id: 'o2', observed_at: '2026-10-25T20:00:00+00:00', status: 'failed', failure_code: 'token_expired', failure_summary: 'Token expired' },
      }),
    )
    expect(await screen.findByText(/Latest attempt failed/)).toBeInTheDocument()
    expect(screen.getByText('token_expired')).toBeInTheDocument()
  })
})

describe('refresh', () => {
  it('is hidden for non-owners', async () => {
    authMock.role = 'member'
    mount(view())
    await screen.findByText('Disclaimer from backend.')
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('shows the 403 message', async () => {
    apiMock.post.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden', null, {}))
    mount(view())
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a workspace owner')
  })

  it('shows the 409 not_observable and entity_archived messages', async () => {
    apiMock.post.mockRejectedValueOnce(new ApiError('cannot read', 409, 'conflict', null, {}))
    mount(view())
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be read')
    apiMock.post.mockRejectedValueOnce(new ApiError('archived', 409, 'entity_archived', null, {}))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('archived'))
  })

  it('treats a 200 carrying a failed observation as failed', async () => {
    apiMock.post.mockResolvedValue(
      view({
        latest_attempt: { id: 'o3', observed_at: 'x', status: 'failed', failure_code: 'rate_limited', failure_summary: 'Slow down' },
      }),
    )
    mount(view())
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('recorded as failed')
    expect(alerts[0]).toHaveTextContent('rate_limited')
  })
})

describe('spend summary', () => {
  const data: SpendSummary = {
    generated_at: 'x',
    total_accounts: 5,
    freshness_counts: { current: 3, stale: 0, never_observed: 1, not_observable: 1 },
    accounts_unattributed: 2,
    currencies: [
      { currency: 'USD', total_raw: '12.25', days: ['2026-10-25'], accounts_included: 1, accounts_without_row: 0, accounts_not_current: 0, accounts_currency_conflict: 0, complete: true },
      { currency: 'VND', total_raw: '3000.5', days: ['2026-10-25'], accounts_included: 2, accounts_without_row: 1, accounts_not_current: 0, accounts_currency_conflict: 0, complete: false },
    ],
    complete: false,
    disclaimer: 'Summary disclaimer.',
  }

  it('shows one row per currency, never a combined total, and complete:false explicitly', () => {
    render(<SpendSummaryView data={data} />)
    expect(screen.getByText('12.25 USD')).toBeInTheDocument()
    expect(screen.getByText('3000.5 VND')).toBeInTheDocument()
    expect(screen.queryByText(/3012/)).toBeNull()
    expect(screen.getByText('1 không có dòng')).toBeInTheDocument()
    expect(screen.getAllByText('Thiếu').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Tổng chưa đầy đủ/)).toBeInTheDocument()
    expect(screen.getByText(/2 tài khoản chưa có lần đọc thành công/)).toBeInTheDocument()
  })
})
