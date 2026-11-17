import { en } from './en'
import type { Language, TranslationKey } from './types'
import { vi } from './vi'

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { vi, en }

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in vars ? String(vars[token]) : match,
  )
}

export function translate(
  language: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  return interpolate(DICTIONARIES[language][key], vars)
}
