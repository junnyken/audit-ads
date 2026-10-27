import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  DISABLE_REASON_LABEL,
  PLATFORM_STATUS_CLASS_META,
  PLATFORM_STATUS_META,
  disableReasonText,
  platformStatusBadge,
  recordedStatusSuggestion,
} from '../lib/platformStatus'
import PlatformStatusBadge from '../components/PlatformStatusBadge'
import { PlatformStatusSummaryView } from '../components/PlatformStatusSummaryCard'
import OverviewTab from '../pages/account/OverviewTab'
import SpendTab from '../pages/account/SpendTab'
import Accounts from '../pages/Accounts'
import AccountFormDrawer from '../components/AccountFormDrawer'
import type {
  AdAccount,
  PlatformAccountStatus,
  PlatformStatusCompact,
  PlatformStatusView,
  Readiness,
  SpendFreshness,
  SpendSummary,
  SpendView,
} from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: authMock.role } }),
}))

afterEach(() => {
  vi.clearAllMocks()
  authMock.role = 'owner'
})

const STATES = Object.keys(PLATFORM_STATUS_META) as PlatformAccountStatus[]
const FRESHNESS: SpendFreshness[] = ['current', 'stale', 'never_observed', 'not_observable']
const SUCCESS = /emerald|green/

const compact = (over: Partial<PlatformStatusCompact> = {}): PlatformStatusCompact => ({
  status: 'disabled',
  account_status_raw: '2',
  freshness: 'current',
  observed_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  ...over,
})

const full = (over: Partial<PlatformStatusView> = {}): PlatformStatusView => ({
  ...compact(),
  status_class: 'blocking',
  disable_reason: 'risk_payment',
  disable_reason_raw: '3',
  observation_id: 'o2',
  observation_status: 'succeeded',
  failure_code: null,
  reader_source: 'server_default',
  previous: { account_status_raw: '1', status: 'active', observed_at: '2026-10-26T01:00:00+00:00' },
  since_observed_at: '2026-10-26T03:00:00+00:00',
  disclaimer: 'Platform status disclaimer from backend.',
  ...over,
})

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// --------------------------------------------------------------------------- colour map

describe('platform status colour map (rule 5, S2 §7 6.3)', () => {
  it('has no positive tone for any state, active included', () => {
    for (const state of STATES) expect(PLATFORM_STATUS_META[state].tone).not.toBe('positive')
    expect(PLATFORM_STATUS_META.active.tone).toBe('neutral')
    for (const meta of Object.values(PLATFORM_STATUS_CLASS_META)) expect(meta.tone).not.toBe('positive')
  })

  it('maps not-operable to attention and pending to caution', () => {
    for (const s of ['disabled', 'closed', 'pending_closure'] as PlatformAccountStatus[])
      expect(PLATFORM_STATUS_META[s].tone).toBe('attention')
    for (const s of ['unsettled', 'pending_risk_review', 'pending_settlement', 'in_grace_period'] as PlatformAccountStatus[])
      expect(PLATFORM_STATUS_META[s].tone).toBe('caution')
    expect(PLATFORM_STATUS_META.unknown.tone).toBe('neutral')
  })

  it('never turns active positive, whatever the freshness', () => {
    for (const freshness of FRESHNESS)
      expect(platformStatusBadge(compact({ status: 'active', account_status_raw: '1', freshness })).tone).not.toBe('positive')
  })

  it('renders missing as a muted dash, never a default state', () => {
    expect(platformStatusBadge(null)).toMatchObject({ label: '—', tone: 'muted', context: null })
    expect(platformStatusBadge(undefined).label).toBe('—')
  })

  it('names an unrecognised code with the code itself', () => {
    const badge = platformStatusBadge(compact({ status: 'unknown', account_status_raw: '201' }))
    expect(badge.label).toBe('Mã trạng thái lạ: 201')
    expect(badge.tone).toBe('neutral')
  })

  it('treats a status the client does not know as unknown, never active', () => {
    const badge = platformStatusBadge(compact({ status: 'brand_new' as PlatformAccountStatus, account_status_raw: '555' }))
    expect(badge.label).toBe('Mã trạng thái lạ: 555')
    expect(badge.tone).toBe('neutral')
  })

  it('always says it is per Meta and when, and flags a last word', () => {
    expect(platformStatusBadge(compact()).context).toMatch(/^theo Meta · /)
    expect(platformStatusBadge(compact({ freshness: 'stale' })).context).toMatch(/lần cuối, không còn mới/)
  })

  it('never words a state as safe or normal', () => {
    const texts = [
      ...Object.values(PLATFORM_STATUS_META).flatMap((m) => [m.label, m.description]),
      ...Object.values(DISABLE_REASON_LABEL),
    ]
    for (const text of texts) expect(text.toLowerCase()).not.toMatch(/\bsafe\b|normal|guarantee|cannot be restricted/)
  })

  it('shows disable reasons as Meta names them, with the raw code', () => {
    expect(disableReasonText('risk_payment', '3')).toBe('RISK_PAYMENT — payment (3)')
    expect(disableReasonText('unknown', '99')).toBe('Unrecognised code 99')
    expect(disableReasonText(null, null)).toBe('—')
  })

  it('suggests a recorded status only for the two unambiguous codes', () => {
    expect(recordedStatusSuggestion('disabled')).toBe('disabled')
    expect(recordedStatusSuggestion('active')).toBe('active')
    for (const state of STATES.filter((s) => s !== 'disabled' && s !== 'active'))
      expect(recordedStatusSuggestion(state)).toBeNull()
    expect(recordedStatusSuggestion(null)).toBeNull()
  })
})

