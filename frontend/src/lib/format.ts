import { INTL_LOCALE, getActiveLanguage, translate } from '../i18n/translate'
import type { Language } from '../i18n/types'

/**
 * Date and number formatting. `vi-VN` is the default (U1 Q4); callers that pass nothing follow
 * the language the viewer selected (kept in step by `I18nProvider`), so a page that has not been
 * translated yet still shows dates the way the rest of the shell does.
 */

export function formatDateTime(
  value: string | null | undefined,
  language: Language = getActiveLanguage(),
): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  if (language === 'vi') {
    // dd/MM/yyyy HH:mm — written out, because Intl's vi-VN pattern puts the time first.
    const two = (n: number) => String(n).padStart(2, '0')
    return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
  }
  return date.toLocaleString(INTL_LOCALE[language], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelative(
  value: string | null | undefined,
  language: Language = getActiveLanguage(),
): string {
  if (!value) return translate(language, 'format.never')
  const date = new Date(value).getTime()
  if (Number.isNaN(date)) return translate(language, 'format.never')
  const seconds = Math.round((date - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(INTL_LOCALE[language], { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return translate(language, 'format.justNow')
}

/**
 * A calendar day as Meta/the API gives it (`YYYY-MM-DD`). Parsed by splitting, never through
 * `Date`, so the day cannot slip by one across a timezone. Anything else is returned untouched.
 */
export function formatDay(value: string | null | undefined, language: Language = getActiveLanguage()): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return language === 'vi' ? `${match[3]}/${match[2]}/${match[1]}` : value
}

/** Counts only. Meta money stays the raw string Meta returned (lib/spend.ts) — never run through this. */
export function formatCount(value: number, language: Language = getActiveLanguage()): string {
  return new Intl.NumberFormat(INTL_LOCALE[language]).format(value)
}
