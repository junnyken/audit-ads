import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { Card, CardContent } from '../primitives/card'
import { Field } from '../primitives/field'
import { ErrorState } from '../states'

interface QuickSyncResponse {
  connection_id: string
  connection_label: string
  run_id: string
  status: string
  business_manager_reference: string | null
  business_manager_name: string | null
  imported_ad_accounts: number
  total_ad_accounts: number
  total_pixels: number
  total_business_users: number
  failure_code: string | null
  failure_summary: string | null
}

export function QuickMetaSyncBanner() {
  const { t } = useI18n()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [bmId, setBmId] = useState('')
  const [result, setResult] = useState<QuickSyncResponse | null>(null)

  const sync = useMutation({
    mutationFn: () =>
      api.post<QuickSyncResponse>('/api/v1/meta-connections/quick-sync', {
        business_manager_reference: bmId.trim(),
      }),
    onSuccess: (data) => {
      setResult(data)
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
      void queryClient.invalidateQueries({ queryKey: ['spend-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
    },
  })

  if (user?.role !== 'owner') return null

  return (
    <Card className="border-brand/30 bg-surface">
      <CardContent className="space-y-3 py-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">{t('qs.title')}</h2>
          <p className="text-xs text-ink-muted">{t('qs.subtitle')}</p>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setResult(null)
            sync.mutate()
          }}
        >
          <div className="min-w-[260px] flex-1">
            <Field label={t('qs.bmLabel')} htmlFor="quick-sync-bm-id">
              <input
                id="quick-sync-bm-id"
                className="input font-mono"
                value={bmId}
                onChange={(event) => setBmId(event.target.value)}
                placeholder={t('qs.bmPlaceholder')}
                maxLength={120}
              />
            </Field>
          </div>
          <Button type="submit" disabled={sync.isPending}>
            {sync.isPending ? t('qs.submitting') : t('qs.submit')}
          </Button>
        </form>
        {sync.isError && (
          <ErrorState title={t('qs.error')} error={sync.error} compact />
        )}
        {result && (
          <div
            role="status"
            className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink"
          >
            {result.status === 'succeeded' || result.status === 'succeeded_with_warnings'
              ? t('qs.result.ok', {
                  name: result.business_manager_name || result.connection_label,
                  ref: result.business_manager_reference || '—',
                  totalAccounts: result.total_ad_accounts,
                  imported: result.imported_ad_accounts,
                  pixels: result.total_pixels,
                  users: result.total_business_users,
                })
              : t('qs.result.failed', {
                  code: result.failure_code || result.status,
                  summary: result.failure_summary || '—',
                })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
