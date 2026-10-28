import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { AdAccount, BudgetPacingStatus, SpendView } from '../../lib/types'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Field } from '../primitives/field'
import { rawMoney } from '../../lib/spend'
import { useI18n } from '../../i18n'
import { useAuth } from '../../hooks/useAuth'
import { Note, Panel } from '../../pages/account/parts'

const PACING_TONE: Record<BudgetPacingStatus, 'neutral' | 'caution' | 'attention'> = {
  unconfigured: 'neutral',
  insufficient_data: 'neutral',
  on_track: 'neutral',
  underspending: 'caution',
  approaching_monthly_budget: 'caution',
  overspending: 'attention',
}

export function BudgetPacingPanel({ account, spend }: { account: AdAccount; spend: SpendView }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'operator'
  const archived = account.archived_at !== null

  const pacing = spend.budget_pacing ?? {
    client_name: account.client_name ?? '',
    planned_daily_budget_raw: account.planned_daily_budget_raw ?? null,
    planned_monthly_budget_raw: account.planned_monthly_budget_raw ?? null,
    currency: spend.observed_currency ?? spend.registry_currency ?? account.currency ?? null,
    latest_complete_day: spend.latest_complete_day,
    latest_day_spend_raw: spend.daily?.[0]?.spend_raw ?? null,
    daily_utilization_pct: null,
    mtd_spend_raw: null,
    mtd_days_counted: 0,
    monthly_utilization_pct: null,
    pacing_status: (account.planned_daily_budget_raw || account.planned_monthly_budget_raw
      ? 'insufficient_data'
      : 'unconfigured') as BudgetPacingStatus,
  }

  const [editing, setEditing] = useState(false)
  const [clientName, setClientName] = useState(pacing.client_name)
  const [dailyBudget, setDailyBudget] = useState(pacing.planned_daily_budget_raw ?? '')
  const [monthlyBudget, setMonthlyBudget] = useState(pacing.planned_monthly_budget_raw ?? '')

  const save = useMutation({
    mutationFn: () =>
      api.patch<AdAccount>(`/api/v1/ad-accounts/${account.id}`, {
        client_name: clientName.trim(),
        planned_daily_budget_raw: dailyBudget.trim() || null,
        planned_monthly_budget_raw: monthlyBudget.trim() || null,
      }),
    onSuccess: (updated) => {
      setEditing(false)
      queryClient.setQueryData(['ad-account', account.id], (prev: AdAccount | undefined) =>
        prev ? { ...prev, ...updated } : updated,
      )
      void queryClient.invalidateQueries({ queryKey: ['spend', account.id] })
      void queryClient.invalidateQueries({ queryKey: ['spend-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['alert-summary'] })
    },
  })

  function openEdit() {
    setClientName(pacing.client_name)
    setDailyBudget(pacing.planned_daily_budget_raw ?? '')
    setMonthlyBudget(pacing.planned_monthly_budget_raw ?? '')
    setEditing(true)
  }

  const cur = pacing.currency
  const statusTone = PACING_TONE[pacing.pacing_status] ?? 'neutral'

  return (
    <Panel
      title={t('sp.pacing.title')}
      action={
        canEdit && !archived && !editing ? (
          <Button variant="secondary" size="sm" onClick={openEdit} data-testid="pacing-edit-btn">
            {t('sp.pacing.editButton')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone} data-testid="pacing-status-badge">
          {t(`sp.pacing.status.${pacing.pacing_status}`)}
        </Badge>
        {pacing.client_name ? (
          <span className="text-xs font-medium text-brand-text" data-testid="pacing-client-name">
            {t('sp.pacing.client')}: {pacing.client_name}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">{t('sp.pacing.clientEmpty')}</span>
        )}
      </div>
      <p className="text-xs text-ink-muted">{t('sp.pacing.hint')}</p>

      {save.isSuccess && !editing && (
        <Note role="status" tone="info">
          {t('sp.pacing.savedNote')}
        </Note>
      )}

      {save.isError && (
        <Note role="alert" tone="attention">
          {save.error instanceof Error ? save.error.message : 'Error'}
        </Note>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="pacing-metrics">
        <div>
          <dt className="text-ink-muted">{t('sp.pacing.dailyBudget')}</dt>
          <dd className="font-mono tabular-nums">
            {pacing.planned_daily_budget_raw
              ? rawMoney(pacing.planned_daily_budget_raw, cur)
              : t('sp.pacing.notSet')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('sp.pacing.latestDayRatio')}</dt>
          <dd className="font-mono tabular-nums">
            {pacing.daily_utilization_pct !== null ? `${pacing.daily_utilization_pct}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('sp.pacing.monthlyBudget')}</dt>
          <dd className="font-mono tabular-nums">
            {pacing.planned_monthly_budget_raw
              ? rawMoney(pacing.planned_monthly_budget_raw, cur)
              : t('sp.pacing.notSet')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('sp.pacing.mtdSpend', { days: pacing.mtd_days_counted })}</dt>
          <dd className="font-mono tabular-nums">
            {pacing.mtd_spend_raw ? rawMoney(pacing.mtd_spend_raw, cur) : '—'}
            {pacing.monthly_utilization_pct !== null ? ` (${pacing.monthly_utilization_pct}%)` : ''}
          </dd>
        </div>
      </dl>

      {editing && (
        <form
          className="mt-3 space-y-3 rounded-md border border-line bg-surface-muted p-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          data-testid="pacing-edit-form"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('sp.pacing.client')} htmlFor="pacing-client-input">
              <input
                id="pacing-client-input"
                className="input"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                maxLength={200}
                placeholder={t('sp.pacing.clientPlaceholder')}
              />
            </Field>
            <Field label={t('sp.pacing.dailyBudget')} htmlFor="pacing-daily-input">
              <input
                id="pacing-daily-input"
                className="input font-mono tabular-nums"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                maxLength={32}
                placeholder={t('sp.pacing.dailyPlaceholder')}
              />
            </Field>
            <Field label={t('sp.pacing.monthlyBudget')} htmlFor="pacing-monthly-input">
              <input
                id="pacing-monthly-input"
                className="input font-mono tabular-nums"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
                maxLength={32}
                placeholder={t('sp.pacing.monthlyPlaceholder')}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={save.isPending}
            >
              {t('sp.pacing.cancelButton')}
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending} data-testid="pacing-save-btn">
              {save.isPending ? t('sp.pacing.savingButton') : t('sp.pacing.saveButton')}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}
