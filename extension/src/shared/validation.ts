/**
 * Page reading and sanitisation, in the browser.
 *
 * Two things matter here:
 *  - the account id is the ONLY thing extracted from the query string, and the query string
 *    itself never leaves the browser;
 *  - an unrecognised route yields `null`, not a best guess. The backend sanitises again, so
 *    this layer is a convenience and the server is the guarantee.
 */
import type { PageType } from './types'

/** Route shapes we understand, in the order they are tested. */
const PATH_RULES: [RegExp, PageType][] = [
  [/^\/adsmanager\/manage\/campaigns\/?$/, 'campaign'],
  [/^\/adsmanager\/manage\/adsets\/?$/, 'adset'],
  [/^\/adsmanager\/manage\/ads\/?$/, 'ad'],
  [/^\/adsmanager\/manage\/accounts\/?$/, 'account'],
  [/^\/adsmanager\/manage\/?$/, 'account'],
  [/^\/adsmanager\/billing\/?$/, 'billing'],
  [/^\/ads\/manager\/account_settings.*$/, 'settings'],
  [/^\/settings\/?$/, 'settings'],
  [/^\/billing_hub\/accounts\/?$/, 'billing'],
  [/^\/billing_hub\/payment_activity\/?$/, 'billing'],
]

export const MAX_PATH_LENGTH = 120

/** `act_123`, `ACT-123` and `123` are the same account. Nothing else is normalised. */
export function canonicalAccountId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim().toLowerCase().replace(/^act[_-]/, '')
  if (!trimmed) return null
  return /^[a-z0-9][a-z0-9._-]{0,119}$/.test(trimmed) ? trimmed : null
}

/** The path, or null. Query and hash are dropped before anything is matched. */
export function sanitisePath(rawUrl: string | null | undefined): {
  safePath: string | null
  pageType: PageType
} {
  if (!rawUrl) return { safePath: null, pageType: 'unknown' }
  let path: string
  try {
    path = new URL(rawUrl, 'https://placeholder.invalid').pathname
  } catch {
    return { safePath: null, pageType: 'unknown' }
  }
  if (!path.startsWith('/') || path.length > MAX_PATH_LENGTH) {
    return { safePath: null, pageType: 'unknown' }
  }
  for (const [pattern, pageType] of PATH_RULES) {
    if (pattern.test(path)) return { safePath: path, pageType }
  }
  return { safePath: null, pageType: 'unknown' }
}

/**
 * Pull the ad account id out of a URL.
 *
 * Meta puts it in `act`, and sometimes in the path as `act_123456789`. Both are read; nothing
 * else in the query string is looked at, and none of it is returned.
 */
export function extractAccountId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  let url: URL
  try {
    url = new URL(rawUrl, 'https://placeholder.invalid')
  } catch {
    return null
  }
  const fromQuery = canonicalAccountId(url.searchParams.get('act'))
  if (fromQuery) return fromQuery
  const match = url.pathname.match(/\/act_(\d{5,})(?:\/|$)/)
  return match ? canonicalAccountId(match[1]) : null
}

/** Trim a page-supplied name for display. It is never used to match an account. */
export function displayNameFrom(title: string | null | undefined): string | null {
  if (!title) return null
  const cleaned = String(title)
    .replace(/\s+/g, ' ')
    .replace(/\s*[|·—-]\s*(Meta|Facebook)?\s*Ads Manager\s*$/i, '')
    .trim()
  return cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : null
}

/** A dashboard URL the extension is willing to talk to. */
export function isUsableDashboardUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    // Plain HTTP is allowed only for local development, never for a real host.
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}
