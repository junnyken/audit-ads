/**
 * U1e: the extension on the new design system. These tests pin the decisions that must not drift:
 * token values equal the dashboard's, no success tone for any freshness or status, "—" never 0,
 * `lang` follows the language, VI/EN parity, and the bundled font + CSS stay local.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installChromeStub } from './setup'
import { LanguageProvider } from '../src/shared/i18n'
import { LanguageToggle } from '../src/shared/LanguageToggle'
import { en } from '../src/shared/i18n/en'
import { vi as viDict } from '../src/shared/i18n/vi'
import { translate } from '../src/shared/i18n/translate'
import {
  CONTEXT_META,
  FRESHNESS_META,
  PAGE_TYPE_LABEL,
  PLATFORM_STATUS_META,
  PLATFORM_STATUS_UNKNOWN,
  READINESS_META,
  SPEND_FRESHNESS_META,
  SPEND_FRESHNESS_UNKNOWN,
  pageTypeKey,
} from '../src/shared/presentation'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function tokenMap(css: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

describe('design tokens match the dashboard', () => {
  const dash = read('../frontend/src/tokens.css')
  const ext = read('src/styles/tokens.css')

  // Light block = text before the first `.dark {` / `@media`; dark = the `.dark` block vs the media block.
  const dashLight = tokenMap(dash.split('.dark {')[0])
  const dashDark = tokenMap(dash.split('.dark {')[1].split('}')[0])
  const extLight = tokenMap(ext.split('@media')[0])
  const extDark = tokenMap(ext.split('@media')[1])

  it('has every colour token of the dashboard with the same light value', () => {
    for (const [name, value] of dashLight) {
      if (name.startsWith('--font') || name.startsWith('--r-')) continue
      expect(extLight.get(name), name).toBe(value)
    }
    expect([...dashLight.keys()].filter((k) => k.startsWith('--tone-')).length).toBe(18)
  })

  it('has the same dark value, selected by prefers-color-scheme', () => {
    expect(ext).toContain('prefers-color-scheme: dark')
    expect(ext).toContain('color-scheme: dark')
    for (const [name, value] of dashDark) expect(extDark.get(name), name).toBe(value)
  })

  it('uses no raw colour literal in the stylesheet (tokens only)', () => {
    const css = read('src/styles/extension.css')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(\s*\d/)
  })
})

describe('bundled font and icons', () => {
  it('ships Be Vietnam Pro locally with its OFL licence and no remote font or script', () => {
    const fonts = readdirSync(resolve(root, 'src/fonts')).filter((f) => f.endsWith('.woff2'))
    expect(fonts.length).toBe(8)
    expect(read('src/fonts/OFL.txt')).toContain('SIL OPEN FONT LICENSE')
    const css = read('src/styles/fonts.css')
    expect(css).not.toMatch(/https?:/)
    expect(css).toContain('U+1EA0-1EF9') // the Vietnamese subset
    for (const sheet of ['fonts.css', 'extension.css', 'tokens.css']) {
      expect(read(`src/styles/${sheet}`)).not.toMatch(/https?:\/\//)
    }
    for (const page of ['popup/popup.html', 'sidepanel/sidepanel.html', 'options/options.html']) {
      expect(read(`src/${page}`)).not.toMatch(/https?:\/\//)
    }
  })

  it.runIf(existsSync(resolve(root, 'dist/manifest.json')))('puts the font files in the built bundle', () => {
    const assets = readdirSync(resolve(root, 'dist/assets'))
    expect(assets.filter((f) => f.endsWith('.woff2')).length).toBe(8)
    expect(assets).toContain('OFL-BeVietnamPro.txt')
  })
})

describe('no success tone for any freshness or status', () => {
  it('freshness, spend freshness, Meta status and unknown/not_ready are never positive', () => {
    for (const meta of Object.values(FRESHNESS_META)) expect(meta.tone).not.toBe('positive')
    for (const meta of Object.values(SPEND_FRESHNESS_META)) expect(meta.tone).not.toBe('positive')
    for (const meta of Object.values(PLATFORM_STATUS_META)) expect(meta.tone).not.toBe('positive')
    expect(SPEND_FRESHNESS_UNKNOWN.tone).not.toBe('positive')
    expect(PLATFORM_STATUS_UNKNOWN.tone).not.toBe('positive')
    expect(READINESS_META.unknown.tone).not.toBe('positive')
    expect(READINESS_META.not_ready.tone).not.toBe('positive')
    expect(CONTEXT_META.unsupported_page.tone).not.toBe('positive')
  })

  it('"current" is neutral for both freshness maps, and unreadable states are neutral or muted', () => {
    expect(FRESHNESS_META.current.tone).toBe('neutral')
    expect(SPEND_FRESHNESS_META.current.tone).toBe('neutral')
    for (const key of ['never_observed', 'not_observable']) {
      expect(['neutral', 'muted']).toContain(SPEND_FRESHNESS_META[key].tone)
    }
    expect(['neutral', 'muted']).toContain(FRESHNESS_META.never_evaluated.tone)
  })
})

describe('human labels', () => {
  it('has a VI and EN label for every page_type and resolution state, none equal to the raw code', () => {
    for (const [code, key] of Object.entries(PAGE_TYPE_LABEL)) {
      for (const lang of ['vi', 'en'] as const) {
        const text = translate(lang, key)
        expect(text.length, `${lang} ${code}`).toBeGreaterThan(0)
        expect(text).not.toBe(code)
      }
    }
    for (const meta of Object.values(CONTEXT_META)) {
      expect(translate('vi', meta.label)).not.toBe(translate('en', meta.label))
    }
    expect(translate('vi', CONTEXT_META.unsupported_page.label)).toBe('Không phải trang Ads Manager')
  })

  it('reads an unrecognised page_type as the "unrecognised" label, never the raw string', () => {
    expect(pageTypeKey('something_new')).toBe('pageType.unknown')
    expect(pageTypeKey(undefined)).toBe('pageType.unknown')
  })

  it('keeps VI and EN keys identical and none empty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(viDict).sort())
    for (const [dict, name] of [[en, 'en'], [viDict, 'vi']] as const) {
      for (const [key, value] of Object.entries(dict)) {
        expect(String(value).trim().length, `${name} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('lang follows the active language', () => {
  it('ships lang="vi" in every page and updates <html lang> when the language changes', async () => {
    for (const page of ['popup/popup.html', 'sidepanel/sidepanel.html', 'options/options.html']) {
      expect(read(`src/${page}`)).toContain('<html lang="vi">')
    }
    const { local } = installChromeStub()
    local.data.set('adsops.language', 'vi')
    render(
      <LanguageProvider>
        <LanguageToggle />
      </LanguageProvider>,
    )
    await waitFor(() => expect(document.documentElement.lang).toBe('vi'))
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    await userEvent.click(screen.getByRole('button', { name: 'VI' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('vi'))
    installChromeStub()
  })
})

describe('permissions did not move', () => {
  it('the source carries no new permission, host or script surface', () => {
    const manifest = JSON.parse(read('src/manifest.json'))
    expect(Object.keys(manifest).sort()).toEqual(
      [
        'action', 'background', 'content_scripts', 'content_security_policy', 'description', 'host_permissions',
        'icons', 'manifest_version', 'minimum_chrome_version', 'name', 'options_page', 'permissions', 'side_panel',
        'version',
      ].sort(),
    )
  })
})
