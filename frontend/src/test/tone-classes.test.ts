import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  READINESS_META,
  SPEND_FRESHNESS_META,
  TONE_CLASS,
  TONE_DOT,
  type Tone,
} from '../lib/readiness'
import { FRESHNESS_META, HEALTH_META } from '../lib/health'
import { PLATFORM_STATUS_CLASS_META, PLATFORM_STATUS_META } from '../lib/platformStatus'

const TONES: Tone[] = ['positive', 'caution', 'attention', 'info', 'neutral', 'muted']
const tokensCss = readFileSync(join(process.cwd(), 'src/tokens.css'), 'utf8')
const indexCss = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

describe('TONE_CLASS / TONE_DOT point at design tokens (U1a)', () => {
  it('cover exactly the six tones, each a single tone-* class and nothing else', () => {
    expect(Object.keys(TONE_CLASS).sort()).toEqual([...TONES].sort())
    expect(Object.keys(TONE_DOT).sort()).toEqual([...TONES].sort())
    for (const tone of TONES) {
      expect(TONE_CLASS[tone]).toBe(`tone-${tone}`)
      expect(TONE_DOT[tone]).toBe(`tone-dot-${tone}`)
    }
  })

  it('paint every tone in the stylesheet', () => {
    for (const tone of TONES) {
      expect(indexCss).toContain(`.tone-${tone} {`)
      expect(indexCss).toContain(`.tone-dot-${tone} {`)
    }
  })

  it('define bg/fg/border for every tone in light, dark and the follow-the-OS block', () => {
    for (const tone of TONES) {
      for (const part of ['bg', 'fg', 'border']) {
        const occurrences = tokensCss.split(`--tone-${tone}-${part}:`).length - 1
        expect(occurrences, `--tone-${tone}-${part}`).toBe(3)
      }
    }
  })
})

describe('the success tone is never given to "not known" states (CLAUDE.md rules 5, 28, S2)', () => {
  const notAllowedPositive: [string, Tone][] = [
    ['readiness unknown', READINESS_META.unknown.tone],
    ['readiness not_ready', READINESS_META.not_ready.tone],
    ['health unknown', HEALTH_META.unknown.tone],
    ...Object.entries(FRESHNESS_META).map(([k, v]): [string, Tone] => [`health freshness ${k}`, v.tone]),
    ...Object.entries(SPEND_FRESHNESS_META).map(([k, v]): [string, Tone] => [`spend freshness ${k}`, v.tone]),
    // Every Meta account status, including "active": Meta saying so is not our verdict.
    ...Object.entries(PLATFORM_STATUS_META).map(([k, v]): [string, Tone] => [`Meta status ${k}`, v.tone]),
    ...Object.entries(PLATFORM_STATUS_CLASS_META).map(([k, v]): [string, Tone] => [`Meta class ${k}`, v.tone]),
  ]

  it.each(notAllowedPositive)('%s is not positive', (_name, tone) => {
    expect(tone).not.toBe('positive')
    expect(TONE_CLASS[tone]).not.toBe('tone-positive')
    expect(TONE_DOT[tone]).not.toBe('tone-dot-positive')
  })

  it('keeps only operationally_ready green among readiness states', () => {
    const greens = Object.entries(READINESS_META)
      .filter(([, meta]) => meta.tone === 'positive')
      .map(([key]) => key)
    expect(greens).toEqual(['operationally_ready'])
  })
})

// WCAG 2.x contrast computed from the token values, per theme. Catches a token edit that
// quietly makes a badge unreadable; it does NOT replace looking at the screen.
function channels(block: string, name: string): [number, number, number] {
  const match = new RegExp(`--${name}: (\\d+) (\\d+) (\\d+);`).exec(block)
  if (!match) throw new Error(`missing token ${name}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('token contrast (WCAG AA, computed)', () => {
  const light = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('.dark {'))
  const dark = tokensCss.slice(tokensCss.indexOf('.dark {'), tokensCss.indexOf('@media'))

  for (const [theme, block] of [['light', light], ['dark', dark]] as const) {
    it.each(TONES)(`${theme}: tone %s text on its background is at least 4.5:1`, (tone) => {
      expect(contrast(channels(block, `tone-${tone}-fg`), channels(block, `tone-${tone}-bg`))).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: body, muted and faint text on surface and sunken surface are at least 4.5:1`, () => {
      for (const fg of ['fg', 'fg-muted', 'fg-faint']) {
        for (const bg of ['surface', 'surface-2']) {
          expect(contrast(channels(block, fg), channels(block, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(contrast(channels(block, 'brand-fg'), channels(block, 'brand'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(channels(block, 'brand-text'), channels(block, 'brand-soft'))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
