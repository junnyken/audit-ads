import type { Tone } from './readiness'
import type { DraftStatus, FindingSeverity, FindingStatus } from './types'

/**
 * The single mapping from a draft's verdict to how it looks and what it is allowed to say.
 *
 * A6 guardrail: none of these strings may say "approved", "guaranteed to pass" or "safe to
 * publish" — every description names the internal review outcome only, never a claim about
 * what Meta (or any platform) will decide.
 */
export const DRAFT_STATUS_META: Record<
  DraftStatus,
  { label: string; tone: Tone; description: string }
> = {
  draft: {
    label: 'Draft',
    tone: 'neutral',
    description: 'Being edited. Not yet submitted for review.',
  },
  submitted_for_review: {
    label: 'Evaluating…',
    tone: 'info',
    description: 'An evaluation is queued or running.',
  },
  needs_changes: {
    label: 'Needs changes',
    tone: 'caution',
    description: 'The last evaluation found findings that require changes before this is ready.',
  },
  ready_for_manual_review: {
    label: 'Ready for manual review',
    tone: 'positive',
    description:
      'No blocking or warning findings under current internal checks. This does not guarantee platform approval — the operator publishes manually on the platform at their own judgment.',
  },
  blocked_by_internal_policy: {
    label: 'Blocked by internal policy',
    tone: 'attention',
    description:
      'A hard internal rule (a restricted/disabled account, critical account health, an unsafe landing-page target, or no linked account) makes manual publishing inadvisable under this workspace’s own configured policy.',
  },
  unknown_missing_evidence: {
    label: 'Unknown — missing evidence',
    tone: 'neutral',
    description:
      'Evaluation could not reach a confident result because required inputs are missing or a check failed. Unknown is never upgraded to ready automatically.',
  },
  archived: {
    label: 'Archived',
    tone: 'muted',
    description: 'Archived draft, excluded from active evaluation. History is retained.',
  },
}

export const FINDING_SEVERITY_META: Record<FindingSeverity, { label: string; tone: Tone }> = {
  blocking: { label: 'Blocking', tone: 'attention' },
  warning: { label: 'Warning', tone: 'caution' },
  info: { label: 'Info', tone: 'info' },
}

export const FINDING_STATUS_META: Record<FindingStatus, { label: string; tone: Tone; hint: string }> = {
  open: { label: 'Open', tone: 'neutral', hint: 'Not yet acted on.' },
  acknowledged: {
    label: 'Acknowledged',
    tone: 'caution',
    hint: 'Seen by an operator. Still counts toward the draft’s verdict.',
  },
  resolved: { label: 'Resolved', tone: 'positive', hint: 'Closed with a reason.' },
  superseded: {
    label: 'Superseded',
    tone: 'muted',
    hint: 'Replaced by a newer evaluation run of the same draft.',
  },
}

export const PREFLIGHT_DISCLAIMER =
  'Operational states recorded in this product. They are not a platform decision, and they do not guarantee that a draft will be approved or that an account cannot be restricted.'
