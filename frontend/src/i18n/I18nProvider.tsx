import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_LANGUAGE,
  INTL_LOCALE,
  isDictionaryLoaded,
  isLanguage,
  loadDictionary,
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

  // The English dictionary is a separate chunk. A stored 'en' waits for it before the first render
  // of the app, so English users never see a flash of Vietnamese; if it cannot be fetched, the
  // default language is the answer.
  const [ready, setReady] = useState(() => isDictionaryLoaded(language))

  useEffect(() => {
    setActiveLanguage(language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (ready) return
    let cancelled = false
    loadDictionary(language)
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setActiveLanguage(DEFAULT_LANGUAGE)
        setLanguageState(DEFAULT_LANGUAGE)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [language, ready])

  const setLanguage = useCallback((next: Language) => {
    const apply = () => {
      setActiveLanguage(next)
      setLanguageState(next)
      writeStoredLanguage(next)
    }
    if (isDictionaryLoaded(next)) {
      apply()
      return
    }
    // Switch only once the dictionary has arrived; on failure the current language stays.
    loadDictionary(next).then(apply, () => undefined)
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => translate(language, key, vars),
    [language],
  )

  const value = useMemo<I18nState>(
    () => ({ language, locale: INTL_LOCALE[language], setLanguage, t }),
    [language, setLanguage, t],
  )

  if (!ready) return null
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nState {
  return useContext(I18nContext)
}

