import type {
  AccountStatus,
  PlatformAccountStatus,
  PlatformStatusClass,
  PlatformStatusCompact,
  SpendFreshness,
} from './types'
import type { Tone } from './readiness'
import { formatDateTime, formatRelative } from './format'

/**
 * S2 — how Meta's account status looks. The ONLY place that decides its colour (rule 5).
 *
 * Decided 2026-10-27 (S2 §7, 6.3): **no state is ever `positive`**. "Active per Meta" is the code
 * Meta returned at one moment for one reader; it is not a statement that the account is fine, so
 * it is neutral and always shown with the time it was observed. Not-operable states are
 * `attention`, pending payment/review states `caution`, an unrecognised code `neutral`, and "no
 * status observed" is muted "—".
 *
 * Labels are proposed wording for BA review (`docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` §4b).
 */
export const PLATFORM_STATUS_META: Record<
  PlatformAccountStatus,
  { label: string; tone: Tone; description: string }
> = {
  active: {
    label: 'Active (Meta)',
    tone: 'neutral',
    description:
      'Meta returned account_status 1 (ACTIVE) at the time shown. It is not a statement that the account will stay active.',
  },
  disabled: {
    label: 'Disabled (Meta)',
    tone: 'attention',
    description: 'Meta returned account_status 2 (DISABLED).',
  },
  unsettled: {
    label: 'Unsettled balance (Meta)',
    tone: 'caution',
    description: 'Meta returned account_status 3 (UNSETTLED).',
  },
  pending_risk_review: {
    label: 'Pending risk review (Meta)',
    tone: 'caution',
    description: 'Meta returned account_status 7 (PENDING_RISK_REVIEW).',
  },
  pending_settlement: {
    label: 'Pending settlement (Meta)',
    tone: 'caution',
    description: 'Meta returned account_status 8 (PENDING_SETTLEMENT).',
  },
  in_grace_period: {
    label: 'In grace period (Meta)',
    tone: 'caution',
    description: 'Meta returned account_status 9 (IN_GRACE_PERIOD).',
  },
  pending_closure: {
    label: 'Pending closure (Meta)',
    tone: 'attention',
    description: 'Meta returned account_status 100 (PENDING_CLOSURE).',
  },
  closed: {
    label: 'Closed (Meta)',
    tone: 'attention',
    description: 'Meta returned account_status 101 (CLOSED).',
  },
  unknown: {
    label: 'Unrecognised status code',
    tone: 'neutral',
    description:
      'Meta returned a status code this product does not recognise, so the status is unknown. Unknown is not a pass.',
  },
}

export const PLATFORM_STATUS_NONE = {
  label: '—',
  tone: 'muted' as Tone,
  description: 'Status not observed: no Meta read for this account has carried a status code.',
}

export const PLATFORM_STATUS_CLASS_META: Record<PlatformStatusClass, { label: string; tone: Tone }> = {
  blocking: { label: 'Not operable', tone: 'attention' },
  pending: { label: 'Pending', tone: 'caution' },
  unknown: { label: 'Unrecognised code', tone: 'neutral' },
  none: { label: 'Not observed', tone: 'muted' },
  active: { label: 'Active (Meta)', tone: 'neutral' },
}

/** Meta's own constant names (shown verbatim) with a short gloss interpreted from the name. The
 * meanings are not documented by Meta and are not verified here. */
export const DISABLE_REASON_LABEL: Record<string, string> = {
  none: 'NONE',
  ads_integrity_policy: 'ADS_INTEGRITY_POLICY — advertising policy',
  ads_ip_review: 'ADS_IP_REVIEW — intellectual property review',
  risk_payment: 'RISK_PAYMENT — payment',
  gray_account_shut_down: 'GRAY_ACCOUNT_SHUT_DOWN',
  ads_afc_review: 'ADS_AFC_REVIEW — review (Meta gives no detail)',
  business_integrity_rar: 'BUSINESS_INTEGRITY_RAR — business integrity',
  permanent_close: 'PERMANENT_CLOSE — permanently closed',
  unused_reseller_account: 'UNUSED_RESELLER_ACCOUNT',
  unused_account: 'UNUSED_ACCOUNT — unused account',
  umbrella_ad_account: 'UMBRELLA_AD_ACCOUNT',
  business_manager_integrity_policy: 'BUSINESS_MANAGER_INTEGRITY_POLICY — Business Manager policy',
  misrepresented_ad_account: 'MISREPRESENTED_AD_ACCOUNT',
  aoab_deshare_legal_entity: 'AOAB_DESHARE_LEGAL_ENTITY',
  ctx_thread_review: 'CTX_THREAD_REVIEW — review',
  compromised_ad_account: 'COMPROMISED_AD_ACCOUNT — account compromised',
}

export function disableReasonText(reason: string | null | undefined, raw: string | null | undefined): string {
  if (reason === null || reason === undefined) return '—'
  if (reason === 'unknown') return `Unrecognised code ${raw ?? ''}`.trim()
  const label = DISABLE_REASON_LABEL[reason] ?? reason.toUpperCase()
  return raw ? `${label} (${raw})` : label
}

const FRESHNESS_CONTEXT: Partial<Record<SpendFreshness, string>> = {
  stale: 'last word, not recent',
  not_observable: 'last word, no reader now',
}

/** Everything a badge needs. `null`/`undefined` → muted "—", never a default state. */
export function platformStatusBadge(value: PlatformStatusCompact | null | undefined): {
  label: string
  tone: Tone
  title: string
  context: string | null
} {
  if (!value) {
    return { label: PLATFORM_STATUS_NONE.label, tone: PLATFORM_STATUS_NONE.tone, title: PLATFORM_STATUS_NONE.description, context: null }
  }
  const meta = PLATFORM_STATUS_META[value.status] ?? PLATFORM_STATUS_META.unknown
  const label =
    value.status === 'unknown' || !PLATFORM_STATUS_META[value.status]
      ? `${PLATFORM_STATUS_META.unknown.label} ${value.account_status_raw}`
      : meta.label
  const freshness = FRESHNESS_CONTEXT[value.freshness]
  const context = `per Meta · ${formatRelative(value.observed_at)}${freshness ? ` · ${freshness}` : ''}`
  return {
    label,
    tone: meta.tone,
    title: `${meta.description} Observed ${formatDateTime(value.observed_at)}.`,
    context,
  }
}

/**
 * What the "Record Meta status in the registry" button pre-fills in the edit drawer (S2 §7, 6.5).
 * Only the two unambiguous codes map; every other state opens the drawer without a suggestion and
 * a person chooses. Nothing is ever written without that person saving the form (rule 11).
 */
export function recordedStatusSuggestion(status: PlatformAccountStatus | null | undefined): AccountStatus | null {
  if (status === 'disabled') return 'disabled'
  if (status === 'active') return 'active'
  return null
}
