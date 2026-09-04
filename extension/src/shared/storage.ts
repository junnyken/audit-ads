/**
 * Extension storage.
 *
 * The session lives in `chrome.storage.session` when it exists — that store is in-memory and
 * cleared when the browser closes, which is the right home for a bearer token. Settings live
 * in `chrome.storage.local`, because a dashboard URL should survive a restart.
 *
 * Nothing here logs a value. A token that is safe to store is not safe to print.
 */
import type { ContextResolution } from './types'

const SESSION_KEY = 'adsops.connection'
const SETTINGS_KEY = 'adsops.settings'
const CONTEXT_KEY_PREFIX = 'adsops.context.'

export interface StoredConnection {
  accessToken: string
  expiresAt: string
  installationId: string
  workspaceName: string
  userEmail: string
}

export interface StoredSettings {
  dashboardUrl: string
  instanceId: string
  label: string
}

function sessionArea(): chrome.storage.StorageArea {
  // `storage.session` needs Chrome 102+. Falling back to `local` keeps the extension usable on
  // an older build; the trade-off is that the token then survives a browser restart, which is
  // why the manifest asks for Chrome 114 and this is only a fallback.
  return chrome.storage.session ?? chrome.storage.local
}

export async function readConnection(): Promise<StoredConnection | null> {
  const stored = await sessionArea().get(SESSION_KEY)
  const value = stored?.[SESSION_KEY] as StoredConnection | undefined
  if (!value?.accessToken || !value.expiresAt) return null
  if (new Date(value.expiresAt).getTime() <= Date.now()) {
    await clearConnection()
    return null
  }
  return value
}

export async function writeConnection(connection: StoredConnection): Promise<void> {
  await sessionArea().set({ [SESSION_KEY]: connection })
}

export async function clearConnection(): Promise<void> {
  await sessionArea().remove(SESSION_KEY)
}

function randomInstanceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function readSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  const value = (stored?.[SETTINGS_KEY] ?? {}) as Partial<StoredSettings>
  const settings: StoredSettings = {
    dashboardUrl: value.dashboardUrl ?? '',
    // Generated once per browser profile, and meaningless outside this product.
    instanceId: value.instanceId ?? randomInstanceId(),
    label: value.label ?? '',
  }
  if (!value.instanceId) await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
  return settings
}

export async function writeSettings(patch: Partial<StoredSettings>): Promise<StoredSettings> {
  const current = await readSettings()
  const next = { ...current, ...patch }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

/**
 * A short per-tab cache of the resolved context.
 *
 * Ads Manager rewrites its URL constantly as you click around. Without this the extension would
 * ask the API on every one of those, which is exactly the behaviour that gets a client
 * rate-limited — and there is no rate limiter yet, so behaving well is the extension's job.
 */
export const CONTEXT_TTL_MS = 30_000

interface CachedContext {
  key: string
  storedAt: number
  resolution: ContextResolution
}

export async function readCachedContext(
  tabId: number,
  key: string,
): Promise<ContextResolution | null> {
  const storageKey = `${CONTEXT_KEY_PREFIX}${tabId}`
  const stored = await sessionArea().get(storageKey)
  const value = stored?.[storageKey] as CachedContext | undefined
  if (!value || value.key !== key) return null
  if (Date.now() - value.storedAt > CONTEXT_TTL_MS) return null
  return value.resolution
}

export async function writeCachedContext(
  tabId: number,
  key: string,
  resolution: ContextResolution,
): Promise<void> {
  const storageKey = `${CONTEXT_KEY_PREFIX}${tabId}`
  await sessionArea().set({ [storageKey]: { key, storedAt: Date.now(), resolution } })
}

export async function clearCachedContext(tabId: number): Promise<void> {
  await sessionArea().remove(`${CONTEXT_KEY_PREFIX}${tabId}`)
}
