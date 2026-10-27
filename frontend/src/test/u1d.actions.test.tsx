import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import Operations from '../pages/Operations'
import CreateAccountWizard from '../pages/operations/CreateAccountWizard'
import ShareAccessWizard from '../pages/operations/ShareAccessWizard'
import PixelShareWizard from '../pages/operations/PixelShareWizard'
import TeamSeats from '../pages/TeamSeats'
import SecurityDevices from '../pages/SecurityDevices'
import AuditLog from '../pages/AuditLog'
import SystemStatus from '../pages/SystemStatus'
import { ApiError } from '../lib/api'
import { SUCCESS, axeOptions, installRoutes, paged, wrap } from './u1d-helpers'
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

// ------------------------------------------------------------------------------------ operations

const capabilities = (over = {}) => ({
  list_business_managers: true,
  create_ad_account: true,
  share_ad_account_access: true,
  share_pixel_access: true,
  reason: null,
  ...over,
})
const connection = (over = {}) => ({
  id: 'conn-1',
  label: 'Kết nối sản xuất',
  environment: 'production',
  status: 'active',
  capabilities: capabilities(),
  last_capability_check_at: '2026-10-26T00:00:00Z',
  business_managers: [{ external_id: 'bm_1', name: 'BM Một' }],
  token_configured: true,
  reader_source: 'none',
  business_manager_reference: null,
  business_manager_source: 'connection',
  notes: '',
  created_at: '',
  updated_at: '',
  archived_at: null,
  ...over,
})
const batchItem = (over = {}) => ({
  id: 'i1',
  name: 'Tài khoản mới',
  currency: 'VND',
  country: null,
  status: 'queued',
  external_account_id: null,
  failure_summary: null,
  synced_ad_account_id: null,
  ...over,
})
const batch = (items: unknown[], extra = {}) => ({
  batch: { id: 'b1', meta_connection_id: 'conn-1', business_manager_external_id: 'bm_1', preview_hash: 'h', confirmed_at: null, created_at: '' },
  items,
  current_preview_hash: 'h',
  ...extra,
})

describe('Operations hub', () => {
  it('lists the four entries, each reachable by an accessible link', () => {
    wrap(<Operations />, '/operations')
    expect(screen.getByRole('heading', { level: 1, name: 'Vận hành' })).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/operations/create-accounts',
      '/operations/share-access',
      '/operations/pixel-share',
      '/team',
    ])
    expect(screen.getByRole('link', { name: 'Bắt đầu: Tạo tài khoản quảng cáo' })).toBeInTheDocument()
    expect(screen.getByText(/không có gì ở đây chạy mà không qua xem trước và xác nhận rõ ràng/)).toBeInTheDocument()
  })
})

