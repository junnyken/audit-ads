import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
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

interface ClassifierBM {
  id: string
  name: string
  external_id: string | null
  ad_account_count?: number
  ad_accounts?: { id: string; display_name: string; external_account_id: string | null }[]
}

interface ClassifierAccount {
  id: string
  display_name: string
  external_account_id: string | null
  account_type: string
  business_manager_id: string | null
  business_manager_name?: string | null
  personal_account_reference_label?: string | null
  owner_label?: string | null
}

interface PaginatedList<T> {
  items: T[]
  total: number
}

function normalizeMetaDigits(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.startsWith('act_') || trimmed.startsWith('act-')) {
    return trimmed.slice(4).trim()
  }
  return trimmed
}

export function QuickMetaSyncBanner() {
  const { t } = useI18n()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [bmId, setBmId] = useState('')
  const [targetBmExternalId, setTargetBmExternalId] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [showQuickPills, setShowQuickPills] = useState(false)
  const [result, setResult] = useState<QuickSyncResponse | null>(null)

  const bmsQuery = useQuery({
    queryKey: ['business-managers', 'quick-classifier'],
    queryFn: () =>
      api.get<PaginatedList<ClassifierBM>>('/api/v1/business-managers?page_size=100'),
    enabled: user?.role === 'owner',
  })

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'quick-classifier'],
    queryFn: () =>
      api.get<PaginatedList<ClassifierAccount>>('/api/v1/ad-accounts?page_size=100'),
    enabled: user?.role === 'owner',
  })

  const detectedClassification = useMemo(() => {
    const raw = bmId.trim()
    if (!raw) return null
    const isActPrefix = raw.toLowerCase().startsWith('act_') || raw.toLowerCase().startsWith('act-')
    const digits = normalizeMetaDigits(raw)
    const bms = bmsQuery.data?.items ?? []
    const accounts = accountsQuery.data?.items ?? []

    if (!isActPrefix) {
      const matchedBm = bms.find(
        (b: ClassifierBM) => (b.external_id || '').trim() === digits,
      )
      if (matchedBm) {
        const count = accounts.filter(
          (a: ClassifierAccount) => a.business_manager_id === matchedBm.id,
        ).length
        return {
          kind: 'bm' as const,
          badge: '[BM]',
          detail: `${matchedBm.name} (${matchedBm.external_id}) · ${count} TKQC`,
          tone: 'border-brand/40 bg-brand-soft/20 text-brand-text',
        }
      }
    }

    const matchedAcc = accounts.find(
      (a: ClassifierAccount) => normalizeMetaDigits(a.external_account_id || '') === digits,
    )
    if (matchedAcc) {
      const isPersonal =
        matchedAcc.account_type === 'personal_reference' ||
        !matchedAcc.business_manager_id ||
        digits === '349735764764551'
      if (isPersonal) {
        return {
          kind: 'personal_ad_account' as const,
          badge: '[TKQC Cá nhân]',
          detail: `${matchedAcc.display_name} (${digits})`,
          tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        }
      }
      return {
        kind: 'bm_ad_account' as const,
        badge: '[TKQC BM]',
        detail: `${matchedAcc.display_name} (${digits}) · BM ${matchedAcc.business_manager_name || ''}`,
        tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      }
    }

    if (isActPrefix) {
      return {
        kind: 'new_ad_account' as const,
        badge: '[TKQC Mới]',
        detail: `act_${digits}`,
        tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      }
    }

    if (/^\d{6,22}$/.test(digits)) {
      return {
        kind: 'auto_probe' as const,
        badge: '[ID Mới]',
        detail: `Tự động kiểm tra ${digits} trên Meta`,
        tone: 'border-brand/40 bg-brand-soft/15 text-ink',
      }
    }

    return null
  }, [bmId, bmsQuery.data, accountsQuery.data])

  const sync = useMutation({
    mutationFn: (overrideId?: string) => {
      const rawId = typeof overrideId === 'string' ? overrideId : bmId
      return api.post<QuickSyncResponse>('/api/v1/meta/quick-sync', {
        business_manager_id: rawId.trim() || null,
        target_bm_external_id: targetBmExternalId.trim() || null,
        account_label: accountLabel.trim() || null,
        access_token: accessToken.trim() || null,
      })
    },
    onSuccess: (data) => {
      setResult(data)
      if (accessToken.trim()) {
        setAccessToken('')
      }
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['pixels'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
    },
  })

  if (user && user.role !== 'owner') {
    return null
  }

  const isSuccess = result?.status === 'completed' || result?.status === 'partial'
  const knownBms = (bmsQuery.data?.items ?? []).filter((b: ClassifierBM) => Boolean(b.external_id))
  const allAccounts = (accountsQuery.data?.items ?? []).filter((a: ClassifierAccount) => Boolean(a.external_account_id))

  return (
    <Card className="border-line-strong bg-surface p-3" data-testid="quick-meta-sync-banner">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setResult(null)
          sync.mutate(undefined)
        }}
      >
        <span className="inline-flex items-center gap-1 text-xs font-bold text-ink">
          ⚡ Đồng bộ Meta:
        </span>
        <input
          type="text"
          className="input min-w-[240px] flex-1 font-mono text-xs"
          placeholder="Nhập ID BM hoặc ID TKQC (để trống = đồng bộ toàn bộ 5 BM)"
          value={bmId}
          onChange={(e) => setBmId(e.target.value)}
          disabled={sync.isPending}
          data-testid="quick-sync-bm-input"
        />
        <select
          className="input w-auto min-w-[200px] text-xs"
          value={targetBmExternalId}
          onChange={(e) => setTargetBmExternalId(e.target.value)}
          disabled={sync.isPending}
          data-testid="quick-sync-target-bm-select"
          aria-label="Chọn BM sở hữu"
        >
          <option value="">⚡ Tự động xác định BM</option>
          {knownBms.map((bm: ClassifierBM) => {
            const count =
              bm.ad_account_count ??
              allAccounts.filter((a: ClassifierAccount) => a.business_manager_id === bm.id).length
            return (
              <option key={bm.id} value={bm.external_id || ''}>
                [BM] {bm.name} ({count} TKQC)
              </option>
            )
          })}
          <option value="PERSONAL">[TKQC Cá nhân] Không thuộc BM</option>
        </select>
        <Button type="submit" disabled={sync.isPending} data-testid="quick-sync-submit">
          {sync.isPending ? t('qs.submitting') : '⚡ Đồng bộ ngay'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setShowQuickPills((v) => !v)}
        >
          {showQuickPills ? 'Ẩn danh sách ID' : `📋 Chọn nhanh ID (${knownBms.length} BM · ${allAccounts.length} TKQC)`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setShowTokenInput((v) => !v)}
          data-testid="quick-sync-toggle-token"
        >
          🔑 {showTokenInput ? 'Ẩn ô Token' : 'Cấp Token mới'}
        </Button>
      </form>

      {detectedClassification && (
        <div
          className={`mt-2 flex flex-wrap items-center gap-2 rounded border px-2.5 py-1 text-xs ${detectedClassification.tone}`}
          data-testid="quick-sync-classification"
        >
          <span className="font-bold">{detectedClassification.badge}</span>
          <span>{detectedClassification.detail}</span>
        </div>
      )}

      {showTokenInput && (
        <div className="mt-2.5 grid gap-2 rounded border border-line bg-surface-muted p-2.5 sm:grid-cols-2">
          <div>
            <label className="label text-xs" htmlFor="quick-sync-token-input">
              Meta Access Token (Tự động đổi sang Token 60 ngày & lưu két mã hoá)
            </label>
            <input
              id="quick-sync-token-input"
              type="password"
              className="input font-mono text-xs"
              placeholder="EAABwzLixnjYBO..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={sync.isPending}
              data-testid="quick-sync-token-input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="quick-sync-label-input">
              Tên gợi nhớ cho BM / TKQC mới (tuỳ chọn)
            </label>
            <input
              id="quick-sync-label-input"
              type="text"
              className="input text-xs"
              placeholder="VD: TK-Xây Dựng hoặc BM Khách hàng..."
              value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)}
              disabled={sync.isPending}
              data-testid="quick-sync-label-input"
            />
          </div>
        </div>
      )}

      {showQuickPills && (knownBms.length > 0 || allAccounts.length > 0) && (
        <div className="mt-2.5 space-y-1.5 rounded border border-line bg-surface-muted p-2.5 text-xs">
          {knownBms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-ink">BM:</span>
              {knownBms.map((bm: ClassifierBM) => {
                const count =
                  bm.ad_account_count ??
                  allAccounts.filter((a: ClassifierAccount) => a.business_manager_id === bm.id).length
                return (
                  <button
                    key={bm.id}
                    type="button"
                    onClick={() => {
                      const val = bm.external_id || ''
                      setBmId(val)
                      setTargetBmExternalId('')
                      setResult(null)
                      sync.mutate(val)
                    }}
                    className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-ink hover:border-brand"
                  >
                    <span className="font-sans font-semibold">{bm.name}:</span>
                    <span>{bm.external_id}</span>
                    <span className="font-sans text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      ({count})
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {allAccounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-ink">TKQC:</span>
              {allAccounts.map((acc: ClassifierAccount) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    const val = acc.external_account_id || ''
                    setBmId(val)
                    setTargetBmExternalId('')
                    setResult(null)
                    sync.mutate(val)
                  }}
                  className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink hover:border-brand"
                >
                  <span>{acc.external_account_id}</span>
                  <span className="font-sans text-ink-muted">({acc.display_name})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sync.isError && (
        <div className="mt-2">
          <ErrorState title={t('qs.error')} error={sync.error} compact />
        </div>
      )}
      {result && (
        <div
          role="status"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink"
        >
          <span>
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
                  summary: result.failure_summary || 'Không thể đồng bộ mã ID này.',
                })}
          </span>
          {!isSuccess && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowTokenInput(true)}>
              🔑 Dán Token mới
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
