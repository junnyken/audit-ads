import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

/**
 * A small, honest `chrome` stub.
 *
 * Only the APIs the extension actually uses are present. If a test needs something that is not
 * here, that is a signal the extension started using an API nobody reviewed.
 */
type Listener = (...args: unknown[]) => void

export function makeStorageArea() {
  const data = new Map<string, unknown>()
  return {
    data,
    get: vi.fn(async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {})),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) data.set(key, value)
    }),
    remove: vi.fn(async (key: string) => {
      data.delete(key)
    }),
  }
}

export function installChromeStub(overrides: Record<string, unknown> = {}) {
  const local = makeStorageArea()
  const session = makeStorageArea()
  local.data.set('adsops.language', 'en')
  const listeners: Listener[] = []
  const stub = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      sendMessage: vi.fn(async () => ({ ok: true })),
      openOptionsPage: vi.fn(),
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      onInstalled: { addListener: vi.fn() },
    },
    storage: {
      local,
      session,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      create: vi.fn(),
      onRemoved: { addListener: vi.fn() },
    },
    sidePanel: { setPanelBehavior: vi.fn() },
    ...overrides,
  }
  ;(globalThis as unknown as { chrome: unknown }).chrome = stub
  return { stub, local, session, listeners }
}

installChromeStub()
