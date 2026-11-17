import { describe, expect, it } from 'vitest'
import { READINESS_META, TONE_CLASS, accountStatusTone, itemStateTone } from '../lib/readiness'

describe('readiness presentation rules', () => {
  it('covers all four readiness states', () => {
    expect(Object.keys(READINESS_META).sort()).toEqual([
      'not_ready',
      'operationally_ready',
      'ready_with_warnings',
      'unknown',
    ])
  })

  it('never renders unknown or not_ready with success styling (A1 Guardrail 10)', () => {
    for (const state of ['unknown', 'not_ready'] as const) {
      const tone = READINESS_META[state].tone
      expect(tone).not.toBe('positive')
      expect(TONE_CLASS[tone]).not.toMatch(/emerald|green/)
    }
  })

  it('reserves the positive tone for operationally_ready alone', () => {
    const positive = Object.entries(READINESS_META)
      .filter(([, meta]) => meta.tone === 'positive')
      .map(([key]) => key)
    expect(positive).toEqual(['operationally_ready'])
  })

  it('states that unknown is not a pass', () => {
    expect(READINESS_META.unknown.description.toLowerCase()).toContain('not a pass')
  })

  it('maps restricted and disabled account statuses to an attention tone', () => {
    expect(accountStatusTone('restricted')).toBe('attention')
    expect(accountStatusTone('disabled')).toBe('attention')
    expect(accountStatusTone('unknown')).toBe('neutral')
    expect(accountStatusTone('active')).toBe('positive')
  })

  it('only marks satisfied checklist items as positive', () => {
    expect(itemStateTone('satisfied')).toBe('positive')
    expect(itemStateTone('unknown')).not.toBe('positive')
    expect(itemStateTone('problem')).toBe('attention')
  })
})
