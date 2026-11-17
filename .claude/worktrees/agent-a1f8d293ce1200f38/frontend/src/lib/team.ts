import type { Tone } from './readiness'
import type { AssignmentStatus, InvitationStatus, WorkspaceMemberStatus } from './types'

/** A9. `deactivated` and `suspended` are never styled as success — the same discipline the
 * readiness/health colour maps have carried since A1: a state that removes access must not
 * look like a healthy one. */
export const MEMBER_STATUS_TONE: Record<WorkspaceMemberStatus, Tone> = {
  invited: 'neutral',
  active: 'positive',
  suspended: 'caution',
  deactivated: 'attention',
}

export const MEMBER_STATUS_LABEL: Record<WorkspaceMemberStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
}

export const INVITATION_STATUS_TONE: Record<InvitationStatus, Tone> = {
  draft: 'neutral',
  pending: 'caution',
  accepted: 'positive',
  expired: 'neutral',
  revoked: 'neutral',
  cancelled: 'neutral',
  archived: 'neutral',
}

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

export const ASSIGNMENT_STATUS_TONE: Record<AssignmentStatus, Tone> = {
  active: 'positive',
  revoked: 'neutral',
  expired: 'neutral',
}

/** Shown once, next to a freshly created invitation link. The token is not stored anywhere on
 * the client and is never returned by the API again — closing the dialog loses it for good. */
export const ONE_TIME_TOKEN_WARNING =
  'Copy this link now. It is shown once and cannot be retrieved again — resend the invitation to get a new one.'

/** The only roles A9 lets anyone assign. `owner` is deliberately absent: ownership transfer is
 * a separate, higher-risk flow, and the backend rejects it regardless of what the UI offers. */
export const ASSIGNABLE_ROLES = ['admin', 'operator', 'viewer'] as const

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
  buyer: 'Operator',
  auditor: 'Auditor',
}

export function seatCaption(limit: number | null, used: number): string {
  if (limit === null) return `${used} active · no seat plan configured yet`
  return `${used} of ${limit} seats used`
}
