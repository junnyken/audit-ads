/**
 * Notices that a single-page app changed route.
 *
 * Ads Manager rewrites its URL without a page load, so a one-shot read at document_idle would
 * go stale the moment the operator clicks anything. This watches for URL changes only — it
 * observes no page content and mutates nothing.
 */
export type UrlListener = (href: string) => void

export interface UrlWatcher {
  stop: () => void
}

export const POLL_INTERVAL_MS = 1_000

export function watchUrl(
  target: { location: { href: string }; setInterval: typeof setInterval; clearInterval: typeof clearInterval },
  listener: UrlListener,
): UrlWatcher {
  let previous = target.location.href
  // A cheap interval rather than a MutationObserver over the document: watching the DOM of a
  // page this size costs real CPU on the operator's machine, and the only thing we care about
  // is the URL.
  const handle = target.setInterval(() => {
    const current = target.location.href
    if (current !== previous) {
      previous = current
      listener(current)
    }
  }, POLL_INTERVAL_MS)
  return { stop: () => target.clearInterval(handle) }
}
