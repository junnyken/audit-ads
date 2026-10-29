import { ApiError } from './api'
import { getActiveLanguage, translate } from '../i18n/translate'
import type { Language } from '../i18n/types'

/** Raw Meta money string with its currency. Never parsed, divided or reformatted. */
export function rawMoney(raw: string | null | undefined, currency: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  return currency ? `${raw} ${currency}` : raw
}

/** What a failed refresh call tells the operator. Distinguishes the documented refusals. */
export function refreshErrorMessage(error: unknown, language: Language = getActiveLanguage()): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return translate(language, 'spend.err.forbidden')
    if (error.status === 409 && error.code === 'entity_archived') return translate(language, 'spend.err.archived')
    if (error.status === 409) return translate(language, 'spend.err.unobservable', { detail: error.message })
    return error.message
  }
  return translate(language, 'spend.err.generic')
}

/** Formatted money for visual display (e.g., 33.966.582 ₫ or 12,345.67 USD) while keeping rawMoney for tests. */
export function prettyMoney(raw: string | null | undefined, currency: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  const num = Number(raw)
  if (!Number.isFinite(num)) return rawMoney(raw, currency)
  const curr = (currency || '').toUpperCase()
  if (curr === 'VND') {
    return `${Math.round(num).toLocaleString('vi-VN')} ₫`
  }
  const formatted = num.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
  return curr ? `${formatted} ${curr}` : formatted
}
