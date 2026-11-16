import { describe, expect, it } from 'vitest'
import {
  buildExtensionFilesForVia,
  canMemberLaunchVia,
  getAntidetectEngineLabel,
  parseAntidetectFromNotes,
} from '../lib/chromeProfileLauncher'

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

  it('generates v2.9.8 manifest metadata cleanly', () => {
    const files = buildExtensionFilesForVia('AdsOps', 'Via Test', 'Profile 1', '')
    const manifestFile = files.find((f) => f.name === 'manifest.json' || f.name.endsWith('/manifest.json'))
    const manifest = JSON.parse(manifestFile!.content) as { version: string }
    expect(manifest.version).toBe('2.9.8')
  })
})
