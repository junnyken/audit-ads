import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Accounts from '../pages/Accounts'
import { PlatformScopeProvider } from '../hooks/usePlatformScope'

function ChangeRoute() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/elsewhere')}>Change route</button>
}

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'owner', workspace: { name: 'WS thử' } } }),
}))

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const account = (id: string, over = {}) => ({
  id, display_name: `Acc ${id}`, external_account_id: `act_${id}`, account_type: 'business_manager', status: 'active',
  readiness_status: 'unknown', tags: [], archived_at: null, business_manager_name: 'BM1', personal_account_reference_label: null,
  updated_at: '2026-11-26T00:00:00Z', last_manual_review_at: null, required_item_count: 0, completed_item_count: 0,
  has_browser_reference: true, has_proxy_reference: false, platform_status: null, ...over,
})

async function exportAccounts(items: ReturnType<typeof account>[], initial = '/', prepare?: () => Promise<void>) {
  apiMock.get.mockImplementation((path: string) => {
    const page = Number(new URL(path, 'http://test').searchParams.get('page') ?? 1)
    return Promise.resolve({ items: path.startsWith('/api/v1/ad-accounts') ? items.slice((page - 1) * 25, page * 25) : [],
      page, page_size: 25, total: items.length, total_pages: Math.ceil(items.length / 25) })
  })
  const createObjectURL = vi.fn(() => 'blob:accounts-csv')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}><PlatformScopeProvider><Accounts /></PlatformScopeProvider></MemoryRouter></QueryClientProvider>)
  await screen.findByTestId('accounts-export-csv')
  await prepare?.()
  await userEvent.click(screen.getByTestId('accounts-export-csv'))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:accounts-csv')
  const blob = createObjectURL.mock.calls[0] as unknown as [Blob]
  expect(blob[0]).toBeInstanceOf(Blob)
  expect(blob[0].type).toBe('text/csv;charset=utf-8;')
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob[0])
  })
  expect(Array.from(new Uint8Array(bytes).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob[0])
  })
}

const money = (cells: string[]) => [cells[8], ...cells.slice(13, 18)]
const periods = (value: string | null) => ({
  balance_raw: value, today_partial_raw: value, last_7d_raw: value, mtd_raw: value, amount_spent_raw: value,
})
const spend = (value: string | null, currency: string | null = null) => ({
  freshness: 'current', observed_currency: currency, latest_complete_day: { date: '2026-11-25', spend_raw: value },
})

describe('Accounts CSV download', () => {
  it('marks missing/null money and currency, preserves zero and exact decimals, and keeps currency/balance precedence', async () => {
    const precise = '900719925474099312345.12345678901234567890'
    const csv = await exportAccounts([
      account('missing'),
      account('null', { currency: null, billing_meta: { balance_raw: null }, spend_periods: periods(null), spend: spend(null) }),
      account('zero', { currency: 'VND', billing_meta: { balance_raw: '0' }, spend_periods: { ...periods('0'), balance_raw: '99' }, spend: spend('0', 'USD') }),
      account('precision', { currency: 'EUR', billing_meta: { balance_raw: null }, spend_periods: periods(precise), spend: spend(precise) }),
      account('balance-fallback', { spend_periods: periods('0'), spend: spend('0', 'JPY') }),
    ])
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n')
    expect(lines).toHaveLength(6)
    const rows = lines.slice(1).map((line) => line.split(','))
    for (const row of rows) expect(row).toHaveLength(19)
    expect(money(rows[0])).toEqual(Array(6).fill('—'))
    expect(money(rows[1])).toEqual(Array(6).fill('—'))
    expect(money(rows[2])).toEqual(Array(6).fill('0'))
    expect(money(rows[3])).toEqual(Array(6).fill(precise))
    expect(money(rows[4])).toEqual(Array(6).fill('0'))
    expect(rows.map((row) => row[7])).toEqual(['—', '—', 'USD', 'EUR', 'JPY'])
  })

  it('retains UTF-8 BOM, CRLF records, headers, metadata and comma/quote/newline escaping', async () => {
    const csv = await exportAccounts([account('escaped', {
      display_name: 'Name, "quoted"\nnext',
      billing_meta: { billing_threshold_raw: '123.4500', next_bill_date: '2026-12-01', meta_daily_limit_raw: '456.7800', payment_card_display: 'Card, "1234"' },
    })])
    // The helper verifies BOM bytes before decoding the generated Blob.
    expect(csv.replace(/^\uFEFF/, '')).toBe(
      'Tên TKQC,ID TKQC (External ID),Business Manager,XMDN BM,Pháp nhân Doanh nghiệp,Mã số thuế (MST),Via & Hồ sơ Chrome,Tiền tệ,Dư nợ hiện tại,Số dư đạt (Ngưỡng TT),Ngày thanh toán tiếp theo,Giới hạn chi tiêu ngày (Meta đặt),Phương thức thanh toán (Thẻ),Chi tiêu Hôm nay,Chi tiêu Hôm qua,Chi tiêu 7 ngày,Chi tiêu Tháng này (MTD),Chi tiêu Lũy kế,Trạng thái Meta\r\n' +
      '"Name, ""quoted""\nnext",act_escaped,BM1,Chưa XMDN,—,—,—,—,—,123.4500,2026-12-01,456.7800,"Card, ""1234""",—,—,—,—,—,Đang hoạt động',
    )
  })
})

