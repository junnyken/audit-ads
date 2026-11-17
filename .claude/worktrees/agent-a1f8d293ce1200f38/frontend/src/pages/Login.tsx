import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Field } from '../components/ui'
import { TooltipProvider } from '../components/primitives/tooltip'
import { BrandMark } from '../components/shell/BrandMark'
import { LanguageToggle } from '../components/shell/LanguageToggle'
import { ThemeToggle } from '../components/shell/ThemeToggle'
import { useI18n } from '../i18n'
import { ApiError } from '../lib/api'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useI18n()
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
      // The server's sanitised message is shown as sent; anything else gets the generic line.
      setError(caught instanceof ApiError ? caught.message : t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col px-4">
        <div className="flex justify-end gap-1 py-3">
          <ThemeToggle />
          <LanguageToggle />
        </div>
        <main className="grid flex-1 place-items-center pb-16">
          <form onSubmit={submit} className="card w-full max-w-sm p-6" aria-labelledby="login-title">
            <div className="mb-5">
              <BrandMark />
              <p className="mt-2 text-xs text-ink-faint">{t('common.appTagline')}</p>
            </div>
            <h1 id="login-title" className="mb-4 text-lg font-semibold">
              {t('login.title')}
            </h1>

            <div className="space-y-3">
              <Field label={t('login.email')} required htmlFor="email">
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
              <Field label={t('login.password')} required htmlFor="password">
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
              <p role="alert" className="tone-attention mt-3 rounded-md border px-3 py-2 text-sm">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary mt-4 w-full" disabled={busy}>
              {busy ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </main>
      </div>
    </TooltipProvider>
  )
}
