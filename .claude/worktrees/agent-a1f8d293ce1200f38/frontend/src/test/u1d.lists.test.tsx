import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import BusinessManagers from '../pages/BusinessManagers'
import Assets from '../pages/Assets'
import Readiness from '../pages/Readiness'
import AccountHealth from '../pages/AccountHealth'
import Alerts from '../pages/Alerts'
import Preflight from '../pages/Preflight'
import PreflightDetail from '../pages/PreflightDetail'
import { ApiError } from '../lib/api'
import { SUCCESS, axeOptions, installRoutes, mountAt, paged, wrap } from './u1d-helpers'
import type { Handler, Key } from './u1d-helpers'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: authMock.role, workspace: { name: 'WS' } } }),
}))

let routes: [Key, Handler][] = []
function mockApi(over: [Key, Handler][] = []) {
  routes = [...over]
  installRoutes(apiMock.get, () => routes)
}

beforeEach(() => {
  authMock.role = 'owner'
  mockApi()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const boom = () => new ApiError('Máy chủ từ chối yêu cầu', 500, 'internal', 'req-77', {})
const forbidden = () => new ApiError('no', 403, 'forbidden', null, {})
const pending = <T,>() => new Promise<T>(() => undefined)

// ---------------------------------------------------------------- ownership references + assets

const bmRecord = (over = {}) => ({
  id: 'bm-1',
  name: 'BM Alpha',
  external_id: '123',
  country: 'VN',
  currency: 'VND',
  status: 'active',
  notes: '',
  updated_at: '2026-10-20T00:00:00Z',
  archived_at: null,
  ...over,
})

describe('Ownership references (BusinessManagers)', () => {
  it('shows a labelled loading region, then the records with Vietnamese status', async () => {
    mockApi([['/api/v1/business-managers', () => pending()]])
    const { unmount } = wrap(<BusinessManagers />)
    expect(await screen.findByRole('status', { name: 'Đang tải…' })).toHaveAttribute('aria-busy', 'true')
    unmount()
    mockApi([['/api/v1/business-managers', paged([bmRecord()])]])
    wrap(<BusinessManagers />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Chủ sở hữu tài khoản' })).toBeInTheDocument()
    expect(await screen.findByText('BM Alpha')).toBeInTheDocument()
    expect(screen.getByText('Đang dùng')).toBeInTheDocument()
  })

  it('has an empty state with a next action and an error state with four parts', async () => {
    mockApi([['/api/v1/business-managers', paged([])]])
    const { unmount } = wrap(<BusinessManagers />)
    expect(await screen.findByText('Chưa có Business Manager nào')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Thêm Business Manager' }).length).toBeGreaterThanOrEqual(2)
    unmount()
    mockApi([['/api/v1/business-managers', boom()]])
    wrap(<BusinessManagers />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không tải được danh sách')
    expect(alert).toHaveTextContent('Máy chủ từ chối yêu cầu')
    expect(alert).toHaveTextContent('req-77')
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })

  it('shows a refused read as a no-permission state, not a failure', async () => {
    mockApi([['/api/v1/business-managers', forbidden()]])
    wrap(<BusinessManagers />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull()
  })

  it('archives only after an AlertDialog confirmation, then reads the list back', async () => {
    const user = userEvent.setup()
    let archived = false
    mockApi([['/api/v1/business-managers', () => paged(archived ? [] : [bmRecord()])]])
    apiMock.post.mockImplementation(async () => {
      archived = true
      return {}
    })
    wrap(<BusinessManagers />)
    await user.click(await screen.findByRole('button', { name: 'Lưu trữ' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Lưu trữ Business Manager?')
    expect(dialog).toHaveTextContent('"BM Alpha"')
    expect(dialog).toHaveTextContent('Khôi phục được')
    expect(dialog).toHaveTextContent('Không có gì bị xoá')
    expect(apiMock.post).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Lưu trữ' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/business-managers/bm-1/archive'))
    expect(await screen.findByText('Máy chủ xác nhận "BM Alpha" đã được lưu trữ.')).toBeInTheDocument()
  })

  it('says so when the read-back does not show the change', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/business-managers', paged([bmRecord()])]])
    apiMock.post.mockResolvedValue({})
    wrap(<BusinessManagers />)
    await user.click(await screen.findByRole('button', { name: 'Lưu trữ' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Lưu trữ' }))
    expect(await screen.findByText(/khi đọc lại, máy chủ chưa cho thấy thay đổi/)).toBeInTheDocument()
  })

  it('Esc and Cancel close the dialog and write nothing', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/business-managers', paged([bmRecord()])]])
    wrap(<BusinessManagers />)
    await user.click(await screen.findByRole('button', { name: 'Lưu trữ' }))
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('the add Sheet is a dialog with a title, description, field error and focus return', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/business-managers', paged([bmRecord()])]])
    wrap(<BusinessManagers />)
    const opener = await screen.findByRole('button', { name: 'Thêm Business Manager' })
    await user.click(opener)
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAccessibleName('Thêm Business Manager')
    expect(sheet).toHaveAccessibleDescription(/Bản ghi mới được lưu/)
    expect(within(sheet).getByRole('button', { name: 'Lưu' })).toBeDisabled()
    const name = within(sheet).getByLabelText(/^Tên/)
    await user.click(name)
    await user.tab()
    expect(within(sheet).getByText('Hãy điền tên.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('Assets has five tabs, switches by arrow key and names the credential rule in the note', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/pages', paged([])]])
    wrap(<Assets />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Page',
      'Pixel',
      'Tham chiếu hồ sơ thanh toán',
      'Tham chiếu hồ sơ trình duyệt',
      'Tham chiếu proxy',
    ])
    tabs[0].focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(tabs[4]).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/không có kho bí mật và không xoay proxy/)).toBeInTheDocument()
  })
})

// -------------------------------------------------------------------------------- readiness board

const boardRow = (over = {}) => ({
  ad_account_id: 'acc-1',
  display_name: 'Tài khoản A',
  external_account_id: 'act_1',
  readiness_status: 'unknown',
  status: 'unknown',
  required_item_count: 0,
  completed_item_count: 0,
  reasons: [{ code: 'x', severity: 'warning', message: 'Thiếu bằng chứng' }],
  ...over,
})

describe('Readiness board', () => {
  it('loads, then lists unknown readiness without any success tone and with no checklist dash-not-zero', async () => {
    mockApi([['/readiness/board', { rows: [boardRow()], groups: [{ code: 'x', message: 'Thiếu bằng chứng', severity: 'warning', accounts: [{ ad_account_id: 'acc-1', display_name: 'Tài khoản A' }] }] }]])
    wrap(<Readiness />)
    const list = (await screen.findByText('Tài khoản (1)')).closest('div')!.parentElement!
    expect(within(list).getByText('Không xác định')).toBeInTheDocument()
    expect(list.innerHTML).not.toMatch(SUCCESS)
    expect(list.textContent).not.toMatch(/\b0\/0\b|\b0%/)
    expect(within(list).getByText('Chưa có mục bắt buộc nào được xác định', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('has loading, empty (with a way back), error and no-permission states', async () => {
    mockApi([['/readiness/board', () => pending()]])
    const loading = wrap(<Readiness />)
    expect(await screen.findByRole('status', { name: 'Đang tải…' })).toBeInTheDocument()
    loading.unmount()

    mockApi([['/readiness/board', { rows: [], groups: [] }]])
    const user = userEvent.setup()
    const empty = wrap(<Readiness />)
    await user.click(await screen.findByRole('button', { name: 'Chưa sẵn sàng', pressed: false }))
    expect(await screen.findByText('Không có gì để hiển thị')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xem mọi tài khoản đang dùng' })).toBeInTheDocument()
    empty.unmount()

    mockApi([['/readiness/board', boom()]])
    const failing = wrap(<Readiness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được bảng mức sẵn sàng')
    failing.unmount()

    mockApi([['/readiness/board', forbidden()]])
    wrap(<Readiness />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('states there is no bulk "mark complete"', async () => {
    mockApi([['/readiness/board', { rows: [], groups: [] }]])
    wrap(<Readiness />)
    expect(await screen.findByText(/Không có thao tác "đánh dấu hoàn tất" hàng loạt/)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------- account health

const healthRow = (over = {}) => ({
  ad_account_id: 'acc-1',
  display_name: 'Tài khoản A',
  external_account_id: 'act_1',
  business_manager_name: 'BM Một',
  personal_account_reference_label: null,
  owner_label: '',
  account_status: 'active',
  account_type: 'business_manager',
  readiness_status: 'unknown',
  health_status: 'unknown',
  freshness_status: 'stale',
  open_critical_count: 0,
  open_warning_count: 2,
  open_attention_count: 0,
  open_unknown_count: 0,
  last_evaluated_at: null,
  top_reason: null,
  archived: false,
  ...over,
})
const rule = (over = {}) => ({
  id: 'r1',
  rule_key: 'manual_review_due',
  version: 1,
  name: 'Rà soát thủ công đã quá hạn',
  description: 'Mô tả của máy chủ',
  category: 'operations',
  enabled: true,
  severity: 'warning',
  resolution_guidance: '',
  why_it_matters: null,
  recommended_next_step: null,
  applicability: null,
  ...over,
})

describe('Account health list', () => {
  it('never paints unknown health, stale data or unknown readiness as success; never-evaluated says "chưa từng"', async () => {
    mockApi([['/account-health/rules', [rule()]], ['/api/v1/account-health', paged([healthRow()])]])
    wrap(<AccountHealth />, '/account-health')
    const table = await screen.findByRole('table', { name: 'Sức khoẻ tài khoản' })
    await within(table).findByText('Tài khoản A')
    expect(table.innerHTML).not.toMatch(SUCCESS)
    expect(within(table).getByText('Đã cũ')).toBeInTheDocument()
    expect(within(table).getByText('chưa từng')).toBeInTheDocument()
    // The partial-data note says why "unknown" and not "clear" is shown.
    expect(screen.getByRole('note')).toHaveTextContent(/được báo là "không xác định" thay vì "không phát hiện vấn đề"/)
  })

  it('right-aligns the counts in tabular numerals and keeps the default columns at eight', async () => {
    mockApi([['/account-health/rules', []], ['/api/v1/account-health', paged([healthRow()])]])
    wrap(<AccountHealth />, '/account-health')
    const table = await screen.findByRole('table', { name: 'Sức khoẻ tài khoản' })
    await within(table).findByText('Tài khoản A')
    const critical = within(table).getByRole('columnheader', { name: 'Nghiêm trọng đang mở' })
    expect(critical.className).toMatch(/text-right/)
    const cells = Array.from(table.querySelectorAll('td[data-label="Cảnh báo đang mở"]'))
    expect(cells[0].className).toMatch(/text-right tabular-nums/)
    expect(cells[0]).toHaveTextContent('2')
    const headers = within(table).getAllByRole('columnheader').filter((h) => !h.querySelector('.sr-only'))
    expect(headers.length).toBeLessThanOrEqual(8)
  })

  it('has empty (filtered / none), error and no-permission states', async () => {
    mockApi([['/account-health/rules', []], ['/api/v1/account-health', paged([])]])
    const none = wrap(<AccountHealth />, '/account-health')
    expect(await screen.findByText('Chưa có tín hiệu sức khoẻ nào')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mở sổ đăng ký tài khoản' })).toBeInTheDocument()
    none.unmount()
    const filtered = wrap(<AccountHealth />, '/account-health?health_status=critical')
    expect(await screen.findByText('Không có tài khoản nào khớp bộ lọc này')).toBeInTheDocument()
    filtered.unmount()
    mockApi([['/account-health/rules', []], ['/api/v1/account-health', boom()]])
    const failing = wrap(<AccountHealth />, '/account-health')
    expect(await screen.findByRole('alert')).toHaveTextContent('req-77')
    failing.unmount()
    mockApi([['/account-health/rules', []], ['/api/v1/account-health', forbidden()]])
    wrap(<AccountHealth />, '/account-health')
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('turns a check off only after an AlertDialog, and reads the rule list back', async () => {
    const user = userEvent.setup()
    let enabled = true
    mockApi([
      ['/account-health/rules', () => [rule({ enabled })]],
      ['/api/v1/account-health', paged([])],
    ])
    apiMock.patch.mockImplementation(async () => {
      enabled = false
      return {}
    })
    wrap(<AccountHealth />, '/account-health')
    await user.click(await screen.findByRole('button', { name: /Kiểm tra đã cấu hình/ }))
    await user.click(await screen.findByRole('button', { name: 'Tắt: Rà soát thủ công đã quá hạn' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('hết hạn, không phải đã xử lý')
    expect(dialog).toHaveTextContent('Bật lại được bất cứ lúc nào')
    expect(apiMock.patch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Tắt kiểm tra' }))
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/api/v1/account-health/rules/manual_review_due', { enabled: false }))
    expect(await screen.findByText(/Máy chủ xác nhận kiểm tra .* đang tắt cho workspace này/)).toBeInTheDocument()
    expect(await screen.findByText(/hết hạn, không phải đã xử lý — lịch sử vẫn giữ chúng/)).toBeInTheDocument()
  })

  it('shows the toggle disabled with a stated reason to a non-owner instead of hiding it', async () => {
    authMock.role = 'operator'
    const user = userEvent.setup()
    mockApi([['/account-health/rules', [rule()]], ['/api/v1/account-health', paged([])]])
    wrap(<AccountHealth />, '/account-health')
    await user.click(await screen.findByRole('button', { name: /Kiểm tra đã cấu hình/ }))
    const toggle = await screen.findByRole('button', { name: 'Tắt: Rà soát thủ công đã quá hạn' })
    expect(toggle).toBeDisabled()
    expect(screen.getAllByText('Chỉ chủ workspace mới tắt được một kiểm tra.').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps URL filters (bookmarks still work) and shows the filter as a removable chip', async () => {
    mockApi([['/account-health/rules', []], ['/api/v1/account-health', paged([healthRow()])]])
    wrap(<AccountHealth />, '/account-health?health_status=unknown&page=1')
    await screen.findByText('Tài khoản A')
    expect(apiMock.get).toHaveBeenCalledWith(expect.stringContaining('health_status=unknown'))
    expect(screen.getByText('Sức khoẻ: Không xác định')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------------------ alerts

const alertRow = (over = {}) => ({
  id: 'alert-1',
  severity: 'critical',
  status: 'open',
  title: 'Tài khoản bị hạn chế',
  summary: 'Trạng thái ghi nhận là restricted.',
  source_type: 'health_signal',
  source_label: 'Health signal',
  category: 'account_status',
  ad_account_id: 'acc-1',
  account_display_name: 'Tài khoản A',
  account_reference: 'act_1',
  business_manager_name: null,
  health_status: 'critical',
  readiness_status: 'not_ready',
  first_observed_at: '2026-10-20T00:00:00Z',
  last_observed_at: '2026-10-21T00:00:00Z',
  last_notified_at: null,
  delivery_status: 'failed_final',
  delivery_skip_reason: null,
  delivery_scheduled_for: null,
  quiet_hours_deferred: false,
  suppressed_until: null,
  archived: false,
  ...over,
})
const summaryOf = (over = {}) => ({
  open_critical: 1,
  open_warning: 0,
  open_info: 0,
  acknowledged: 0,
  suppressed: 0,
  failed_final_notifications: 1,
  deferred_by_quiet_hours: 0,
  total_active: 1,
  last_successful_notification_at: null,
  telegram_transport_configured: true,
  recipient_configured: true,
  disclaimer: 'x',
  ...over,
})

describe('Alerts', () => {
  it('renders severity, status and delivery in Vietnamese, and "never notified" as "chưa từng"', async () => {
    mockApi([['/alerts/summary', summaryOf()], ['/api/v1/alerts', paged([alertRow()])]])
    wrap(<Alerts />, '/alerts')
    const table = await screen.findByRole('table', { name: 'Cảnh báo' })
    await within(table).findByText('Tài khoản bị hạn chế')
    expect(within(table).getByText('Gửi thông báo thất bại')).toBeInTheDocument()
    expect(within(table).getAllByText('Nghiêm trọng').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText(/chưa từng có thông báo thành công/)).toBeInTheDocument()
  })

  it('warns that Telegram is not configured only when the summary says so, and flags a failed summary as partial', async () => {
    mockApi([['/alerts/summary', summaryOf({ telegram_transport_configured: false })], ['/api/v1/alerts', paged([alertRow()])]])
    const first = wrap(<Alerts />, '/alerts')
    expect(await screen.findByText(/Chưa cấu hình Telegram; cảnh báo vẫn xem được/)).toBeInTheDocument()
    first.unmount()
    mockApi([['/alerts/summary', boom()], ['/api/v1/alerts', paged([alertRow()])]])
    wrap(<Alerts />, '/alerts')
    await screen.findByText('Tài khoản bị hạn chế')
    // An unloaded summary is "not known", never "configured": no all-clear, and the gap is named.
    expect(screen.queryByText(/Chưa cấu hình Telegram; cảnh báo vẫn xem được/)).toBeNull()
    expect(await screen.findByRole('note')).toHaveTextContent('Chưa tải được tóm tắt thông báo')
  })

  it('has empty, error and no-permission states, and one disclaimer that claims no safety', async () => {
    mockApi([['/alerts/summary', summaryOf()], ['/api/v1/alerts', paged([])]])
    const empty = wrap(<Alerts />, '/alerts')
    expect(await screen.findByText('Không có cảnh báo')).toBeInTheDocument()
    expect(screen.getByText(/không phải quyết định của nền tảng, không phải bảo đảm/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/an toàn|sẽ được duyệt/)
    empty.unmount()
    mockApi([['/alerts/summary', summaryOf()], ['/api/v1/alerts', boom()]])
    const failing = wrap(<Alerts />, '/alerts')
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách cảnh báo')
    failing.unmount()
    mockApi([['/alerts/summary', summaryOf()], ['/api/v1/alerts', forbidden()]])
    wrap(<Alerts />, '/alerts')
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('confirms muting a CRITICAL alert in an AlertDialog before posting the suppression', async () => {
    const user = userEvent.setup()
    const detail = {
      alert: {
        id: 'alert-1', ad_account_id: 'acc-1', source_type: 'health_signal', source_entity_type: 'x', source_entity_id: null,
        alert_key: 'k', category: 'account_status', severity: 'critical', status: 'open', title: 'Tài khoản bị hạn chế',
        summary: 's', source_snapshot_json: {}, first_observed_at: '2026-10-20T00:00:00Z', last_observed_at: '2026-10-20T00:00:00Z',
        last_notified_at: null, acknowledged_at: null, acknowledgement_note: null, resolved_at: null, resolved_by: null,
        resolution_reason: null, suppressed_at: null, suppression_reason: null, suppression_expires_at: null, created_at: '2026-10-20T00:00:00Z',
      },
      source_label: 'Health signal',
      account: { id: 'acc-1', display_name: 'Tài khoản A', external_account_id: 'act_1', status: 'restricted', readiness_status: 'not_ready', health_status: 'critical' },
      notifications: [],
      policy_decision: { timezone: null, quiet_hours_enabled: false, critical_bypasses_quiet_hours: true, recipient_configured: true, latest_delivery: null },
      disclaimer: 'Server disclaimer',
    }
    mockApi([['/alerts/alert-1', detail], ['/alerts/summary', summaryOf()], ['/api/v1/alerts', paged([alertRow()])]])
    apiMock.post.mockResolvedValue({})
    wrap(<Alerts />, '/alerts')
    await user.click(await screen.findByRole('button', { name: 'Mở cảnh báo Tài khoản bị hạn chế' }))
    const sheet = await screen.findByRole('dialog')
    await user.type(await within(sheet).findByLabelText(/^Lý do/, { selector: 'input' }), 'Đã kháng nghị.')
    await user.click(within(sheet).getByRole('button', { name: 'Tạm tắt thông báo' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveAccessibleName('Tạm tắt thông báo của cảnh báo nghiêm trọng?')
    expect(confirm).toHaveTextContent('Chỉ ngừng việc gửi')
    expect(apiMock.post).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Tạm tắt thông báo' }))
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/alerts/alert-1/suppress', expect.objectContaining({ reason: 'Đã kháng nghị.' })),
    )
  })
})

// ---------------------------------------------------------------------------------- preflight

const draft = (over = {}) => ({
  id: 'draft-1',
  workspace_id: 'w',
  ad_account_id: 'acc-1',
  account_display_name: 'Tài khoản A',
  title: 'Chiến dịch mùa thu',
  objective: 'conversion',
  primary_copy: 'Nội dung',
  headline: null,
  description: null,
  call_to_action: null,
  landing_page_url: 'https://example.com',
  creative_reference: null,
  budget_amount: null,
  budget_currency: null,
  budget_change_percent: null,
  targeting_summary: null,
  draft_status: 'draft',
  last_evaluated_at: null,
  open_blocking_count: 0,
  open_warning_count: 0,
  created_by: 'u',
  updated_by: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  archived_at: null,
  ...over,
})

describe('Preflight list', () => {
  it('shows "—" for the finding counts of a draft that was never evaluated, and the real 0 once it was', async () => {
    mockApi([
      [
        '/api/v1/campaign-drafts',
        paged([
          draft(),
          draft({ id: 'draft-2', title: 'Đã đánh giá', draft_status: 'ready_for_manual_review', last_evaluated_at: '2026-10-21T00:00:00Z' }),
        ]),
      ],
    ])
    wrap(<Preflight />, '/preflight')
    const table = await screen.findByRole('table', { name: /Kiểm tra trước khi chạy/ })
    const rows = await within(table).findAllByRole('row')
    const never = rows.find((row) => row.textContent?.includes('Chiến dịch mùa thu'))!
    const done = rows.find((row) => row.textContent?.includes('Đã đánh giá'))!
    // Both the blocking and the warning cell say why there is no number.
    expect(within(never).getAllByText('Chưa đánh giá lần nào, nên chưa có số phát hiện.', { selector: '.sr-only' })).toHaveLength(2)
    expect(never.querySelector('td[data-label="Chặn"]')!.textContent).not.toMatch(/\b0\b/)
    expect(done.querySelector('td[data-label="Chặn"]')!.textContent).toBe('0')
    expect(done.querySelector('td[data-label="Chặn"]')!.className).toMatch(/text-right tabular-nums/)
  })

  it('has empty, error and no-permission states, plus the single disclaimer', async () => {
    mockApi([['/api/v1/campaign-drafts', paged([])]])
    const empty = wrap(<Preflight />, '/preflight')
    expect(await screen.findByText('Chưa có bản nháp chiến dịch nào')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tạo bản nháp chiến dịch' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/không bảo đảm bản nháp sẽ được duyệt/)).toBeInTheDocument()
    empty.unmount()
    mockApi([['/api/v1/campaign-drafts', boom()]])
    const failing = wrap(<Preflight />, '/preflight')
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách bản nháp')
    failing.unmount()
    mockApi([['/api/v1/campaign-drafts', forbidden()]])
    wrap(<Preflight />, '/preflight')
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })
})

describe('Preflight detail (T3)', () => {
  const detailRoutes = (over: [Key, Handler][] = []): [Key, Handler][] => [
    ...over,
    ['/findings', []],
    ['/landing-page-evidence', []],
    ['/evaluation-runs', []],
    ['/audit-logs', paged([])],
    [/\/campaign-drafts\/draft-1$/, draft()],
  ]
  const mountDetail = (path = '/preflight/draft-1') => mountAt('/preflight/:draftId', <PreflightDetail />, path)

  it('shows the draft, a Vietnamese status and five tabs synced to ?tab=', async () => {
    const user = userEvent.setup()
    mockApi(detailRoutes())
    mountDetail()
    expect(await screen.findByRole('heading', { level: 1, name: 'Chiến dịch mùa thu' })).toBeInTheDocument()
    expect(screen.getAllByText('Bản nháp').length).toBeGreaterThanOrEqual(1)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    await user.click(screen.getByRole('tab', { name: 'Phát hiện' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=findings')
    await user.click(screen.getByRole('tab', { name: 'Tổng quan' }))
    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=')
  })

  it('does not call a never-evaluated draft clean in the findings tab', async () => {
    mockApi(detailRoutes())
    mountDetail('/preflight/draft-1?tab=findings')
    expect(await screen.findByText('Không có phát hiện đang mở')).toBeInTheDocument()
    expect(screen.getByText(/"không có phát hiện" ở đây không có nghĩa là đã sạch/)).toBeInTheDocument()
  })

  it('archives through an AlertDialog (no window.confirm), then reads the draft back', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    let archivedAt: string | null = null
    mockApi(detailRoutes([[/\/campaign-drafts\/draft-1$/, () => draft({ archived_at: archivedAt })]]))
    apiMock.post.mockImplementation(async () => {
      archivedAt = '2026-10-27T00:00:00Z'
      return {}
    })
    mountDetail()
    await user.click(await screen.findByRole('button', { name: 'Thao tác khác' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Lưu trữ' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Lưu trữ bản nháp này?')
    expect(dialog).toHaveTextContent('Chiến dịch mùa thu')
    expect(dialog).toHaveTextContent('Khôi phục được bất cứ lúc nào')
    expect(apiMock.post).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Lưu trữ bản nháp' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/campaign-drafts/draft-1/archive'))
    expect(await screen.findByText(/Máy chủ xác nhận bản nháp "Chiến dịch mùa thu" đã được lưu trữ/)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('a failed evaluation run is an alert, never a silent "ready"', async () => {
    const user = userEvent.setup()
    mockApi(detailRoutes())
    apiMock.post.mockResolvedValue({ id: 'run-1', status: 'failed', error_summary: 'Không tải được trang đích', error_code: 'fetch' })
    mountDetail()
    await user.click(await screen.findByRole('button', { name: 'Chạy đánh giá' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Lần đánh giá chưa hoàn tất')
    expect(alert).toHaveTextContent('Không tải được trang đích')
    expect(alert).toHaveTextContent('không phải "Sẵn sàng"')
    expect(alert.className).not.toMatch(SUCCESS)
  })

  it('shows loading, then an error with a way back, when the draft cannot be read', async () => {
    mockApi(detailRoutes([[/\/campaign-drafts\/draft-1$/, boom()]]))
    mountDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được bản nháp')
    expect(screen.getByRole('link', { name: 'Về danh sách bản nháp' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------------------ axe

describe('accessibility (axe, colour-contrast off because jsdom has no layout)', () => {
  it('BusinessManagers, Readiness, AccountHealth, Alerts and Preflight have no violations', async () => {
    mockApi([
      ['/api/v1/business-managers', paged([bmRecord()])],
      ['/readiness/board', { rows: [boardRow()], groups: [] }],
      ['/account-health/rules', [rule()]],
      ['/api/v1/account-health', paged([healthRow()])],
      ['/alerts/summary', summaryOf()],
      ['/api/v1/alerts', paged([alertRow()])],
      ['/api/v1/campaign-drafts', paged([draft()])],
    ])
    const pages: [string, React.ReactElement, string][] = [
      ['Tài khoản A', <Readiness />, '/readiness'],
      ['Tài khoản A', <AccountHealth />, '/account-health'],
      ['Tài khoản bị hạn chế', <Alerts />, '/alerts'],
      ['Chiến dịch mùa thu', <Preflight />, '/preflight'],
      ['BM Alpha', <BusinessManagers />, '/business-managers'],
    ]
    for (const [text, element, path] of pages) {
      const { container, unmount } = wrap(element, path)
      await screen.findAllByText(text)
      expect((await axe(container, axeOptions)).violations, path).toEqual([])
      unmount()
    }
  })

  it('the typed-reason AlertDialog and a Sheet have no violations', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/business-managers', paged([bmRecord()])]])
    wrap(<BusinessManagers />)
    await user.click(await screen.findByRole('button', { name: 'Lưu trữ' }))
    const dialog = await screen.findByRole('alertdialog')
    expect((await axe(dialog, axeOptions)).violations).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Thêm Business Manager' }))
    const sheet = await screen.findByRole('dialog')
    expect((await axe(sheet, axeOptions)).violations).toEqual([])
  })
})
