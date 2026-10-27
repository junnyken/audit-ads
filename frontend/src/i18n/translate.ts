import { en } from './en'
import type { Language, TranslationKey, TranslationVars } from './types'
import { vi } from './vi'

export const DEFAULT_LANGUAGE: Language = 'vi'
export const LANGUAGES: readonly Language[] = ['vi', 'en']

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { vi, en }

/** The BCP 47 tag handed to `Intl` for each language. Vietnamese is the default (Q4). */
export const INTL_LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-GB' }

export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in vars ? String(vars[token]) : match,
  )
}

export function translate(language: Language, key: TranslationKey, vars?: TranslationVars): string {
  return interpolate(DICTIONARIES[language][key], vars)
}

export function isLanguage(value: unknown): value is Language {
  return value === 'vi' || value === 'en'
}

/**
 * The language non-React code (`lib/format.ts`) formats with. `I18nProvider` keeps it in step
 * with the viewer's choice, so a date rendered by a page that has not been translated yet still
 * follows the selected language.
 */
let activeLanguage: Language = DEFAULT_LANGUAGE

export function getActiveLanguage(): Language {
  return activeLanguage
}

export function setActiveLanguage(language: Language): void {
  activeLanguage = language
}
