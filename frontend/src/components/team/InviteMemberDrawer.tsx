import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { InvitationCreated } from '../../lib/types'
import { ASSIGNABLE_ROLES } from '../../lib/team'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'
import { FormSheet } from '../page/FormSheet'

/** A9 §G.3. Owner is deliberately absent from the role select — ownership transfer is a
 * separate, higher-risk flow, and the backend rejects `owner` here regardless of the UI. */
export default function InviteMemberDrawer({
  open,
  availableSeats,
  onClose,
  onCreated,
}: {
  open: boolean
  availableSeats: number | null
  onClose: () => void
  onCreated: (created: InvitationCreated) => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('operator')
  const [touched, setTouched] = useState(false)

  const create = useMutation({
    mutationFn: () => api.post<InvitationCreated>('/api/v1/team/invitations', { email: email.trim(), role }),
    onSuccess: (created) => {
      setEmail('')
      setRole('operator')
      setTouched(false)
      onCreated(created)
    },
  })

  const missing = !email.trim()

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t('inv.title')}
      description={t('inv.desc')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="invite-form" disabled={missing || create.isPending}>
            {create.isPending ? t('inv.submitting') : t('inv.submit')}
          </Button>
        </>
      }
    >
      <form
        id="invite-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={t('inv.email')} required htmlFor="invite-email" error={touched && missing ? t('inv.email.required') : undefined}>
          <input
            id="invite-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && missing ? true : undefined}
            placeholder="teammate@example.com"
          />
        </Field>

        <Field label={t('inv.role')} required htmlFor="invite-role">
          <select id="invite-role" className="input" value={role} onChange={(event) => setRole(event.target.value)}>
            {ASSIGNABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {enumLabel('role', value)}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs">
          <p className="font-medium">{t('inv.before')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
            <li>{t('inv.seats', { seats: availableSeats === null ? t('inv.seats.unknown') : availableSeats })}</li>
            <li>{t('inv.expires')}</li>
            <li>{t('inv.noEmail')}</li>
            <li>{t('inv.scope')}</li>
          </ul>
        </div>

        <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">{t('inv.after')}</p>

        {create.isError && <ErrorState error={create.error} title={t('inv.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
      </form>
    </FormSheet>
  )
}
