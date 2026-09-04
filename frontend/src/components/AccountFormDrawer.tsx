import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, query } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { Drawer, ErrorState, Field, InlineNote } from './ui'

interface FormState {
  display_name: string
  external_account_id: string
  account_type: string
  business_manager_id: string
  personal_account_reference_id: string
  owner_label: string
  country: string
  currency: string
  timezone: string
  status: string
  requires_page: boolean
  requires_pixel: boolean
  landing_page_url: string
  tags: string
  notes: string
}

const EMPTY: FormState = {
  display_name: '',
  external_account_id: '',
  account_type: 'unknown',
  business_manager_id: '',
  personal_account_reference_id: '',
  owner_label: '',
  country: '',
  currency: '',
  timezone: '',
  status: 'unknown',
  requires_page: false,
  requires_pixel: false,
  landing_page_url: '',
  tags: '',
  notes: '',
}

function fromAccount(account: AdAccount): FormState {
  return {
    display_name: account.display_name,
    external_account_id: account.external_account_id ?? '',
    account_type: account.account_type,
    business_manager_id: account.business_manager_id ?? '',
    personal_account_reference_id: account.personal_account_reference_id ?? '',
    owner_label: account.owner_label,
    country: account.country ?? '',
    currency: account.currency ?? '',
    timezone: account.timezone ?? '',
    status: account.status,
    requires_page: account.requires_page,
    requires_pixel: account.requires_pixel,
    landing_page_url: account.landing_page_url ?? '',
    tags: account.tags.join(', '),
    notes: account.notes,
  }
}

function toPayload(form: FormState) {
  return {
    display_name: form.display_name.trim(),
    external_account_id: form.external_account_id.trim() || null,
    account_type: form.account_type,
    business_manager_id: form.business_manager_id || null,
    personal_account_reference_id: form.personal_account_reference_id || null,
    owner_label: form.owner_label.trim(),
    country: form.country.trim().toUpperCase() || null,
    currency: form.currency.trim().toUpperCase() || null,
    timezone: form.timezone.trim() || null,
    status: form.status,
    requires_page: form.requires_page,
    requires_pixel: form.requires_pixel,
    landing_page_url: form.landing_page_url.trim() || null,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    notes: form.notes,
  }
}

export default function AccountFormDrawer({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean
  account?: AdAccount | null
  onClose: () => void
  onSaved?: (account: AdAccount) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)

  useEffect(() => {
    setForm(account ? fromAccount(account) : EMPTY)
  }, [account, open])

  const businessManagers = useQuery({
    queryKey: ['business-managers', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/business-managers${query({ page_size: 200 })}`),
    enabled: open,
  })
  const personalReferences = useQuery({
    queryKey: ['personal-account-references', 'options'],
    queryFn: () =>
      api.get<Paged<ReferenceRecord>>(`/api/v1/personal-account-references${query({ page_size: 200 })}`),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: async (): Promise<AdAccount> => {
      const payload = toPayload(form)
      return account
        ? api.patch<AdAccount>(`/api/v1/ad-accounts/${account.id}`, payload)
        : api.post<AdAccount>('/api/v1/ad-accounts', payload)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['account', saved.id] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
      onSaved?.(saved)
      onClose()
    },
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <Drawer
      open={open}
      title={account ? 'Edit account' : 'Register ad account'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="account-form"
            className="btn-primary"
            disabled={save.isPending || !form.display_name.trim()}
          >
            {save.isPending ? 'Saving…' : account ? 'Save changes' : 'Create account'}
          </button>
        </div>
      }
    >
      <form
        id="account-form"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {save.isError && <ErrorState error={save.error as ApiError} />}

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Identity
          </legend>
          <Field label="Account name" required htmlFor="display_name">
            <input
              id="display_name"
              className="input"
              value={form.display_name}
              onChange={(event) => set('display_name', event.target.value)}
              required
              maxLength={200}
            />
          </Field>
          <Field label="External account ID" hint="Unique within this workspace when provided.">
            <input
              className="input"
              value={form.external_account_id}
              onChange={(event) => set('external_account_id', event.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Tags" hint="Comma separated.">
            <input className="input" value={form.tags} onChange={(event) => set('tags', event.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Ownership
          </legend>
          <Field label="Account type" required>
            <select
              className="input"
              value={form.account_type}
              onChange={(event) => set('account_type', event.target.value)}
            >
              <option value="unknown">Unknown</option>
              <option value="business_manager">Business Manager</option>
              <option value="personal_reference">Personal reference</option>
            </select>
          </Field>
          <Field label="Business Manager">
            <select
              className="input"
              value={form.business_manager_id}
              onChange={(event) => set('business_manager_id', event.target.value)}
            >
              <option value="">Not mapped</option>
              {(businessManagers.data?.items ?? []).map((bm) => (
                <option key={bm.id} value={bm.id}>
                  {String(bm.name)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Personal account reference">
            <select
              className="input"
              value={form.personal_account_reference_id}
              onChange={(event) => set('personal_account_reference_id', event.target.value)}
            >
              <option value="">Not mapped</option>
              {(personalReferences.data?.items ?? []).map((reference) => (
                <option key={reference.id} value={reference.id}>
                  {String(reference.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner label">
            <input
              className="input"
              value={form.owner_label}
              onChange={(event) => set('owner_label', event.target.value)}
              maxLength={200}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Operational metadata
          </legend>
          <Field label="Account status" required hint="Record what you observed. Leave as Unknown if you have not checked.">
            <select className="input" value={form.status} onChange={(event) => set('status', event.target.value)}>
              <option value="unknown">Unknown</option>
              <option value="active">Active</option>
              <option value="warning">Warning</option>
              <option value="restricted">Restricted</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Country">
              <input
                className="input uppercase"
                value={form.country}
                onChange={(event) => set('country', event.target.value)}
                maxLength={2}
                placeholder="VN"
              />
            </Field>
            <Field label="Currency">
              <input
                className="input uppercase"
                value={form.currency}
                onChange={(event) => set('currency', event.target.value)}
                maxLength={3}
                placeholder="VND"
              />
            </Field>
            <Field label="Timezone">
              <input
                className="input"
                value={form.timezone}
                onChange={(event) => set('timezone', event.target.value)}
                placeholder="Asia/Ho_Chi_Minh"
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Assets
          </legend>
          <InlineNote>
            These switches decide which conditional checklist items apply. Turning one on makes
            the matching item required; the readiness panel always states why an item is required.
          </InlineNote>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form.requires_page}
              onChange={(event) => set('requires_page', event.target.checked)}
            />
            This account needs a Page for its operating workflow
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form.requires_pixel}
              onChange={(event) => set('requires_pixel', event.target.checked)}
            />
            This account needs a Pixel for its operating workflow
          </label>
          <Field label="Active landing page URL" hint="Setting this makes the landing-page and contact/policy checks required.">
            <input
              className="input"
              type="url"
              value={form.landing_page_url}
              onChange={(event) => set('landing_page_url', event.target.value)}
              placeholder="https://"
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Browser and proxy references
          </legend>
          <InlineNote>
            Browser and proxy references are non-secret operator labels, and they are assigned
            from the account&apos;s <strong>Assets &amp; References</strong> tab after creation.
            This product never stores passwords, cookies, session data, tokens or proxy
            credentials — the API refuses those fields.
          </InlineNote>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Notes
          </legend>
          <Field label="Operator notes">
            <textarea
              className="input min-h-[80px]"
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
              maxLength={5000}
            />
          </Field>
        </fieldset>
      </form>
    </Drawer>
  )
}
