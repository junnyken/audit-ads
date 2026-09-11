import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, query } from '../lib/api'
import type { AdAccount, CampaignDraft, Paged } from '../lib/types'
import { Drawer, ErrorState, Field, InlineNote } from './ui'

interface FormState {
  title: string
  ad_account_id: string
  objective: string
  primary_copy: string
  headline: string
  description: string
  call_to_action: string
  landing_page_url: string
  creative_reference: string
  budget_amount: string
  budget_currency: string
  budget_change_percent: string
  targeting_summary: string
}

const EMPTY: FormState = {
  title: '',
  ad_account_id: '',
  objective: '',
  primary_copy: '',
  headline: '',
  description: '',
  call_to_action: '',
  landing_page_url: '',
  creative_reference: '',
  budget_amount: '',
  budget_currency: '',
  budget_change_percent: '',
  targeting_summary: '',
}

function fromDraft(draft: CampaignDraft): FormState {
  return {
    title: draft.title,
    ad_account_id: draft.ad_account_id ?? '',
    objective: draft.objective ?? '',
    primary_copy: draft.primary_copy,
    headline: draft.headline ?? '',
    description: draft.description ?? '',
    call_to_action: draft.call_to_action ?? '',
    landing_page_url: draft.landing_page_url ?? '',
    creative_reference: draft.creative_reference ?? '',
    budget_amount: draft.budget_amount ?? '',
    budget_currency: draft.budget_currency ?? '',
    budget_change_percent: draft.budget_change_percent ?? '',
    targeting_summary: draft.targeting_summary ?? '',
  }
}

function toPayload(form: FormState) {
  return {
    title: form.title.trim(),
    ad_account_id: form.ad_account_id || null,
    objective: form.objective.trim() || null,
    primary_copy: form.primary_copy,
    headline: form.headline.trim() || null,
    description: form.description.trim() || null,
    call_to_action: form.call_to_action.trim() || null,
    landing_page_url: form.landing_page_url.trim() || null,
    creative_reference: form.creative_reference.trim() || null,
    budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
    budget_currency: form.budget_currency.trim().toUpperCase() || null,
    budget_change_percent: form.budget_change_percent ? Number(form.budget_change_percent) : null,
    targeting_summary: form.targeting_summary.trim() || null,
  }
}

export default function PreflightDraftFormDrawer({
  open,
  draft,
  onClose,
  onSaved,
}: {
  open: boolean
  draft?: CampaignDraft | null
  onClose: () => void
  onSaved?: (draft: CampaignDraft) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)

  useEffect(() => {
    setForm(draft ? fromDraft(draft) : EMPTY)
  }, [draft, open])

  const accounts = useQuery({
    queryKey: ['ad-accounts', 'options'],
    queryFn: () => api.get<Paged<AdAccount>>(`/api/v1/ad-accounts${query({ page_size: 200 })}`),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: async (): Promise<CampaignDraft> => {
      const payload = toPayload(form)
      return draft
        ? api.patch<CampaignDraft>(`/api/v1/campaign-drafts/${draft.id}`, payload)
        : api.post<CampaignDraft>('/api/v1/campaign-drafts', payload)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['preflight-drafts'] })
      void queryClient.invalidateQueries({ queryKey: ['preflight-draft', saved.id] })
      onSaved?.(saved)
      onClose()
    },
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <Drawer
      open={open}
      title={draft ? 'Edit campaign draft' : 'Create campaign draft'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="preflight-draft-form"
            className="btn-primary"
            disabled={save.isPending || !form.title.trim()}
          >
            {save.isPending ? 'Saving…' : draft ? 'Save & re-check needed' : 'Create draft'}
          </button>
        </div>
      }
    >
      <form
        id="preflight-draft-form"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {save.isError && <ErrorState error={save.error as ApiError} />}

        <InlineNote>
          This is an internal record for rule-based review only. Nothing here is sent to Meta —
          the operator publishes manually on the platform after reviewing the findings.
        </InlineNote>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Identity
          </legend>
          <Field label="Draft title" required htmlFor="pf-title">
            <input
              id="pf-title"
              className="input"
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              required
              maxLength={200}
            />
          </Field>
          <Field
            label="Ad account"
            hint="A draft not linked to a registered account is always blocked (draft_missing_account_link)."
          >
            <select
              className="input"
              value={form.ad_account_id}
              onChange={(event) => set('ad_account_id', event.target.value)}
            >
              <option value="">Not linked</option>
              {(accounts.data?.items ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objective">
            <select className="input" value={form.objective} onChange={(event) => set('objective', event.target.value)}>
              <option value="">Not set</option>
              <option value="conversion">Conversion</option>
              <option value="traffic">Traffic</option>
              <option value="messages">Messages</option>
              <option value="awareness">Awareness</option>
            </select>
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Copy
          </legend>
          <Field label="Primary copy" required htmlFor="pf-copy">
            <textarea
              id="pf-copy"
              className="input min-h-[90px]"
              value={form.primary_copy}
              onChange={(event) => set('primary_copy', event.target.value)}
              required
              maxLength={5000}
            />
          </Field>
          <Field label="Headline">
            <input
              className="input"
              value={form.headline}
              onChange={(event) => set('headline', event.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label="Description" hint="For sensitive categories (health, finance, weight loss), disclaimer-style language here avoids a warning.">
            <textarea
              className="input min-h-[70px]"
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>
          <Field label="Call to action">
            <input
              className="input"
              value={form.call_to_action}
              onChange={(event) => set('call_to_action', event.target.value)}
              maxLength={80}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Landing page &amp; creative
          </legend>
          <Field
            label="Landing page URL"
            hint="Checked automatically: HTTPS, response time, redirects, mobile viewport, contact/policy link. Only bounded metadata is stored — never the page's HTML."
          >
            <input
              className="input"
              type="url"
              value={form.landing_page_url}
              onChange={(event) => set('landing_page_url', event.target.value)}
              placeholder="https://"
            />
          </Field>
          <Field label="Creative reference" hint="An external link or label only — this product does not store creative files.">
            <input
              className="input"
              value={form.creative_reference}
              onChange={(event) => set('creative_reference', event.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            Budget &amp; targeting
          </legend>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Budget amount">
              <input
                className="input"
                type="number"
                value={form.budget_amount}
                onChange={(event) => set('budget_amount', event.target.value)}
              />
            </Field>
            <Field label="Currency">
              <input
                className="input uppercase"
                value={form.budget_currency}
                onChange={(event) => set('budget_currency', event.target.value)}
                maxLength={8}
                placeholder="VND"
              />
            </Field>
            <Field label="% change vs. current" hint="Over the configured threshold (default 50%) triggers a warning.">
              <input
                className="input"
                type="number"
                value={form.budget_change_percent}
                onChange={(event) => set('budget_change_percent', event.target.value)}
              />
            </Field>
          </div>
          <Field label="Targeting summary">
            <textarea
              className="input min-h-[60px]"
              value={form.targeting_summary}
              onChange={(event) => set('targeting_summary', event.target.value)}
            />
          </Field>
        </fieldset>
      </form>
    </Drawer>
  )
}
