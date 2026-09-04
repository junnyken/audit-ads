import type { EvidenceStatus, ReadinessStatus, ReviewStatus } from './types'

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

export const TONE_CLASS: Record<Tone, string> = {
  positive: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  caution: 'bg-amber-50 text-amber-900 border-amber-200',
  attention: 'bg-rose-50 text-rose-800 border-rose-200',
  info: 'bg-sky-50 text-sky-900 border-sky-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300',
  muted: 'bg-surface-sunken text-ink-faint border-line',
}

export const TONE_DOT: Record<Tone, string> = {
  positive: 'bg-emerald-500',
  caution: 'bg-amber-500',
  attention: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-400',
  muted: 'bg-line-strong',
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
