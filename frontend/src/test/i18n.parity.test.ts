import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { vi as viDict } from '../i18n/vi'
import {
  DEFAULT_LANGUAGE,
  INTL_LOCALE,
  interpolate,
  setActiveLanguage,
  translate,
} from '../i18n/translate'
import { NAV_GROUPS, NAV_ITEMS } from '../components/shell/nav'
import { formatDateTime, formatRelative } from '../lib/format'

afterEach(() => setActiveLanguage(DEFAULT_LANGUAGE))

describe('i18n parity (the compile-time check is `satisfies Record<TranslationKey, string>`)', () => {
  it('has the same keys in vi and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(viDict).sort())
  })

  it('has no empty string in either language', () => {
    for (const dict of [viDict, en] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim().length, key).toBeGreaterThan(0)
      }
    }
  })

  it('uses the same {placeholders} in both languages', () => {
    const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(viDict) as (keyof typeof viDict)[]) {
      expect(tokens(en[key]), key).toEqual(tokens(viDict[key]))
    }
  })

  it('makes Vietnamese the default language', () => {
    expect(DEFAULT_LANGUAGE).toBe('vi')
    expect(INTL_LOCALE.vi).toBe('vi-VN')
  })

  it('every navigation label is a real key', () => {
    for (const group of NAV_GROUPS) {
      expect(viDict).toHaveProperty(group.labelKey)
      for (const item of group.items) expect(viDict).toHaveProperty(item.labelKey)
    }
    expect(NAV_ITEMS).toHaveLength(15)
  })

  it('marks the file as awaiting BA review', () => {
    const source = readFileSync(join(process.cwd(), 'src/i18n/vi.ts'), 'utf8')
    expect(source).toContain('[ĐỀ XUẤT — chờ duyệt]')
  })

  it('never states a guarantee in the disclaimer (rule 6)', () => {
    for (const language of ['vi', 'en'] as const) {
      const text = translate(language, 'shell.disclaimer').toLowerCase()
      expect(text).not.toMatch(/an toàn|sẽ được duyệt|will be approved|is safe/)
    }
  })
})

describe('interpolate', () => {
  it('fills known tokens and leaves unknown ones visible', () => {
    expect(interpolate('{a} và {b}', { a: 1 })).toBe('1 và {b}')
    expect(interpolate('không có biến')).toBe('không có biến')
  })
})

describe('format.ts follows the language, vi-VN by default', () => {
  it('formats a date as dd/MM/yyyy HH:mm in Vietnamese', () => {
    const iso = new Date(2026, 9, 27, 9, 15).toISOString()
    expect(formatDateTime(iso)).toBe('27/10/2026 09:15')
  })

  it('says "chưa từng" for a missing time, not an English word', () => {
    expect(formatRelative(null)).toBe('chưa từng')
    expect(formatRelative('not-a-date')).toBe('chưa từng')
    expect(formatRelative(new Date().toISOString())).toBe('vừa xong')
  })

  it('relative time in Vietnamese reads in Vietnamese', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    expect(formatRelative(twoHoursAgo)).toMatch(/giờ/)
  })

  it('switches with the active language', () => {
    setActiveLanguage('en')
    expect(formatRelative(null)).toBe('never')
    expect(formatRelative(new Date().toISOString())).toBe('just now')
  })

  it('a missing date is a dash in both languages, never a made-up date', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('garbage', 'en')).toBe('—')
  })
})
