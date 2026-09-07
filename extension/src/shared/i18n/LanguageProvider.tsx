import { createContext, useCallback, useContext as useReactContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readLanguage, writeLanguage } from '../storage'
import { translate } from './translate'
import type { Language, TranslationKey } from './types'

interface LanguageState {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageState | null>(null)

/**
 * Mounted once per extension surface (popup, side panel, options each render in a separate
 * document — see vite.config.ts's three entry points), so this reads its own copy of the
 * persisted preference on mount rather than assuming a single shared instance.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('vi')

  useEffect(() => {
    let cancelled = false
    void readLanguage().then((value) => {
      if (!cancelled) setLanguageState(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local' || !changes['adsops.language']) return
      setLanguageState(changes['adsops.language'].newValue === 'en' ? 'en' : 'vi')
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    void writeLanguage(next)
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageState {
  const value = useReactContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider')
  return value
}
