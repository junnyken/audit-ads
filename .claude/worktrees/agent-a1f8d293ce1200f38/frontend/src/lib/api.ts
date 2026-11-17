/**
 * Where the API lives.
 *
 * Read at RUNTIME from `/config.js`, not baked in at build time. The deployed origin is not
 * known when the image is built — on a platform that assigns a subdomain, it does not exist
 * yet — and a bundle that hard-codes it can only be pointed somewhere else by rebuilding.
 * `nginx` writes `/config.js` from an environment variable when the container starts, so the
 * same image serves any environment.
 *
 * An empty string is a real answer, not a missing one: it means "same origin", which is what
 * a deployment fronted by a single proxy wants. Hence the `typeof` check rather than `??`.
 */
declare global {
  interface Window {
    __ADSOPS_API_BASE__?: string
  }
}

const runtimeBase = typeof window !== 'undefined' ? window.__ADSOPS_API_BASE__ : undefined
const BASE =
  typeof runtimeBase === 'string'
    ? runtimeBase
    : ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000')
const TOKEN_KEY = 'adsops.token'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly details: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage can be unavailable; the session simply does not survive a reload */
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> })?.error
    throw new ApiError(
      (error?.message as string) ?? 'The request could not be completed.',
      response.status,
      (error?.code as string) ?? 'unknown_error',
      (error?.request_id as string) ?? response.headers.get('X-Request-ID'),
      (error?.details as Record<string, unknown>) ?? {},
    )
  }
  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
}

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}
