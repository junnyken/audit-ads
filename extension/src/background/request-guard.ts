import type { WorkerRequest } from '../shared/types'
import { canonicalAccountId, displayNameFrom, extractAccountId, normalizeDashboardOrigin, sanitisePath } from '../shared/validation'

const events = new Set(['extension_context_confirmed', 'extension_context_ambiguous', 'extension_context_unknown', 'manual_review_started', 'manual_review_completed', 'campaign_change_intent', 'campaign_change_completed', 'account_note_added', 'policy_issue_reported', 'payment_issue_reported'])
const fields: Record<string, string[]> = {
  observation: ['kind', 'observation'], getContext: ['kind', 'tabId'], getConnection: ['kind'],
  connect: ['kind', 'dashboardUrl', 'email', 'password', 'label'], disconnect: ['kind', 'reason'],
  setDashboardUrl: ['kind', 'dashboardUrl'], recordEvent: ['kind', 'adAccountId', 'eventType', 'note'],
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}
function origin(value: unknown): boolean {
  try { return typeof value === 'string' && Boolean(normalizeDashboardOrigin(value)) } catch { return false }
}
/** No casts from the message boundary until both provenance and shape have been checked. */
export function allowedRequest(value: unknown, sender: chrome.runtime.MessageSender): value is WorkerRequest {
  if (sender.id !== chrome.runtime.id || !record(value) || typeof value.kind !== 'string') return false
  const allowed = Object.hasOwn(fields, value.kind) ? fields[value.kind] : undefined
  if (!allowed || Object.keys(value).some(key => !allowed.includes(key))) return false
  if (value.kind === 'observation') {
    if (!Number.isSafeInteger(sender.tab?.id) || sender.tab!.id! < 0 || sender.frameId !== 0 || !sender.url || !record(value.observation)) return false
    let url: URL
    try { url = new URL(sender.url) } catch { return false }
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !['adsmanager.facebook.com', 'business.facebook.com', 'www.facebook.com'].includes(url.hostname)) return false
    if (url.hostname === 'www.facebook.com' && !url.pathname.startsWith('/adsmanager/')) return false
    const detected = sanitisePath(url.href)
    const o = value.observation
    if (!detected.safePath || Object.keys(o).sort().join(',') !== 'displayName,externalAccountId,pageType,safePath') return false
    return o.safePath === detected.safePath && o.pageType === detected.pageType &&
      o.externalAccountId === extractAccountId(url.href) &&
      (o.externalAccountId === null || (typeof o.externalAccountId === 'string' && canonicalAccountId(o.externalAccountId) === o.externalAccountId)) &&
      (o.displayName === null || (text(o.displayName, 120, 2) && displayNameFrom(o.displayName) === o.displayName))
  }
  if (sender.frameId !== undefined && sender.frameId !== 0) return false
  if (!['options/options.html', 'popup/popup.html', 'sidepanel/sidepanel.html'].some(path => sender.url === chrome.runtime.getURL(path))) return false
  switch (value.kind) {
    case 'getConnection': return true
    case 'getContext': return value.tabId === undefined || (Number.isSafeInteger(value.tabId) && (value.tabId as number) >= 0)
    case 'setDashboardUrl': return origin(value.dashboardUrl)
    case 'connect': return origin(value.dashboardUrl) && text(value.email, 320, 1) && text(value.password, 4096, 1) && text(value.label, 120)
    case 'disconnect': return text(value.reason, 500)
    case 'recordEvent': return text(value.adAccountId, 120, 1) && text(value.eventType, 80) && events.has(value.eventType) && text(value.note, 4000)
    default: return false
  }
}
