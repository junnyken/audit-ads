import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  ASSIGNMENT_STATUS_TONE,
  INVITATION_STATUS_TONE,
  MEMBER_STATUS_LABEL,
  MEMBER_STATUS_TONE,
  ONE_TIME_TOKEN_WARNING,
  seatCaption,
} from '../lib/team'
import { TONE_CLASS } from '../lib/readiness'
import type { WorkspaceMemberStatus } from '../lib/types'

describe('A9 member status presentation', () => {
  it('never styles a member who has lost access as positive', () => {
    for (const status of ['suspended', 'deactivated'] as WorkspaceMemberStatus[]) {
      expect(MEMBER_STATUS_TONE[status]).not.toBe('positive')
      expect(TONE_CLASS[MEMBER_STATUS_TONE[status]]).not.toMatch(/emerald/)
    }
  })

  it('only an active member is styled positive', () => {
    const statuses: WorkspaceMemberStatus[] = ['invited', 'active', 'suspended', 'deactivated']
    for (const status of statuses) {
      if (status === 'active') expect(MEMBER_STATUS_TONE[status]).toBe('positive')
      else expect(MEMBER_STATUS_TONE[status]).not.toBe('positive')
    }
  })

  it('never calls a deactivated member "deleted" — the spec forbids that wording', () => {
    for (const label of Object.values(MEMBER_STATUS_LABEL)) {
      expect(label.toLowerCase()).not.toContain('delet')
    }
  })
})

describe('A9 invitation and assignment presentation', () => {
  it('a pending invitation is not styled as if it were already accepted', () => {
    expect(INVITATION_STATUS_TONE.pending).not.toBe('positive')
    expect(INVITATION_STATUS_TONE.accepted).toBe('positive')
  })

  it('a revoked or expired assignment is never styled as active access', () => {
    expect(ASSIGNMENT_STATUS_TONE.revoked).not.toBe('positive')
    expect(ASSIGNMENT_STATUS_TONE.expired).not.toBe('positive')
    expect(ASSIGNMENT_STATUS_TONE.active).toBe('positive')
  })
})

describe('A9 role vocabulary', () => {
  it('owner is never offered as an assignable role', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('owner')
    expect([...ASSIGNABLE_ROLES]).toEqual(['admin', 'operator', 'viewer'])
  })
})

describe('A9 seat caption', () => {
  it('says capacity is unconfigured rather than inventing a limit', () => {
    const caption = seatCaption(null, 3)
    expect(caption).toContain('no seat plan configured')
    expect(caption).not.toMatch(/\bof \d+ seats\b/)
  })

  it('reports the real numbers once a plan exists', () => {
    expect(seatCaption(5, 2)).toBe('2 of 5 seats used')
  })
})

describe('A9 one-time token warning', () => {
  it('tells the operator the link cannot be retrieved again', () => {
    expect(ONE_TIME_TOKEN_WARNING).toMatch(/shown once/i)
    expect(ONE_TIME_TOKEN_WARNING).toMatch(/resend/i)
  })
})
