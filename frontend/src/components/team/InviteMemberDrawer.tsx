import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { InvitationCreated } from '../../lib/types'
import { Drawer, ErrorState, Field, InlineNote } from '../ui'
import { ASSIGNABLE_ROLES, ROLE_LABEL } from '../../lib/team'

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
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('operator')

  const create = useMutation({
    mutationFn: () =>
      api.post<InvitationCreated>('/api/v1/team/invitations', { email: email.trim(), role }),
    onSuccess: (created) => {
      setEmail('')
      setRole('operator')
      onCreated(created)
    },
  })

  return (
    <Drawer
      open={open}
      title="Invite member"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!email.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create invitation'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Email" required>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@example.com"
          />
        </Field>

        <Field label="Role" required>
          <select className="input" value={role} onChange={(event) => setRole(event.target.value)}>
            {ASSIGNABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[12px]">
          <p className="font-medium">Before you create it</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
            <li>
              Seats available right now:{' '}
              <b>{availableSeats === null ? 'unknown — no seat plan configured' : availableSeats}</b>.
              A pending invitation does not hold a seat; the seat is checked again when they
              accept.
            </li>
            <li>The invitation expires in 7 days.</li>
            <li>
              No email is sent — this product has no email provider configured. You get a
              one-time link to pass on yourself.
            </li>
            <li>This grants access to AdsOps only. It changes nothing on Meta.</li>
          </ul>
        </div>

        <InlineNote>
          Assign Business Managers or ad accounts after they accept — scope is managed per member
          from the Manage panel.
        </InlineNote>

        {create.isError && <ErrorState error={create.error} />}
      </div>
    </Drawer>
  )
}
