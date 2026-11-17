import type { Language, TranslationKey, TranslationVars } from './types'
import { vi } from './vi'

export const DEFAULT_LANGUAGE: Language = 'vi'
export const LANGUAGES: readonly Language[] = ['vi', 'en']

type Dictionary = Record<TranslationKey, string>

/**
 * Vietnamese is the default and ships in the entry bundle. English is the secondary language and is
 * loaded on demand (U1d): `loadDictionary('en')` imports `./en` as its own chunk, so a Vietnamese
 * session never downloads it. Until a dictionary is registered, `translate` answers in Vietnamese
 * rather than throwing — a half-loaded app shows the default language, not a crash.
 */
const DICTIONARIES: Partial<Record<Language, Dictionary>> = { vi }

export function isDictionaryLoaded(language: Language): boolean {
  return DICTIONARIES[language] !== undefined
}

/** Registers a dictionary directly (tests preload `en` this way; production uses `loadDictionary`). */
export function registerDictionary(language: Language, dictionary: Dictionary): void {
  DICTIONARIES[language] = dictionary
}

/** Test hook: forgets a loaded dictionary so the lazy-loading path can be exercised. */
export function unregisterDictionary(language: Language): void {
  if (language !== DEFAULT_LANGUAGE) delete DICTIONARIES[language]
}

export async function loadDictionary(language: Language): Promise<void> {
  if (DICTIONARIES[language]) return
  if (language === 'en') {
    const module = await import('./en')
    DICTIONARIES.en = module.en
  }
}

/** The BCP 47 tag handed to `Intl` for each language. Vietnamese is the default (Q4). */
export const INTL_LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-GB' }

export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in vars ? String(vars[token]) : match,
  )
}

export function translate(language: Language, key: TranslationKey, vars?: TranslationVars): string {
  const dictionary = DICTIONARIES[language] ?? vi
  return interpolate(dictionary[key] ?? vi[key], vars)
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
