import { describe, expect, it, vi } from 'vitest'
import {
  buildExtensionFilesForVia,
  getLocalBridgeToken,
  setLocalBridgeToken,
} from '../lib/chromeProfileLauncher'

describe('v2.5.0 Zero-Trust Bridge Token & Community Readiness helpers', () => {
  it('persists and attaches X-AdsOps-Bridge-Token cleanly for extension bundles', () => {
    window.localStorage.removeItem('adsops_bridge_token')
    expect(getLocalBridgeToken()).toBe('')

    setLocalBridgeToken('  token_community_zero_trust_999  ')
    expect(getLocalBridgeToken()).toBe('token_community_zero_trust_999')

    const files = buildExtensionFilesForVia(
      'AdsOps-Chrome-Extension',
      'Via Community 1',
      'Profile 1',
      '103.10.20.30:8080:u:p',
      [],
      'JBSWY3DPEHPK3PXP',
      'camp',
      'via-comm-1',
    )
    const byName = new Map(files.map((f) => [f.name, f.content]))
    expect(byName.get('AdsOps-Chrome-Extension/background.js')).toContain('token_community_zero_trust_999')
    expect(byName.get('AdsOps-Chrome-Extension/popup.js')).toContain('token_community_zero_trust_999')
    expect(byName.get('AdsOps-Chrome-Extension/popup.html')).toContain('id="bridge-token-input"')
    expect(byName.get('AdsOps-Chrome-Extension/popup.html')).toContain('id="btn-save-bridge-token"')

    setLocalBridgeToken('')
    expect(getLocalBridgeToken()).toBe('')
    vi.restoreAllMocks()
  })
})
