import { beforeEach, expect, it, vi } from 'vitest'
import { installChromeStub } from './setup'
import { allowedRequest } from '../src/background/request-guard'
import { apiRequest } from '../src/background/api-client'
import { normalizeDashboardOrigin } from '../src/shared/validation'
import { readConnection, writeConnection, writeSettings } from '../src/shared/storage'
import { disconnect, withSession, connect } from '../src/background/auth-session'

beforeEach(() => { installChromeStub(); vi.restoreAllMocks() })
const ui = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html') })
const connection = () => ({ origin: 'https://old.example', accessToken: 'extension-test', expiresAt: new Date(Date.now() + 60000).toISOString(), installationId: 'i', workspaceName: 'W', userEmail: 'e' })
it('normalizes origins and rejects credentials, paths, fragments, queries and insecure hosts', () => {
  expect(normalizeDashboardOrigin('https://EXAMPLE.com:443/')).toBe('https://example.com')
  for (const url of ['https://u:p@example.com', 'https://example.com/api', 'https://example.com/?x', 'https://example.com/#x', 'http://example.com', 'https://example.com\\evil', '//example.com']) expect(() => normalizeDashboardOrigin(url)).toThrow()
})
it('clears legacy, mismatched and invalid expiry sessions and caches', async () => {
  for (const patch of [{ origin: undefined }, { origin: 'https://other.example' }, { expiresAt: 'invalid' }]) {
    const { session } = installChromeStub()
    await writeSettings({ dashboardUrl: 'https://old.example' })
    session.data.set('adsops.connection', { ...connection(), ...patch })
    session.data.set('adsops.context.1', { stale: true })
    expect(await readConnection()).toBeNull()
    expect(session.data.size).toBe(0)
  }
})
it('changing settings clears session/cache and never reuses a bearer on the new origin', async () => {
  const { session } = installChromeStub()
  await writeSettings({ dashboardUrl: 'https://old.example' })
  await writeConnection(connection())
  session.data.set('adsops.context.1', {})
  await writeSettings({ dashboardUrl: 'https://new.example' })
  const run = vi.fn()
  await expect(withSession(run)).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
  expect(session.data.size).toBe(0)
})
it('revokes only at the bound origin and clears even on failure', async () => {
  await writeSettings({ dashboardUrl: 'https://old.example' })
  await writeConnection(connection())
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  await disconnect('test')
  expect(fetcher.mock.calls[0][0]).toBe('https://old.example/api/v1/extension/installations/revoke')
  expect(await readConnection()).toBeNull()
})
it('rejects path confusion before fetch and disables redirects for credentials', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('redirect'))
  for (const path of ['//evil/api/v1/x', '/api/v1//evil', '/api/v1/../auth', '/api/v1/%2e%2e/x', '/api/v1/x?next=evil', '/api/v1/x\\y']) await expect(apiRequest('https://old.example', path)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
  await expect(apiRequest('https://old.example', '/api/v1/extension/connect', { token: 'test' })).rejects.toThrow('redirect')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
})
it('keeps password transient and binds newly exchanged sessions', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'login-only' }))).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'extension-test', expires_at: connection().expiresAt, installation_id: 'i', workspace_name: 'W', user_email: 'e' })))
  const { local, session } = installChromeStub()
  await connect({ dashboardUrl: 'https://OLD.example/', email: 'e', password: 'transient-test', label: '' })
  expect((await readConnection())?.origin).toBe('https://old.example')
  const saved = JSON.stringify([...local.data, ...session.data])
  expect(saved).not.toContain('transient-test')
  expect(saved).not.toContain('login-only')
})
it('validates every message schema and exact extension page provenance', () => {
  for (const request of [null, [], {}, { kind: 'constructor' }, { kind: 'getConnection', extra: true }, { kind: 'connect' }, { kind: 'getContext', tabId: -1 }, { kind: 'recordEvent', adAccountId: 'a', eventType: 'arbitrary', note: '' }, { kind: 'setDashboardUrl', dashboardUrl: 'https://u:p@host' }]) expect(allowedRequest(request, ui())).toBe(false)
  for (const sender of [{}, { ...ui(), id: 'other' }, { ...ui(), url: 'https://business.facebook.com/settings' }, { ...ui(), url: chrome.runtime.getURL('options/options.html?x') }, { ...ui(), frameId: 1 }]) expect(allowedRequest({ kind: 'getConnection' }, sender)).toBe(false)
  for (const path of ['options/options.html', 'popup/popup.html', 'sidepanel/sidepanel.html']) expect(allowedRequest({ kind: 'getConnection' }, { ...ui(), url: chrome.runtime.getURL(path) })).toBe(true)
})
it('accepts only detector-matching observations from known Meta routes and top-frame tabs', () => {
  const sender = { id: chrome.runtime.id, url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123', frameId: 0, tab: { id: 7 } as chrome.tabs.Tab }
  const request = { kind: 'observation', observation: { externalAccountId: '123', safePath: '/adsmanager/manage/campaigns', pageType: 'campaign', displayName: null } }
  expect(allowedRequest(request, sender)).toBe(true)
  for (const change of [{ id: 'other' }, { frameId: 2 }, { tab: undefined }, { url: 'https://evil.example/adsmanager/manage/campaigns?act=123' }, { url: 'https://www.facebook.com/settings?act=123' }]) expect(allowedRequest(request, { ...sender, ...change })).toBe(false)
  expect(allowedRequest({ ...request, observation: { ...request.observation, externalAccountId: '456' } }, sender)).toBe(false)
  expect(allowedRequest({ kind: 'disconnect', reason: 'x' }, sender)).toBe(false)
})
it('worker rejects malformed messages without side effects using the Chrome listener mock', async () => {
  const { listeners, local } = installChromeStub()
  await import('../src/background/service-worker')
  const reply = vi.fn()
  listeners[0](null, ui(), reply)
  expect(reply).toHaveBeenCalledWith({ ok: false, error: 'Invalid request.' })
  expect(local.set).not.toHaveBeenCalled()
})
