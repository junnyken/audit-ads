import { useMemo, useState } from 'react'
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from '../lib/api'
import type { FacebookIdentitySummary, Paged, ReferenceRecord, TeamMember } from '../lib/types'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { PageHeader } from '../components/page/PageHeader'
import { SearchField, SelectField } from '../components/page/Filters'
import { EmptyState, ErrorState } from '../components/states'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { FacebookAccountFormSheet } from '../components/facebook/FacebookAccountFormSheet'
import { twoFactorTone } from '../lib/readiness'
import {
  WORKSTATION_REAL_CHROME_PROFILES,
  downloadSwitchyOmegaConfig,
  downloadWindowsChromeLauncherBat,
  fetchRealLocalChromeProfiles,
  launchInAssignedChromeProfile,
  parseProxyString,
} from '../lib/chromeProfileLauncher'

const LEGACY_MOCK_NETWORKS = [
  'vnpt static ip — line #',
  'fpt static ip — line #',
  'viettel residential — line #',
  'mobile 4g/5g vn — line #',
]

function isRealNetworkLabel(val: string): boolean {
  const clean = val.trim()
  if (!clean) return false
  const lower = clean.toLowerCase()
  return !LEGACY_MOCK_NETWORKS.some((p) => lower.startsWith(p))
}