describe('Meta write wizards: the connection step', () => {
  it('shows loading, an error with retry, and an empty state that points to setup', async () => {
    mockApi([['/api/v1/meta-connections', () => pending()]])
    const loading = wrap(<CreateAccountWizard />)
    expect(await screen.findByRole('status', { name: 'Đang tải…' })).toBeInTheDocument()
    loading.unmount()
    mockApi([['/api/v1/meta-connections', boom()]])
    const failing = wrap(<ShareAccessWizard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách kết nối Meta')
    failing.unmount()
    mockApi([['/api/v1/meta-connections', []]])
    wrap(<PixelShareWizard />)
    expect(await screen.findByText('Chưa có kết nối Meta nào')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Thiết lập kết nối trước' })).toHaveAttribute('href', '/meta-connections')
  })

  it('tells "never checked" apart from "not allowed", and blocks Next on both', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/meta-connections', [connection({ capabilities: null })]]])
    const unchecked = wrap(<ShareAccessWizard />)
    await user.selectOptions(await screen.findByLabelText(/^Kết nối Meta/), 'conn-1')
    expect(await screen.findByText(/chưa được kiểm tra khả năng/)).toBeInTheDocument()
    expect(screen.queryByText(/không được phép/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Tiếp' })).toBeDisabled()
    unchecked.unmount()

    mockApi([['/api/v1/meta-connections', [connection({ capabilities: capabilities({ share_ad_account_access: false, reason: 'thiếu quyền' }) })]]])
    wrap(<ShareAccessWizard />)
    await user.selectOptions(await screen.findByLabelText(/^Kết nối Meta/), 'conn-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('`share_ad_account_access` không được phép (thiếu quyền)')
    expect(screen.getByRole('button', { name: 'Tiếp' })).toBeDisabled()
  })

  it('names what the environment really does before anything is written', async () => {
    const user = userEvent.setup()
    mockApi([['/api/v1/meta-connections', [connection({ environment: 'fake', id: 'c-fake' }), connection({ id: 'c-prod' })]]])
    wrap(<PixelShareWizard />)
    const select = await screen.findByLabelText(/^Kết nối Meta/)
    await user.selectOptions(select, 'c-fake')
    expect(await screen.findByText(/không có lệnh nào tới Meta thật/)).toBeInTheDocument()
    await user.selectOptions(select, 'c-prod')
    expect(await screen.findByText(/ghi lên Meta thật và không hoàn tác được từ đây/)).toBeInTheDocument()
  })
})

describe('Create ad accounts wizard keeps every gate and adds a typed confirmation', () => {
  async function toResult(user: ReturnType<typeof userEvent.setup>) {
    mockApi([['/api/v1/meta-connections', [connection()]]])
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/account-creation-batches')) return batch([batchItem()])
      if (path.endsWith('/confirm')) return batch([batchItem()], { batch: { id: 'b1', confirmed_at: '2026-10-27T00:00:00Z' } })
      if (path.endsWith('/run')) {
        return batch([
          batchItem({ status: 'failed', failure_summary: 'Meta từ chối' }),
          batchItem({ id: 'i2', name: 'Tài khoản hai', status: 'unknown' }),
        ])
      }
      return {}
    })
    wrap(<CreateAccountWizard />, '/operations/create-accounts')
    await user.selectOptions(await screen.findByLabelText(/^Kết nối Meta/), 'conn-1')
    await user.type(screen.getByLabelText(/^ID ngoài của Business Manager/), 'bm_1')
    await user.click(screen.getByRole('button', { name: 'Tiếp' }))
    await user.type(await screen.findByLabelText(/^Tên/), 'Tài khoản mới')
    await user.click(screen.getByRole('button', { name: 'Kiểm tra và xem trước' }))
    expect(await screen.findByRole('heading', { name: 'Bước 3 — Xem trước đúng những gì sẽ được tạo' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Đúng rồi — tiếp tục' }))
  }

  it('walks preview -> confirm -> run, posting each step only when asked', async () => {
    const user = userEvent.setup()
    await toResult(user)
    expect(apiMock.post).not.toHaveBeenCalledWith(expect.stringContaining('/confirm'), expect.anything())
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('4. Xác nhận')
    await user.click(screen.getByRole('button', { name: 'Xác nhận lô' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/account-creation-batches/b1/confirm', { preview_hash: 'h' }))
    expect(await screen.findByRole('button', { name: 'Chạy hàng đợi' })).toBeInTheDocument()
    expect(apiMock.post).not.toHaveBeenCalledWith('/api/v1/account-creation-batches/b1/run')
  })

  it('"Chạy hàng đợi" opens an AlertDialog that names BM, environment and irreversibility, and needs the typed word', async () => {
    const user = userEvent.setup()
    await toResult(user)
    await user.click(screen.getByRole('button', { name: 'Xác nhận lô' }))
    await user.click(await screen.findByRole('button', { name: 'Chạy hàng đợi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Chạy hàng đợi tạo 1 tài khoản quảng cáo?')
    expect(dialog).toHaveTextContent('BM bm_1')
    expect(dialog).toHaveTextContent('Kết nối sản xuất')
    expect(dialog).toHaveTextContent('Không hoàn tác được từ sản phẩm này')
    const run = within(dialog).getByRole('button', { name: 'Chạy hàng đợi' })
    expect(run).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toHaveFocus()
    await user.type(within(dialog).getByLabelText('Gõ "CHẠY" để xác nhận'), 'chạy')
    expect(run).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('Gõ "CHẠY" để xác nhận'))
    await user.type(within(dialog).getByLabelText('Gõ "CHẠY" để xác nhận'), 'CHẠY')
    expect(run).toBeEnabled()
    expect(apiMock.post).not.toHaveBeenCalledWith('/api/v1/account-creation-batches/b1/run')
    await user.click(run)
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/account-creation-batches/b1/run'))
  })

  it('reports the outcome from each item status, never as success when one failed or is unknown', async () => {
    const user = userEvent.setup()
    await toResult(user)
    await user.click(screen.getByRole('button', { name: 'Xác nhận lô' }))
    await user.click(await screen.findByRole('button', { name: 'Chạy hàng đợi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Gõ/), 'CHẠY')
    await user.click(within(dialog).getByRole('button', { name: 'Chạy hàng đợi' }))
    const summary = await screen.findByText(/Máy chủ báo lại: 0 thành công, 1 thất bại, 1 chưa xác định, 0 chưa chạy/)
    expect(summary.className).not.toMatch(SUCCESS)
    expect(screen.getByText(/Có mục thất bại hoặc chưa xác định/)).toBeInTheDocument()
    expect(screen.getByText('Meta từ chối')).toBeInTheDocument()
    // An undetermined item offers reconciliation, which asks Meta again and never creates another account.
    expect(screen.getByText(/Đối chiếu sẽ hỏi lại Meta; không tự tạo thêm/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đối chiếu Tài khoản hai' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chạy hàng đợi' })).toBeNull()
  })

  it('a confirm refused by the server stays on the step and says what to do', async () => {
    const user = userEvent.setup()
    await toResult(user)
    apiMock.post.mockRejectedValueOnce(new ApiError('Bản xem trước đã đổi', 409, 'preview_changed', 'req-5', {}))
    await user.click(screen.getByRole('button', { name: 'Xác nhận lô' }))
    expect(await screen.findByText('Không xác nhận được lô')).toBeInTheDocument()
    expect(screen.getByText(/quay lại bước xem trước và xác nhận lại/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xác nhận lô' })).toBeInTheDocument()
  })
})

describe('Share access and pixel share wizards also ask for the typed word before they write', () => {
  it.each([
    ['access-share-batches', ShareAccessWizard],
    ['pixel-share-batches', PixelShareWizard],
  ] as const)('%s', async (segment, Wizard) => {
    const user = userEvent.setup()
    const item = {
      id: 'i1', status: 'queued', source_external_account_id: 'act_1', recipient_reference: 'a@b.vn', role: 'advertiser',
      source_external_pixel_id: 'px_1', target_ad_account_external_id: 'act_2', access_grant_reference: null, failure_summary: null,
    }
    mockApi([['/api/v1/meta-connections', [connection()]]])
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith(`/${segment}`)) return batch([item])
      if (path.endsWith('/confirm')) return batch([item])
      if (path.endsWith('/run')) return batch([{ ...item, status: 'succeeded', access_grant_reference: 'grant-1' }])
      return {}
    })
    wrap(<Wizard />)
    await user.selectOptions(await screen.findByLabelText(/^Kết nối Meta/), 'conn-1')
    await user.click(screen.getByRole('button', { name: 'Tiếp' }))
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], segment.startsWith('access') ? 'act_1' : 'px_1')
    if (segment.startsWith('access')) await user.type(inputs[1], 'a@b.vn')
    else await user.type(inputs[1], 'act_2')
    await user.click(screen.getByRole('button', { name: 'Kiểm tra và xem trước' }))
    await user.click(await screen.findByRole('button', { name: 'Đúng rồi — tiếp tục' }))
    await user.click(screen.getByRole('button', { name: 'Xác nhận lô' }))
    await user.click(await screen.findByRole('button', { name: 'Chạy hàng đợi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Chạy hàng đợi' })).toBeDisabled()
    expect(apiMock.post).not.toHaveBeenCalledWith(expect.stringMatching(/\/run$/))
    await user.type(within(dialog).getByLabelText(/Gõ/), 'CHẠY')
    await user.click(within(dialog).getByRole('button', { name: 'Chạy hàng đợi' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(expect.stringMatching(/\/run$/)))
    // All items succeeded: the summary may now say so, in the info tone, still counted from the item statuses.
    expect(await screen.findByText(/Máy chủ báo lại: 1 thành công, 0 thất bại/)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------------------ team

const member = (over = {}) => ({
  id: 'm1',
  user_id: 'u2',
  email: 'an@x.vn',
  full_name: 'Nguyễn An',
  role: 'operator',
  status: 'active',
  is_archived: false,
  assigned_business_manager_count: 1,
  assigned_ad_account_count: 0,
  active_session_count: 2,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})
const invitation = (over = {}) => ({
  id: 'inv1',
  email_normalized: 'b@x.vn',
  invited_role: 'viewer',
  status: 'pending',
  token_last_four: null,
  expires_at: '2026-11-01T00:00:00Z',
  sent_at: null,
  accepted_at: null,
  revoked_at: null,
  revoke_reason: null,
  created_at: '2026-10-20T00:00:00Z',
  ...over,
})
const teamRoutes = (members: () => unknown, invitations: () => unknown = () => [invitation()], summary: unknown = null): [Key, Handler][] => [
  ['/members/m1/assignments', { business_managers: [], ad_accounts: [] }],
  ['/members/m1/access-preview', { is_owner: false, business_manager_ids: [], ad_account_ids: [] }],
  ['/members/m1/sessions', [{ id: 's1', session_type: 'web', label: 'Chrome', browser_family: null, os_family: null, last_seen_at: '2026-10-26T00:00:00Z', created_at: '', expires_at: '', revoked_at: null, revoked_reason: null, is_current: false }]],
  ['/team/members', members],
  ['/team/summary', summary ?? { seat_limit: 5, active_members: 2, available_seats: 3, pending_invitations: 1, plan_reference: null }],
  ['/team/invitations', invitations],
  ['/team/seat-plan', { id: 'p', seat_limit: 5, plan_reference: null, created_at: '', updated_at: '' }],
  ['/business-managers', paged([])],
  ['/ad-accounts', paged([])],
]

describe('Team & seats', () => {
  it('shows loading, an error, and a refused read as no permission', async () => {
    mockApi([['/team/summary', () => pending()], ['/team/members', () => pending()]])
    const loading = wrap(<TeamSeats />)
    expect((await screen.findAllByRole('status', { name: 'Đang tải…' })).length).toBeGreaterThanOrEqual(1)
    loading.unmount()
    mockApi([['/team/summary', boom()], ['/team/members', []]])
    const failing = wrap(<TeamSeats />)
    expect(await screen.findByRole('alert')).toHaveTextContent('req-77')
    failing.unmount()
    mockApi([['/team/summary', forbidden()], ['/team/members', []]])
    wrap(<TeamSeats />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('shows "—" with a reason, not 0, when no seat plan exists, and right-aligns the member counts', async () => {
    mockApi(teamRoutes(() => [member()], () => [], { seat_limit: null, active_members: 2, available_seats: null, pending_invitations: 0, plan_reference: null }))
    wrap(<TeamSeats />)
    expect(await screen.findByText('Chưa cấu hình gói chỗ')).toBeInTheDocument()
    expect(screen.getByText('Chưa biết cho đến khi có gói chỗ')).toBeInTheDocument()
    expect(screen.getByText(/chưa ai chấp nhận được lời mời/)).toBeInTheDocument()
    const limit = screen.getByText('Giới hạn chỗ', { selector: 'span' }).closest('div')!.parentElement!
    expect(limit).toHaveTextContent('—')
    const cell = document.querySelector('td[data-label="Phiên"]')!
    expect(cell.className).toMatch(/text-right tabular-nums/)
    expect(cell).toHaveTextContent('2')
  })

  it('changes a role only after an AlertDialog shows old -> new, then reads the member back', async () => {
    const user = userEvent.setup()
    let role = 'operator'
    mockApi(teamRoutes(() => [member({ role })]))
    apiMock.patch.mockImplementation(async () => {
      role = 'viewer'
      return {}
    })
    wrap(<TeamSeats />)
    await user.click(await screen.findByRole('button', { name: 'Quản lý Nguyễn An' }))
    const sheet = await screen.findByRole('dialog')
    await user.selectOptions(within(sheet).getByLabelText(/^Vai trò/), 'viewer')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Đổi vai trò của Nguyễn An?')
    expect(dialog).toHaveTextContent('Người vận hành → Người xem')
    expect(apiMock.patch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Đổi vai trò' }))
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/api/v1/team/members/m1/role', { role: 'viewer' }))
    // The notice is shown in the Sheet and on the page behind it.
    expect((await screen.findAllByText('Máy chủ xác nhận vai trò của Nguyễn An hiện là Người xem.')).length).toBeGreaterThanOrEqual(1)
  })

  it('says so when the read-back still shows the old role', async () => {
    const user = userEvent.setup()
    mockApi(teamRoutes(() => [member()]))
    apiMock.patch.mockResolvedValue({})
    wrap(<TeamSeats />)
    await user.click(await screen.findByRole('button', { name: 'Quản lý Nguyễn An' }))
    await user.selectOptions(within(await screen.findByRole('dialog')).getByLabelText(/^Vai trò/), 'viewer')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Đổi vai trò' }))
    expect((await screen.findAllByText(/khi đọc lại, vai trò của Nguyễn An chưa đổi/)).length).toBeGreaterThanOrEqual(1)
  })

  it('deactivating needs a typed reason, states the seat and history consequences, and posts the reason', async () => {
    const user = userEvent.setup()
    mockApi(teamRoutes(() => [member()]))
    apiMock.post.mockResolvedValue({})
    wrap(<TeamSeats />)
    await user.click(await screen.findByRole('button', { name: 'Quản lý Nguyễn An' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ngừng' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Ngừng thành viên này?')
    expect(dialog).toHaveTextContent('Chỗ của họ được giải phóng')
    expect(dialog).toHaveTextContent('không có gì bị xoá')
    const confirm = within(dialog).getByRole('button', { name: 'Ngừng thành viên' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/^Lý do/), 'Nghỉ việc')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/team/members/m1/deactivate', { reason: 'Nghỉ việc' }))
  })

  it('revoking an invitation needs a reason and is read back', async () => {
    const user = userEvent.setup()
    let status = 'pending'
    mockApi(teamRoutes(() => [member()], () => [invitation({ status })]))
    apiMock.post.mockImplementation(async () => {
      status = 'revoked'
      return {}
    })
    wrap(<TeamSeats />)
    await user.click(await screen.findByRole('button', { name: 'Thu hồi lời mời của b@x.vn' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Thu hồi lời mời' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/^Lý do/), 'Mời nhầm')
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi lời mời' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/team/invitations/inv1/revoke', { reason: 'Mời nhầm' }))
    expect(await screen.findByText('Máy chủ xác nhận lời mời tới b@x.vn đã bị thu hồi.')).toBeInTheDocument()
  })

  it('the invite Sheet reports a missing email at the field and shows the one-time link warning afterwards', async () => {
    const user = userEvent.setup()
    mockApi(teamRoutes(() => [member()]))
    apiMock.post.mockResolvedValue({ invitation: invitation({ email_normalized: 'new@x.vn' }), invite_link_token: 'tok-123' })
    wrap(<TeamSeats />)
    await user.click((await screen.findAllByRole('button', { name: 'Mời thành viên' }))[0])
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Tạo lời mời' })).toBeDisabled()
    await user.click(within(sheet).getByLabelText(/^Email/))
    await user.tab()
    expect(within(sheet).getByText('Hãy điền email của người được mời.')).toBeInTheDocument()
    await user.type(within(sheet).getByLabelText(/^Email/), 'new@x.vn')
    await user.click(within(sheet).getByRole('button', { name: 'Tạo lời mời' }))
    expect(await screen.findByText('tok-123')).toBeInTheDocument()
    expect(screen.getByText(/Hãy sao chép liên kết này ngay/)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------------- security

const session = (over = {}) => ({
  id: 's2',
  session_type: 'web',
  label: 'Safari iPhone',
  browser_family: null,
  os_family: null,
  last_seen_at: '2026-10-26T00:00:00Z',
  created_at: '',
  expires_at: '2026-11-26T00:00:00Z',
  revoked_at: null,
  revoked_reason: null,
  is_current: false,
  ...over,
})

describe('Security & devices', () => {
  it('does not offer to revoke the current session, and says where to sign out', async () => {
    mockApi([
      ['/security/sessions/me', [session({ id: 'cur', label: 'Chrome Windows', is_current: true }), session()]],
      ['/extension/installations', []],
    ])
    wrap(<SecurityDevices />)
    await screen.findByText('Chrome Windows')
    expect(screen.getByText('(thiết bị này)')).toBeInTheDocument()
    expect(screen.getByText('Đăng xuất từ thanh trên cùng')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thu hồi phiên Chrome Windows' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Thu hồi phiên Safari iPhone' })).toBeInTheDocument()
  })

  it('revokes another device through an AlertDialog and reads the session back', async () => {
    const user = userEvent.setup()
    let revokedAt: string | null = null
    mockApi([
      ['/security/sessions/me', () => [session({ revoked_at: revokedAt })]],
      ['/extension/installations', []],
    ])
    apiMock.post.mockImplementation(async () => {
      revokedAt = '2026-10-27T00:00:00Z'
      return {}
    })
    wrap(<SecurityDevices />)
    await user.click(await screen.findByRole('button', { name: 'Thu hồi phiên Safari iPhone' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Thu hồi phiên đăng nhập này?')
    expect(dialog).toHaveTextContent('"Safari iPhone"')
    expect(apiMock.post).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi phiên' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/security/sessions/s2/revoke', {}))
    expect(await screen.findByText('Máy chủ xác nhận phiên "Safari iPhone" đã bị thu hồi.')).toBeInTheDocument()
  })

  it('signs out the other devices only after confirming, naming the count', async () => {
    const user = userEvent.setup()
    mockApi([
      ['/security/sessions/me', [session({ id: 'cur', label: 'Chrome', is_current: true }), session(), session({ id: 's3', label: 'Firefox' })]],
      ['/extension/installations', []],
    ])
    apiMock.post.mockResolvedValue({})
    wrap(<SecurityDevices />)
    await user.click(await screen.findByRole('button', { name: 'Đăng xuất 2 thiết bị khác' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Đăng xuất 2 thiết bị khác?')
    expect(dialog).toHaveTextContent('Phiên hiện tại của bạn được giữ nguyên')
    expect(apiMock.post).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Đăng xuất các thiết bị khác' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/security/sessions/logout-other-devices'))
  })

  it('a failed extension list is an error, not "no browser connected"', async () => {
    mockApi([['/security/sessions/me', [session()]], ['/extension/installations', boom()]])
    wrap(<SecurityDevices />)
    await screen.findByText('Safari iPhone')
    expect(await screen.findByText('Không tải được danh sách trình duyệt đã kết nối')).toBeInTheDocument()
    expect(screen.queryByText(/Chưa có trình duyệt nào kết nối/)).toBeNull()
  })

  it('has loading, error and refused states', async () => {
    mockApi([['/security/sessions/me', () => pending()], ['/extension/installations', []]])
    const loading = wrap(<SecurityDevices />)
    expect(await screen.findByRole('status', { name: 'Đang tải…' })).toBeInTheDocument()
    loading.unmount()
    mockApi([['/security/sessions/me', boom()], ['/extension/installations', []]])
    const failing = wrap(<SecurityDevices />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được các phiên đăng nhập')
    failing.unmount()
    mockApi([['/security/sessions/me', forbidden()], ['/extension/installations', []]])
    wrap(<SecurityDevices />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------------- audit log

const auditEntry = (over = {}) => ({
  id: 'e1',
  actor_id: 'u1',
  actor_email: null,
  action: 'ad_account.updated',
  entity_type: 'ad_account',
  entity_id: 'abcdef1234567890',
  before_json: { status: 'unknown', token: '[REDACTED]' },
  after_json: { status: 'active', token: '[REDACTED]' },
  metadata_json: null,
  request_id: 'req-123456789',
  created_at: '2026-10-26T01:00:00Z',
  ...over,
})

describe('Audit log', () => {
  it('shows the record as written, a before/after diff with column headers, and redaction as a marker', async () => {
    mockApi([['/audit-logs', paged([auditEntry()])]])
    wrap(<AuditLog />)
    expect(await screen.findByText('ad_account.updated')).toBeInTheDocument()
    expect(screen.getByText('hệ thống')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Thay đổi theo từng trường' })
    expect(within(table).getByRole('columnheader', { name: 'Trước' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Sau' })).toBeInTheDocument()
    const redacted = within(table).getAllByText('[REDACTED]')
    expect(redacted).toHaveLength(2)
    expect(redacted[0]).toHaveAttribute('title', expect.stringContaining('đã được che'))
    // The diff colours carry meaning by tone tokens, never raw palette, and "added" is not a success claim.
    expect(table.innerHTML).not.toMatch(SUCCESS)
  })

  it('has empty (none / filtered), error and refused states', async () => {
    const user = userEvent.setup()
    mockApi([['/audit-logs', paged([])]])
    const empty = wrap(<AuditLog />)
    expect(await screen.findByText('Chưa có thay đổi nào được ghi trong workspace này.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Loại đối tượng'), 'ad_account')
    expect(await screen.findByText('Chưa có bản ghi nào khớp bộ lọc này.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Xoá bộ lọc' }).length).toBeGreaterThanOrEqual(1)
    empty.unmount()
    mockApi([['/audit-logs', boom()]])
    const failing = wrap(<AuditLog />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được nhật ký kiểm toán')
    failing.unmount()
    mockApi([['/audit-logs', forbidden()]])
    wrap(<AuditLog />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------------------------- system

const overview = (over = {}) => ({
  release_version: 'r1',
  application_version: '1.0',
  environment: 'production',
  server_time: '2026-10-27T01:00:00Z',
  database_status: 'reachable',
  migration_revision: '0015',
  api_status: 'healthy',
  notification_transport: 'fake',
  telegram_transport_configured: false,
  test_send_enabled: false,
  dispatcher_state: 'current',
  dispatcher_last_run: null,
  dispatcher_last_success_at: '2026-10-27T00:50:00Z',
  due_delivery_count: 0,
  failed_final_delivery_count: 0,
  oldest_due_delivery_at: null,
  oldest_due_delivery_minutes: null,
  backup_state: 'never',
  backup_last_success_at: null,
  backup_last_run: null,
  restore_drill_last_run: null,
  migration_last_run: null,
  host: { cpu_count: 4, load_average_1m: 0.5, load_percent: 12, memory_total_mb: 8000, memory_available_mb: 4000, memory_used_percent: 50, disk_total_gb: 100, disk_free_gb: 60, disk_used_percent: 40, swap_total_mb: 0 },
  host_bands: { cpu: 'ok', memory: 'ok', disk: 'unknown' },
  thresholds: { cpu_warning_percent: 70, cpu_critical_percent: 90, memory_warning_percent: 80, memory_critical_percent: 90, disk_warning_percent: 80, disk_critical_percent: 90 },
  ...over,
})
const systemStatus = (over = {}) => ({
  application: 'AdsOps',
  version: '1.0',
  environment: 'production',
  api_status: 'healthy',
  database_status: 'reachable',
  database_migration_revision: '0015',
  worker_status: 'running',
  redis_status: 'not_configured',
  last_readiness_recalculation_at: null,
  account_count: 3,
  server_time: '2026-10-27T01:00:00Z',
  ...over,
})
const systemRoutes = (ov: unknown = overview(), st: unknown = systemStatus(), extra: [Key, Handler][] = []): [Key, Handler][] => [
  ...extra,
  ['/operations/overview', ov],
  ['/system/status', st],
  ['/operations/configuration', { environment: 'production', production_mode: true, release_version: 'r1', api_docs_enabled: false, cors_origin_count: 1, public_app_url_configured: true, public_app_url_is_https: true, notification_transport: 'fake', telegram_transport_configured: false, test_send_enabled: false, error_count: 0, warning_count: 1, findings: [{ code: 'x_code', severity: 'warning', message: 'Một cảnh báo cấu hình' }] }],
  ['/operations/runs', []],
]

describe('System status', () => {
  const apiBadge = () => screen.findByTestId('api-status-badge')

  it('P13: the API badge reflects the reported value instead of always being green', async () => {
    const cases: [string, RegExp, boolean][] = [
      ['healthy', /tone-positive/, true],
      ['degraded', /tone-caution/, false],
      ['unhealthy', /tone-attention/, false],
      ['down', /tone-attention/, false],
    ]
    for (const [value, tone] of cases.map(([v, t]) => [v, t] as const)) {
      mockApi(systemRoutes(overview(), systemStatus({ api_status: value })))
      const { unmount } = wrap(<SystemStatus />)
      const badge = await apiBadge()
      expect(badge.className, value).toMatch(tone)
      if (value !== 'healthy') expect(badge.className, value).not.toMatch(SUCCESS)
      unmount()
    }
  })

  it('P13: an unfamiliar or empty API value is neutral and is shown as the raw code, never green', async () => {
    for (const value of ['mystery', '']) {
      mockApi(systemRoutes(overview(), systemStatus({ api_status: value })))
      const { unmount } = wrap(<SystemStatus />)
      const badge = await apiBadge()
      expect(badge.className, value).toMatch(/tone-neutral/)
      expect(badge.className, value).not.toMatch(SUCCESS)
      if (value) expect(badge).toHaveTextContent(value)
      unmount()
    }
  })

  it('keeps "never run" and "stale" apart, in words and in tone, and neither is green (rule 28)', async () => {
    mockApi(systemRoutes(overview({ dispatcher_state: 'never', dispatcher_last_success_at: null, backup_state: 'stale' }), systemStatus({ worker_status: 'not_configured' })))
    wrap(<SystemStatus />)
    const dispatcher = (await screen.findByText('Bộ gửi thông báo', { selector: 'p' })).closest('div')!
    expect(dispatcher).toHaveTextContent('Chưa từng chạy')
    const neverBadge = within(dispatcher).getByText('Chưa từng chạy')
    expect(neverBadge.className).toMatch(/tone-attention/)
    expect(neverBadge.className).not.toMatch(SUCCESS)
    const backup = screen.getByText('Sao lưu', { selector: 'p' }).closest('div')!
    const staleBadge = within(backup).getByText('Đã cũ')
    expect(staleBadge.className).toMatch(/tone-caution/)
    expect(staleBadge.className).not.toBe(neverBadge.className)
    expect(screen.getAllByText(/Không có bản ghi nào cho thấy việc này từng chạy/).length).toBeGreaterThanOrEqual(1)
    // The application card says the same about the same fact, with the same tone.
    const worker = (await screen.findByText('Bộ gửi thông báo', { selector: 'dt' })).nextElementSibling!
    expect(within(worker as HTMLElement).getByText('Chưa từng chạy').className).toMatch(/tone-attention/)
  })

  it('a missing readiness recalculation is "chưa từng", not a date', async () => {
    mockApi(systemRoutes())
    wrap(<SystemStatus />)
    const dd = (await screen.findByText('Lần tính lại mức sẵn sàng gần nhất')).nextElementSibling!
    expect(dd).toHaveTextContent('chưa từng')
  })

  it('degrades: a failed overview still shows the application card, with its own error and retry', async () => {
    mockApi(systemRoutes(boom()))
    wrap(<SystemStatus />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không tải được trạng thái hệ thống')
    expect(await screen.findByText('AdsOps 1.0')).toBeInTheDocument()
  })

  it('shows loading placeholders first', async () => {
    mockApi(systemRoutes(() => pending(), () => pending()))
    wrap(<SystemStatus />)
    expect((await screen.findAllByRole('status', { name: 'Đang tải…' })).length).toBeGreaterThanOrEqual(1)
  })

  it('a non-owner sees the reason, not the configuration, run history or test send', async () => {
    authMock.role = 'operator'
    mockApi(systemRoutes())
    wrap(<SystemStatus />)
    expect(await screen.findByText(/chỉ chủ workspace xem được/)).toBeInTheDocument()
    expect(screen.queryByText('Cấu hình')).toBeNull()
    expect(screen.queryByText('Kiểm tra gửi có kiểm soát')).toBeNull()
  })

  it('the host metric with no measurement says so, and an unknown band is not OK', async () => {
    mockApi(systemRoutes(overview({ host: { ...overview().host, disk_used_percent: null } })))
    wrap(<SystemStatus />)
    const disk = (await screen.findByText('Ổ đĩa')).closest('div')!.parentElement!
    expect(disk).toHaveTextContent('Môi trường này không đo được')
    expect(within(disk).getByText('Không xác định').className).toMatch(/tone-neutral/)
  })

  it('test send: "off" is neutral, and the real send needs the typed word in an AlertDialog', async () => {
    const user = userEvent.setup()
    mockApi(systemRoutes(overview({ test_send_enabled: true, notification_transport: 'telegram', telegram_transport_configured: true })))
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) {
        return { message: 'Tin thử', recipient_masked: '…7890', environment: 'production', timezone: 'Asia/Ho_Chi_Minh', template_version: 'v1', approval_code: 'ap-1', transport_mode: 'telegram', already_sent: false, ready_to_send: true, checks: [{ code: 'c', passed: true, detail: 'ok' }] }
      }
      return { sent: true, detail: '', message_id: 'm-99' }
    })
    wrap(<SystemStatus />)
    await user.click(await screen.findByRole('button', { name: 'Xem trước tin nhắn' }))
    await user.click(await screen.findByRole('button', { name: 'Gửi một tin nhắn thử' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Gửi một tin nhắn thật tới Telegram?')
    expect(dialog).toHaveTextContent('…7890')
    expect(dialog).toHaveTextContent('Không thu hồi được tin đã gửi')
    const send = within(dialog).getByRole('button', { name: 'Gửi một tin nhắn thử' })
    expect(send).toBeDisabled()
    expect(apiMock.post).not.toHaveBeenCalledWith('/api/v1/operations/test-send/execute', expect.anything())
    await user.type(within(dialog).getByLabelText('Gõ "SEND" để xác nhận'), 'SEND')
    await user.click(send)
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/operations/test-send/execute', { approval_code: 'ap-1', confirm: true }))
    expect(await screen.findByText('Đã gửi một tin nhắn. Mã tin nhắn từ nhà cung cấp: m-99.')).toBeInTheDocument()
  })

  it('test send switched off is neutral, never the success tone', async () => {
    mockApi(systemRoutes())
    wrap(<SystemStatus />)
    const badge = await screen.findByText('Gửi thử đang tắt')
    expect(badge.className).toMatch(/tone-neutral/)
    expect(badge.className).not.toMatch(SUCCESS)
  })
})

// ------------------------------------------------------------------------------------------ axe

describe('accessibility (axe, colour-contrast off because jsdom has no layout)', () => {
  it('Operations, the wizard connection step, Team, Security, Audit and System have no violations', async () => {
    mockApi([
      ...teamRoutes(() => [member()]),
      ['/api/v1/meta-connections', [connection()]],
      ['/security/sessions/me', [session({ id: 'cur', is_current: true }), session()]],
      ['/extension/installations', [{ id: 'x', label: 'Chrome', extension_version: '0.3', last_seen_at: null, revoked_at: null, revoked_reason: null, created_at: '', is_active: true }]],
      ['/audit-logs', paged([auditEntry()])],
      ...systemRoutes(),
    ])
    const cases: [string, React.ReactElement, string][] = [
      ['Vận hành', <Operations />, '/operations'],
      ['Chọn kết nối', <CreateAccountWizard />, '/operations/create-accounts'],
      ['Nguyễn An', <TeamSeats />, '/team'],
      ['Safari iPhone', <SecurityDevices />, '/security-devices'],
      ['ad_account.updated', <AuditLog />, '/audit-log'],
      ['AdsOps 1.0', <SystemStatus />, '/system'],
    ]
    for (const [text, element, path] of cases) {
      const { container, unmount } = wrap(element, path)
      if (text === 'Chọn kết nối') await screen.findByLabelText(/^Kết nối Meta/)
      else await screen.findAllByText(text)
      expect((await axe(container, axeOptions)).violations, path).toEqual([])
      unmount()
    }
  })

  it('the member Sheet, the typed AlertDialog and the reason AlertDialog have no violations', async () => {
    const user = userEvent.setup()
    mockApi(teamRoutes(() => [member()]))
    wrap(<TeamSeats />)
    await user.click(await screen.findByRole('button', { name: 'Quản lý Nguyễn An' }))
    const sheet = await screen.findByRole('dialog')
    await within(sheet).findByText('Chrome')
    expect((await axe(sheet, axeOptions)).violations).toEqual([])
    await user.click(within(sheet).getByRole('button', { name: 'Ngừng' }))
    const dialog = await screen.findByRole('alertdialog')
    expect((await axe(dialog, axeOptions)).violations).toEqual([])
  })
})
