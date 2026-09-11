import { describe, expect, it } from 'vitest'
import { DRAFT_STATUS_META, FINDING_SEVERITY_META, PREFLIGHT_DISCLAIMER } from '../lib/preflight'

describe('preflight presentation rules (A6)', () => {
  it('covers all seven draft statuses', () => {
    expect(Object.keys(DRAFT_STATUS_META).sort()).toEqual(
      [
        'archived',
        'blocked_by_internal_policy',
        'draft',
        'needs_changes',
        'ready_for_manual_review',
        'submitted_for_review',
        'unknown_missing_evidence',
      ].sort(),
    )
  })

  it('reserves the positive tone for ready_for_manual_review alone (mini-spec §4.1)', () => {
    const positive = Object.entries(DRAFT_STATUS_META)
      .filter(([, meta]) => meta.tone === 'positive')
      .map(([key]) => key)
    expect(positive).toEqual(['ready_for_manual_review'])
  })

  it('never affirmatively claims a draft is approved, guaranteed, or safe to publish (A6 guardrail 5)', () => {
    // Per-status label/description text has no reason to mention approval at all, affirmatively
    // or not — unlike the disclaimer (tested separately below), which must negate it by name.
    const affirmativeClaim = /\bis guaranteed\b|\bwill be approved\b|\bis approved\b|\bsafe to publish\b/i
    for (const [status, meta] of Object.entries(DRAFT_STATUS_META)) {
      expect(meta.description, `status "${status}" description`).not.toMatch(affirmativeClaim)
      expect(meta.label, `status "${status}" label`).not.toMatch(affirmativeClaim)
    }
  })

  it('the disclaimer explicitly negates a guarantee of approval, not a hedge that omits it', () => {
    expect(PREFLIGHT_DISCLAIMER.toLowerCase()).toMatch(/do not guarantee/)
  })

  it("ready_for_manual_review's own description explicitly disclaims a platform guarantee", () => {
    expect(DRAFT_STATUS_META.ready_for_manual_review.description.toLowerCase()).toContain(
      'does not guarantee',
    )
  })

  it('unknown_missing_evidence is never styled as positive', () => {
    expect(DRAFT_STATUS_META.unknown_missing_evidence.tone).not.toBe('positive')
  })

  it('blocking is the only attention-toned finding severity', () => {
    expect(FINDING_SEVERITY_META.blocking.tone).toBe('attention')
    expect(FINDING_SEVERITY_META.warning.tone).not.toBe('attention')
    expect(FINDING_SEVERITY_META.info.tone).not.toBe('attention')
  })
})
