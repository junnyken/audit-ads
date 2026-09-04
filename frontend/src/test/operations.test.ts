import { describe, expect, it } from 'vitest'
import {
  BAND_META,
  OPERATIONS_DISCLAIMER,
  RUN_KIND_LABEL,
  RUN_STATUS_META,
  STATE_META,
  TEST_SEND_DISCLAIMER,
  TRANSPORT_LABEL,
} from '../lib/operations'
import { TONE_CLASS } from '../lib/readiness'

describe('operations presentation rules', () => {
  it('never styles a stale or never-run process as healthy', () => {
    for (const key of ['stale', 'never'] as const) {
      expect(STATE_META[key].tone).not.toBe('positive')
      expect(TONE_CLASS[STATE_META[key].tone]).not.toMatch(/emerald/)
    }
    expect(STATE_META.current.tone).toBe('positive')
  })

  it('keeps "never run" distinct from "stale" in wording, not just in colour', () => {
    expect(STATE_META.never.label).toBe('Never run')
    expect(STATE_META.never.hint).toContain('no record of this ever running')
    expect(STATE_META.stale.hint).toContain('ran before')
  })

  it('never reports an unknown metric as OK', () => {
    expect(BAND_META.unknown.tone).toBe('neutral')
    expect(BAND_META.unknown.label).toBe('Unknown')
    expect(BAND_META.critical.tone).not.toBe('positive')
  })

  it('says plainly what each transport mode does', () => {
    expect(TRANSPORT_LABEL.disabled).toContain('nothing is delivered')
    expect(TRANSPORT_LABEL.fake).toContain('never sent')
    expect(TRANSPORT_LABEL.telegram).toContain('real delivery')
  })

  it('labels every recorded run kind', () => {
    for (const kind of [
      'dispatch',
      'recovery_sweep',
      'backup',
      'restore_drill',
      'migration_release',
      'test_send',
    ]) {
      expect(RUN_KIND_LABEL[kind]).toBeTruthy()
    }
    expect(RUN_STATUS_META.failed.tone).not.toBe('positive')
    expect(RUN_STATUS_META.partial.tone).toBe('caution')
  })

  it('states that operational signals are not account health or readiness', () => {
    expect(OPERATIONS_DISCLAIMER).toContain('not a health or readiness state')
    expect(OPERATIONS_DISCLAIMER.toLowerCase()).toContain('say nothing about any advertising')
  })

  it('states that a test send changes no source record', () => {
    expect(TEST_SEND_DISCLAIMER).toContain('creates no alert')
    expect(TEST_SEND_DISCLAIMER).toContain('changes no account, health or readiness record')
  })

  it('uses no safety, approval or score language in operational copy', () => {
    const texts = [
      ...Object.values(STATE_META).map((m) => `${m.label} ${m.hint}`),
      ...Object.values(BAND_META).map((m) => m.label),
      ...Object.values(TRANSPORT_LABEL),
      OPERATIONS_DISCLAIMER,
      TEST_SEND_DISCLAIMER,
    ]
    const forbidden =
      /\b(safe account|no ban risk|guaranteed approval|account protected|risk score|health score)\b/i
    for (const text of texts) expect(forbidden.test(text), text).toBe(false)
  })
})
