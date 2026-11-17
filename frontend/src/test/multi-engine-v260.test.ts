import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExtensionFilesForVia,
  canMemberLaunchVia,
  getAntidetectEngineLabel,
  parseAntidetectFromNotes,
  probeLocalDesktopBridge,
  resetLocalBridgePortCache,
  resolveLocalBridgeBaseUrl,
} from '../lib/chromeProfileLauncher'

afterEach(() => {
  resetLocalBridgePortCache()
  vi.restoreAllMocks()
})

describe('v2.6.0 Multi-Engine Antidetect Hub & Team Launch RBAC', () => {
  it('parses [ADENG] and [ADID] tags cleanly and resolves engine display names', () => {
    const parsed = parseAntidetectFromNotes('[TIER:camp] [ADENG:dolphin_anty] [ADID:prof-8899] Via Spa')
    expect(parsed.engine).toBe('dolphin_anty')
    expect(parsed.profileId).toBe('prof-8899')
    expect(parsed.cleanNotes).toBe('[TIER:camp] Via Spa')
    expect(getAntidetectEngineLabel('adspower')).toBe('AdsPower')
    expect(getAntidetectEngineLabel('hidemyacc')).toBe('Hidemyacc')
    expect(getAntidetectEngineLabel('genlogin')).toBe('Genlogin')
    expect(getAntidetectEngineLabel('gologin')).toBe('GoLogin')
  })

  it('enforces team assignee RBAC before launching another buyer Via profile', () => {
    expect(canMemberLaunchVia('viewer', 'm1', '').allowed).toBe(false)
    expect(canMemberLaunchVia('auditor', 'm1', '').allowed).toBe(false)
    expect(canMemberLaunchVia('buyer', 'm2', 'm1').allowed).toBe(false)
    expect(canMemberLaunchVia('buyer', 'm1', 'm1').allowed).toBe(true)
    expect(canMemberLaunchVia('owner', 'm-owner', 'm1').allowed).toBe(true)
    expect(canMemberLaunchVia('admin', 'm-admin', 'm1').allowed).toBe(true)
  })

  it('generates v2.9.9 manifest metadata cleanly', () => {
    const files = buildExtensionFilesForVia('AdsOps', 'Via Test', 'Profile 1', '')
    const manifest = JSON.parse(files.find((f) => f.name.endsWith('/manifest.json'))!.content) as { version: string }
    expect(manifest.version).toBe('2.9.9')
  })

  it('auto-discovers AdsOpsDesktop on fallback port 17891 when 17890 is occupied by another app', async () => {
    resetLocalBridgePortCache()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://127.0.0.1:17890/health') {
        return new Response('Not Found', { status: 404 })
      }
      if (url === 'http://127.0.0.1:17891/health') {
        return new Response(
          JSON.stringify({
            ok: true,
            app: 'AdsOpsDesktop',
            version: '2.6.0',
            extVersion: '2.9.8',
            port: 17891,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected port fetch: ${url}`)
    })

    const probe = await probeLocalDesktopBridge(1000)
    expect(probe.online).toBe(true)
    expect(probe.isDesktopApp).toBe(true)
    expect(probe.port).toBe(17891)
    expect(probe.version).toBe('2.6.0')
    expect(await resolveLocalBridgeBaseUrl()).toBe('http://127.0.0.1:17891')
  })
})