// ------------------------------------------------------------------------------- badge

describe('PlatformStatusBadge', () => {
  it.each(STATES)('renders %s without success styling', (status) => {
    render(<PlatformStatusBadge value={compact({ status, account_status_raw: status === 'unknown' ? '201' : '2' })} />)
    const badge = screen.getByTitle(/Quan sát lúc/)
    expect(badge.className).not.toMatch(SUCCESS)
  })

  it('renders a dash when no status was observed', () => {
    render(<PlatformStatusBadge value={null} />)
    expect(screen.getByTestId('platform-status-none')).toHaveTextContent('—')
  })
})

// ---------------------------------------------------------------------------- accounts

describe('Accounts list', () => {
  it('has a Meta status column beside the recorded status, with "—" when missing', async () => {
    const base = { tags: [], readiness_status: 'unknown', status: 'active', account_type: 'unknown', archived_at: null }
    apiMock.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/api/v1/business-managers')
          ? { items: [], page: 1, page_size: 200, total: 0, total_pages: 0 }
          : {
              items: [
                { ...base, id: 'a1', display_name: 'Seen', platform_status: compact() },
                { ...base, id: 'a2', display_name: 'Unseen', platform_status: null },
              ],
              page: 1,
              page_size: 25,
              total: 2,
              total_pages: 1,
            },
      ),
    )
    wrap(<Accounts />)
    expect(await screen.findByText('Seen')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Trạng thái Meta' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Đội ghi nhận' })).toBeInTheDocument()
    expect(screen.getByText('Bị vô hiệu hoá (theo Meta)').className).not.toMatch(SUCCESS)
    expect(screen.getAllByTestId('platform-status-none')).toHaveLength(1)
  })
})

// ------------------------------------------------------------------------ overview tab

const account = {
  id: 'acc-1', display_name: 'Acc', external_account_id: '123', account_type: 'business_manager',
  status: 'active', readiness_status: 'unknown', tags: [], archived_at: null, notes: '',
  created_at: '2026-10-01T00:00:00Z', imported_from_discovery: null,
} as unknown as AdAccount

const readiness = {
  isLoading: false,
  isError: false,
  data: {
    completed_item_count: 0, required_item_count: 0, reasons: [], disclaimer: 'r',
    data_freshness: { status: 'unknown' },
  },
} as unknown as UseQueryResult<Readiness>

function mountOverview(platform: PlatformStatusView | null, onRecord = vi.fn()) {
  apiMock.get.mockResolvedValue({ platform_status: platform, latest_attempt: null } as unknown as SpendView)
  wrap(<OverviewTab account={account} readiness={readiness} onChanged={() => {}} onRecordMetaStatus={onRecord} />)
  return onRecord
}

