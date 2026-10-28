import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { RevealPinStatus } from '../../lib/types'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'
import { Note, Panel } from '../../pages/account/parts'

export function RevealPinSection() {
  const { t } = useI18n(); const queryClient = useQueryClient(); const currentId = useId(); const pinId = useId(); const [currentPassword, setCurrentPassword] = useState(''); const [newPin, setNewPin] = useState('')
  const status = useQuery({ queryKey: ['reveal-pin'], queryFn: () => api.get<RevealPinStatus>('/api/v1/me/reveal-pin') })
  const save = useMutation({ mutationFn: () => api.put<RevealPinStatus>('/api/v1/me/reveal-pin', { current_password: currentPassword, new_pin: newPin }), onSuccess: () => { setCurrentPassword(''); setNewPin(''); void queryClient.invalidateQueries({ queryKey: ['reveal-pin'] }) } })
  return <Panel title={t('fb.pin.setup.title')}><p className="text-sm text-ink-muted">{t('fb.pin.setup.desc')}</p>
    {status.data?.is_set && <Note role="status">{t('fb.pin.setup.set')}</Note>}{status.isError && <ErrorState error={status.error} compact onRetry={() => status.refetch()} />}
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field htmlFor={currentId} label={t('fb.pin.setup.current')} required><input id={currentId} className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field>
      <Field htmlFor={pinId} label={t('fb.pin.setup.new')} required><input id={pinId} className="input font-mono" inputMode="numeric" autoComplete="off" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ''))} /></Field>
      {save.isError && <ErrorState error={save.error} compact />}<Button type="submit" disabled={!currentPassword || newPin.length !== 6 || save.isPending}>{status.data?.is_set ? t('fb.pin.setup.change') : t('fb.pin.setup.submit')}</Button>
    </form></Panel>
}
