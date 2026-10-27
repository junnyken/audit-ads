import { useI18n } from './I18nProvider'
import type { TranslationKey } from './types'
import { vi } from './vi'

/**
 * Labels for server enums (`readiness_status`, `account_status`, ...). The mapping lives in the
 * dictionaries as `<prefix>.<value>`, replacing the old helper that prettified the raw enum (U1b; removed in U1d).
 * A value the client does not know is shown as the raw code, never as a guessed label: the code
 * is what the server said, and an invented friendly word could claim more than we know.
 */
export function hasKey(key: string): key is TranslationKey {
  return key in vi
}

export function useEnumLabel() {
  const { t } = useI18n()
  return (prefix: string, value: string | null | undefined): string => {
    if (value === null || value === undefined || value === '') return '—'
    const key = `${prefix}.${value}`
    return hasKey(key) ? t(key) : value
  }
}
