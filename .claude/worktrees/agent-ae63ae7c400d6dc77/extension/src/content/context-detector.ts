/**
 * Reads the page. Nothing else.
 *
 * The whole surface is: the URL, and the document title. It does not touch cookies,
 * localStorage, sessionStorage, IndexedDB, network traffic, form values or page text, and it
 * never writes to the host document — the extension's UI lives in the popup and side panel,
 * which are extension pages.
 */
import { displayNameFrom, extractAccountId, sanitisePath } from '../shared/validation'
import type { PageObservation } from '../shared/types'

export function observe(location: { href: string }, title: string | null): PageObservation {
  const { safePath, pageType } = sanitisePath(location.href)
  return {
    // The id is read from the query string; the query string itself goes no further.
    externalAccountId: extractAccountId(location.href),
    safePath,
    pageType,
    // Display only. The backend never matches on it.
    displayName: displayNameFrom(title),
  }
}

export function observationsDiffer(a: PageObservation | null, b: PageObservation): boolean {
  if (!a) return true
  return (
    a.externalAccountId !== b.externalAccountId ||
    a.safePath !== b.safePath ||
    a.pageType !== b.pageType
  )
}
