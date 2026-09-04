import { beforeEach, describe, expect, it } from 'vitest'
import { installChromeStub } from './setup'
import {
  CONTEXT_TTL_MS,
  clearConnection,
  readCachedContext,
  readConnection,
  readSettings,
  writeCachedContext,
  writeConnection,
} from '../src/shared/storage'

describe('extension storage', () => {
  beforeEach(() => {
    installChromeStub()
  })

  it('keeps the session in the in-memory session area, not local storage', async () => {
    const { local, session } = installChromeStub()
    await writeConnection({
      accessToken: 'ext-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      installationId: 'inst-1',
      workspaceName: 'Matbao AdsOps',
      userEmail: 'operator@example.com',
    })
    expect(JSON.stringify([...session.data.values()])).toContain('ext-token')
    expect(JSON.stringify([...local.data.values()])).not.toContain('ext-token')
  })

  it('treats an expired session as no session, and clears it', async () => {
    const { session } = installChromeStub()
    await writeConnection({
      accessToken: 'stale',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      installationId: 'inst-1',
      workspaceName: 'W',
      userEmail: 'e@example.com',
    })
    expect(await readConnection()).toBeNull()
    expect(JSON.stringify([...session.data.values()])).not.toContain('stale')
  })

  it('forgets the session on disconnect', async () => {
    await writeConnection({
      accessToken: 'x',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      installationId: 'i',
      workspaceName: 'W',
      userEmail: 'e@example.com',
    })
    await clearConnection()
    expect(await readConnection()).toBeNull()
  })

  it('generates one stable instance id per browser profile', async () => {
    installChromeStub()
    const first = await readSettings()
    const second = await readSettings()
    expect(first.instanceId).toMatch(/^[0-9a-f]{32}$/)
    expect(second.instanceId).toBe(first.instanceId)
  })

  it('never stores a password anywhere', async () => {
    const { local, session } = installChromeStub()
    await readSettings()
    const everything = JSON.stringify([...local.data.values(), ...session.data.values()])
    expect(everything.toLowerCase()).not.toContain('password')
  })

  it('caches a resolved context per tab, keyed by what was observed', async () => {
    installChromeStub()
    const resolution = { context_status: 'confirmed' as const, reason_code: null, message: null, page_type: 'campaign' as const, safe_path: '/adsmanager/manage/campaigns' }
    await writeCachedContext(7, 'key-a', resolution)
    expect(await readCachedContext(7, 'key-a')).toEqual(resolution)
    // A different page in the same tab must not read the previous account's context.
    expect(await readCachedContext(7, 'key-b')).toBeNull()
    // Nor may another tab.
    expect(await readCachedContext(8, 'key-a')).toBeNull()
  })

  it('caches briefly enough that a stale account state cannot linger', () => {
    expect(CONTEXT_TTL_MS).toBeLessThanOrEqual(60_000)
  })
})
