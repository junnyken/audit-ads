import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BusinessUsersSection } from '../components/meta/BusinessUsersSection'
import { api } from '../lib/api'
import type { DiscoveryBusinessUsersResult } from '../lib/types'

const sampleResult: DiscoveryBusinessUsersResult = {
  coverage_status: 'complete',
  complete: true,
  required_edges: ['business_users'],
  coverage: {
    total_unique_assets: 3,
    edges: {
      business_users: {
        required: true,
        status: 'completed',
        pages: 1,
        items: 3,
        error_code: null,
      },
    },
  },
  reconciliation: [
    {
      external_user_id: 'bu_01',
      display_name: 'Minh Nguyen',
      role: 'ADMIN',
      status: 'unlinked',
      is_admin_drift: true,
      source_edge: 'business_users',
      detail: 'Chưa xác nhận nối với hồ sơ Facebook nội bộ.',
      linked_identity: null,
      suggested_identity: {
        id: 'fb-profile-1',
        label: 'FB1 — Minh giữ',
        owner_member_name: 'Minh Nguyen',
        match_reason: 'name_match',
      },
    },
    {
      external_user_id: 'bu_02',
      display_name: 'Lan Tran',
      role: 'EMPLOYEE',
      status: 'linked',
      is_admin_drift: false,
      source_edge: 'business_users',
      detail: 'Đã xác nhận nối với hồ sơ Facebook nội bộ.',
      linked_identity: {
        id: 'fb-profile-2',
        label: 'FB2 — Lan giữ',
        owner_member_name: 'Lan Tran',
        two_factor_method: 'app',
        link_id: 'link-2',
        recorded_role: 'employee',
      },
      suggested_identity: null,
    },
    {
      external_user_id: 'bu_03_removed',
      display_name: 'FB0 — Admin cũ',
      role: 'ADMIN',
      status: 'missing_from_latest_discovery',
      is_admin_drift: true,
      source_edge: 'business_users',
      detail: 'Quản trị viên (ADMIN) đã xác nhận nối nhưng không còn trong lần quét đầy đủ mới nhất.',
      linked_identity: null,
      suggested_identity: null,
    },
  ],
}

describe('F3 BusinessUsersSection', () => {
  it('renders linked, unlinked with suggested profile, and removed admin rows and confirms suggested link in 1 click', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      items: [
        { id: 'fb-profile-1', label: 'FB1 — Minh giữ' },
        { id: 'fb-profile-2', label: 'FB2 — Lan giữ' },
      ],
      total: 2,
      page: 1,
      page_size: 100,
    })
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      link_id: 'link-1',
      role: 'admin',
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <BusinessUsersSection
            connectionId="conn-123"
            runId="run-456"
            result={sampleResult}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Minh Nguyen')).toBeInTheDocument()
    expect(screen.getByText('Lan Tran')).toBeInTheDocument()
    expect(screen.getByText('FB0 — Admin cũ')).toBeInTheDocument()
    expect(screen.getByText(/FB1 — Minh giữ/)).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: /Xác nhận nối|Confirm link/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/meta-connections/conn-123/discoveries/run-456/business-user-links',
        {
          external_user_id: 'bu_01',
          personal_account_reference_id: 'fb-profile-1',
        },
      )
    })
  })
})
