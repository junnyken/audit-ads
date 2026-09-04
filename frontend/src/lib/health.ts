import type { Tone } from './readiness'
import type { HealthStatus, FreshnessStatus, SignalSeverity, SignalStatus } from './types'

/**
 * The single mapping from a health state to how it looks and what it is allowed to say.
 *
 * Two rules are enforced here rather than per page, because a rule spread across pages is a
 * rule that eventually gets broken on one of them:
 *   - `unknown` is never green — it means "we cannot tell", not "nothing found";
 *   - `clear_signals` is described only as "no current issues found by configured checks",
 *     never as safe, protected, approved or immune.
 */
export const HEALTH_META: Record<
  HealthStatus,
  { label: string; tone: Tone; description: string }
> = {
  critical: {
    label: 'Critical',
    tone: 'attention',
    description: 'At least one unresolved critical signal is open on this account.',
  },
  warning: {
    label: 'Warning',
    tone: 'caution',
    description: 'At least one unresolved warning signal is open, and no critical signal is open.',
  },
  attention_needed: {
    label: 'Attention needed',
    tone: 'info',
    description: 'No warning or critical signal is open, but something needs attention.',
  },
  unknown: {
    label: 'Unknown health',
    tone: 'neutral',
    description:
      'There is not enough current evidence to assess this account. Unknown is not a clear result.',
  },
  clear_signals: {
    label: 'Clear signals',
    tone: 'positive',
    description:
      'No current issues found by configured checks. This describes the configured checks only; it is not a platform approval and it is not a guarantee against restriction.',
  },
}

/** Freshness is deliberately never green: it describes the data, not the account. */
export const FRESHNESS_META: Record<
  FreshnessStatus,
  { label: string; tone: Tone; description: string }
> = {
  current: {
    label: 'Current',
    tone: 'neutral',
    description: 'The last health evaluation is within the configured interval.',
  },
  stale: {
    label: 'Stale',
    tone: 'caution',
    description:
      'The last health evaluation is older than the configured interval, so this account is reported as unknown rather than clear.',
  },
  unknown: {
    label: 'Not evaluated',
    tone: 'neutral',
    description: 'Health has never been evaluated for this account.',
  },
  not_applicable: {
    label: 'Not applicable',
    tone: 'muted',
    description: 'Archived accounts are excluded from active health evaluation.',
  },
}

export const SEVERITY_META: Record<SignalSeverity, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'attention' },
  warning: { label: 'Warning', tone: 'caution' },
  attention: { label: 'Attention', tone: 'info' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const SIGNAL_STATUS_META: Record<SignalStatus, { label: string; tone: Tone; hint: string }> = {
  open: { label: 'Open', tone: 'attention', hint: 'Active and counting towards this account’s health.' },
  acknowledged: {
    label: 'Acknowledged',
    tone: 'caution',
    hint: 'You recorded that you have seen it. It still counts towards health until it is resolved.',
  },
  resolved: { label: 'Resolved', tone: 'positive', hint: 'Closed. The historical record remains.' },
  expired: { label: 'Expired', tone: 'muted', hint: 'No longer evaluated. The historical record remains.' },
  superseded: {
    label: 'Superseded',
    tone: 'muted',
    hint: 'A newer signal replaced this one after the evidence changed.',
  },
}

export const HEALTH_DISCLAIMER =
  'Account health is an internal operational state derived from records you entered. Clear signals means no current issues were found by the configured checks; it is not a platform approval, not a safety guarantee, and not a prediction of enforcement.'

export const RECALCULATE_EXPLANATION =
  'Recalculating re-reads the evidence, checklist and events already stored here. It does not contact any advertising platform and changes nothing outside this product.'

export const RESOLVE_DISCLAIMER =
  'Resolving records an internal workflow outcome. It does not assert that any platform has approved, restored or cleared this account, and it does not change the underlying event or checklist item.'
