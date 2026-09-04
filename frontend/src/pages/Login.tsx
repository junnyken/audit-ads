import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Field } from '../components/ui'
import { ApiError } from '../lib/api'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Sign-in failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded bg-brand text-[13px] font-bold text-white">
            AO
          </span>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight">AdsOps Control Center</h1>
            <p className="text-[11.5px] text-ink-faint">Account registry and operational readiness</p>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Email" required htmlFor="email">
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password" required htmlFor="password">
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
