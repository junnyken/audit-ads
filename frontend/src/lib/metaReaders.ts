import type { TranslationKey, TranslationVars } from '../i18n'
import type { Tone } from './readiness'
import type { NotObservableReason, ReaderCredentialState } from './types'

/**
 * O4. Which tone each credential state is painted with — decided here, painted by tokens.
 *
 * `active` is deliberately `neutral`, never `positive`: a credential that reads today says
 * nothing about whether the accounts behind it are fine (rule 5's spirit). There is no "safe"
 * colour for a credential. A credential that reads nothing is `attention`, the strongest tone.
 */
export const READER_STATE_TONE: Record<ReaderCredentialState, Tone> = {
  active: 'neutral',
  expiring: 'caution',
  pending_verification: 'caution',
  reconnect_required: 'attention',
  revoked: 'muted',
}

const KNOWN_REASONS = new Set([
  'invalid_state', 'not_configured', 'vault_unavailable', 'not_authorized', 'login_cancelled',
  'code_missing', 'code_exchange_failed', 'token_check_failed', 'app_mismatch', 'invalid_token',
  'scope_missing', 'scope_too_broad', 'unsupported_token_type', 'business_manager_required',
  'user_mismatch', 'credential_revoked', 'business_not_readable', 'businesses_unreadable',
  'rate_limited', 'expired', 'password_changed', 'checkpointed', 'app_not_installed',
  'revoked_by_owner',
])

type T = (key: TranslationKey, vars?: TranslationVars) => string

/** A reason code from the server, as a sentence. An unknown code is shown as a code, never
 * guessed into a known one. */
export function readerReasonText(t: T, code: string | null | undefined): string {
  if (!code) return '—'
  if (KNOWN_REASONS.has(code)) return t(`metaReader.reasonText.${code}` as TranslationKey)
  return t('metaReader.reasonText.unknown', { code })
}

const NOT_OBSERVABLE: NotObservableReason[] = [
  'account_archived',
  'no_external_account_id',
  'no_business_manager',
  'no_production_connection',
  'no_reader',
  'reader_reconnect_required',
]

export function notObservableText(t: T, reason: string | null | undefined): string | null {
  if (!reason) return null
  if ((NOT_OBSERVABLE as string[]).includes(reason)) return t(`notObservable.${reason}` as TranslationKey)
  return t('metaReader.reasonText.unknown', { code: reason })
}

/** Where the Login callback lands: `/settings?meta_login=ok|error&reason=…&reader=…#meta-readers`. */
export function readCallbackParams(search: string): { outcome: 'ok' | 'error'; reason: string | null } | null {
  const params = new URLSearchParams(search)
  const outcome = params.get('meta_login')
  if (outcome !== 'ok' && outcome !== 'error') return null
  return { outcome, reason: params.get('reason') }
}

/** The reader as a label, never the raw `reader_source` string. */
export function readerSourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case 'vault':
      return 'Facebook Login (vault)'
    case 'vault_reconnect_required':
      return 'Facebook Login — needs reconnecting'
    case 'business_specific':
      return 'Own server reader for this Business Manager'
    case 'server_default':
      return 'Server default reader'
    case null:
    case undefined:
    case 'none':
      return null
    default:
      return source
  }
}
