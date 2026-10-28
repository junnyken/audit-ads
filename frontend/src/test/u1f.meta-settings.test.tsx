import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { axe } from 'vitest-axe'
import MetaConnections from '../pages/MetaConnections'
import MetaConnectionWorkspace from '../pages/MetaConnectionWorkspace'
import Settings from '../pages/Settings'
import { DiscoveryOverview } from '../components/meta/DiscoveryOverview'
import { ReaderCredentialsSection } from '../components/meta/ReaderCredentialsSection'
import { ConnectionReaderSwitch } from '../components/meta/ConnectionReaderSwitch'
import { ReaderSourceBadge, readerSourceNote } from '../components/meta/ReaderSource'
import { readerSourceLabel } from '../lib/metaReaders'
import { ApiError } from '../lib/api'
import { vi as viDict } from '../i18n/vi'
import { en as enDict } from '../i18n/en'
import { u1fEn, u1fVi } from '../i18n/u1f'
import type {
  DiscoveryRun,
  MetaConnection,
  MetaReaderCredential,
  MetaReaderCredentialList,
  ReaderSource,
} from '../lib/types'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
const authMock = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: apiMock,
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'owner@example.test',
      full_name: 'Nguyễn Triều',
      role: authMock.role,
      workspace: { id: 'w1', name: 'WS', slug: 'ws' },
    },
  }),
}))

const SUCCESS = /tone-positive|tone-dot-positive|emerald|green/

// ---------------------------------------------------------------------------------- fixtures

function connectionFixture(over: Partial<MetaConnection> = {}): MetaConnection {
  return {
    id: 'c1',
    label: 'Hub',
    environment: 'production',
    status: 'unknown',
    capabilities: null,
    last_capability_check_at: null,
    business_managers: null,
    token_configured: true,
    reader_source: 'server_default',
    business_manager_reference: '1993884657458857',
    business_manager_source: 'connection',
    notes: '',
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    archived_at: null,
    automation: {
      auto_discovery_enabled: false,
      auto_import_enabled: false,
      enabled_by: null,
      enabled_at: null,
      eligible: true,
      ineligible_reason: null,
    },
    ...over,
  } as MetaConnection
}

const edge = (items = 2) => ({ required: true, status: 'completed' as const, pages: 1, items, error_code: null })

function runFixture(over: Partial<DiscoveryRun> = {}): DiscoveryRun {
  return {
    id: 'run-1',
    status: 'succeeded',
    trigger: 'manual',
    environment: 'production',
    business_manager: { reference: '1993884657458857', name: 'Quảng Cáo Top' },
    read_as: { external_id: '615', name: 'adsops-readonly' },
    business_authority: 'established',
    started_at: '2026-10-27T01:00:00Z',
    completed_at: '2026-10-27T01:00:05Z',
    freshness: 'current',
    failure_code: null,
    failure_summary: null,
    ad_accounts: {
      coverage_status: 'complete',
      complete: true,
      required_edges: ['owned_ad_accounts'],
      coverage: { edges: { owned_ad_accounts: edge(1) }, total_unique_assets: 1 },
      reconciliation: [
        {
          external_id: '111',
          internal_entity_id: null,
          display_name: 'Tbsupellex',
          status: 'missing_in_registry',
          detail: null,
          source_edge: 'owned_ad_accounts',
        },
      ],
    },
    pixels: {
      coverage_status: 'complete',
      complete: true,
      required_edges: ['adspixels'],
      coverage: { edges: { adspixels: edge(0) }, total_unique_assets: 0 },
      reconciliation: [],
    },
    ...over,
  } as DiscoveryRun
}

function credentialFixture(over: Partial<MetaReaderCredential> = {}): MetaReaderCredential {
  return {
    id: 'r1',
    label: 'FB Triều',
    kind: 'system_user',
    status: 'active',
    derived_state: 'active',
    provider_user_external_id: '6155',
    provider_user_name: 'AdsOps reader',
    scopes: ['ads_read', 'business_management'],
    issued_at: null,
    expires_at: null,
    data_access_expires_at: null,
    last_verified_at: '2026-10-27T00:00:00Z',
    last_verify_outcome: 'valid',
    reconnect_reason: null,
    businesses_seen: [{ external_id: '1993884657458857', name: 'Shop A', permitted_roles: null, bound_here: true }],
    connections: [{ id: 'c1', label: 'FB Triều — Shop A', business_manager_reference: '1993884657458857' }],
    connected_at: '2026-10-27T00:00:00Z',
    secret_last_rotated_at: null,
    revoked_at: null,
    ...over,
  }
}

function listFixture(over: Partial<MetaReaderCredentialList> = {}): MetaReaderCredentialList {
  return {
    configured: true,
    unavailable_reason: null,
    config_kind: 'system_user',
    business_manager_required: true,
    items: [credentialFixture()],
    ...over,
  }
}

const policyFixture = (over = {}) => ({
  id: 'p1',
  name: 'default',
  enabled: true,
  timezone: 'Asia/Ho_Chi_Minh',
  quiet_hours_enabled: false,
  quiet_hours_start: '23:00:00',
  quiet_hours_end: '07:00:00',
  critical_bypasses_quiet_hours: true,
  warning_telegram_enabled: true,
  attention_telegram_enabled: false,
  reminder_enabled: false,
  reminder_interval_hours: null,
  max_reminders_per_alert: null,
  telegram_transport_configured: true,
  recipient_configured: true,
  telegram_chat_id_masked: '***789',
  updated_at: '2026-10-27T00:00:00Z',
  ...over,
})

