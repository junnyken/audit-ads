import type { EvidenceStatus, ReadinessStatus, ReviewStatus, SpendFreshness } from './types'

export type Tone = 'positive' | 'caution' | 'attention' | 'info' | 'neutral' | 'muted'

/**
 * The single mapping from a readiness state to how it looks.
 *
 * Centralised on purpose: A1 Guardrail 10 forbids success styling for `unknown` and
 * `not_ready`, and a rule spread across pages is a rule that eventually gets broken on one of
 * them. Only `operationally_ready` is ever green.
 */
export const READINESS_META: Record<
  ReadinessStatus,
  { label: string; tone: Tone; description: string }
> = {
  operationally_ready: {
    label: 'Operationally ready',
    tone: 'positive',
    description:
      'Every required item is satisfied, the manual review is current, and no warning or critical event is unresolved.',
  },
  ready_with_warnings: {
    label: 'Ready with warnings',
    tone: 'caution',
    description: 'Required items are satisfied, but at least one warning event is unresolved.',
  },
  not_ready: {
    label: 'Not ready',
    tone: 'attention',
    description:
      'Something recorded is blocking this account: a restricted status, an unresolved critical event, or a failed/expired required item.',
  },
  unknown: {
    label: 'Unknown',
    tone: 'neutral',
    description:
      'Evidence is missing, stale or incomplete, so readiness cannot be determined. Unknown is not a pass.',
  },
}

/**
 * How each tone is painted. Since U1a the values are design-token classes (`tone-*`, declared in
 * `src/index.css` from the variables in `src/tokens.css`), not raw palette classes: the colours
 * live in one stylesheet for light and dark, while the decision of WHICH state gets WHICH tone
 * still lives here and in the `*_META` maps beside it. A state's tone never depends on the theme.
 */
export const TONE_CLASS: Record<Tone, string> = {
  positive: 'tone-positive',
  caution: 'tone-caution',
  attention: 'tone-attention',
  info: 'tone-info',
  neutral: 'tone-neutral',
  muted: 'tone-muted',
}

export const TONE_DOT: Record<Tone, string> = {
  positive: 'tone-dot-positive',
  caution: 'tone-dot-caution',
  attention: 'tone-dot-attention',
  info: 'tone-dot-info',
  neutral: 'tone-dot-neutral',
  muted: 'tone-dot-muted',
}

export function accountStatusTone(status: string): Tone {
  switch (status) {
    case 'active':
      return 'positive'
    case 'warning':
      return 'caution'
    case 'restricted':
    case 'disabled':
      return 'attention'
    case 'archived':
      return 'muted'
    default:
      return 'neutral'
  }
}

export function evidenceTone(status: EvidenceStatus): Tone {
  switch (status) {
    case 'verified':
      return 'positive'
    case 'provided':
      return 'caution'
    case 'expired':
    case 'rejected':
      return 'attention'
    default:
      return 'neutral'
  }
}

export function reviewTone(status: ReviewStatus): Tone {
  switch (status) {
    case 'completed':
      return 'positive'
    case 'in_review':
      return 'caution'
    case 'needs_update':
      return 'attention'
    case 'waived':
      return 'caution'
    default:
      return 'neutral'
  }
}

export function itemStateTone(state: string): Tone {
  switch (state) {
    case 'satisfied':
      return 'positive'
    case 'problem':
      return 'attention'
    case 'unknown':
      return 'neutral'
    default:
      return 'muted'
  }
}

export function severityTone(severity: string): Tone {
  switch (severity) {
    case 'critical':
      return 'attention'
    case 'warning':
      return 'caution'
    default:
      return 'neutral'
  }
}

export const READINESS_DISCLAIMER =
  'Readiness is an internal operational state derived from recorded evidence. It is not a platform approval, and it is not a guarantee against restriction.'

/**
 * Spend freshness (S1). Describes how recent the stored Meta read is, never how the account is
 * doing — so NO state here is `positive`. `current` only means the last read is recent enough to
 * trust the number's age; it is neutral. `never_observed` (nothing was ever read) and `stale`
 * (a read exists but is old) are different states and must never be merged (rule 28).
 */
export const SPEND_FRESHNESS_META: Record<
  SpendFreshness,
  { label: string; tone: Tone; description: string }
> = {
  current: {
    label: 'Current',
    tone: 'neutral',
    description: 'The latest successful Meta read is within the configured freshness window.',
  },
  stale: {
    label: 'Stale',
    tone: 'caution',
    description: 'A successful read exists, but it is older than the freshness window.',
  },
  never_observed: {
    label: 'Never observed',
    tone: 'neutral',
    description: 'No successful spend read has ever been recorded for this account.',
  },
  not_observable: {
    label: 'Not observable',
    tone: 'muted',
    description: 'No connection can read this account, so spend cannot be observed.',
  },
}

/** F1. A recorded second factor is an operational reference, not evidence an account is secure.
 * In particular `none` and `unknown` must never be green (CLAUDE.md rule 5). */
export function twoFactorTone(method: string): Tone {
  switch (method) {
    case 'none': return 'caution'
    case 'app':
    case 'sms':
    case 'security_key': return 'info'
    default: return 'neutral'
  }
}
