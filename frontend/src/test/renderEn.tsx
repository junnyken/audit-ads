import type { ReactElement, ReactNode } from 'react'
import { afterEach } from 'vitest'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import { I18nProvider, DEFAULT_LANGUAGE, setActiveLanguage } from '../i18n'

/**
 * `render`, but with the interface in English.
 *
 * Several suites written before the interface was translated assert the English wording of rules
 * (what a count must be shown next to, what may never be called "deleted"). They keep doing so,
 * unchanged, through this wrapper — which also exercises the English dictionary. The Vietnamese
 * default is covered by `u1f.meta-settings.test.tsx` and the suites that already use `vi`.
 */
afterEach(() => {
  localStorage.removeItem('adsops.language')
  setActiveLanguage(DEFAULT_LANGUAGE)
})

function English({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  localStorage.setItem('adsops.language', 'en')
  return rtlRender(ui, { wrapper: English, ...options })
}
