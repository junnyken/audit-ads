import { useEffect, useId, useState } from 'react'
import { Copy } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../primitives/alert-dialog'

export function RevealEmailDialog({ identityId, open, onOpenChange }: { identityId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const id = useId()
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const reveal = useMutation({ mutationFn: () => api.post<{ email: string }>(`/api/v1/personal-account-references/${identityId}/reveal-email`, { pin }) })
  useEffect(() => {
    if (!email) return
    const timer = window.setTimeout(() => { setEmail(null); setCopied(false); setPin('') }, 30_000)
    return () => window.clearTimeout(timer)
  }, [email])
  const { reset } = reveal
  useEffect(() => { if (!open) { setPin(''); setEmail(null); setCopied(false); reset() } }, [open, reset])
  const error = reveal.error as ApiError | null
  const locked = error?.status === 423
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('fb.pin.title')}</AlertDialogTitle><AlertDialogDescription>{t('fb.pin.desc')}</AlertDialogDescription></AlertDialogHeader>
      {email ? <div className="rounded-md border border-line bg-surface-sunken p-3">
        <p className="text-xs text-ink-muted">{t('fb.pin.revealed')}</p><p className="mt-1 break-all font-mono text-sm">{email}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={async () => { await navigator.clipboard?.writeText(email); setCopied(true) }}><Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('fb.pin.copied') : t('fb.pin.copy')}</Button>
      </div> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); reveal.mutate(undefined, { onSuccess: ({ email: value }) => setEmail(value) }) }}>
        <Field htmlFor={id} label={t('fb.pin.label')} required error={locked ? t('fb.pin.locked') : undefined}>
          <input id={id} className="input font-mono tracking-[0.35em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} aria-invalid={reveal.isError || undefined} autoFocus />
        </Field>
        {reveal.isError && !locked && <ErrorState error={reveal.error} compact title={t('fb.pin.error')} />}
        <Button type="submit" disabled={pin.length !== 6 || reveal.isPending || locked}>{t('fb.pin.submit')}</Button>
      </form>}
      <AlertDialogFooter><AlertDialogCancel>{t('common.close')}</AlertDialogCancel></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
