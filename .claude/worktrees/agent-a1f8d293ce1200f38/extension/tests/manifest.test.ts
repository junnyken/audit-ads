import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8'))

describe('manifest', () => {
  it('carries the same version as package.json (0.3.1: U1e, the new design system)', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(manifest.version).toBe(pkg.version)
    expect(manifest.version).toBe('0.3.1')
  })

  it('keeps the exact permission surface of 0.3.0 (U1e is a visual slice: nothing may widen)', () => {
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'sidePanel', 'storage'])
    expect(manifest.host_permissions).toEqual([
      'https://adsmanager.facebook.com/*',
      'https://business.facebook.com/*',
      'https://www.facebook.com/adsmanager/*',
    ])
    expect(manifest.content_scripts).toHaveLength(1)
    expect(manifest.content_scripts[0].matches).toEqual(manifest.host_permissions)
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'none'; base-uri 'none'",
    )
    expect(manifest.optional_permissions).toBeUndefined()
    expect(manifest.web_accessible_resources).toBeUndefined()
    expect(manifest.externally_connectable).toBeUndefined()
  })

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.background.type).toBe('module')
  })

  it('fits the Chrome Web Store listing: a 128px icon that exists, a summary of at most 132 characters', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132)
    expect(manifest.icons['128']).toBe('icons/icon-128.png')
    const named = [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]
    for (const path of named as string[]) {
      expect(existsSync(resolve(root, path)), path).toBe(true)
    }
  })

  it('never asks for a broad host permission', () => {
    const hosts: string[] = manifest.host_permissions ?? []
    expect(hosts).not.toContain('<all_urls>')
    expect(hosts).not.toContain('*://*/*')
    expect(hosts).not.toContain('https://*/*')
    expect(manifest.optional_host_permissions).toBeUndefined()
    for (const host of hosts) {
      expect(host.startsWith('https://')).toBe(true)
      // A bare facebook.com host would put the content script on the feed and on Messenger.
      expect(host).not.toBe('https://www.facebook.com/*')
    }
  })

  it('scopes www.facebook.com to the Ads Manager path only', () => {
    const hosts: string[] = manifest.host_permissions
    const www = hosts.find((host) => host.includes('www.facebook.com'))
    expect(www).toBe('https://www.facebook.com/adsmanager/*')
  })

  it('requests no permission that could read credentials or drive the browser', () => {
    const permissions: string[] = manifest.permissions ?? []
    for (const forbidden of [
      'cookies',
      'webRequest',
      'webRequestBlocking',
      'declarativeNetRequest',
      'debugger',
      'proxy',
      'tabs',
      'scripting',
      'history',
      'management',
      'privacy',
      'downloads',
    ]) {
      expect(permissions).not.toContain(forbidden)
    }
    expect(permissions.sort()).toEqual(['activeTab', 'sidePanel', 'storage'])
  })

  it('runs the content script only on the declared Ads Manager hosts, in the top frame', () => {
    const [script] = manifest.content_scripts
    expect(script.all_frames).toBe(false)
    expect(script.matches).toEqual(manifest.host_permissions)
    expect(script.js).toEqual(['content/content.js'])
  })

  it('locks extension pages down with a CSP that allows no remote code', () => {
    const csp: string = manifest.content_security_policy.extension_pages
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('http')
  })

  it('describes itself as read-only, and claims no protection', () => {
    const description: string = manifest.description.toLowerCase()
    expect(description).toContain('read-only')
    for (const claim of ['protect', 'safe', 'ban', 'bypass', 'unlock', 'guarantee', 'automat']) {
      expect(description).not.toContain(claim)
    }
  })
})

describe('built bundle', () => {
  const dist = resolve(root, 'dist')
  const built = existsSync(resolve(dist, 'manifest.json'))

  it.runIf(built)('ships every file the manifest points at', () => {
    for (const path of [
      'manifest.json',
      manifest.background.service_worker,
      ...manifest.content_scripts[0].js,
      manifest.action.default_popup,
      manifest.side_panel.default_path,
      manifest.options_page,
    ]) {
      expect(existsSync(resolve(dist, path)), path).toBe(true)
    }
  })

  it.runIf(built)('builds the content script as one self-contained file', () => {
    const source = readFileSync(resolve(dist, 'content/content.js'), 'utf8')
    // An isolated-world script has no module loader: a bare import would fail silently.
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\bexport\s/m)
  })

  it.runIf(built)('bakes no secret, no dashboard URL and no Meta endpoint into the bundle', () => {
    for (const file of [
      'background/service-worker.js',
      'content/content.js',
      'popup.js',
      'sidepanel.js',
      'options.js',
    ]) {
      const source = readFileSync(resolve(dist, file), 'utf8')
      expect(source).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/)
      expect(source.toLowerCase()).not.toContain('graph.facebook.com')
      expect(source).not.toContain('document.cookie')
      expect(source).not.toContain('localStorage')
      expect(source).not.toContain('indexedDB')
    }
  })

  it.runIf(built)('never references a browser-automation or network-interception API', () => {
    const worker = readFileSync(resolve(dist, 'background/service-worker.js'), 'utf8')
    for (const api of ['chrome.cookies', 'chrome.webRequest', 'chrome.debugger', 'chrome.proxy']) {
      expect(worker).not.toContain(api)
    }
  })
})
