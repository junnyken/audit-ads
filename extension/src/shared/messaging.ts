/** Typed wrapper around the one-way trip from an extension page to the service worker. */
import type { WorkerRequest, WorkerResponse } from './types'

export async function ask<T>(request: WorkerRequest): Promise<WorkerResponse<T>> {
  try {
    return (await chrome.runtime.sendMessage(request)) as WorkerResponse<T>
  } catch {
    return { ok: false, error: 'The extension background worker is not responding.' }
  }
}
