import { describe, expect, it } from 'vitest'
import {
  FRESHNESS_META,
  HEALTH_DISCLAIMER,
  HEALTH_META,
  RECALCULATE_EXPLANATION,
  RESOLVE_DISCLAIMER,
  SEVERITY_META,
  SIGNAL_STATUS_META,
} from '../lib/health'
import { READINESS_META, TONE_CLASS } from '../lib/readiness'

describe('health presentation rules', () => {
  it('covers all five health states', () => {
    expect(Object.keys(HEALTH_META).sort()).toEqual([
      'attention_needed',
      'clear_signals',
      'critical',
      'unknown',
      'warning',
    ])
  })

  it('never styles unknown health as success', () => {
    expect(HEALTH_META.unknown.tone).not.toBe('positive')
    expect(TONE_CLASS[HEALTH_META.unknown.tone]).not.toMatch(/emerald|green/)
  })

  it('reserves the positive tone for clear_signals alone', () => {
    const positive = Object.entries(HEALTH_META)
      .filter(([, meta]) => meta.tone === 'positive')
      .map(([key]) => key)
    expect(positive).toEqual(['clear_signals'])
  })

  it('describes clear_signals only as a configured-check result', () => {
    expect(HEALTH_META.clear_signals.description).toContain(
      'No current issues found by configured checks',
    )
    expect(HEALTH_META.clear_signals.description).toContain('not a platform approval')
  })

  it('says explicitly that unknown is not a clear result', () => {
    expect(HEALTH_META.unknown.description.toLowerCase()).toContain('not a clear result')
  })

  it('never uses safety or approval language anywhere in health copy', () => {
    const texts = [
      ...Object.values(HEALTH_META).map((m) => `${m.label} ${m.description}`),
      ...Object.values(FRESHNESS_META).map((m) => `${m.label} ${m.description}`),
      ...Object.values(SIGNAL_STATUS_META).map((m) => `${m.label} ${m.hint}`),
      HEALTH_DISCLAIMER,
      RESOLVE_DISCLAIMER,
      RECALCULATE_EXPLANATION,
    ]
    const affirmative =
      /\b(is safe|are safe|safe account|protected|unbanned|approved by|will be approved|immune|cannot be restricted|no ban risk|ban risk|trust score|safety score)\b/i
    for (const text of texts) {
      expect(affirmative.test(text), text).toBe(false)
    }
  })

  it('keeps freshness visually independent of health', () => {
    for (const meta of Object.values(FRESHNESS_META)) {
      expect(meta.tone).not.toBe('positive')
      expect(meta.tone).not.toBe('attention')
    }
    expect(FRESHNESS_META.stale.tone).toBe('caution')
  })

  it('maps signal severities without giving any of them a success tone', () => {
    expect(SEVERITY_META.critical.tone).toBe('attention')
    expect(SEVERITY_META.warning.tone).toBe('caution')
    expect(SEVERITY_META.attention.tone).toBe('info')
    for (const meta of Object.values(SEVERITY_META)) {
      expect(meta.tone).not.toBe('positive')
    }
  })

  it('states that acknowledgement is not resolution', () => {
    expect(SIGNAL_STATUS_META.acknowledged.hint.toLowerCase()).toContain('still counts')
  })

  it('tells the operator that recalculation contacts no platform', () => {
    expect(RECALCULATE_EXPLANATION.toLowerCase()).toContain('does not contact')
  })

  it('keeps health and readiness vocabularies separate', () => {
    const healthKeys = new Set(Object.keys(HEALTH_META))
    const readinessKeys = new Set(Object.keys(READINESS_META))
    const shared = [...healthKeys].filter((key) => readinessKeys.has(key))
    expect(shared).toEqual(['unknown'])
    expect(HEALTH_META.unknown.label).not.toBe(READINESS_META.unknown.label)
  })
})
