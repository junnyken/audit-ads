import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../hooks/useAuth'
import { api, getToken, setToken } from '../lib/api'
import App from '../App'
import { I18nProvider } from '../i18n'
vi.mock('../components/AppShell', () => ({ default: () => null }))
vi.mock('../pages/Login', () => ({ default: () => <div>Login form</div> }))
function Probe() {
  const a = useAuth()
  return <><div data-testid="state">{a.loading ? 'loading' : a.recovery ? 'recovery' : a.user ? 'user' : 'guest'}</div>
    <button onClick={() => void a.retry?.()}>retry</button><button onClick={a.signOut}>logout</button>
    <button onClick={() => void a.signIn('fixture@example.test', 'fixture')}>login</button></>
}
const response = (status = 200) => new Response(JSON.stringify({ id: 'fixture-user' }), { status })
const flush = async () => { await act(async () => { await Promise.resolve() }) }
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)
beforeEach(() => { localStorage.clear(); setToken('fixture-token'); vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it.each(['fetch', 'body'])('bounds hung %s at 20s including body and aborts', async kind => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, init) => {
    signal = init.signal
    return kind === 'fetch' ? new Promise(() => {}) : Promise.resolve({ status: 200, ok: true, json: () => new Promise(() => {}) })
  }))
  mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(19_999) })
  expect(screen.getByTestId('state')).toHaveTextContent('loading')
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByTestId('state')).toHaveTextContent('recovery')
  expect(signal?.aborted).toBe(true)
  expect(getToken()).toBe('fixture-token')
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['network', '503'])('preserves token on %s and retries', async kind => {
  const fetchMock = vi.fn()
  if (kind === 'network') fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  else fetchMock.mockResolvedValueOnce(response(503))
  fetchMock.mockResolvedValueOnce(response())
  vi.stubGlobal('fetch', fetchMock); mount(); await flush()
  expect(screen.getByTestId('state')).toHaveTextContent('recovery')
  expect(getToken()).toBe('fixture-token')
  fireEvent.click(screen.getByText('retry')); await flush()
  expect(screen.getByTestId('state')).toHaveTextContent('user')
  expect(vi.getTimerCount()).toBe(0)
})
it('clears invalid 401 session', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401))); mount(); await flush()
  expect(getToken()).toBeNull(); expect(screen.getByTestId('state')).toHaveTextContent('guest')
})
it.each(['retry', 'logout', 'login'])('ignores old pending auth after %s', async action => {
  let old!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { old = r }))
    .mockImplementation((url: string) => Promise.resolve(url.endsWith('/login') ? new Response('{"access_token":"new-fixture"}') : response(action === 'retry' ? 503 : 200))))
  mount(); fireEvent.click(screen.getByText(action)); await flush()
  await act(async () => { old(response(401)) })
  expect(screen.getByTestId('state')).toHaveTextContent(action === 'retry' ? 'recovery' : action === 'logout' ? 'guest' : 'user')
  expect(getToken()).toBe(action === 'logout' ? null : action === 'login' ? 'new-fixture' : 'fixture-token')
})
it('signout invalidates in-flight login', async () => {
  let login!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.endsWith('/login') ? new Promise<Response>(r => { login = r }) : Promise.resolve(response())))
  mount(); await flush(); fireEvent.click(screen.getByText('login')); fireEvent.click(screen.getByText('logout'))
  await act(async () => { login(new Response('{"access_token":"late-fixture"}')) })
  expect(getToken()).toBeNull(); expect(screen.getByTestId('state')).toHaveTextContent('guest')
})
it('renders translated recovery before login on deep link', async () => {
  window.history.replaceState({}, '', '/assets/emails?entry=id')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  render(<I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider>); await flush()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument()
  expect(screen.queryByText('Login form')).not.toBeInTheDocument()
  expect(window.location.search).toBe('?entry=id')
})

it('reproduces the unbounded default GET path used before auth timeout', async () => {
  let complete!: (r: Response) => void
  let settled = false
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { complete = r })))
  const request = api.get('/api/v1/auth/me').then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(settled).toBe(false)
  complete(response())
  await request
})
