import { describe, expect, it } from 'vitest'
import { DISABLE_CONSEQUENCE, SIGNAL_STATUS_META } from '../lib/health'

describe('what an operator is told before turning a check off', () => {
  it('says expired, and says it is not resolved', () => {
    // The engine expires a disabled rule's open signals rather than resolving them: a resolved
    // signal claims the condition stopped being true, and switching off the check that watched
    // for it claims nothing of the kind. The wording has to carry that distinction or the UI
    // quietly undoes the guarantee.
    expect(DISABLE_CONSEQUENCE).toContain('expired, not resolved')
  })

  it('says the history is kept', () => {
    expect(DISABLE_CONSEQUENCE).toContain('history is kept')
  })

  it('refuses to imply the problem is gone', () => {
    expect(DISABLE_CONSEQUENCE).toContain('has gone away')
    expect(DISABLE_CONSEQUENCE).toMatch(/nothing about it means/i)
  })

  it('scopes the change to this workspace', () => {
    expect(DISABLE_CONSEQUENCE).toContain('for this workspace')
  })

  it('keeps expired and resolved as different words in the signal list', () => {
    // Same distinction, one layer down: if these two ever render identically, an expired signal
    // starts reading as a solved one.
    expect(SIGNAL_STATUS_META.expired.label).not.toBe(SIGNAL_STATUS_META.resolved.label)
  })
})