it('protects textual formula vectors and malformed numeric values while preserving raw negatives', async () => {
  const vectors = ['=1', '+1', '-1', '@SUM(A1)', ' \t=1', '\u0001-1', '\r+1', '\n@x']
  const csv = await exportAccounts(vectors.map((value, i) => account(String(i), {
    display_name: value, external_account_id: value, currency: value,
    billing_meta: { balance_raw: '-123.450000', billing_threshold_raw: value },
  })))
  for (const value of vectors) {
    const protectedText = "'" + value
    expect(csv).toContain(/[\r\n]/.test(value) ? '"' + protectedText + '"' : protectedText)
  }
  expect(csv.match(/,-123\.450000,/g)).toHaveLength(vectors.length)
})

it('exports fresh pages 1 and 2 from page 2, retaining server filters', async () => {
  const csv = await exportAccounts(Array.from({ length: 26 }, (_, i) => account(String(i))), '/?page=2&search=needle&status=active')
  expect(csv.split('\r\n')).toHaveLength(27)
  const calls = apiMock.get.mock.calls.map(([path]) => String(path)).filter(path => path.startsWith('/api/v1/ad-accounts'))
  expect(calls.slice(-2).map(path => new URL(path, 'http://test').searchParams.get('page'))).toEqual(['1', '2'])
  for (const path of calls.slice(-2)) expect(path).toContain('search=needle')
})

it.each(['duplicate', 'count', 'page', 'error', 'limit', 'cancel', 'unmount', 'auth', 'route'])('fails closed without Blob on %s', async (failure) => {
  const first = Array.from({ length: 25 }, (_, i) => account(String(i)))
  let resolvePage!: (value: unknown) => void
  let rejectPage!: (reason: Error) => void
  let requests = 0
  apiMock.get.mockImplementation((path: string) => {
    if (!path.startsWith('/api/v1/ad-accounts') || path.includes('page_size=100')) return Promise.resolve({ items: [] })
    requests++
    if (requests <= 2) return Promise.resolve({ items: first, page: 1, page_size: 25, total: failure === 'limit' && requests === 2 ? 10001 : 26, total_pages: failure === 'limit' && requests === 2 ? 401 : 2 })
    return new Promise((resolve, reject) => { resolvePage = resolve; rejectPage = reject })
  })
  const create = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><MemoryRouter><ChangeRoute /><PlatformScopeProvider><Accounts /></PlatformScopeProvider></MemoryRouter></QueryClientProvider>)
  await userEvent.click(await screen.findByTestId('accounts-export-csv'))
  if (failure !== 'limit') {
    await waitFor(() => expect(resolvePage).toBeTypeOf('function'))
    if (failure === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Hủy xuất CSV' }))
    if (failure === 'unmount') view.unmount()
    if (failure === 'route') await userEvent.click(screen.getByRole('button', { name: 'Change route' }))
    if (failure === 'auth') localStorage.setItem('adsops.token', 'another-session')
    if (failure !== 'unmount' && failure !== 'cancel' && failure !== 'route') {
      expect(screen.getByTestId('accounts-export-csv')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Xuất CSV đối soát' })).toBeDisabled()
    }
    await act(async () => {
      if (failure === 'error') { rejectPage(new Error('network failed')); return }
      resolvePage({
      items: [account(failure === 'duplicate' ? '0' : '25')], page: failure === 'page' ? 1 : 2,
      page_size: 25, total: failure === 'count' ? 27 : 26, total_pages: 2,
      })
    })
  }
  if (!['cancel', 'unmount', 'auth', 'route'].includes(failure)) await screen.findByRole('alert')
  expect(create).not.toHaveBeenCalled()
})

it('applies platform and quick filters to fetched rows on every page', async () => {
  localStorage.setItem('adsops.platform_scope', 'meta')
  const items = Array.from({ length: 26 }, (_, i) => account(String(i), {
    status: i === 0 ? 'disabled' : 'active', external_account_id: i === 1 ? 'gads_1' : `act_${i}`,
  }))
  const csv = await exportAccounts(items, '/', async () => {
    await userEvent.click(screen.getByRole('button', { name: /^Đang hoạt động/ }))
  })
  expect(csv.split('\r\n')).toHaveLength(25)
  expect(csv).not.toContain('act_0,')
  expect(csv).not.toContain('gads_1,')
  expect(csv).toContain('act_25,')
})

it('applies selected card filter across all pages', async () => {
  const csv = await exportAccounts(Array.from({ length: 26 }, (_, i) => account(String(i), {
    billing_meta: { payment_card_display: i === 1 ? 'Other card' : 'Target card', payment_card_code: i === 1 ? 'other' : 'target' },
  })), '/', async () => {
    await userEvent.click(screen.getByRole('button', { name: /^Target card/ }))
  })
  expect(csv.split('\r\n')).toHaveLength(26)
  expect(csv).not.toContain('Other card')
  expect(csv).toContain('act_25,')
})
