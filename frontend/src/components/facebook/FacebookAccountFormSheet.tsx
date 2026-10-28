import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ReferenceRecord, TeamMember } from '../../lib/types'
import { useI18n } from '../../i18n'
import { useEnumLabel } from '../../i18n/labels'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'
import { FormSheet } from '../page/FormSheet'

const TWO_FACTOR_OPTIONS = ['unknown', 'app', 'sms', 'security_key', 'none'] as const
const STATUS_OPTIONS = ['unknown', 'active', 'inactive', 'restricted'] as const

export function FacebookAccountFormSheet({
  open,
  onClose,
  record,
  members = [],
  canAssignOwner = false,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  record?: ReferenceRecord | null
  members?: TeamMember[]
  canAssignOwner?: boolean
  onSaved?: (saved: ReferenceRecord) => void
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const formId = useId()

  const [label, setLabel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [externalId, setExternalId] = useState('')
  const [status, setStatus] = useState('unknown')
  const [ownerMemberId, setOwnerMemberId] = useState('')
  const [twoFactor, setTwoFactor] = useState('unknown')
  const [vaultReference, setVaultReference] = useState('')
  const [recoveryNote, setRecoveryNote] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setLabel(String(record?.label ?? ''))
    setDisplayName(String(record?.display_name ?? ''))
    setExternalId(String(record?.external_reference_id ?? ''))
    setStatus(String(record?.status ?? 'unknown'))
    setOwnerMemberId(String(record?.owner_member_id ?? ''))
    setTwoFactor(String(record?.two_factor_method ?? 'unknown'))
    setVaultReference(String(record?.vault_reference ?? ''))
    setRecoveryNote(String(record?.recovery_note ?? ''))
    setNotes(String(record?.notes ?? ''))
  }, [open, record])

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        label: label.trim(),
        display_name: displayName.trim(),
        external_reference_id: externalId.trim() || null,
        status,
        two_factor_method: twoFactor,
        vault_reference: vaultReference.trim(),
        recovery_note: recoveryNote.trim(),
        notes: notes.trim(),
      }
      if (canAssignOwner) {
        payload.owner_member_id = ownerMemberId || null
      }
      if (record) {
        return api.patch<ReferenceRecord>(`/api/v1/personal-account-references/${record.id}`, payload)
      }
      return api.post<ReferenceRecord>('/api/v1/personal-account-references', payload)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      onSaved?.(saved)
      onClose()
    },
  })

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={record ? t('fb.form.editTitle') : t('fb.form.addTitle')}
      description={t('fb.form.desc')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={!label.trim() || save.isPending}>
            {t('fb.pin.setup.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (label.trim()) save.mutate()
        }}
      >
        <Field htmlFor={`${formId}-label`} label={t('res.f.label')} required>
          <input
            id={`${formId}-label`}
            className="input"
            required
            maxLength={200}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-display`} label={t('res.f.displayName')}>
          <input
            id={`${formId}-display`}
            className="input"
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-ext`} label={t('res.f.externalReferenceId')}>
          <input
            id={`${formId}-ext`}
            className="input font-mono"
            maxLength={120}
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </Field>
        {canAssignOwner && (
          <Field htmlFor={`${formId}-owner`} label={t('fb.owner')}>
            <select
              id={`${formId}-owner`}
              className="input"
              value={ownerMemberId}
              onChange={(e) => setOwnerMemberId(e.target.value)}
            >
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.email}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field htmlFor={`${formId}-2fa`} label={t('fb.twoFactor')}>
          <select
            id={`${formId}-2fa`}
            className="input"
            value={twoFactor}
            onChange={(e) => setTwoFactor(e.target.value)}
          >
            {TWO_FACTOR_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`twoFactor.${opt}` as never)}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={`${formId}-vault`} label={t('fb.form.vaultLabel')}>
          <input
            id={`${formId}-vault`}
            className="input"
            maxLength={2048}
            placeholder="Bitwarden → Agency/FB2"
            value={vaultReference}
            onChange={(e) => setVaultReference(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-recovery`} label={t('fb.detail.recovery')}>
          <textarea
            id={`${formId}-recovery`}
            className="input min-h-[4rem]"
            maxLength={2000}
            value={recoveryNote}
            onChange={(e) => setRecoveryNote(e.target.value)}
          />
        </Field>
        <Field htmlFor={`${formId}-status`} label={t('res.f.status')}>
          <select
            id={`${formId}-status`}
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {enumLabel('refStatus', opt)}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={`${formId}-notes`} label={t('res.f.notes')}>
          <textarea
            id={`${formId}-notes`}
            className="input min-h-[4rem]"
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {save.isError && <ErrorState error={save.error} compact />}
      </form>
    </FormSheet>
  )
}
