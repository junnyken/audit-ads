/**
 * The only place in the extension that talks to the AdsOps API.
 *
 * It never talks to Meta, and there is no code path here that could: the base URL comes from
 * the operator's own settings and every request is a relative path under `/api/v1`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  { method = 'GET', body, token, signal }: RequestOptions = {},
): Promise<T> {
  if (!path.startsWith('/api/v1/')) {
    // A guard, not a formality: it makes "call an arbitrary URL" impossible from here.
    throw new ApiError('Refusing to call a path outside the AdsOps API.', 0, 'invalid_path')
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    // No cookies, ever. The bearer token is the only credential this client carries.
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (response.status === 204) return undefined as T
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const envelope = (payload as { error?: { message?: string; code?: string } } | null)?.error
    throw new ApiError(
      envelope?.message ?? `The dashboard returned ${response.status}.`,
      response.status,
      envelope?.code ?? 'request_failed',
    )
  }
  return payload as T
}
