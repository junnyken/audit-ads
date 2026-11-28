import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AutomationCronSection } from '../pages/Settings'
import { readSyncEn } from '../i18n/readSync'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))
vi.mock('../i18n', () => ({ useI18n: () => ({ language: 'en', t: (key: string) => readSyncEn[key as keyof typeof readSyncEn] ?? key }) }))
const copy = (key: keyof typeof readSyncEn) => readSyncEn[key]
const status = (extra = {}) => ({ auto_meta_sync_enabled: false, sync_interval_minutes: 60,
  last_run_at: null, last_sync_at: null, next_sync_at: null, last_run_summary: null, ...extra })
const clients: QueryClient[] = []
function setup(owner = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><AutomationCronSection isOwner={owner} /></QueryClientProvider>)
}
const save = () => screen.getByRole('button', { name: copy('readSync.save') })
const run = () => screen.getByRole('button', { name: copy('readSync.run') })
async function ready() { await waitFor(() => expect(run()).toBeEnabled()) }
beforeEach(() => { mocks.get.mockResolvedValue(status()); mocks.post.mockResolvedValue({}) })
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.resetAllMocks() })

describe('read-only sync settings', () => {
  it('starts unchecked and makes no change before GET succeeds', async () => {
    let resolve!: (value: unknown) => void
    mocks.get.mockReturnValue(new Promise(r => { resolve = r }))
    setup()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(save()).toBeDisabled(); expect(run()).toBeDisabled()
    fireEvent.click(run()); expect(mocks.post).not.toHaveBeenCalled()
    resolve(status()); await ready()
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('shows a safe load error and blocks actions without leaking errors', async () => {
    mocks.get.mockRejectedValue(new Error('private-token-error'))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent(copy('readSync.loadError'))
    expect(document.body.textContent).not.toContain('private-token-error')
    expect(run()).toBeDisabled(); expect(save()).toBeDisabled()
    expect(screen.getByRole('button', { name: copy('readSync.retry') })).toBeEnabled()
  })
  it('blocks malformed config and retains an explicit error instead of empty state', async () => {
    mocks.get.mockResolvedValue({})
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent(copy('readSync.loadError'))
    expect(run()).toBeDisabled(); expect(save()).toBeDisabled()
  })
  it('disables all writes for buyers', async () => {
    setup(false)
    await screen.findByText(copy('readSync.off'))
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    expect(run()).toBeDisabled(); expect(save()).toBeDisabled()
    fireEvent.click(run()); fireEvent.click(save())
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it.each(['', '14', '721', '15.5'])('rejects invalid interval %s without a POST', async value => {
    setup(); await ready()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value } })
    expect(save()).toBeDisabled(); fireEvent.click(save())
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it.each([15, 720])('sends only the explicit config and verifies GET readback at %s minutes', async minutes => {
    setup(); await ready()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(minutes) } })
    mocks.get.mockResolvedValue(status({ auto_meta_sync_enabled: true, sync_interval_minutes: minutes }))
    fireEvent.click(save())
    await screen.findByText(copy('readSync.saved'))
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/automation-cron/config', {
      auto_meta_sync_enabled: true, sync_interval_minutes: minutes,
    })
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })
  it('waits for config readback and blocks actions while it is pending', async () => {
    setup(); await ready()
    let resolve!: (value: unknown) => void
    mocks.get.mockReturnValue(new Promise(r => { resolve = r }))
    fireEvent.click(save())
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(copy('readSync.saved'))).not.toBeInTheDocument()
    expect(run()).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    resolve(status())
    await screen.findByText(copy('readSync.saved'))
  })
  it('does not announce saved configuration from POST alone', async () => {
    setup(); await ready()
    fireEvent.click(screen.getByRole('checkbox'))
    mocks.post.mockResolvedValue(status({ auto_meta_sync_enabled: true }))
    fireEvent.click(save())
    await screen.findByText(copy('readSync.saveError'))
    expect(screen.queryByText(copy('readSync.saved'))).not.toBeInTheDocument()
    expect(run()).toBeDisabled()
  })
  it('does not announce save success when readback fails', async () => {
    setup(); await ready()
    mocks.get.mockRejectedValue(new Error('secret readback'))
    fireEvent.click(save())
    await screen.findByText(copy('readSync.saveError'))
    expect(document.body.textContent).not.toContain('secret readback')
    expect(run()).toBeDisabled()
  })
  it.each(['succeeded', 'ok', 'partial', 'error', 'skipped_no_token', 'not_due', 'license_read_only', 'private-provider-error'])('labels actual status %s safely, never deriving success from attempted', async sync_status => {
    mocks.post.mockResolvedValue({ run_summary: { sync_executed: true, sync_status, parts: { secret: 'token' }, raw_error: 'private details' } })
    setup(); await ready(); fireEvent.click(run())
    const notice = await screen.findByRole('status')
    const key = sync_status === 'private-provider-error' ? 'readSync.resultUnknown' : `readSync.${sync_status === 'succeeded' ? 'ok' : sync_status}` as keyof typeof readSyncEn
    expect(notice).toHaveTextContent(copy(key))
    if (!['succeeded','ok'].includes(sync_status)) expect(notice).not.toHaveTextContent(copy('readSync.ok'))
    expect(document.body.textContent).not.toContain('private details')
    expect(document.body.textContent).not.toContain('private-provider-error')
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/automation-cron/run-now', { sync: true, warmup: false })
  })
  it('handles missing result, invalid dates and unknown counts without inventing success', async () => {
    mocks.get.mockResolvedValue(status({ last_run_at: 'invalid', last_sync_at: 'invalid', last_run_summary: { sync_executed: true } }))
    setup(); await ready(); fireEvent.click(run())
    expect(await screen.findByRole('status')).toHaveTextContent(copy('readSync.resultUnknown'))
    expect(screen.getByText(copy('readSync.attempt'))).toBeInTheDocument()
    expect(screen.getByText(copy('readSync.success'))).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN|undefined|0 posts/)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })
  it('shows a generic run error and requires reload after failed POST', async () => {
    mocks.post.mockRejectedValue(new Error('private provider exception'))
    setup(); await ready(); fireEvent.click(run())
    await screen.findByText(copy('readSync.runError'))
    expect(document.body.textContent).not.toContain('private provider exception')
    expect(run()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: copy('readSync.retry') }))
    await ready()
  })
})
