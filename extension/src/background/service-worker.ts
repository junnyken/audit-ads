/**
 * MV3 service worker: the extension's only network caller and its only holder of the session.
 *
 * The content script observes and reports; the pages render. Neither can reach the API, so the
 * session token exists in exactly one place.
 */
import { apiRequest, ApiError } from './api-client'
import { connect, disconnect, currentConnection, withSession, EXTENSION_VERSION } from './auth-session'
import {
  clearCachedContext,
  readCachedContext,
  readSettings,
  writeCachedContext,
  writeSettings,
} from '../shared/storage'
import type {
  ContextResolution,
  PageObservation,
  WorkerRequest,
  WorkerResponse,
} from '../shared/types'

/** The last observation each tab reported, so the popup can ask "what am I looking at?". */
const observations = new Map<number, PageObservation>()

function cacheKey(observation: PageObservation): string {
  return `${observation.externalAccountId ?? '-'}|${observation.safePath ?? '-'}`
}

const UNSUPPORTED: ContextResolution = {
  context_status: 'unsupported_page',
  reason_code: 'unsupported_page',
  message: 'This page is not a recognised Ads Manager route.',
  page_type: 'unknown',
  safe_path: null,
}

async function resolveContext(
  tabId: number | undefined,
  observation: PageObservation,
): Promise<ContextResolution> {
  if (!observation.safePath) return UNSUPPORTED

  const key = cacheKey(observation)
  if (tabId !== undefined) {
    const cached = await readCachedContext(tabId, key)
    if (cached) return cached
  }

  const resolution = await withSession((baseUrl, token) =>
    apiRequest<ContextResolution>(baseUrl, '/api/v1/extension/context/resolve', {
      method: 'POST',
      token,
      body: {
        external_account_id: observation.externalAccountId,
        page_type: observation.pageType,
        safe_path: observation.safePath,
        extension_version: EXTENSION_VERSION,
      },
    }),
  )
  if (tabId !== undefined) await writeCachedContext(tabId, key, resolution)
  return resolution
}

async function handle(
  request: WorkerRequest,
  sender: chrome.runtime.MessageSender,
): Promise<WorkerResponse> {
  switch (request.kind) {
    case 'observation': {
      const tabId = sender.tab?.id
      if (tabId !== undefined) observations.set(tabId, request.observation)
      return { ok: true }
    }

    case 'getContext': {
      let tabId = request.tabId
      if (tabId === undefined) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        tabId = tab?.id
      }
      if (tabId === undefined) return { ok: true, data: UNSUPPORTED }
      const observation = observations.get(tabId)
      if (!observation) return { ok: true, data: UNSUPPORTED }
      try {
        return { ok: true, data: await resolveContext(tabId, observation) }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }

    case 'getConnection': {
      const [connection, settings] = await Promise.all([currentConnection(), readSettings()])
      return {
        ok: true,
        data: {
          connected: Boolean(connection),
          dashboardUrl: settings.dashboardUrl,
          workspaceName: connection?.workspaceName ?? null,
          userEmail: connection?.userEmail ?? null,
          expiresAt: connection?.expiresAt ?? null,
          error: null,
        },
      }
    }

    case 'connect': {
      try {
        const connection = await connect({
          dashboardUrl: request.dashboardUrl,
          email: request.email,
          password: request.password,
          label: request.label,
        })
        return {
          ok: true,
          data: {
            connected: true,
            dashboardUrl: (await readSettings()).dashboardUrl,
            workspaceName: connection.workspaceName,
            userEmail: connection.userEmail,
            expiresAt: connection.expiresAt,
            error: null,
          },
        }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }

    case 'disconnect': {
      await disconnect(request.reason)
      return { ok: true }
    }

    case 'setDashboardUrl': {
      await writeSettings({ dashboardUrl: request.dashboardUrl.replace(/\/+$/, '') })
      return { ok: true }
    }

    case 'recordEvent': {
      const tabId = sender.tab?.id
      const observation = tabId !== undefined ? observations.get(tabId) : undefined
      try {
        const created = await withSession((baseUrl, token) =>
          apiRequest(baseUrl, '/api/v1/extension/events', {
            method: 'POST',
            token,
            body: {
              ad_account_id: request.adAccountId,
              event_type: request.eventType,
              note: request.note,
              page_type: observation?.pageType ?? 'unknown',
              safe_path: observation?.safePath ?? null,
              extension_version: EXTENSION_VERSION,
            },
          }),
        )
        // The account's state may have changed, so the cached summary is no longer the truth.
        if (tabId !== undefined) await clearCachedContext(tabId)
        return { ok: true, data: created }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    }

    default:
      return { ok: false, error: 'Unknown request.' }
  }
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'not_connected') return 'Connect the extension in Options first.'
    return error.message
  }
  // Never surface a raw exception: it can carry a URL or an internal detail, and it tells the
  // operator nothing they can act on.
  return 'The dashboard could not be reached. Check the dashboard URL in Options.'
}

chrome.runtime.onMessage.addListener((request: WorkerRequest, sender, sendResponse) => {
  handle(request, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'Something went wrong.' }))
  return true // keep the message channel open for the async reply
})

chrome.tabs.onRemoved.addListener((tabId) => {
  observations.delete(tabId)
  void clearCachedContext(tabId)
})

// Open the side panel when the toolbar icon is used with a modifier, and keep it available
// on the Ads Manager pages the manifest already covers.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })
})
