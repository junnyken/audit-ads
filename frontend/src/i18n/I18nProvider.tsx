import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_LANGUAGE,
  INTL_LOCALE,
  isLanguage,
  setActiveLanguage,
  translate,
} from './translate'
import type { Language, TranslationKey, TranslationVars } from './types'

const STORAGE_KEY = 'adsops.language'

interface I18nState {
  language: Language
  /** BCP 47 tag for `Intl` (e.g. `vi-VN`). */
  locale: string
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, vars?: TranslationVars) => string
}

function readStoredLanguage(): Language {
  // Storage can throw (private mode, blocked storage); the default language is the answer then.
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_LANGUAGE
}

function writeStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* the choice still applies for this session */
  }
}

// A component rendered outside the provider (a unit test, mostly) gets Vietnamese rather than a
// crash: the default language is a real answer, not a missing one.
const FALLBACK: I18nState = {
  language: DEFAULT_LANGUAGE,
  locale: INTL_LOCALE[DEFAULT_LANGUAGE],
  setLanguage: () => undefined,
  t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
}

const I18nContext = createContext<I18nState>(FALLBACK)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = readStoredLanguage()
    setActiveLanguage(initial)
    return initial
  })

  useEffect(() => {
    setActiveLanguage(language)
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    setActiveLanguage(next)
    setLanguageState(next)
    writeStoredLanguage(next)
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => translate(language, key, vars),
    [language],
  )

  const value = useMemo<I18nState>(
    () => ({ language, locale: INTL_LOCALE[language], setLanguage, t }),
    [language, setLanguage, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  return useContext(I18nContext)
}

