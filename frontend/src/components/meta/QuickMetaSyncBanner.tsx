import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
          badge: '[BM] ID Business Manager (Doanh nghiệp)',
          detail: `${matchedBm.name} (Mã BM: ${matchedBm.external_id}) — Đang quản lý ${count} tài khoản quảng cáo`,
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
        const viaName =
          matchedAcc.personal_account_reference_label ||
          matchedAcc.owner_label ||
          'Nguyễn Thiên Triều'
        return {
          kind: 'personal_ad_account' as const,
          badge: '[TKQC Cá nhân] ID Tài khoản quảng cáo Cá nhân (Không thuộc BM)',
          detail: `TKQC ${matchedAcc.display_name} (act_${digits}) — Thuộc tài khoản Facebook cá nhân "${viaName}"`,
          tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        }
      }
      return {
        kind: 'bm_ad_account' as const,
        badge: '[TKQC BM] ID Tài khoản quảng cáo thuộc BM',
        detail: `TKQC ${matchedAcc.display_name} (act_${digits}) — Thuộc Business Manager "${matchedAcc.business_manager_name || 'BM'}"`,
        tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      }
    }

    if (targetBmExternalId) {
      if (targetBmExternalId === 'personal') {
        return {
          kind: 'new_personal' as const,
          badge: '[Gắn TKQC Cá nhân mới]',
          detail: `Sẽ gắn ID act_${digits} làm Tài khoản quảng cáo Cá nhân (Không thuộc BM).`,
          tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        }
      }
      const chosenBm = bms.find((b: ClassifierBM) => b.external_id === targetBmExternalId)
      return {
        kind: 'new_bm_assigned' as const,
        badge: '[Gắn TKQC vào BM đã chọn]',
        detail: `Sẽ gắn trực tiếp TKQC act_${digits} vào Business Manager "${chosenBm?.name || targetBmExternalId}" (${targetBmExternalId}).`,
        tone: 'border-brand/40 bg-brand-soft/20 text-brand-text',
      }
    }

    if (isActPrefix) {
      return {
        kind: 'new_ad_account' as const,
        badge: '[TKQC] Chuỗi ID Tài khoản quảng cáo Meta (act_...)',
        detail: `Hệ thống sẽ truy vấn node act_${digits} trên Meta Graph API để lấy chính xác BM sở hữu (business{id,name}) hoặc Cá nhân.`,
        tone: 'border-line bg-surface-muted text-ink',
      }
    }

    if (/^\d{5,22}$/.test(digits)) {
      return {
        kind: 'unknown_digits' as const,
        badge: '[Tự động phân loại] Chuỗi dãy số Meta ID (' + digits.length + ' chữ số)',
        detail: `Hệ thống sẽ kiểm tra trên Meta xem "${digits}" là Node Doanh nghiệp ({bm_id}) hay Node Tài khoản quảng cáo (act_${digits}) và gắn đúng BM sở hữu (không bao giờ nhảy sang BM mặc định khác).`,
        tone: 'border-line bg-surface-muted text-ink',
      }
    }

    return null
  }, [bmId, targetBmExternalId, bmsQuery.data, accountsQuery.data])

  const sync = useMutation({
    mutationFn: (overrideId?: string) =>
      api.post<QuickSyncResponse>('/api/v1/meta-connections/quick-sync', {
        business_manager_reference: (overrideId ?? bmId).trim(),
        label: accountLabel.trim(),
        access_token: accessToken.trim() || null,
        target_bm_external_id: overrideId ? null : targetBmExternalId || null,
      }),
    onSuccess: (data) => {
      setResult(data)
      if (accessToken.trim()) {
        setAccessToken('')
      }
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['business-managers'] })
      void queryClient.invalidateQueries({ queryKey: ['meta-connections'] })
      void queryClient.invalidateQueries({ queryKey: ['spend-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['readiness-summary'] })
    },
  })

  if (user?.role !== 'owner') return null

  const isSuccess = result && (result.status === 'succeeded' || result.status === 'succeeded_with_warnings')
  const bmsList = bmsQuery.data?.items ?? []
  const accountsList = accountsQuery.data?.items ?? []
  const personalAccounts = accountsList.filter(
    (a: ClassifierAccount) =>
      a.account_type === 'personal_reference' ||
      !a.business_manager_id ||
      normalizeMetaDigits(a.external_account_id || '') === '349735764764551',
  )
  const bmAccounts = accountsList.filter(
    (a: ClassifierAccount) =>
      a.account_type !== 'personal_reference' &&
      Boolean(a.business_manager_id) &&
      normalizeMetaDigits(a.external_account_id || '') !== '349735764764551',
  )

  return (
    <Card className="border-brand/30 bg-surface">
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-ink">{t('qs.title')}</h2>
            <p className="text-xs text-ink-muted">{t('qs.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowTokenInput((prev) => !prev)}
            className="rounded border border-brand/40 bg-brand-soft/15 px-2.5 py-1 text-[11px] font-medium text-brand-text hover:bg-brand-soft/30"
          >
            {showTokenInput
              ? '− Đóng hướng dẫn & cài đặt nâng cao'
              : '❓ Khi nào cần chọn BM hoặc dán Token mới?'}
          </button>
        </div>

        <div className="grid gap-2 rounded-md border border-line/80 bg-surface-muted/40 p-2.5 text-[11px] text-ink sm:grid-cols-3">
          <div className="rounded border border-line/60 bg-surface p-2">
            <div className="font-semibold text-emerald-500">
              Trường hợp 1: Chỉ cần nhập dãy số ID (Mặc định)
            </div>
            <p className="mt-0.5 text-ink-muted">
              Bạn chỉ cần dán <strong>ID BM</strong> hoặc <strong>ID TKQC</strong> vào ô số (1) rồi bấm <strong>Kết nối</strong>. Ô số (2) cứ để nguyên <em>"Tự động xác định"</em>.
            </p>
          </div>
          <div className="rounded border border-line/60 bg-surface p-2">
            <div className="font-semibold text-sky-400">
              Trường hợp 2: Khi nào dùng ô (2) "Gắn vào BM"?
            </div>
            <p className="mt-0.5 text-ink-muted">
              Chỉ dùng khi bạn nhập <strong>1 ID TKQC mới</strong> (ví dụ <code className="font-mono">1730165772447559</code>) và muốn chỉ định ngay nó nằm trong BM nào (ví dụ chọn <em>Xây Dựng - Tân Hòa</em>) hoặc là <em>TKQC Cá nhân</em>.
            </p>
          </div>
          <div className="rounded border border-line/60 bg-surface p-2">
            <div className="font-semibold text-amber-400">
              Trường hợp 3: Khi nào bấm nút "Cấp Token mới"?
            </div>
            <p className="mt-0.5 text-ink-muted">
              Chỉ dùng khi bạn thêm một <strong>BM hoàn toàn mới</strong> (ngoài Quảng Cáo Top) và muốn hệ thống tự động kéo tiền chi tiêu & danh sách TKQC từ Meta về.
            </p>
          </div>
        </div>

        <form
          className="space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            setResult(null)
            sync.mutate(undefined)
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Field label="(1) Nhập Mã ID Business Manager hoặc ID Tài khoản quảng cáo" htmlFor="quick-sync-bm-id">
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

            <div className="min-w-[230px]">
              <Field
                label="(2) Thuộc BM nào? (Mặc định: Để Tự động)"
                htmlFor="quick-sync-target-bm"
              >
                <select
                  id="quick-sync-target-bm"
                  className="input text-xs"
                  value={targetBmExternalId}
                  onChange={(event) => setTargetBmExternalId(event.target.value)}
                >
                  <option value="">⚡ Tự động xác định theo Meta Graph API</option>
                  {bmsList.map((bm: ClassifierBM) => (
                    <option key={bm.id} value={bm.external_id || ''}>
                      [BM] {bm.name} ({bm.external_id})
                    </option>
                  ))}
                  <option value="personal">
                    [TKQC Cá nhân] Không thuộc BM (Nguyễn Thiên Triều)
                  </option>
                </select>
              </Field>
            </div>

            <Button type="submit" disabled={sync.isPending}>
              {sync.isPending ? t('qs.submitting') : t('qs.submit')}
            </Button>
          </div>

          {showTokenInput && (
            <div className="grid gap-3 rounded-md border border-brand/30 bg-surface-muted/60 p-3 sm:grid-cols-2">
              <Field
                label="Meta Access Token (User Token đọc toàn bộ BM hoặc System User Token của BM mới)"
                htmlFor="quick-sync-access-token"
              >
                <input
                  id="quick-sync-access-token"
                  type="password"
                  className="input font-mono text-xs"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder="EAA... (Dán 1 lần, hệ thống tự mã hoá & lưu để đọc mọi BM tiếp theo)"
                />
              </Field>
              <Field
                label="Tên hiển thị gợi nhớ cho TKQC / BM (Nếu thêm mới)"
                htmlFor="quick-sync-account-label"
              >
                <input
                  id="quick-sync-account-label"
                  className="input text-xs"
                  value={accountLabel}
                  onChange={(event) => setAccountLabel(event.target.value)}
                  placeholder="VD: TK-Xây Dựng, Công Ty Cổ Phần Mắt Bão..."
                  maxLength={200}
                />
              </Field>
            </div>
          )}
        </form>

        {detectedClassification && (
          <div
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${detectedClassification.tone}`}
          >
            <span className="font-semibold">{detectedClassification.badge}:</span>
            <span>{detectedClassification.detail}</span>
          </div>
        )}

        {(bmsList.length > 0 || accountsList.length > 0) && (
          <div className="space-y-1.5 rounded-md border border-line/70 bg-surface-muted/60 px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-ink-muted">
                [BM] Dãy số ID Business Manager:
              </span>
              {bmsList.map((bm: ClassifierBM) => {
                const count = accountsList.filter(
                  (a: ClassifierAccount) => a.business_manager_id === bm.id,
                ).length
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
                    className="inline-flex items-center gap-1 rounded border border-brand/30 bg-surface px-2 py-0.5 font-mono text-[11px] text-ink hover:border-brand hover:text-brand-text"
                  >
                    <span className="font-sans font-semibold">{bm.name}:</span>
                    <span>{bm.external_id}</span>
                    <span className="font-sans text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      ({count} TKQC)
                    </span>
                  </button>
                )
              })}
            </div>

            {personalAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-ink-muted">
                  [TKQC Cá nhân] Không thuộc BM:
                </span>
                {personalAccounts.map((acc: ClassifierAccount) => (
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
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-surface px-2 py-0.5 font-mono text-[11px] text-ink hover:border-emerald-500"
                  >
                    <span>{acc.external_account_id}</span>
                    <span className="font-sans text-ink-muted">
                      ({acc.personal_account_reference_label || acc.owner_label || 'Nguyễn Thiên Triều'})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {bmAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-ink-muted">
                  [TKQC thuộc BM] Dãy số ID Tài khoản quảng cáo:
                </span>
                {bmAccounts.map((acc: ClassifierAccount) => (
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
                    <span className="font-sans text-ink-muted">
                      ({acc.business_manager_name || 'BM'})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
                    summary:
                      result.failure_summary ||
                      'Token hiện tại chưa có quyền đọc mã ID này trên Meta. Bạn có thể chọn "Gắn vào BM sở hữu" ngay ở ô bên trên hoặc bấm "+ Cấp Token đa BM" để dán User Token.',
                  })}
            </p>
            {isSuccess && result.accounts && result.accounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-medium text-ink-muted">
                  Tài khoản quảng cáo được xác định:
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowTokenInput(true)}
                >
                  🔑 Dán Token hoặc Chọn BM sở hữu ngay trên thanh này
                </Button>
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
