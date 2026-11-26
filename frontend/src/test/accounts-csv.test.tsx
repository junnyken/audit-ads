import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Accounts from '../pages/Accounts'

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

async function exportAccounts(items: ReturnType<typeof account>[]) {
  apiMock.get.mockImplementation((path: string) => Promise.resolve({
    items: path.startsWith('/api/v1/business-managers') ? [] : items,
    page: 1, page_size: 25, total: items.length, total_pages: 1,
  }))
  const createObjectURL = vi.fn(() => 'blob:accounts-csv')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><Accounts /></MemoryRouter></QueryClientProvider>)
  await userEvent.click(await screen.findByTestId('accounts-export-csv'))
  expect(download).toHaveBeenCalledOnce()
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
