import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, query } from '../lib/api'
import type { AccountStatus, AdAccount, Paged, ReferenceRecord } from '../lib/types'
import { Button } from './primitives/button'
import { Field } from './primitives/field'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './primitives/sheet'
import { ErrorState } from './states'
import { useEnumLabel } from '../i18n/labels'
import { useI18n } from '../i18n'
import { cn } from '../lib/cn'

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
  client_name: string
  planned_daily_budget_raw: string
  planned_monthly_budget_raw: string
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
  client_name: '',
  planned_daily_budget_raw: '',
  planned_monthly_budget_raw: '',
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
    client_name: account.client_name ?? '',
    planned_daily_budget_raw: account.planned_daily_budget_raw ?? '',
    planned_monthly_budget_raw: account.planned_monthly_budget_raw ?? '',
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
    client_name: form.client_name.trim(),
    planned_daily_budget_raw: form.planned_daily_budget_raw.trim() || null,
    planned_monthly_budget_raw: form.planned_monthly_budget_raw.trim() || null,
  }
}

export default function AccountFormDrawer({
  open,
  account,
  onClose,
  onSaved,
  statusSuggestion = null,
  statusNote = null,
}: {
  open: boolean
  account?: AdAccount | null
  onClose: () => void
  onSaved?: (account: AdAccount) => void
  /** S2: a recorded status to pre-select when the sheet was opened from "Record Meta status in
   * the registry". Only pre-selects — nothing is saved until the person presses Save (rule 11). */
  statusSuggestion?: AccountStatus | null
  /** S2: what Meta returned, shown above the status field when the sheet was opened that way. */
  statusNote?: string | null
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [touchedName, setTouchedName] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(account))
  // Radix returns focus only to a <Trigger>; this sheet is opened by state from several buttons,
  // so remember who had focus when it opened and give it back when it closes.
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const base = account ? fromAccount(account) : EMPTY
    setForm(account && statusSuggestion ? { ...base, status: statusSuggestion } : base)
    setTouchedName(false)
    setShowAdvanced(Boolean(account))
  }, [account, open, statusSuggestion])

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

  const nameMissing = !form.display_name.trim()
  const legend = 'mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted'

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('common.close')}
        className="w-full sm:w-[30rem] sm:max-w-[30rem]"
        onOpenAutoFocus={() => {
          returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus()
        }}
      >
        <header className="space-y-1 border-b border-line px-4 py-3 pr-14">
          <SheetTitle className="text-lg font-semibold">
            {account ? t('form.title.edit') : t('form.title.create')}
          </SheetTitle>
          <SheetDescription className="text-sm text-ink-muted">
            {account ? t('form.desc.edit') : t('form.desc.create')}
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <form
            id="account-form"
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
          >
            {save.isError && (
              <ErrorState error={save.error as ApiError} title={t('form.error.title')} noPermissionText={t('acct.error.noPermissionWrite')} compact />
            )}

            <fieldset className="space-y-3">
              <legend className={legend}>{t('form.group.identity')}</legend>
              <Field
                label={t('form.name')}
                required
                htmlFor="display_name"
                error={touchedName && nameMissing ? t('form.name.required') : undefined}
              >
                <input
                  id="display_name"
                  className={cn('input', touchedName && nameMissing && 'border-tone-attention-border')}
                  value={form.display_name}
                  onChange={(event) => set('display_name', event.target.value)}
                  onBlur={() => setTouchedName(true)}
                  aria-invalid={touchedName && nameMissing}
                  required
                  maxLength={200}
                />
              </Field>
              <Field label={t('form.externalId')} hint={t('form.externalId.hint')}>
                <input
                  className="input font-mono"
                  value={form.external_account_id}
                  onChange={(event) => set('external_account_id', event.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label={t('sp.pacing.client')} htmlFor="account-client-name">
                <input
                  id="account-client-name"
                  className="input"
                  value={form.client_name}
                  onChange={(event) => set('client_name', event.target.value)}
                  maxLength={200}
                  placeholder={t('sp.pacing.clientPlaceholder')}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('sp.pacing.dailyBudget')} htmlFor="account-daily-budget">
                  <input
                    id="account-daily-budget"
                    className="input font-mono tabular-nums"
                    value={form.planned_daily_budget_raw}
                    onChange={(event) => set('planned_daily_budget_raw', event.target.value)}
                    maxLength={32}
                    placeholder={t('sp.pacing.dailyPlaceholder')}
                  />
                </Field>
                <Field label={t('sp.pacing.monthlyBudget')} htmlFor="account-monthly-budget">
                  <input
                    id="account-monthly-budget"
                    className="input font-mono tabular-nums"
                    value={form.planned_monthly_budget_raw}
                    onChange={(event) => set('planned_monthly_budget_raw', event.target.value)}
                    maxLength={32}
                    placeholder={t('sp.pacing.monthlyPlaceholder')}
                  />
                </Field>
              </div>
            </fieldset>

            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? t('form.advanced.hide') : t('form.advanced.show')}
              </Button>
            </div>

            {showAdvanced && (
              <>
                <fieldset className="space-y-3">
                  <legend className={legend}>{t('form.group.ownership')}</legend>
                  <Field label={t('form.type')} required>
                    <select
                      className="input"
                      value={form.account_type}
                      onChange={(event) => set('account_type', event.target.value)}
                    >
                      <option value="unknown">{enumLabel('accountType', 'unknown')}</option>
                      <option value="business_manager">{enumLabel('accountType', 'business_manager')}</option>
                      <option value="personal_reference">{enumLabel('accountType', 'personal_reference')}</option>
                    </select>
                  </Field>
                  <Field label={t('form.bm')}>
                    <select
                      className="input"
                      value={form.business_manager_id}
                      onChange={(event) => set('business_manager_id', event.target.value)}
                    >
                      <option value="">{t('ov.notMapped')}</option>
                      {(businessManagers.data?.items ?? []).map((bm) => (
                        <option key={bm.id} value={bm.id}>
                          {String(bm.name)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('form.personalRef')}>
                    <select
                      className="input"
                      value={form.personal_account_reference_id}
                      onChange={(event) => set('personal_account_reference_id', event.target.value)}
                    >
                      <option value="">{t('ov.notMapped')}</option>
                      {(personalReferences.data?.items ?? []).map((reference) => (
                        <option key={reference.id} value={reference.id}>
                          {String(reference.label)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('form.ownerLabel')}>
                    <input
                      className="input"
                      value={form.owner_label}
                      onChange={(event) => set('owner_label', event.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <Field label={t('form.tags')} hint={t('form.tags.hint')}>
                    <input className="input" value={form.tags} onChange={(event) => set('tags', event.target.value)} />
                  </Field>
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className={legend}>{t('form.group.operational')}</legend>
                  {statusNote && (
                    <p
                      className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-ink-muted"
                      data-testid="meta-status-note"
                    >
                      {statusNote}
                    </p>
                  )}
                  <Field label={t('form.status')} required htmlFor="account-status" hint={t('form.status.hint')}>
                    <select
                      id="account-status"
                      className="input"
                      value={form.status}
                      onChange={(event) => set('status', event.target.value)}
                    >
                      {(['unknown', 'active', 'warning', 'restricted', 'disabled'] as const).map((value) => (
                        <option key={value} value={value}>
                          {enumLabel('accountStatus', value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label={t('form.country')}>
                      <input
                        className="input uppercase"
                        value={form.country}
                        onChange={(event) => set('country', event.target.value)}
                        maxLength={2}
                        placeholder="VN"
                      />
                    </Field>
                    <Field label={t('form.currency')}>
                      <input
                        className="input uppercase"
                        value={form.currency}
                        onChange={(event) => set('currency', event.target.value)}
                        maxLength={3}
                        placeholder="VND"
                      />
                    </Field>
                    <Field label={t('form.timezone')}>
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
                  <legend className={legend}>{t('form.group.assets')}</legend>
                  <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
                    {t('form.assets.note')}
                  </p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand"
                      checked={form.requires_page}
                      onChange={(event) => set('requires_page', event.target.checked)}
                    />
                    {t('form.requiresPage')}
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand"
                      checked={form.requires_pixel}
                      onChange={(event) => set('requires_pixel', event.target.checked)}
                    />
                    {t('form.requiresPixel')}
                  </label>
                  <Field label={t('form.landing')} hint={t('form.landing.hint')}>
                    <input
                      className="input"
                      type="url"
                      value={form.landing_page_url}
                      onChange={(event) => set('landing_page_url', event.target.value)}
                      placeholder="https://"
                    />
                  </Field>
                </fieldset>

                <fieldset>
                  <legend className={legend}>{t('form.group.notes')}</legend>
                  <Field label={t('form.notes')}>
                    <textarea
                      className="input min-h-[80px]"
                      value={form.notes}
                      onChange={(event) => set('notes', event.target.value)}
                      maxLength={5000}
                    />
                  </Field>
                </fieldset>
              </>
            )}

            <fieldset className="space-y-3">
              <legend className={legend}>{t('form.group.refs')}</legend>
              <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
                {t('form.refs.note')}
              </p>
            </fieldset>
          </form>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="account-form" disabled={save.isPending || nameMissing}>
            {save.isPending ? t('form.saving') : account ? t('form.save') : t('form.create')}
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  )
}