const browserFixture = (over = {}) => ({
  id: 'b1',
  label: 'Chrome văn phòng',
  extension_version: '0.3.0',
  last_seen_at: '2026-10-27T00:00:00Z',
  revoked_at: null,
  revoked_reason: null,
  created_at: '2026-10-01T00:00:00Z',
  is_active: true,
  ...over,
})

// ------------------------------------------------------------------------------------- mocks

type Handler = unknown | Error | (() => unknown)
type Key = string | RegExp
let routes: [Key, Handler][] = []

function mockApi(over: [Key, Handler][] = []) {
  routes = [
    ...over,
    [/\/discoveries\/latest$/, null],
    [/\/discoveries\?/, { items: [], page: 1, page_size: 10, total: 0, total_pages: 0 }],
    [/\/meta-connections\/c1$/, connectionFixture()],
    [/\/meta-connections$/, [connectionFixture()]],
    ['/discovery-summary', []],
    ['/business-managers', { items: [], page: 1, page_size: 25, total: 0, total_pages: 1 }],
    [/\/meta-reader-credentials$/, listFixture()],
    ['/auth/me', { id: 'u1', email: 'owner@example.test', full_name: 'Nguyễn Triều', role: authMock.role, workspace: { id: 'w1', name: 'WS', slug: 'ws' } }],
    ['/notification-policies/current', policyFixture()],
    ['/extension/installations', [browserFixture()]],
  ]
  apiMock.get.mockImplementation((path: string) => {
    const hit = routes.find(([key]) => (typeof key === 'string' ? path.includes(key) : key.test(path)))
    const value = hit ? hit[1] : null
    const resolved = typeof value === 'function' ? (value as () => unknown)() : value
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved)
  })
}

const refusal = (status: number, message = 'Máy chủ từ chối') => new ApiError(message, status, 'x', 'req-123', {})

