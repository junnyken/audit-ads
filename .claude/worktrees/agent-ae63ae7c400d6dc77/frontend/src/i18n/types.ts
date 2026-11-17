import type { vi } from './vi'

export type Language = 'vi' | 'en'
export type TranslationKey = keyof typeof vi
export type TranslationVars = Record<string, string | number>
