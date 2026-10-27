import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReaderCredentialsSection } from '../components/meta/ReaderCredentialsSection'
import { ReaderSourceBadge, readerSourceNote } from '../components/meta/ReaderSource'
import { NotObservableReason } from '../components/meta/NotObservableReason'
import { ConnectionReaderSwitch } from '../components/meta/ConnectionReaderSwitch'
import { READER_STATE_TONE, readCallbackParams, readerReasonText, readerSourceLabel } from '../lib/metaReaders'
import { translate } from '../i18n'
import type { MetaConnection, MetaReaderCredential, MetaReaderCredentialList, ReaderSource } from '../lib/types'

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('vi', key, vars)

function wrap(node: ReactNode, path = '/settings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubFetch(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status })))
}

afterEach(() => vi.unstubAllGlobals())

function credential(over: Partial<MetaReaderCredential> = {}): MetaReaderCredential {
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

function listing(over: Partial<MetaReaderCredentialList> = {}): MetaReaderCredentialList {
  return {
    configured: true,
    unavailable_reason: null,
    config_kind: 'system_user',
    business_manager_required: true,
    items: [credential()],
    ...over,
  }
}

describe('credential state tones', () => {
  it('never paints a credential with success styling, and a dead one with the strongest tone', () => {
    expect(READER_STATE_TONE.active).not.toBe('positive')
    expect(Object.values(READER_STATE_TONE)).not.toContain('positive')
    expect(READER_STATE_TONE.reconnect_required).toBe('attention')
    expect(READER_STATE_TONE.expiring).toBe('caution')
  })
})

describe('the reader badge with the vault', () => {
  it('names the vault credential by its label, not as a positive state', () => {
    render(<ReaderSourceBadge source="vault" readerLabel="FB Triều" />)
    const badge = screen.getByText(t('readerSource.vault', { label: 'FB Triều' }))
    expect(badge.className).not.toContain('tone-positive')
  })

  it('says nothing is read when the credential needs reconnecting', () => {
    render(<ReaderSourceBadge source="vault_reconnect_required" />)
    const badge = screen.getByText(t('readerSource.vaultReconnect'))
    expect(badge.className).toContain('tone-attention')
    expect(readerSourceNote('vault_reconnect_required')).toContain('không đổi sang danh tính khác')
  })

  it('has an answer for all six reader sources', () => {
    const sources: ReaderSource[] = ['vault', 'vault_reconnect_required', 'business_specific', 'server_default', 'none', 'fake']
    for (const source of sources) {
      const { container, unmount } = render(<ReaderSourceBadge source={source} />)
      if (source === 'fake') expect(container.textContent).toBe('')
      else expect(container.textContent).not.toBe('')
      unmount()
    }
    expect(readerSourceLabel('vault_reconnect_required', 'en')).toContain('reconnecting')
    expect(readerSourceLabel('vault_reconnect_required', 'vi')).toContain('kết nối lại')
    expect(readerSourceLabel('none')).toBeNull()
  })
})

describe('the Settings section', () => {
  it('lists a credential with its metadata and never a token-shaped field', async () => {
    stubFetch(listing())
    const { container } = wrap(<ReaderCredentialsSection isOwner />)
    expect(await screen.findByText('FB Triều')).toBeInTheDocument()
    expect(screen.getByText(t('metaReader.state.active'))).toBeInTheDocument()
    expect(screen.getByText(t('metaReader.neverExpires'))).toBeInTheDocument()
    expect(screen.getByText('ads_read, business_management')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/token|secret|ciphertext/i)
  })

  it('shows the empty state and the before-you-start steps', async () => {
    stubFetch(listing({ items: [] }))
    wrap(<ReaderCredentialsSection isOwner />)
    expect(await screen.findByText(t('metaReader.empty'))).toBeInTheDocument()
    expect(screen.getByText(t('metaReader.beforeStep2'))).toBeInTheDocument()
  })

  it('disables Connect with the reason when the server is not configured', async () => {
    stubFetch(listing({ configured: false, unavailable_reason: 'not_configured', items: [] }))
    wrap(<ReaderCredentialsSection isOwner />)
    expect(await screen.findByText(t('metaReader.notConfigured'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('metaReader.connect') })).toBeDisabled()
  })

  it('shows a dead credential with its reason and offers Reconnect, not Check again', async () => {
    stubFetch(
      listing({
        items: [credential({ status: 'reconnect_required', derived_state: 'reconnect_required', reconnect_reason: 'password_changed' })],
      }),
    )
    wrap(<ReaderCredentialsSection isOwner />)
    expect(await screen.findByText(t('metaReader.state.reconnect_required'))).toBeInTheDocument()
    expect(screen.getByText(t('metaReader.reasonText.password_changed'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('metaReader.verify') })).toBeDisabled()
    expect(screen.getByRole('button', { name: t('metaReader.reconnect') })).toBeEnabled()
  })

  it('reads the callback outcome from the URL', async () => {
    stubFetch(listing())
    wrap(<ReaderCredentialsSection isOwner />, '/settings?meta_login=error&reason=scope_too_broad')
    expect(
      await screen.findByText(
        t('metaReader.callback.error', { reason: t('metaReader.reasonText.scope_too_broad') }),
      ),
    ).toBeInTheDocument()
  })

  it('shows an error state when the list fails', async () => {
    stubFetch({ error: { code: 'x', message: 'Broken' } }, 500)
    wrap(<ReaderCredentialsSection isOwner />)
    expect(await screen.findByText(/Broken/)).toBeInTheDocument()
  })

  it('tells a non-owner it is owner-only and makes no request', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    wrap(<ReaderCredentialsSection isOwner={false} />)
    expect(screen.getByText(t('metaReader.notOwner'))).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('reasons and helpers', () => {
  it('shows an unknown code as a code, never as a known reason', () => {
    expect(readerReasonText(t, 'something_new')).toContain('something_new')
    expect(readCallbackParams('?meta_login=ok')).toEqual({ outcome: 'ok', reason: null })
    expect(readCallbackParams('?meta_login=maybe')).toBeNull()
  })

  it('explains why an account is not observable', () => {
    render(<NotObservableReason reason="reader_reconnect_required" />)
    expect(screen.getByText(t('notObservable.reader_reconnect_required'))).toBeInTheDocument()
    const { container } = render(<NotObservableReason reason={null} />)
    expect(container.textContent).toBe('')
  })

  it('offers another credential as an explicit switch only', () => {
    const connection = {
      id: 'c1',
      other_readers: [{ id: 'r2', label: 'FB Hằng', kind: 'system_user' }],
    } as unknown as MetaConnection
    wrap(<ConnectionReaderSwitch connection={connection} />)
    expect(screen.getByRole('button', { name: t('readerSource.useThis', { label: 'FB Hằng' }) })).toBeInTheDocument()
  })
})
