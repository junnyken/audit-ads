/**
 * The content script entry point.
 *
 * It reports observations to the service worker and does nothing else. If any of this throws,
 * the page must be exactly as it was — an extension that breaks Ads Manager is worse than no
 * extension.
 */
import { observationsDiffer, observe } from './context-detector'
import { watchUrl } from './dom-observer'
import type { PageObservation } from '../shared/types'

let last: PageObservation | null = null

function report(observation: PageObservation): void {
  try {
    void chrome.runtime.sendMessage({ kind: 'observation', observation })
  } catch {
    /* the worker may be asleep or the context invalidated; the next change will retry */
  }
}

function tick(): void {
  try {
    const observation = observe(window.location, document.title)
    if (observationsDiffer(last, observation)) {
      last = observation
      report(observation)
    }
  } catch {
    /* never let a detector failure surface on the page */
  }
}

export function start(): void {
  tick()
  watchUrl(window, () => tick())
}

// Guarded so a failure here cannot break the host page in any way.
try {
  start()
} catch {
  /* intentionally silent */
}
