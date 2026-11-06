import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
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
import { applyDomLanguage } from './domAutoTranslate'
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

  const [ready, setReady] = useState(() => isDictionaryLoaded(language))

  useEffect(() => {
    setActiveLanguage(language)
    document.documentElement.lang = language
  }, [language])

  useLayoutEffect(() => {
    if (!ready || typeof document === 'undefined' || !document.body) return
    let applying = false
    const runApply = () => {
      if (applying || !document.body) return
      applying = true
      try {
        applyDomLanguage(language, document.body)
      } finally {
        applying = false
      }
    }

    runApply()
    const rafId = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(runApply) : 0
    const t1 = setTimeout(runApply, 60)
    const t2 = setTimeout(runApply, 250)

    if (language !== 'en' || typeof MutationObserver === 'undefined') {
      return () => {
        if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }

    const observer = new MutationObserver(() => {
      runApply()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label'],
    })

    return () => {
      if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
      clearTimeout(t1)
      clearTimeout(t2)
      observer.disconnect()
    }
  }, [language, ready])

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
