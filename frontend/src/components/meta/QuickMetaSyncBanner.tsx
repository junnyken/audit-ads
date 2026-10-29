import { useState } from 'react'
import { Link } from 'react-router-dom'
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
  accounts?: { id: string; display_name: string; external_account_id: string | null }[]
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

  const isSuccess = result && (result.status === 'succeeded' || result.status === 'succeeded_with_warnings')

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
            className="space-y-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink"
          >
            <p>
              {isSuccess
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
                    summary: result.failure_summary || 'Token hiện tại trên máy chủ chưa có quyền đọc BM này.',
                  })}
            </p>
            {isSuccess && result.accounts && result.accounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-medium text-ink-muted">
                  Tài khoản quảng cáo của BM này:
                </span>
                {result.accounts.map((acc) => (
                  <Link
                    key={acc.id}
                    to={`/accounts/${acc.id}`}
                    className="inline-flex items-center rounded border border-brand/40 bg-brand-soft/20 px-2 py-0.5 text-[11px] font-medium text-brand-text hover:underline"
                  >
                    {acc.display_name}
                    {acc.external_account_id && acc.external_account_id !== acc.display_name
                      ? ` (${acc.external_account_id})`
                      : ''}
                  </Link>
                ))}
                <Link
                  to="/accounts"
                  className="ml-1 text-[11px] font-semibold text-brand-text hover:underline"
                >
                  Mở trang Tài khoản quảng cáo →
                </Link>
              </div>
            )}
            {!isSuccess && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button asChild variant="secondary" size="sm">
                  <Link to="/settings#meta-readers">{t('mc.empty.facebook')}</Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
