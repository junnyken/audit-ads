import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, getToken, setToken } from '../lib/api'
import type { CurrentUser } from '../lib/types'

export interface RegisterPayload {
  full_name: string
  workspace_name: string
  email: string
  password: string
  challenge_token: string
  captcha_code: string
  math_answer: string
  human_confirmed: boolean
  website_honeypot?: string
  invite_code?: string
  turnstile_token?: string
}

interface AuthState {
  user: CurrentUser | null
  recovery?: boolean
  retry?: () => Promise<void>
  loading: boolean
  signIn: (email: string, password: string, turnstileToken?: string) => Promise<void>
  registerAccount: (payload: RegisterPayload) => Promise<{ verificationRequired: boolean }>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [recovery, setRecovery] = useState(false)
  const generation = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const invalidate = useCallback(() => {
    generation.current += 1
    pending.current?.abort()
    pending.current = null
    return generation.current
  }, [])

  const load = useCallback(async () => {
    const scope = invalidate()
    const token = getToken()
    setRecovery(false)
    setUser(null)
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    pending.current = controller
    const current = () => generation.current === scope && getToken() === token
    try {
      const loaded = await api.get<CurrentUser>('/api/v1/auth/me', {
        timeoutMs: 20_000,
        signal: controller.signal,
      })
      if (current()) setUser(loaded)
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiError && error.status === 401) setToken(null)
      else setRecovery(true)
    } finally {
      if (generation.current === scope) {
        setLoading(false)
        pending.current = null
      }
    }
  }, [invalidate])

  useEffect(() => {
    void load()
    return () => { invalidate() }
  }, [load, invalidate])

  const signIn = useCallback(
    async (email: string, password: string, turnstileToken?: string) => {
      const scope = invalidate()
      const response = await api.post<{ access_token: string }>('/api/v1/auth/login', {
        email,
        password,
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      })
      if (scope !== generation.current) return
      setToken(response.access_token)
      setLoading(true)
      await load()
    },
    [load, invalidate],
  )

  const registerAccount = useCallback(
    async (payload: RegisterPayload) => {
      const scope = invalidate()
      const response = await api.post<{
        access_token: string
        verification_required?: boolean
      }>('/api/v1/auth/register', payload)
      if (scope !== generation.current) return { verificationRequired: true }
      if (response.verification_required || !response.access_token) {
        return { verificationRequired: true }
      }
      setToken(response.access_token)
      setLoading(true)
      await load()
      return { verificationRequired: false }
    },
    [load, invalidate],
  )

  const signOut = useCallback(() => {
    invalidate()
    setLoading(false)
    setRecovery(false)
    if (getToken()) {
      void api.post('/api/v1/auth/logout', {}).catch(() => {})
    }
    setToken(null)
    setUser(null)
  }, [invalidate])

  const value = useMemo(
    () => ({ user, loading, recovery, retry: load, signIn, registerAccount, signOut }),
    [user, loading, recovery, load, signIn, registerAccount, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
