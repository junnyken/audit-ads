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
  balance_raw: string
  billing_threshold_raw: string
  next_bill_date: string
  meta_daily_limit_raw: string
  payment_card_display: string
  payment_card_expiry: string
  business_legal_name: string
  business_country_code: string
  tax_id: string
  tax_id_verified: boolean
  bm_verified: boolean
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
  balance_raw: '',
  billing_threshold_raw: '',
  next_bill_date: '',
  meta_daily_limit_raw: '',
  payment_card_display: '',
  payment_card_expiry: '',
  business_legal_name: '',
  business_country_code: 'VN',
  tax_id: '',
  tax_id_verified: true,
  bm_verified: true,
}

function fromAccount(account: AdAccount): FormState {
  const bm = account.billing_meta ?? {}
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
    balance_raw: bm.balance_raw ?? account.spend_periods?.balance_raw ?? '',
    billing_threshold_raw: bm.billing_threshold_raw ?? '',
    next_bill_date: bm.next_bill_date ?? '',
    meta_daily_limit_raw: bm.meta_daily_limit_raw ?? '',
    payment_card_display: bm.payment_card_display ?? '',
    payment_card_expiry: bm.payment_card_expiry ?? '',
    business_legal_name: bm.business_legal_name ?? '',
    business_country_code: bm.business_country_code ?? account.country ?? 'VN',
    tax_id: bm.tax_id ?? '',
    tax_id_verified: bm.tax_id_verified ?? true,
    bm_verified: bm.bm_verified ?? true,
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
    billing_meta: {
      balance_raw: form.balance_raw.replace(/[^0-9.]/g, '').trim() || null,
      billing_threshold_raw: form.billing_threshold_raw.replace(/[^0-9.]/g, '').trim() || null,
      next_bill_date: form.next_bill_date.trim() || null,
      meta_daily_limit_raw: form.meta_daily_limit_raw.replace(/[^0-9.]/g, '').trim() || null,
      payment_card_display: form.payment_card_display.trim() || null,
      payment_card_expiry: form.payment_card_expiry.trim() || null,
      business_legal_name: form.business_legal_name.trim() || null,
      business_country_code: form.business_country_code.trim().toUpperCase() || 'VN',
      tax_id: form.tax_id.trim() || null,
      tax_id_verified: form.tax_id_verified,
      bm_verified: form.bm_verified,
    },
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
  statusSuggestion?: AccountStatus | null
  statusNote?: string | null
}) {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [touchedName, setTouchedName] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(account))
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
        className="w-full sm:w-[32rem] sm:max-w-[32rem]"
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
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-line bg-surface-muted/40 p-3.5">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-brand-text">
                Thanh toán, Ngưỡng Bill & Thông tin Doanh nghiệp (Meta)
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dư nợ hiện tại" hint="Số dư chưa thanh toán trên Meta">
                  <input
                    className="input font-mono tabular-nums"
                    value={form.balance_raw}
                    onChange={(event) => set('balance_raw', event.target.value)}
                    placeholder="VD: 880669"
                  />
                </Field>
                <Field label="Số dư của bạn đạt (Ngưỡng TT)" hint="Ngưỡng lập hóa đơn tự động">
                  <input
                    className="input font-mono tabular-nums"
                    value={form.billing_threshold_raw}
                    onChange={(event) => set('billing_threshold_raw', event.target.value)}
                    placeholder="VD: 1524019"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Và vào ngày này (Ngày TT)" hint="Ngày lập hóa đơn định kỳ hàng tháng">
                  <input
                    className="input"
                    value={form.next_bill_date}
                    onChange={(event) => set('next_bill_date', event.target.value)}
                    placeholder="VD: 18 Tháng 11, 2026"
                  />
                </Field>
                <Field label="Giới hạn chi tiêu ngày (Meta đặt)" hint="Daily Spend Limit do Meta áp đặt">
                  <input
                    className="input font-mono tabular-nums"
                    value={form.meta_daily_limit_raw}
                    onChange={(event) => set('meta_daily_limit_raw', event.target.value)}
                    placeholder="VD: 962367"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Phương thức thanh toán (Thẻ)" hint="Tên thẻ hiển thị trên Meta">
                    <input
                      className="input font-mono"
                      value={form.payment_card_display}
                      onChange={(event) => set('payment_card_display', event.target.value)}
                      placeholder="VD: Visa ···· 5173"
                    />
                  </Field>
                </div>
                <Field label="Hết hạn thẻ">
                  <input
                    className="input font-mono"
                    value={form.payment_card_expiry}
                    onChange={(event) => set('payment_card_expiry', event.target.value)}
                    placeholder="09/28"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-line pt-2.5">
                <div className="col-span-2">
                  <Field label="Tên doanh nghiệp (Pháp nhân)">
                    <input
                      className="input"
                      value={form.business_legal_name}
                      onChange={(event) => set('business_legal_name', event.target.value)}
                      placeholder="VD: Jollibee Foods Corporation"
                    />
                  </Field>
                </div>
                <Field label="Quốc gia ĐK">
                  <input
                    className="input uppercase font-mono"
                    value={form.business_country_code}
                    onChange={(event) => set('business_country_code', event.target.value)}
                    maxLength={2}
                    placeholder="PH / VN"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mã số thuế (Tax ID)">
                  <input
                    className="input font-mono"
                    value={form.tax_id}
                    onChange={(event) => set('tax_id', event.target.value)}
                    placeholder="VD: 000388771"
                  />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={form.tax_id_verified}
                      onChange={(event) => set('tax_id_verified', event.target.checked)}
                    />
                    Mã số thuế đã xác minh
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={form.bm_verified}
                      onChange={(event) => set('bm_verified', event.target.checked)}
                    />
                    BM chủ quản đã XMDN
                  </label>
                </div>
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
