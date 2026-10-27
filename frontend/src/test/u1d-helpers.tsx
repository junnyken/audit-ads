import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'

/** Shared plumbing for the U1d page tests. Each test file still declares its own `vi.mock` for
 * `../lib/api` and `../hooks/useAuth` (vitest hoists those per file) and hands the mock here. */

export type Handler = unknown | Error | (() => unknown)
export type Key = string | RegExp

export const paged = (items: unknown[], extra = {}) => ({
  items,
  page: 1,
  page_size: 25,
  total: items.length,
  total_pages: 1,
  ...extra,
})

/** Success styling must never appear on a state we cannot vouch for. */
export const SUCCESS = /tone-positive|tone-dot-positive|emerald|green/

export function installRoutes(apiGet: Mock, routes: () => [Key, Handler][]) {
  apiGet.mockImplementation((path: string) => {
    const hit = routes().find(([key]) => (typeof key === 'string' ? path.includes(key) : key.test(path)))
    const value = hit ? hit[1] : paged([])
    const resolved = typeof value === 'function' ? (value as () => unknown)() : value
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved)
  })
}

export function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

export function wrap(node: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

export function mountAt(pattern: string, element: ReactNode, path: string) {
  return wrap(
    <>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <LocationProbe />
    </>,
    path,
  )
}

export const axeOptions = { rules: { 'color-contrast': { enabled: false } } }