describe('Overview tab', () => {
  it('labels the registry row as recorded and adds the Meta rows', async () => {
    mountOverview(full())
    expect(await screen.findByText('Bị vô hiệu hoá (theo Meta)')).toBeInTheDocument()
    expect(screen.getByText('Recorded status')).toBeInTheDocument()
    expect(screen.queryByText('Platform status')).toBeNull()
    expect(screen.getByText('Disable reason')).toBeInTheDocument()
    expect(screen.getByText('RISK_PAYMENT — payment (3)')).toBeInTheDocument()
  })

  it('shows a dash when no status was observed, and offers no record button', async () => {
    mountOverview(null)
    expect(await screen.findByTestId('platform-status-none')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record Meta status/ })).toBeNull()
  })

  it('the record button only opens the drawer with a suggestion; it writes nothing', async () => {
    const onRecord = mountOverview(full())
    await userEvent.click(await screen.findByRole('button', { name: 'Record Meta status in the registry' }))
    expect(onRecord).toHaveBeenCalledWith('disabled', expect.stringContaining('account_status 2'))
    expect(apiMock.patch).not.toHaveBeenCalled()
    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('suggests nothing for a pending or closed code', async () => {
    const onRecord = mountOverview(full({ status: 'unsettled', account_status_raw: '3' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Record Meta status in the registry' }))
    expect(onRecord).toHaveBeenCalledWith(null, expect.any(String))
  })

  it('hides the record button from a viewer', async () => {
    authMock.role = 'viewer'
    mountOverview(full())
    await screen.findByText('Bị vô hiệu hoá (theo Meta)')
    expect(screen.queryByRole('button', { name: /Record Meta status/ })).toBeNull()
  })
})

// ---------------------------------------------------------------------------- drawer

describe('edit drawer opened from the record button', () => {
  it('pre-selects the suggestion and saves nothing until Save is pressed', async () => {
    apiMock.get.mockResolvedValue({ items: [], page: 1, page_size: 200, total: 0, total_pages: 0 })
    apiMock.patch.mockResolvedValue({ ...account, status: 'disabled' })
    const full = { ...account, account_type: 'unknown', business_manager_id: null, personal_account_reference_id: null, owner_label: '', country: null, currency: null, timezone: null, requires_page: false, requires_pixel: false, landing_page_url: null } as AdAccount
    wrap(
      <AccountFormDrawer open account={full} onClose={() => {}} statusSuggestion="disabled" statusNote="Meta returned account_status 2." />,
    )
    const select = (await screen.findByLabelText(/Account status/)) as HTMLSelectElement
    expect(select.value).toBe('disabled')
    expect(screen.getByTestId('meta-status-note')).toHaveTextContent('Meta returned account_status 2.')
    expect(apiMock.patch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1))
    expect(apiMock.patch.mock.calls[0][1]).toMatchObject({ status: 'disabled' })
  })

  it('without a suggestion keeps the recorded status as it is', async () => {
    apiMock.get.mockResolvedValue({ items: [], page: 1, page_size: 200, total: 0, total_pages: 0 })
    const full = { ...account, account_type: 'unknown', business_manager_id: null, personal_account_reference_id: null, owner_label: '', country: null, currency: null, timezone: null, requires_page: false, requires_pixel: false, landing_page_url: null } as AdAccount
    wrap(<AccountFormDrawer open account={full} onClose={() => {}} statusSuggestion={null} />)
    const select = (await screen.findByLabelText(/Account status/)) as HTMLSelectElement
    expect(select.value).toBe('active')
  })
})

// -------------------------------------------------------------------------- spend tab

describe('Spend tab observation history', () => {
  it('has a status code column, with "—" when Meta returned none', async () => {
    const row = (id: string, code: string | null) => ({
      id, observed_at: '2026-10-26T01:00:00Z', status: 'succeeded', trigger: 'sweep', failure_code: null,
      failure_summary: null, account_status_raw: code, daily: [],
    })
    apiMock.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/spend/observations')
          ? { items: [row('o1', '2'), row('o2', null)], page: 1, page_size: 10, total: 2, total_pages: 1 }
          : { freshness: 'current', latest_observation: null, latest_attempt: null, disclaimer: 'd', stale_after_hours: 26, platform_status: null },
      ),
    )
    wrap(<SpendTab account={account} />)
    expect(await screen.findByRole('columnheader', { name: 'Account status (code)' })).toBeInTheDocument()
    const cells = await screen.findAllByTestId('history-status-code')
    expect(cells.map((c) => c.textContent)).toEqual(['2', '—'])
  })
})

// --------------------------------------------------------------------- overview card

describe('Meta status summary card', () => {
  it('shows counts per class without success styling', () => {
    const data = {
      platform_status_counts: { active: 3, blocking: 1, pending: 2, unknown: 0, none: 4 },
    } as unknown as SpendSummary
    render(
      <MemoryRouter>
        <PlatformStatusSummaryView data={data} />
      </MemoryRouter>,
    )
    const counts = screen.getByTestId('platform-status-counts')
    expect(within(counts).getByText('Không hoạt động: 1')).toBeInTheDocument()
    expect(within(counts).getByText('Chưa quan sát: 4')).toBeInTheDocument()
    expect(within(counts).getByText('Đang hoạt động (theo Meta): 3').className).not.toMatch(SUCCESS)
    for (const badge of within(counts).getAllByText(/: \d/)) expect(badge.className).not.toMatch(SUCCESS)
  })

  it('says so when an older server sends no counts', () => {
    render(
      <MemoryRouter>
        <PlatformStatusSummaryView data={{} as SpendSummary} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/chưa báo cáo trạng thái tài khoản Meta/)).toBeInTheDocument()
  })
})