function wrap(node: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function mountConnections() {
  return wrap(<MetaConnections />, '/meta-connections')
}

function mountWorkspace(path = '/meta-connections/c1') {
  return wrap(
    <Routes>
      <Route path="/meta-connections/:connectionId" element={<MetaConnectionWorkspace />} />
      <Route path="/meta-connections" element={<p>danh sách kết nối</p>} />
    </Routes>,
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

// ---------------------------------------------------------------------- Meta connections page

describe('Meta connections page: states', () => {
  it('shows a loading region shaped like the cards while the list is pending', async () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined))
    mountConnections()
    expect(await screen.findByRole('heading', { level: 1, name: 'Kết nối Meta' })).toBeInTheDocument()
    expect(screen.getAllByRole('status', { name: 'Đang tải…' }).length).toBeGreaterThan(0)
  })

  it('says there is no connection and offers the next step, instead of a blank page', async () => {
    mockApi([[/\/meta-connections$/, []]])
    const user = userEvent.setup()
    mountConnections()
    expect(await screen.findByText('Chưa có kết nối Meta nào')).toBeInTheDocument()
    const facebook = screen.getByRole('link', { name: 'Kết nối bằng Facebook' })
    expect(facebook).toHaveAttribute('href', '/settings#meta-readers')
    await user.click(screen.getByRole('button', { name: 'Đi tới biểu mẫu thêm kết nối' }))
    expect(screen.getByLabelText(/Nhãn/)).toHaveFocus()
  })

  it('reports a failed list with the four parts and retries', async () => {
    let fail = true
    mockApi([[/\/meta-connections$/, () => (fail ? refusal(500, 'Cơ sở dữ liệu không trả lời') : [])]])
    const user = userEvent.setup()
    mountConnections()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không tải được danh sách kết nối Meta')
    expect(alert).toHaveTextContent('Cơ sở dữ liệu không trả lời')
    expect(alert).toHaveTextContent('req-123')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Chưa có kết nối Meta nào')).toBeInTheDocument()
  })

  it('tells a non-owner why they cannot see connections, and offers no way to add one', async () => {
    mockApi([[/\/meta-connections$/, refusal(403)]])
    mountConnections()
    expect(await screen.findByText('Chỉ chủ workspace mới xem được kết nối Meta')).toBeInTheDocument()
    expect(screen.queryByText('Thêm kết nối')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says once, above the list, that a connection reads nothing at the moment', async () => {
    mockApi([[/\/meta-connections$/, [connectionFixture({ reader_source: 'none' }), connectionFixture({ id: 'c2', label: 'Khác' })]]])
    mountConnections()
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Dữ liệu chưa đầy đủ')
    expect(note).toHaveTextContent('Hub')
    expect(note).not.toHaveTextContent('Khác')
  })

  it('labels the optional field optional and the label required', async () => {
    mountConnections()
    await screen.findByText('Hub')
    expect(screen.getByText('Nhãn').closest('label')).not.toHaveTextContent('(không bắt buộc)')
    expect(screen.getByText('ID Business Manager').closest('label')).toHaveTextContent('(không bắt buộc)')
  })
})

describe('Meta connections page: writes', () => {
  it('adds a connection and then reads the list back before saying it exists', async () => {
    const user = userEvent.setup()
    let created = false
    mockApi([[/\/meta-connections$/, () => (created ? [connectionFixture({ id: 'c9', label: 'Mới' })] : [])]])
    apiMock.post.mockImplementation(async () => {
      created = true
      return connectionFixture({ id: 'c9', label: 'Mới', environment: 'fake' })
    })
    mountConnections()
    await screen.findByText('Chưa có kết nối Meta nào')
    await user.type(screen.getByLabelText(/Nhãn/), 'Mới')
    await user.click(screen.getByRole('button', { name: 'Thêm kết nối' }))
    const note = await screen.findByRole('status', { name: '' })
    expect(note).toHaveTextContent('Đọc lại từ máy chủ: đã có kết nối "Mới"')
    expect(note.className).not.toMatch(SUCCESS)
  })

  it('does not claim the connection exists when the re-read list lacks it', async () => {
    const user = userEvent.setup()
    mockApi([[/\/meta-connections$/, []]])
    apiMock.post.mockResolvedValue(connectionFixture({ id: 'ghost', label: 'Ma' }))
    mountConnections()
    await screen.findByText('Chưa có kết nối Meta nào')
    await user.type(screen.getByLabelText(/Nhãn/), 'Ma')
    await user.click(screen.getByRole('button', { name: 'Thêm kết nối' }))
    expect(await screen.findByText(/Chưa coi là đã thêm/)).toBeInTheDocument()
  })

  it('shows the refusal of a capability check on the card, not nowhere', async () => {
    const user = userEvent.setup()
    apiMock.post.mockRejectedValue(refusal(500, 'Meta không trả lời'))
    mountConnections()
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra khả năng' }))
    expect(await screen.findByText('Không kiểm tra được khả năng của kết nối này')).toBeInTheDocument()
    expect(screen.getByText(/Meta không trả lời/)).toBeInTheDocument()
  })

  it('never paints a capability or a reader with the success tone', async () => {
    mockApi([
      [
        /\/meta-connections$/,
        [
          connectionFixture({
            reader_source: 'business_specific',
            capabilities: { list_business_managers: true, create_ad_account: false, share_ad_account_access: true, share_pixel_access: false, reason: null },
          }),
        ],
      ],
    ])
    mountConnections()
    expect((await screen.findAllByText('Được phép'))[0].className).not.toMatch(SUCCESS)
    expect(screen.getByText('Reader riêng cho Business Manager này').className).not.toMatch(SUCCESS)
    expect(screen.getByText('Không được phép').className).toContain('tone-attention')
  })

  it('imports a discovered account only after an AlertDialog, then reads the result back', async () => {
    const user = userEvent.setup()
    let imported = false
    mockApi([
      [
        /\/discoveries\/latest$/,
        () => {
          const run = runFixture()
          if (imported) run.ad_accounts.reconciliation[0] = { ...run.ad_accounts.reconciliation[0], status: 'matched', internal_entity_id: 'row-1' }
          return run
        },
      ],
    ])
    apiMock.post.mockImplementation(async () => {
      imported = true
      return {}
    })
    mountConnections()
    await user.click(await screen.findByRole('button', { name: 'Thêm vào sổ đăng ký' }))
    expect(apiMock.post).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Bản ghi trong sổ đăng ký không xoá được về sau')
    expect(dialog).toHaveTextContent('Không hoàn tác được')
    await user.click(within(dialog).getByRole('button', { name: 'Thêm vào sổ đăng ký' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/v1/meta-connections/c1/discoveries/run-1/imports',
      { external_account_id: '111' },
    )
    expect(await screen.findByText(/sổ đăng ký nay báo "Khớp"/)).toBeInTheDocument()
  })

  it('keeps the dialog open and explains a refusal of the import', async () => {
    const user = userEvent.setup()
    mockApi([[/\/discoveries\/latest$/, runFixture()]])
    apiMock.post.mockRejectedValue(refusal(409, 'Mã tài khoản này đã được dùng'))
    mountConnections()
    await user.click(await screen.findByRole('button', { name: 'Thêm vào sổ đăng ký' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Thêm vào sổ đăng ký' }))
    expect(await within(dialog).findByText(/Mã tài khoản này đã được dùng/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------- automation

describe('Scheduled discovery switches: AlertDialog and read-back', () => {
  it('drafts on tick, writes only on confirm, and reports what the server stored', async () => {
    const user = userEvent.setup()
    apiMock.patch.mockResolvedValue(
      connectionFixture({
        automation: { auto_discovery_enabled: true, auto_import_enabled: false, enabled_by: null, enabled_at: null, eligible: true, ineligible_reason: null },
      }),
    )
    mountConnections()
    await user.click(await screen.findByRole('checkbox', { name: /Tự động khám phá/ }))
    expect(apiMock.patch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Tự động khám phá: tắt → bật')
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Áp dụng thay đổi' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.patch).toHaveBeenCalledWith('/api/v1/meta-connections/c1/automation', {
      auto_discovery_enabled: true,
      auto_import_enabled: false,
    })
    expect(await screen.findByText(/khám phá tự động bật, tự động nhập tắt/)).toBeInTheDocument()
  })

  it('writes nothing when the dialog is cancelled with Esc, and hands focus back', async () => {
    const user = userEvent.setup()
    mountConnections()
    await user.click(await screen.findByRole('checkbox', { name: /Tự động khám phá/ }))
    const review = screen.getByRole('button', { name: 'Xem lại thay đổi' })
    await user.click(review)
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.patch).not.toHaveBeenCalled()
    await waitFor(() => expect(review).toHaveFocus())
  })
})

// -------------------------------------------------------------------------- reader switch

describe('Switching which credential reads a connection', () => {
  const connection = {
    id: 'c1',
    label: 'Hub',
    other_readers: [{ id: 'r2', label: 'FB Hằng', kind: 'system_user' }],
  } as unknown as MetaConnection

  it('asks first, says nothing is revoked, and reads the bound credential back', async () => {
    const user = userEvent.setup()
    apiMock.post.mockResolvedValue({ ...connection, reader_credential: { id: 'r2', label: 'FB Hằng' } })
    wrap(<ConnectionReaderSwitch connection={connection} />)
    await user.click(screen.getByRole('button', { name: 'Dùng FB Hằng cho kết nối này' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(apiMock.post).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('không bị thu hồi')
    await user.click(within(dialog).getByRole('button', { name: 'Dùng reader này' }))
    expect(await screen.findByText(/kết nối "Hub" nay đọc bằng "FB Hằng"/)).toBeInTheDocument()
  })

  it('reports a different credential than the one asked for', async () => {
    const user = userEvent.setup()
    apiMock.post.mockResolvedValue({ ...connection, reader_credential: { id: 'r1', label: 'FB Triều' } })
    wrap(<ConnectionReaderSwitch connection={connection} />)
    await user.click(screen.getByRole('button', { name: 'Dùng FB Hằng cho kết nối này' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dùng reader này' }))
    expect(await screen.findByText(/máy chủ đọc lại cho kết nối "Hub" là "FB Triều"/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------- workspace page

describe('Connection workspace: states', () => {
  it('shows a loading region, then the header with breadcrumb and badges', async () => {
    mountWorkspace()
    expect(await screen.findByRole('heading', { level: 1, name: 'Hub' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Đường dẫn' })).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
  })

  it('reports a connection that cannot be loaded and links back', async () => {
    mockApi([[/\/meta-connections\/c1$/, refusal(404, 'Không có kết nối này')]])
    mountWorkspace()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được kết nối này')
    expect(screen.getByRole('link', { name: 'Về danh sách kết nối' })).toHaveAttribute('href', '/meta-connections')
  })

  it('says the connection is owner-only on a 403', async () => {
    mockApi([[/\/meta-connections\/c1$/, refusal(403)]])
    mountWorkspace()
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })

  it('still shows the connection card when only the latest discovery fails (partial)', async () => {
    mockApi([[/\/discoveries\/latest$/, refusal(500, 'Hỏng khi đọc lần chạy')]])
    mountWorkspace()
    expect(await screen.findByText('Không tải được lần khám phá gần nhất')).toBeInTheDocument()
    expect(screen.getByText('Credential đọc')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Hub' })).toBeInTheDocument()
  })

  it('says no discovery has run, without inventing numbers', async () => {
    mountWorkspace()
    expect(await screen.findByText('Chưa chạy khám phá nào cho kết nối này.')).toBeInTheDocument()
  })

  it('states the authority caveat and never shows a stale reading as current', async () => {
    mockApi([[/\/discoveries\/latest$/, runFixture({ business_authority: 'not_established', freshness: 'stale' })]])
    mountWorkspace()
    expect(await screen.findByText('Chưa xác lập được quyền truy cập Business Manager này.')).toBeInTheDocument()
    expect(screen.getByText('Lần đọc đã cũ').className).toContain('tone-caution')
  })

  it('keeps the tab in the URL and shows the inventory tab', async () => {
    mockApi([[/\/discoveries\/latest$/, runFixture()]])
    const user = userEvent.setup()
    mountWorkspace()
    await user.click(await screen.findByRole('tab', { name: 'Tài khoản quảng cáo' }))
    expect(await screen.findByText('Tbsupellex')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tài khoản quảng cáo', selected: true })).toBeInTheDocument()
  })

  it('opens straight on a tab from the URL and shows the empty history with its next step', async () => {
    mountWorkspace('/meta-connections/c1?tab=history')
    expect(await screen.findByText('Chưa chạy khám phá nào cho kết nối này')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lịch sử khám phá', selected: true })).toBeInTheDocument()
  })

  it('reports a failed history without hiding the other tabs', async () => {
    mockApi([[/\/discoveries\?/, refusal(500, 'Lịch sử hỏng')]])
    mountWorkspace('/meta-connections/c1?tab=history')
    expect(await screen.findByText('Không tải được lịch sử khám phá')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------- discovery overview

describe('DiscoveryOverview', () => {
  it('shows an empty state with the next actions when the owner has no connection', async () => {
    mockApi([['/discovery-summary', []]])
    wrap(<DiscoveryOverview isOwner />)
    // It used to return null here, which reads from outside exactly like "nothing was found".
    expect(await screen.findByText('Chưa có kết nối Meta để đọc')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Thêm kết nối' })).toHaveAttribute('href', '/meta-connections')
    expect(screen.getByRole('link', { name: 'Kết nối bằng Facebook' })).toHaveAttribute('href', '/settings#meta-readers')
  })

  it('renders nothing for a non-owner and makes no request', () => {
    const { container } = wrap(<DiscoveryOverview isOwner={false} />)
    expect(container.textContent).toBe('')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('shows a loading region, not nothing, while the summary is pending', () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined))
    wrap(<DiscoveryOverview isOwner />)
    expect(screen.getByRole('status', { name: 'Đang tải…' })).toBeInTheDocument()
    expect(screen.getByText('Khám phá Business Manager')).toBeInTheDocument()
  })

  it('reports a failed summary instead of vanishing', async () => {
    mockApi([['/discovery-summary', refusal(422, 'Tham số sai')]])
    wrap(<DiscoveryOverview isOwner />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được tổng hợp khám phá')
  })

  it('says a 403 is a permission matter, not an outage', async () => {
    mockApi([['/discovery-summary', refusal(403)]])
    wrap(<DiscoveryOverview isOwner />)
    expect(await screen.findByText('Bạn chưa có quyền xem mục này')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ reader credentials flows

describe('Reader credentials: revoke', () => {
  const sectionWith = (list: MetaReaderCredentialList) => {
    mockApi([[/\/meta-reader-credentials$/, list]])
    return wrap(<ReaderCredentialsSection isOwner />, '/settings')
  }

  it('says it clears the stored credential, that it cannot be undone and that Meta is a separate step', async () => {
    const user = userEvent.setup()
    sectionWith(listFixture())
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Xoá quyền đã lưu khỏi kho mã hoá')
    expect(dialog).toHaveTextContent('không hoàn tác được')
    expect(dialog).toHaveTextContent('Thu hồi ở phía Meta là một bước tay riêng')
    expect(dialog).toHaveTextContent('Business Settings')
    expect(dialog).toHaveTextContent('Không hoàn tác được')
    // A credential value is never part of this wording.
    expect(dialog.textContent).not.toMatch(/EAA|ciphertext|secret/i)
  })

  it('needs a reason, uses the destructive action, and starts on the safe one', async () => {
    const user = userEvent.setup()
    sectionWith(listFixture())
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toHaveFocus()
    const confirm = within(dialog).getByRole('button', { name: 'Thu hồi vĩnh viễn' })
    expect(confirm).toBeDisabled()
    expect(confirm.className).toContain('tone-attention')
    await user.type(within(dialog).getByLabelText(/Lý do thu hồi/), 'Nhân sự nghỉ việc')
    expect(confirm).toBeEnabled()
  })

  it('writes nothing on cancel or Esc, and returns focus to the Revoke button', async () => {
    const user = userEvent.setup()
    sectionWith(listFixture())
    const opener = await screen.findByRole('button', { name: 'Thu hồi' })
    await user.click(opener)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
    await user.click(opener)
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('revokes with the reason and then reads the credential back from the server', async () => {
    const user = userEvent.setup()
    let revoked = false
    mockApi([
      [
        /\/meta-reader-credentials$/,
        () => listFixture({ items: [credentialFixture(revoked ? { status: 'revoked', derived_state: 'revoked' } : {})] }),
      ],
    ])
    apiMock.post.mockImplementation(async () => {
      revoked = true
      return credentialFixture({ status: 'revoked', derived_state: 'revoked' })
    })
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Lý do thu hồi/), 'Nhân sự nghỉ việc')
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi vĩnh viễn' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiMock.post).toHaveBeenCalledWith('/api/v1/meta-reader-credentials/r1/revoke', { reason: 'Nhân sự nghỉ việc' })
    const note = await screen.findByText(/nay có trạng thái "Đã thu hồi"/)
    expect(note).toHaveTextContent('Bước gỡ ở phía Meta vẫn cần làm tay')
    // The Revoke button is gone once the server says it is revoked.
    expect(screen.queryByRole('button', { name: 'Thu hồi' })).toBeNull()
  })

  it('does not say it is revoked when the re-read still shows an active credential', async () => {
    const user = userEvent.setup()
    sectionWith(listFixture())
    apiMock.post.mockResolvedValue(credentialFixture({ status: 'revoked', derived_state: 'revoked' }))
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Lý do thu hồi/), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi vĩnh viễn' }))
    expect(await screen.findByText(/Chưa coi là đã thu hồi/)).toBeInTheDocument()
  })

  it('explains a refusal inside the dialog and keeps it open', async () => {
    const user = userEvent.setup()
    sectionWith(listFixture())
    apiMock.post.mockRejectedValue(refusal(403))
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Lý do thu hồi/), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi vĩnh viễn' }))
    expect(await within(dialog).findByText('Chỉ chủ workspace mới thực hiện được thao tác này.')).toBeInTheDocument()
  })
})

describe('Reader credentials: connect, reconnect, verify', () => {
  it('asks before sending the browser to Meta, and says what the product never sees', async () => {
    const user = userEvent.setup()
    mockApi()
    apiMock.post.mockResolvedValue({ url: '#meta' })
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await user.type(await screen.findByLabelText(/Tên gợi nhớ/), 'FB mới')
    await user.type(screen.getByLabelText(/ID Business Manager/), '1993884657458857')
    await user.click(screen.getByRole('button', { name: 'Kết nối một tài khoản Facebook' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(apiMock.post).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('không bao giờ thấy mật khẩu hay cookie')
    expect(dialog).toHaveTextContent('chỉ để đọc')
    await user.click(within(dialog).getByRole('button', { name: 'Chuyển sang Meta' }))
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/v1/meta-reader-credentials/connect/start', {
        label: 'FB mới',
        business_manager_reference: '1993884657458857',
      }),
    )
  })

  it('asks before reconnecting and says the old permission stays unusable until Meta confirms', async () => {
    const user = userEvent.setup()
    mockApi([[/\/meta-reader-credentials$/, listFixture({ items: [credentialFixture({ status: 'reconnect_required', derived_state: 'reconnect_required', reconnect_reason: 'password_changed' })] })]])
    apiMock.post.mockResolvedValue({ url: '#meta' })
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await user.click(await screen.findByRole('button', { name: 'Kết nối lại' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('vẫn không đọc gì')
    await user.click(within(dialog).getByRole('button', { name: 'Chuyển sang Meta' }))
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/api/v1/meta-reader-credentials/r1/reconnect/start'))
  })

  it('reads the credential state back after "Kiểm lại", with the strongest tone for a dead one', async () => {
    const user = userEvent.setup()
    mockApi()
    apiMock.post.mockResolvedValue(credentialFixture({ status: 'reconnect_required', derived_state: 'reconnect_required' }))
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await user.click(await screen.findByRole('button', { name: 'Kiểm lại' }))
    const note = await screen.findByText(/nay có trạng thái "Cần kết nối lại — không đọc"/)
    expect(note.className).toContain('tone-attention')
  })

  it('never renders a credential value, even if a response carried one by mistake', async () => {
    mockApi([
      [
        /\/meta-reader-credentials$/,
        listFixture({
          items: [
            { ...credentialFixture(), access_token: 'EAAGsecretvalue123', encrypted_secret: 'gAAAAciphertext456' } as MetaReaderCredential,
          ],
        }),
      ],
    ])
    const { container } = wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await screen.findByText('FB Triều')
    expect(container.textContent).not.toMatch(/EAAGsecretvalue123|gAAAAciphertext456|token|secret|ciphertext/i)
  })

  it('tells a non-owner it is owner-only without asking the server', () => {
    wrap(<ReaderCredentialsSection isOwner={false} />, '/settings')
    expect(screen.getByText('Chỉ chủ workspace mới quản lý được kết nối Facebook.')).toBeInTheDocument()
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('reports a failed list with a retry', async () => {
    mockApi([[/\/meta-reader-credentials$/, refusal(500, 'Kho không trả lời')]])
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    expect(await screen.findByText('Không tải được các tài khoản Facebook đã kết nối')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------------- Settings

describe('Settings page', () => {
  it('shows the account, in Vietnamese, with the role as a label', async () => {
    mockApi()
    wrap(<Settings />, '/settings')
    expect(await screen.findByRole('heading', { level: 1, name: 'Cài đặt' })).toBeInTheDocument()
    expect(screen.getByText('owner@example.test')).toBeInTheDocument()
    expect(screen.getByText('Chủ workspace', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Nhóm và chỗ ngồi/ })).toBeInTheDocument()
  })

  it('does not offer Team to a non-owner and says why the policy is read-only', async () => {
    authMock.role = 'viewer'
    mockApi()
    wrap(<Settings />, '/settings')
    expect(await screen.findByText('Chỉ chủ workspace mới đổi được chính sách thông báo.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Nhóm và chỗ ngồi/ })).toBeNull()
  })

  it('does not paint "configured" transports with the success tone, and says not configured as caution', async () => {
    mockApi([['/notification-policies/current', policyFixture({ recipient_configured: false, telegram_chat_id_masked: null })]])
    wrap(<Settings />, '/settings')
    const ok = await screen.findByText('Kênh Telegram: Đã cấu hình')
    expect(ok.className).not.toMatch(SUCCESS)
    expect(screen.getByText('Cuộc trò chuyện nhận: Chưa cấu hình').className).toContain('tone-caution')
  })

  it('reports a failed policy and a failed browser list separately (partial page)', async () => {
    mockApi([
      ['/notification-policies/current', refusal(500, 'Chính sách hỏng')],
      ['/extension/installations', refusal(500, 'Danh sách hỏng')],
    ])
    wrap(<Settings />, '/settings')
    expect(await screen.findByText('Không tải được chính sách thông báo')).toBeInTheDocument()
    expect(screen.getByText('Không tải được danh sách trình duyệt')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeInTheDocument()
  })

  it('saves the policy and then shows what the server returns', async () => {
    const user = userEvent.setup()
    let stored = policyFixture()
    mockApi([['/notification-policies/current', () => stored]])
    apiMock.patch.mockImplementation(async () => {
      stored = policyFixture({ enabled: false })
      return stored
    })
    wrap(<Settings />, '/settings')
    await user.click(await screen.findByRole('checkbox', { name: 'Bật thông báo' }))
    await user.click(screen.getByRole('button', { name: 'Lưu chính sách' }))
    expect(await screen.findByText(/thông báo tắt, giờ yên lặng tắt, múi giờ Asia\/Ho_Chi_Minh/)).toBeInTheDocument()
  })

  it('does not accept a bot token field and never prints one', async () => {
    mockApi()
    const { container } = wrap(<Settings />, '/settings')
    await screen.findByText('Chính sách thông báo')
    expect(container.textContent).toMatch(/Token bot Telegram là cấu hình phía máy chủ/)
    // F1 adds one legitimate field: the *login* password that authorises setting the reveal PIN.
    // Any other password-type input (a bot token, for instance) is still forbidden.
    const passwordInputs = [...container.querySelectorAll('input[type="password"]')]
    expect(passwordInputs.filter((input) => input.getAttribute('autocomplete') !== 'current-password')).toEqual([])
  })

  it('revokes a browser only after an AlertDialog, then reads the list back', async () => {
    const user = userEvent.setup()
    let revoked = false
    mockApi([['/extension/installations', () => [browserFixture(revoked ? { is_active: false, revoked_at: '2026-10-27T02:00:00Z' } : {})]]])
    apiMock.post.mockImplementation(async () => {
      revoked = true
      return {}
    })
    wrap(<Settings />, '/settings')
    // Several "Thu hồi" buttons live on this page; the browser one names its row.
    await user.click(await screen.findByRole('button', { name: 'Thu hồi trình duyệt "Chrome văn phòng"' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(apiMock.post).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Chrome văn phòng')
    expect(dialog).toHaveTextContent('Không hoàn tác được')
    expect(dialog).toHaveTextContent('không đổi gì trên Meta')
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi trình duyệt' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await screen.findByText(/"Chrome văn phòng" nay có trạng thái "Đã thu hồi"/)).toBeInTheDocument()
  })

  it('shows the empty state of connected browsers', async () => {
    mockApi([['/extension/installations', []]])
    wrap(<Settings />, '/settings')
    expect(await screen.findByText('Chưa có trình duyệt nào kết nối tiện ích Chrome với tài khoản này.')).toBeInTheDocument()
  })
})

// --------------------------------------------------------------------- reader labels, i18n

describe('readerSourceLabel and the reader badges follow the language', () => {
  it('returns Vietnamese and English for each source, and null for none', () => {
    expect(readerSourceLabel('vault', 'vi')).toBe('Facebook Login (kho mã hoá)')
    expect(readerSourceLabel('vault', 'en')).toBe('Facebook Login (vault)')
    expect(readerSourceLabel('vault_reconnect_required', 'vi')).toContain('kết nối lại')
    expect(readerSourceLabel('server_default', 'en')).toBe('Server default reader')
    expect(readerSourceLabel('none', 'vi')).toBeNull()
    expect(readerSourceLabel(undefined, 'en')).toBeNull()
  })

  it('shows an unknown source as the code the server sent, not a guess', () => {
    expect(readerSourceLabel('something_new', 'vi')).toBe('something_new')
  })

  it('follows the active language when called without one (SpendTab before this change was English only)', async () => {
    const { setActiveLanguage } = await import('../i18n')
    setActiveLanguage('en')
    expect(readerSourceLabel('vault')).toBe('Facebook Login (vault)')
    setActiveLanguage('vi')
    expect(readerSourceLabel('vault')).toBe('Facebook Login (kho mã hoá)')
  })

  it('never gives a reader the success tone, and the dead one the strongest', () => {
    const sources: ReaderSource[] = ['vault', 'vault_reconnect_required', 'business_specific', 'server_default', 'none']
    for (const source of sources) {
      const { container, unmount } = render(<ReaderSourceBadge source={source} readerLabel="FB" />)
      expect(container.innerHTML).not.toMatch(SUCCESS)
      unmount()
    }
    const { container } = render(<ReaderSourceBadge source="none" />)
    expect(container.innerHTML).toContain('tone-attention')
  })

  it('has a note in both languages for every source that needs one', () => {
    for (const source of ['vault', 'vault_reconnect_required', 'business_specific', 'server_default', 'none'] as const) {
      expect(readerSourceNote(source, 'vi')).toBeTruthy()
      expect(readerSourceNote(source, 'en')).toBeTruthy()
      expect(readerSourceNote(source, 'vi')).not.toBe(readerSourceNote(source, 'en'))
    }
    expect(readerSourceNote('fake', 'vi')).toBeNull()
  })
})

describe('U1f i18n', () => {
  it('has the same keys and placeholders in both languages', () => {
    expect(Object.keys(u1fEn).sort()).toEqual(Object.keys(u1fVi).sort())
    const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(u1fVi) as (keyof typeof u1fVi)[]) {
      expect(tokens(u1fEn[key]), key).toEqual(tokens(u1fVi[key]))
    }
  })

  it('is part of both dictionaries, and Vietnamese is not a copy of English', () => {
    for (const key of Object.keys(u1fVi) as (keyof typeof u1fVi)[]) {
      expect(viDict[key]).toBe(u1fVi[key])
      expect(enDict[key]).toBe(u1fEn[key])
    }
    // Product names and "label: {value}" templates are the same in both languages; sentences are not.
    const TEMPLATES = new Set(['disc.bm', 'ws.bm', 'import.object', 'rc.connectDialog.object'])
    const same = (Object.keys(u1fVi) as (keyof typeof u1fVi)[]).filter(
      (key) => !TEMPLATES.has(key) && u1fVi[key] === u1fEn[key] && u1fVi[key].split(' ').length > 2,
    )
    expect(same).toEqual([])
  })

  it('adds no key that the base dictionaries or O4 already define (a spread silently overrides one)', () => {
    // Found while building U1f: `runStatus.succeeded` already meant "Hoàn tất" for operations runs,
    // and the later definition won without any compiler complaint.
    const defined = (file: string) =>
      new Set([...readFileSync(join(process.cwd(), 'src/i18n', file), 'utf8').matchAll(/^ {2}'([\w.-]+)':/gm)].map((m) => m[1]))
    for (const file of ['vi.ts', 'en.ts', 'o4.ts']) {
      const base = defined(file)
      expect(Object.keys(u1fVi).filter((key) => base.has(key)), file).toEqual([])
    }
  })

  it('every key used by the U1f files exists', () => {
    const files = [
      'pages/MetaConnections.tsx',
      'pages/MetaConnectionWorkspace.tsx',
      'pages/Settings.tsx',
      'pages/meta-connection/HistoryTab.tsx',
      'components/meta/AssetInventory.tsx',
      'components/meta/AutomationControls.tsx',
      'components/meta/ConnectionReaderSwitch.tsx',
      'components/meta/DiscoveryOverview.tsx',
      'components/meta/DiscoverySection.tsx',
      'components/meta/ImportConfirmDialog.tsx',
      'components/meta/ReaderCredentialsSection.tsx',
      'components/meta/ReaderSource.tsx',
      'components/meta/confirm.tsx',
      'components/meta/useImportAccount.ts',
    ]
    const missing: string[] = []
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')
      for (const match of source.matchAll(/\bt\('([\w.-]+)'/g)) {
        if (!(match[1] in viDict)) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('no U1f source file uses window.confirm, the old ui.tsx or a raw palette class', () => {
    const files = [
      'pages/MetaConnections.tsx',
      'pages/MetaConnectionWorkspace.tsx',
      'pages/Settings.tsx',
      'pages/meta-connection/HistoryTab.tsx',
      'components/meta/AssetInventory.tsx',
      'components/meta/AutomationControls.tsx',
      'components/meta/ConnectionReaderSwitch.tsx',
      'components/meta/CredentialCheckStatus.tsx',
      'components/meta/DiscoveryOverview.tsx',
      'components/meta/DiscoverySection.tsx',
      'components/meta/NotObservableReason.tsx',
      'components/meta/ReaderCredentialsSection.tsx',
      'components/meta/ReaderSource.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')
      expect(source, file).not.toMatch(/window\.confirm|\bconfirm\(/)
      expect(source, file).not.toMatch(/from '(\.\.\/)+(components\/)?ui'/)
    }
  })
})

// ------------------------------------------------------------------------------------- axe

describe('accessibility (axe, colour-contrast off because jsdom has no layout)', () => {
  const options = { rules: { 'color-contrast': { enabled: false } } }

  it('the connections list has no violations', async () => {
    mockApi([[/\/discoveries\/latest$/, runFixture()]])
    const { container } = mountConnections()
    await screen.findByText('Tbsupellex')
    expect((await axe(container, options)).violations).toEqual([])
  })

  it('the connections list in its empty state has no violations', async () => {
    mockApi([[/\/meta-connections$/, []]])
    const { container } = mountConnections()
    await screen.findByText('Chưa có kết nối Meta nào')
    expect((await axe(container, options)).violations).toEqual([])
  })

  it.each(['', '?tab=ad-accounts', '?tab=pixels', '?tab=history'])('the workspace %s has no violations', async (query) => {
    mockApi([[/\/discoveries\/latest$/, runFixture()]])
    const { container } = mountWorkspace(`/meta-connections/c1${query}`)
    await screen.findByRole('tab', { selected: true })
    await waitFor(() => expect(screen.queryAllByRole('status', { name: 'Đang tải…' })).toHaveLength(0))
    expect((await axe(container, options)).violations).toEqual([])
  })

  it('Settings has no violations', async () => {
    mockApi()
    const { container } = wrap(<Settings />, '/settings')
    await screen.findByText('FB Triều')
    await screen.findByText('Chrome văn phòng')
    await waitFor(() => expect(screen.queryAllByRole('status', { name: 'Đang tải…' })).toHaveLength(0))
    expect((await axe(container, options)).violations).toEqual([])
  })

  it('the revoke AlertDialog has no violations', async () => {
    const user = userEvent.setup()
    mockApi()
    wrap(<ReaderCredentialsSection isOwner />, '/settings')
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect((await axe(dialog, options)).violations).toEqual([])
  })

  it('the import AlertDialog has no violations', async () => {
    const user = userEvent.setup()
    mockApi([[/\/discoveries\/latest$/, runFixture()]])
    mountConnections()
    await user.click(await screen.findByRole('button', { name: 'Thêm vào sổ đăng ký' }))
    const dialog = await screen.findByRole('alertdialog')
    expect((await axe(dialog, options)).violations).toEqual([])
  })

  it('the empty Discovery overview has no violations', async () => {
    mockApi([['/discovery-summary', []]])
    const { container } = wrap(<DiscoveryOverview isOwner />)
    await screen.findByText('Chưa có kết nối Meta để đọc')
    expect((await axe(container, options)).violations).toEqual([])
  })
})
