/**
 * How a state is worded and coloured, in one place.
 *
 * The dashboard keeps the same discipline in `lib/readiness.ts`, `lib/health.ts` and
 * `lib/alerts.ts`. Duplicating the *rule* here rather than the file keeps the extension
 * independently buildable while making a divergence a test failure rather than a surprise.
 */
export type Tone = 'positive' | 'caution' | 'attention' | 'info' | 'neutral'

export const READINESS_META: Record<string, { label: string; tone: Tone }> = {
  operationally_ready: { label: 'Operationally ready', tone: 'positive' },
  ready_with_warnings: { label: 'Ready with warnings', tone: 'caution' },
  not_ready: { label: 'Not ready', tone: 'attention' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const HEALTH_META: Record<string, { label: string; tone: Tone }> = {
  clear_signals: { label: 'No current issues found', tone: 'positive' },
  attention_needed: { label: 'Attention needed', tone: 'caution' },
  warning: { label: 'Warning', tone: 'caution' },
  critical: { label: 'Critical', tone: 'attention' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const FRESHNESS_META: Record<string, { label: string; tone: Tone }> = {
  current: { label: 'Current', tone: 'positive' },
  stale: { label: 'Stale', tone: 'caution' },
  never_evaluated: { label: 'Never evaluated', tone: 'neutral' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
}

export const CONTEXT_META: Record<string, { label: string; tone: Tone; hint: string }> = {
  confirmed: {
    label: 'Confirmed',
    tone: 'positive',
    hint: 'This page matches a registered account by exact account id.',
  },
  ambiguous: {
    label: 'Not confirmed',
    tone: 'caution',
    hint: 'This page could not be matched to one registered account safely.',
  },
  unknown: {
    label: 'Not registered',
    tone: 'caution',
    hint: 'No registered account matches the account id on this page.',
  },
  unsupported_page: {
    label: 'Not an Ads Manager page',
    tone: 'neutral',
    hint: 'Open an Ads Manager page to see account context.',
  },
}

export const EVENT_LABEL: Record<string, string> = {
  manual_review_started: 'Manual review started',
  manual_review_completed: 'Manual review completed',
  campaign_change_intent: 'Change intent recorded',
  campaign_change_completed: 'Change completed',
  account_note_added: 'Note added',
  policy_issue_reported: 'Policy issue reported',
  payment_issue_reported: 'Payment issue reported',
}

export const GUARD_CHECKLIST: { id: string; label: string }[] = [
  { id: 'context', label: 'Context is confirmed by exact account id' },
  { id: 'readiness', label: 'I reviewed the account readiness' },
  { id: 'alerts', label: 'I reviewed active critical alerts' },
  { id: 'reason', label: 'I recorded why I am making this change' },
]

export const DISCLAIMER =
  'Operational states recorded in this product. They are not a platform decision, and they do ' +
  'not guarantee that an account cannot be restricted.'

export const READ_ONLY_NOTE =
  'This extension reads the page and shows what this product already knows. It changes nothing ' +
  'in Ads Manager.'

export function toneClass(tone: Tone): string {
  return `badge badge--${tone}`
}
