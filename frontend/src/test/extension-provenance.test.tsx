import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ChromeExtension from '../pages/ChromeExtension'
import { extensionProvenanceEn } from '../i18n/extensionProvenance'
import { rawSnapshotValue, safeStoredNetworkReference } from '../lib/extensionProvenance'
const mocks = vi.hoisted(() => ({ get: vi.fn(), profiles: vi.fn(), launch: vi.fn(), bundle: vi.fn() }))
vi.mock('../lib/api', () => ({ api: { get: mocks.get } }))
vi.mock('../lib/chromeProfileLauncher', () => ({ fetchRealLocalChromeProfiles: mocks.profiles, launchInAssignedChromeProfile: mocks.launch, downloadChromeExtensionZip: mocks.bundle }))
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: keyof typeof extensionProvenanceEn, vars?: Record<string, string | number>) => {
  let value: string = extensionProvenanceEn[key]
  for (const [name, replacement] of Object.entries(vars ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
} }) }))
const references = [{ id: 'selected', label: 'Same label', network_label: 'VNPT Static IP — Line #42', vault_reference: 'JBSWY3DPEHPK3PXP' }]
const accounts = [
  { id: 'exact', display_name: 'Exact account', facebook_identities: [{ id: 'selected', label: 'Different label' }], billing_meta: { payment_card_display: 'Visa •••• 4242' }, status: 'new-api-status' },
  { id: 'direct', display_name: 'Direct account', personal_account_reference_id: 'selected', billing_meta: { balance_raw: '12.30' }, currency: 'USD', status: 'active', last_synced_at: '2026-11-26T12:00:00Z' },
  { id: 'wrong', display_name: 'Wrong account', facebook_identities: [{ id: 'other', label: 'Same label' }], currency: 'VND', billing_meta: { balance_raw: '999' } },
]
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><ChromeExtension /></QueryClientProvider>)
}
async function select() {
  await waitFor(() => expect(screen.getByLabelText('Personal account reference')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Personal account reference'), { target: { value: 'selected' } })
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.profiles.mockResolvedValue([])
  mocks.get.mockImplementation((url: string) => Promise.resolve({ items: url.includes('personal-account') ? references : accounts, total: 900, total_pages: 5 }))
})
it('requires selection and exact IDs, preserving raw money, masked payment and timestamps', async () => {
  mount()
  await waitFor(() => expect(screen.getByLabelText('Personal account reference')).not.toBeDisabled())
  expect(screen.queryByText('Exact account')).not.toBeInTheDocument()
  await select()
  expect(await screen.findByText('Exact account')).toBeInTheDocument()
  expect(screen.getByText('Direct account')).toBeInTheDocument()
  expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
  for (const value of ['12.30', 'Visa •••• 4242', '2026-11-26T12:00:00Z']) expect(screen.getByText(value)).toBeInTheDocument()
  expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1)
  expect(screen.getByText(/VNPT Static IP — Line #42/)).toBeInTheDocument()
  expect(screen.getByText(/first page only/)).toBeInTheDocument()
  expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(mocks.launch).not.toHaveBeenCalled()
  expect(mocks.bundle).not.toHaveBeenCalled()
})
it('distinguishes errors from empty results', async () => {
  mocks.get.mockImplementation((url: string) => url.includes('ad-accounts') ? Promise.reject(new Error('offline')) : Promise.resolve({ items: references }))
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('API request failed')
  expect(screen.queryByText(/Matching rows/)).not.toBeInTheDocument()
  expect(screen.queryByText(/No exact ID matches/)).not.toBeInTheDocument()
})
it('does not substitute accounts when none match', async () => {
  mocks.get.mockImplementation((url: string) => Promise.resolve({ items: url.includes('personal-account') ? references : [accounts[2]] }))
  mount()
  await select()
  expect(await screen.findByText('No exact ID matches in the loaded account page.')).toBeInTheDocument()
  expect(screen.queryByText('Wrong account')).not.toBeInTheDocument()
})
it('never invents a default profile or enables a bundle with a disconnected bridge', async () => {
  mocks.profiles.mockRejectedValue(new Error('disconnected'))
  mount()
  expect(await screen.findByText(/No default profile is assumed/)).toBeInTheDocument()
  expect(screen.getByLabelText('Observed local Chrome profiles')).toHaveValue('')
  expect(screen.getByLabelText('Observed local Chrome profiles')).toBeDisabled()
  expect(screen.queryByRole('option', { name: 'Default' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Custom bundle unavailable' })).toBeDisabled()
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://business.facebook.com/overview')
})
it('does not auto-select an observed profile or launch it', async () => {
  mocks.profiles.mockResolvedValue([{ folder: 'Default', name: 'Observed profile' }])
  mount()
  await screen.findByRole('option', { name: 'Observed profile' })
  expect(screen.getByLabelText('Observed local Chrome profiles')).toHaveValue('')
  expect(mocks.launch).not.toHaveBeenCalled()
})
it('keeps unknown amounts unknown and withholds network authentication', () => {
  expect(rawSnapshotValue(null, 'Unknown')).toBe('Unknown')
  expect(rawSnapshotValue('0', 'Unknown')).toBe('0')
  expect(rawSnapshotValue('raw', 'Unknown')).toBe('raw')
  expect(safeStoredNetworkReference('http://user:password@host:8000')).toBe('withheld')
  expect(safeStoredNetworkReference('host:8000:user:password')).toBe('withheld')
})