export default function FacebookAccounts() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'owner'
  const canWrite = role !== 'viewer'
  const canAssignOwner = role === 'owner' || role === 'admin'

  const [search, setSearch] = useState('')
  const [holder, setHolder] = useState('')
  const [ownershipFilter, setOwnershipFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ReferenceRecord | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['personal-account-references', 'facebook-list', search],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/personal-account-references${query({ search, page_size: 200 })}`),
  })
  const summary = useQuery({
    queryKey: ['facebook-identities', 'summary'],
    queryFn: () => api.get<FacebookIdentitySummary[]>('/api/v1/facebook-identities/summary'),
  })
  const members = useQuery({
    queryKey: ['team-members', 'options'],
    queryFn: () => api.get<TeamMember[]>('/api/v1/team/members'),
    retry: false,
  })
  const localChrome = useQuery({
    queryKey: ['local-chrome-profiles'],
    queryFn: fetchRealLocalChromeProfiles,
    initialData: WORKSTATION_REAL_CHROME_PROFILES,
    retry: false,
  })

  const syncFromMeta = useMutation({
    mutationFn: () =>
      api.post<{ status: string; total_business_users?: number; total_ad_accounts?: number }>(
        '/api/v1/meta-operations/quick-sync',
        { business_manager_reference: '' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setSyncNotice('Đã tự động lấy toàn bộ danh sách Via (Business Users), BM và TKQC thật từ Meta Graph API.')
      setTimeout(() => setSyncNotice(null), 5000)
    },
  })

  const quickUpdateProfile = useMutation({
    mutationFn: ({ id, browser_profile_label }: { id: string; browser_profile_label: string }) =>
      api.patch(`/api/v1/personal-account-references/${id}`, { browser_profile_label }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/personal-account-references/${id}/archive`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['facebook-identities'] })
    },
  })

  const bySummary = useMemo(() => new Map((summary.data ?? []).map((row) => [row.id, row])), [summary.data])
  const rows = (list.data?.items ?? []).filter((row) => {
    if (holder && row.owner_member_id !== holder) return false
    if (ownershipFilter && (row.ownership_type ?? 'agency_owned') !== ownershipFilter) return false
    return true
  })

  const chromeOptions = localChrome.data ?? WORKSTATION_REAL_CHROME_PROFILES

  const columns = [
    t('res.f.label'),
    'Môi trường đăng nhập (Hồ sơ Chrome thật & Proxy)',
    t('fb.owner'),
    t('fb.twoFactor'),
    t('fb.businessManagers'),
    t('fb.adAccounts'),
    t('fb.status'),
    ...(canWrite ? [t('fb.form.editBtn')] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('fb.title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              🟢 Đã kết nối {chromeOptions.length} Hồ sơ Chrome thật trên máy
            </span>
            {canWrite && (
              <Button
                type="button"
                variant="secondary"
                disabled={syncFromMeta.isPending}
                onClick={() => syncFromMeta.mutate()}
                title="Tự động quét toàn bộ Via (Business Users), Email, 2FA, BM và TKQC từ Meta Graph API mà không cần nhập tay"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncFromMeta.isPending ? 'animate-spin' : ''}`} />
                {syncFromMeta.isPending ? 'Đang lấy Via từ Meta...' : 'Tự động lấy Via từ Meta'}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={downloadWindowsChromeLauncherBat}
              title="Tải file cài đặt dự phòng cho máy Windows khác"
              data-testid="fb-chrome-launcher-setup"
            >
              ⚡ Tải bộ kết nối cho máy khác
            </Button>
            {canWrite && (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('fb.empty.action')}
              </Button>
            )}
          </div>
        }
      />

      {syncNotice && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          ✓ {syncNotice}
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            1. Cách tách Tài khoản (Via & BM)
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            1 Chrome Profile = <span className="text-brand-text">1 Via cố định</span> · 1 Cụm BM = <span className="text-success-text">2 Via + 1 Partner</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            Mỗi BM gồm <strong>1 Via gốc</strong> + <strong>1 Via dự phòng</strong> (nằm im kháng nghị/thanh toán) và share <strong>Partner</strong> về BM Tổng.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            2. Hạn mức 1 Proxy → Tài khoản FB
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            Chuẩn nuôi: <span className="text-success-text">1–2 Via / 1 Proxy</span> · Wifi gốc: <span className="text-warning-text">Tối đa 2–3 Via</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-muted">
            Tốt nhất <strong>1 Proxy : 1 Via chính</strong> (hoặc 2 Via cùng 1 cụm BM). Từ Via thứ 4 trở đi bắt buộc tách Proxy riêng.
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            3. Loại Proxy chuẩn & Chỗ mua / Quản lý
          </div>
          <div className="mt-1 text-xs font-semibold text-ink">
            Bắt buộc: <span className="text-brand-text">IPv4 Dân cư tĩnh VN</span> (Viettel / VNPT / FPT)
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-semibold text-ink-muted">Mua & QL:</span>
            <a href="https://proxyvn.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:border-brand hover:underline">
              🛒 ProxyVN.vn ↗
            </a>
            <a href="https://zingproxy.com/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:border-brand hover:underline">
              🛒 ZingProxy ↗
            </a>
            <a href="https://muaproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:border-brand hover:underline">
              🛒 MuaProxy.vn ↗
            </a>
            <a href="https://vproxy.vn/" target="_blank" rel="noopener noreferrer" className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-brand-text hover:border-brand hover:underline">
              🛒 VProxy.vn ↗
            </a>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <SearchField label={t('pg.search')} placeholder={t('fb.search')} value={search} onApply={setSearch} />
        <SelectField
          label={t('fb.ownership')}
          value={ownershipFilter}
          onChange={setOwnershipFilter}
          options={[
            ['', t('fb.ownership.all')],
            ['agency_owned', t('fb.ownership.agency_owned')],
            ['client_provided', t('fb.ownership.client_provided')],
          ]}
        />
        {members.data && (
          <SelectField
            label={t('fb.owner')}
            value={holder}
            onChange={setHolder}
            options={[['', t('fb.anyOwner')], ...members.data.map((m) => [m.id, m.full_name || m.email] as [string, string])]}
          />
        )}
      </div>

      {list.isLoading ? (
        <TableSkeleton columns={columns} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} title={t('fb.error.title')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('fb.empty.title')}
          description={t('fb.empty.body')}
          action={
            canWrite ? (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('fb.empty.action')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table cards aria-label={t('fb.title')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const s = bySummary.get(row.id)
                const ownership = String(row.ownership_type ?? 'agency_owned')
                const clientName = String(row.client_name ?? '').trim()
                const browserLabel = String(row.browser_profile_label ?? '').trim()
                const rawNetwork = String(row.network_label ?? '').trim()
                const networkLabel = isRealNetworkLabel(rawNetwork) ? rawNetwork : ''
                const emailHint = String(row.email_hint ?? '').trim()
                const notesText = String(row.notes ?? '').trim()

                const allRows = list.data?.items ?? []
                const sharedBrowser =
                  s?.shared_browser_profile_with ??
                  (browserLabel
                    ? allRows
                        .filter(
                          (o) =>
                            o.id !== row.id &&
                            String(o.browser_profile_label ?? '').trim().toLowerCase() === browserLabel.toLowerCase(),
                        )
                        .map((o) => String(o.label))
                    : [])
                const sharedNetwork =
                  networkLabel
                    ? allRows
                        .filter(
                          (o) =>
                            o.id !== row.id &&
                            isRealNetworkLabel(String(o.network_label ?? '')) &&
                            String(o.network_label ?? '').trim().toLowerCase() === networkLabel.toLowerCase(),
                        )
                        .map((o) => String(o.label))
                    : []

                return (
                  <TableRow key={row.id} className="align-top">
                    {/* CỘT 1: TÊN VIA + ID META THẬT + EMAIL */}
                    <TableCell label={columns[0]} className="cell-title max-w-[16rem]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/facebook-accounts/${row.id}`}
                            className="font-semibold text-brand-text hover:underline"
                          >
                            {String(row.label)}
                          </Link>
                          <Badge tone={ownership === 'client_provided' ? 'info' : 'neutral'}>
                            {t(`fb.ownership.${ownership}` as never)}
                          </Badge>
                          {clientName && <span className="text-xs text-ink-muted">{clientName}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          {Boolean(row.external_reference_id) && (
                            <span className="font-mono">ID: {String(row.external_reference_id)}</span>
                          )}
                          {emailHint && <span className="font-mono text-[11px]">· ✉️ {emailHint}</span>}
                        </div>
                        {notesText && (
                          <p className="text-[11px] text-ink-muted line-clamp-1" title={notesText}>
                            {notesText}
                          </p>
                        )}
                      </div>
                    </TableCell>

                    {/* CỘT 2: CHỌN NHANH HỒ SƠ CHROME THẬT (1 CHẠM) & PROXY THẬT */}
                    <TableCell label={columns[1]} className="min-w-[20rem] text-xs">
                      <div className="space-y-1.5" data-testid={`fb-env-${row.id}`}>
                        {/* Dòng 1: Chọn nhanh Hồ sơ Chrome thật ngay trên bảng + Mở Chrome */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-ink-muted">Chrome:</span>
                          {canWrite ? (
                            <select
                              aria-label={`Chọn hồ sơ Chrome cho ${String(row.label)}`}
                              className="max-w-[16.5rem] rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-brand focus:border-brand focus:outline-none"
                              value={browserLabel}
                              onChange={(e) =>
                                quickUpdateProfile.mutate({
                                  id: row.id,
                                  browser_profile_label: e.target.value,
                                })
                              }
                            >
                              <option value="">— Chọn Hồ sơ Chrome trên máy —</option>
                              {chromeOptions.map((cp) => (
                                <option key={cp.folder} value={cp.label}>
                                  {cp.label}
                                </option>
                              ))}
                              {browserLabel && !chromeOptions.some((c) => c.label === browserLabel) && (
                                <option value={browserLabel}>{browserLabel}</option>
                              )}
                            </select>
                          ) : (
                            <span className="font-medium text-ink">{browserLabel || 'Chưa chọn Chrome'}</span>
                          )}

                          {browserLabel && (
                            <button
                              type="button"
                              onClick={() =>
                                launchInAssignedChromeProfile(
                                  'https://business.facebook.com/overview',
                                  browserLabel,
                                  String(row.label ?? ''),
                                  networkLabel,
                                )
                              }
                              className="inline-flex items-center rounded border border-emerald-600/50 bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-300"
                              title={`Tự động bật cửa sổ Google Chrome (${browserLabel}) của VIA ${String(row.label ?? '')}`}
                            >
                              🚀 Mở Chrome
                            </button>
                          )}
                        </div>

                        {/* Dòng 2: Proxy thật (nếu đã gắn) hoặc Mạng gốc (không bao giờ hiện Proxy giả) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-ink-muted">IP/Proxy:</span>
                          {networkLabel ? (
                            <>
                              <span className="rounded border border-brand/30 bg-brand-soft/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-text">
                                {networkLabel}
                              </span>
                              <Badge
                                tone={sharedNetwork.length === 0 ? 'positive' : sharedNetwork.length === 1 ? 'caution' : 'attention'}
                                title="Hạn mức an toàn: 1 Proxy nuôi tối đa 1–2 Via Facebook"
                              >
                                {`${sharedNetwork.length + 1}/2 Via · ${
                                  sharedNetwork.length === 0
                                    ? '1 Via riêng'
                                    : sharedNetwork.length === 1
                                      ? 'Đủ 2 Via/Proxy'
                                      : 'Quá tải Proxy'
                                }`}
                              </Badge>
                              {parseProxyString(networkLabel) && (
                                <button
                                  type="button"
                                  onClick={() => downloadSwitchyOmegaConfig(networkLabel, String(row.label ?? ''))}
                                  className="inline-flex items-center rounded border border-brand/40 bg-brand-soft/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-text hover:bg-brand-soft/40"
                                >
                                  🔌 SwitchyOmega (.bak)
                                </button>
                              )}
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => setEditingRecord(row)}
                                  className="text-[10px] text-ink-muted hover:text-ink hover:underline"
                                >
                                  ✎ Đổi Proxy
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted">
                                🌐 Mạng gốc (Chưa gắn Proxy riêng)
                              </span>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => setEditingRecord(row)}
                                  className="text-[11px] font-medium text-brand-text hover:underline"
                                >
                                  + Gắn Proxy
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {sharedBrowser.length > 0 && (
                          <div className="pt-0.5" data-testid={`fb-collision-browser-${row.id}`}>
                            <Badge tone="caution">
                              {t('fb.env.collisionBrowser', { names: sharedBrowser.join(', ') })}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell label={columns[2]}>{s?.owner_member_name ?? '—'}</TableCell>
                    <TableCell label={columns[3]}>
                      <Badge tone={twoFactorTone(String(row.two_factor_method))}>
                        {t(`twoFactor.${String(row.two_factor_method)}` as never)}
                      </Badge>
                    </TableCell>
                    <TableCell label={columns[4]}>
                      {s ? (
                        <div className="space-y-0.5">
                          <Badge tone={s.business_manager_count <= 2 ? 'positive' : s.business_manager_count <= 4 ? 'info' : 'caution'}>
                            {`${s.business_manager_count} BM`}
                          </Badge>
                          <div className="text-[10px] text-ink-muted">
                            {s.business_manager_count <= 2
                              ? 'An toàn (≤ 2 BM gốc/Via)'
                              : s.business_manager_count <= 4
                                ? 'Chạm trần tạo BM (4 BM)'
                                : 'Via Tổng / Partner'}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell label={columns[5]} className="font-mono font-semibold tabular-nums">
                      {s ? s.ad_account_count : '—'}
                    </TableCell>
                    <TableCell label={columns[6]}>
                      <Badge tone={row.status === 'active' ? 'positive' : row.status === 'restricted' ? 'attention' : 'neutral'}>
                        {enumLabel('refStatus', String(row.status))}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell label={columns[7]}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingRecord(row)}
                            data-testid={`fb-edit-${row.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t('fb.form.editBtn')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={archive.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  language === 'vi'
                                    ? `Lưu trữ (xóa) tài khoản Facebook "${String(row.label)}"?`
                                    : `Archive Facebook account "${String(row.label)}"?`,
                                )
                              ) {
                                archive.mutate(row.id)
                              }
                            }}
                            data-testid={`fb-delete-${row.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger-text" />
                            {language === 'vi' ? 'Xóa' : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <FacebookAccountFormSheet
        open={creating || Boolean(editingRecord)}
        record={editingRecord}
        onClose={() => {
          setCreating(false)
          setEditingRecord(null)
        }}
        members={members.data ?? []}
        canAssignOwner={canAssignOwner}
      />
    </div>
  )
}
