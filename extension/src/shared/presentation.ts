/**
 * How a state is worded and coloured, in one place.
 *
 * The dashboard keeps the same discipline in `lib/readiness.ts`, `lib/health.ts` and
 * `lib/alerts.ts`. Duplicating the *rule* here rather than the file keeps the extension
 * independently buildable while making a divergence a test failure rather than a surprise.
 *
 * `label`/`hint` fields hold a translation key, not literal text — resolve them with
 * `useLanguage().t(...)` at render time. Tone is never localized.
 */
import type { TranslationKey } from './i18n'

export type Tone = 'positive' | 'caution' | 'attention' | 'info' | 'neutral'

export const READINESS_META: Record<string, { label: TranslationKey; tone: Tone }> = {
  operationally_ready: { label: 'presentation.readiness.operationallyReady.label', tone: 'positive' },
  ready_with_warnings: { label: 'presentation.readiness.readyWithWarnings.label', tone: 'caution' },
  not_ready: { label: 'presentation.readiness.notReady.label', tone: 'attention' },
  unknown: { label: 'presentation.readiness.unknown.label', tone: 'neutral' },
}

export const HEALTH_META: Record<string, { label: TranslationKey; tone: Tone }> = {
  clear_signals: { label: 'presentation.health.clearSignals.label', tone: 'positive' },
  attention_needed: { label: 'presentation.health.attentionNeeded.label', tone: 'caution' },
  warning: { label: 'presentation.health.warning.label', tone: 'caution' },
  critical: { label: 'presentation.health.critical.label', tone: 'attention' },
  unknown: { label: 'presentation.health.unknown.label', tone: 'neutral' },
}

export const FRESHNESS_META: Record<string, { label: TranslationKey; tone: Tone }> = {
  current: { label: 'presentation.freshness.current.label', tone: 'positive' },
  stale: { label: 'presentation.freshness.stale.label', tone: 'caution' },
  never_evaluated: { label: 'presentation.freshness.neverEvaluated.label', tone: 'neutral' },
  not_applicable: { label: 'presentation.freshness.notApplicable.label', tone: 'neutral' },
}

export const CONTEXT_META: Record<string, { label: TranslationKey; tone: Tone; hint: TranslationKey }> = {
  confirmed: {
    label: 'presentation.context.confirmed.label',
    tone: 'positive',
    hint: 'presentation.context.confirmed.hint',
  },
  ambiguous: {
    label: 'presentation.context.ambiguous.label',
    tone: 'caution',
    hint: 'presentation.context.ambiguous.hint',
  },
  unknown: {
    label: 'presentation.context.unknown.label',
    tone: 'caution',
    hint: 'presentation.context.unknown.hint',
  },
  unsupported_page: {
    label: 'presentation.context.unsupportedPage.label',
    tone: 'neutral',
    hint: 'presentation.context.unsupportedPage.hint',
  },
}

export const EVENT_LABEL: Record<string, TranslationKey> = {
  manual_review_started: 'presentation.event.manualReviewStarted',
  manual_review_completed: 'presentation.event.manualReviewCompleted',
  campaign_change_intent: 'presentation.event.campaignChangeIntent',
  campaign_change_completed: 'presentation.event.campaignChangeCompleted',
  account_note_added: 'presentation.event.accountNoteAdded',
  policy_issue_reported: 'presentation.event.policyIssueReported',
  payment_issue_reported: 'presentation.event.paymentIssueReported',
}

export const GUARD_CHECKLIST: { id: string; label: TranslationKey }[] = [
  { id: 'context', label: 'presentation.guardChecklist.context' },
  { id: 'readiness', label: 'presentation.guardChecklist.readiness' },
  { id: 'alerts', label: 'presentation.guardChecklist.alerts' },
  { id: 'reason', label: 'presentation.guardChecklist.reason' },
]

export const DISCLAIMER_KEY: TranslationKey = 'presentation.disclaimer'
export const READ_ONLY_NOTE_KEY: TranslationKey = 'presentation.readOnlyNote'

export function toneClass(tone: Tone): string {
  return `badge badge--${tone}`
}
