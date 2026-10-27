import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, query } from '../lib/api'
import type { AdAccount, CampaignDraft, Paged } from '../lib/types'
import { useI18n } from '../i18n'
import { Button } from './primitives/button'
import { Field } from './primitives/field'
import { ErrorState } from './states'
import { FormSheet } from './page/FormSheet'
import { Note } from '../pages/account/parts'

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

const OBJECTIVES = ['conversion', 'traffic', 'messages', 'awareness']

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
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [touched, setTouched] = useState<{ title?: boolean; copy?: boolean }>({})

  useEffect(() => {
    setForm(draft ? fromDraft(draft) : EMPTY)
    setTouched({})
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

  const titleMissing = !form.title.trim()
  const copyMissing = !form.primary_copy.trim()
  const legend = 'mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted'

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={draft ? t('pf.form.edit.title') : t('pf.form.create.title')}
      description={t('pf.form.desc')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="preflight-draft-form" disabled={save.isPending || titleMissing}>
            {save.isPending ? t('pg.saving') : draft ? t('pf.form.save') : t('pf.form.create')}
          </Button>
        </>
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
        {save.isError && (
          <ErrorState error={save.error as ApiError} title={t('pf.form.error')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
        )}

        <Note>{t('pf.form.note')}</Note>

        <fieldset className="space-y-3">
          <legend className={legend}>{t('pf.form.g.identity')}</legend>
          <Field
            label={t('pf.form.title')}
            required
            htmlFor="pf-title"
            error={touched.title && titleMissing ? t('pf.form.title.required') : undefined}
          >
            <input
              id="pf-title"
              className="input"
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, title: true }))}
              aria-invalid={touched.title && titleMissing ? true : undefined}
              required
              maxLength={200}
            />
          </Field>
          <Field label={t('pf.form.account')} hint={t('pf.form.account.hint')} htmlFor="pf-account">
            <select id="pf-account" className="input" value={form.ad_account_id} onChange={(event) => set('ad_account_id', event.target.value)}>
              <option value="">{t('pf.form.account.none')}</option>
              {(accounts.data?.items ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('pf.form.objective')} htmlFor="pf-objective">
            <select id="pf-objective" className="input" value={form.objective} onChange={(event) => set('objective', event.target.value)}>
              <option value="">{t('pf.form.objective.none')}</option>
              {OBJECTIVES.map((value) => (
                <option key={value} value={value}>
                  {t(`objective.${value}` as 'objective.conversion')}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={legend}>{t('pf.form.g.copy')}</legend>
          <Field
            label={t('pf.form.copy')}
            required
            htmlFor="pf-copy"
            error={touched.copy && copyMissing ? t('pf.form.copy.required') : undefined}
          >
            <textarea
              id="pf-copy"
              className="input min-h-[90px]"
              value={form.primary_copy}
              onChange={(event) => set('primary_copy', event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, copy: true }))}
              aria-invalid={touched.copy && copyMissing ? true : undefined}
              required
              maxLength={5000}
            />
          </Field>
          <Field label={t('pf.form.headline')} htmlFor="pf-headline">
            <input id="pf-headline" className="input" value={form.headline} onChange={(event) => set('headline', event.target.value)} maxLength={200} />
          </Field>
          <Field label={t('pf.form.description')} hint={t('pf.form.description.hint')} htmlFor="pf-description">
            <textarea id="pf-description" className="input min-h-[70px]" value={form.description} onChange={(event) => set('description', event.target.value)} />
          </Field>
          <Field label={t('pf.form.cta')} htmlFor="pf-cta">
            <input id="pf-cta" className="input" value={form.call_to_action} onChange={(event) => set('call_to_action', event.target.value)} maxLength={80} />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={legend}>{t('pf.form.g.landing')}</legend>
          <Field label={t('pf.form.url')} hint={t('pf.form.url.hint')} htmlFor="pf-url">
            <input
              id="pf-url"
              className="input"
              type="url"
              value={form.landing_page_url}
              onChange={(event) => set('landing_page_url', event.target.value)}
              placeholder="https://"
            />
          </Field>
          <Field label={t('pf.form.creative')} hint={t('pf.form.creative.hint')} htmlFor="pf-creative">
            <input id="pf-creative" className="input" value={form.creative_reference} onChange={(event) => set('creative_reference', event.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={legend}>{t('pf.form.g.budget')}</legend>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('pf.form.budget')} htmlFor="pf-budget">
              <input id="pf-budget" className="input font-mono" type="number" value={form.budget_amount} onChange={(event) => set('budget_amount', event.target.value)} />
            </Field>
            <Field label={t('pf.form.currency')} htmlFor="pf-currency">
              <input
                id="pf-currency"
                className="input uppercase"
                value={form.budget_currency}
                onChange={(event) => set('budget_currency', event.target.value)}
                maxLength={8}
                placeholder="VND"
              />
            </Field>
            <Field label={t('pf.form.change')} hint={t('pf.form.change.hint')} htmlFor="pf-change">
              <input id="pf-change" className="input font-mono" type="number" value={form.budget_change_percent} onChange={(event) => set('budget_change_percent', event.target.value)} />
            </Field>
          </div>
          <Field label={t('pf.form.targeting')} htmlFor="pf-targeting">
            <textarea id="pf-targeting" className="input min-h-[60px]" value={form.targeting_summary} onChange={(event) => set('targeting_summary', event.target.value)} />
          </Field>
        </fieldset>
      </form>
    </FormSheet>
  )
}
