import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setToken } from '../lib/api'
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
  loading: boolean
  signIn: (email: string, password: string, turnstileToken?: string) => Promise<void>
  registerAccount: (payload: RegisterPayload) => Promise<{ verificationRequired: boolean }>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      setUser(await api.get<CurrentUser>('/api/v1/auth/me'))
    } catch {
      setToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const signIn = useCallback(
    async (email: string, password: string, turnstileToken?: string) => {
      const response = await api.post<{ access_token: string }>('/api/v1/auth/login', {
        email,
        password,
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      })
      setToken(response.access_token)
      setLoading(true)
      await load()
    },
    [load],
  )

  const registerAccount = useCallback(
    async (payload: RegisterPayload) => {
      const response = await api.post<{
        access_token: string
        verification_required?: boolean
      }>('/api/v1/auth/register', payload)
      if (response.verification_required || !response.access_token) {
        return { verificationRequired: true }
      }
      setToken(response.access_token)
      setLoading(true)
      await load()
      return { verificationRequired: false }
    },
    [load],
  )

  const signOut = useCallback(() => {
    if (getToken()) {
      void api.post('/api/v1/auth/logout', {}).catch(() => {})
    }
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, registerAccount, signOut }),
    [user, loading, signIn, registerAccount, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
