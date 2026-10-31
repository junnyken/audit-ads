import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
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
  const migratedMockRef = useRef(false)
  useEffect(() => {
    if (!canWrite || migratedMockRef.current || !list.data?.items?.length) return
    const MOCK_PATTERNS = [
      'hidemyacc — profile #3',
      'adspower — profile #2',
      'chrome — profile #1 (tài khoản chính)',
      'chrome — profile #10 (via 2)',
    ]
    const toFix = list.data.items.filter((r) => {
      const b = String(r.browser_profile_label ?? '').trim().toLowerCase()
      return MOCK_PATTERNS.some((p) => b.includes(p))
    })
    if (toFix.length === 0) return
    migratedMockRef.current = true
    void (async () => {
      for (const item of toFix) {
        const lbl = String(item.label ?? '').toLowerCase()
        let nextProfile = 'Chrome — Default · trieu (thientrieu753@gmail.com)'
        if (lbl.includes('via 2')) {
          nextProfile = 'Chrome — Profile 10 · Lâm Quang (lamquangthinh3006@gmail.com)'
        } else if (lbl.includes('xmdt')) {
          nextProfile = 'Chrome — Profile 3 · Thiên Triều (trieunguyen.home9x@gmail.com)'
        }
        try {
          await api.patch(`/api/v1/personal-account-references/${item.id}`, {
            browser_profile_label: nextProfile,
          })
        } catch {
          // Ignore patch error
        }
      }
      // Also archive legacy mock BrowserProfileReference entries
      try {
        const bRefs = await api.get<Paged<ReferenceRecord>>('/api/v1/browser-profile-references?page_size=200')
        for (const br of bRefs.items ?? []) {
          const bl = String(br.label ?? '').toLowerCase()
          if (
            bl.includes('hidemyacc') ||
            bl.includes('adspower') ||
            bl.includes('chrome — chrome') ||
            bl.includes('profile #1 (') ||
            bl.includes('profile #10 (')
          ) {
            await api.post(`/api/v1/browser-profile-references/${br.id}/archive`).catch(() => {})
          }
        }
      } catch {
        // Ignore
      }
      void queryClient.invalidateQueries({ queryKey: ['personal-account-references'] })
      void queryClient.invalidateQueries({ queryKey: ['browser-profile-references'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    })()
  }, [canWrite, list.data?.items, queryClient])
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
  const columns = [
    t('res.f.label'),
    t('fb.env.column'),
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
              🟢 Đã kết nối {(localChrome.data ?? WORKSTATION_REAL_CHROME_PROFILES).length} Hồ sơ Chrome thật trên máy
            </span>
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
                const deviceLabel = String(row.device_label ?? '').trim()
                const browserLabel = String(row.browser_profile_label ?? '').trim()
                const networkLabel = String(row.network_label ?? '').trim()
                const hasEnv = Boolean(deviceLabel || browserLabel || networkLabel)
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
                  s?.shared_network_with ??
                  (networkLabel
                    ? allRows
                        .filter(
                          (o) =>
                            o.id !== row.id &&
                            String(o.network_label ?? '').trim().toLowerCase() === networkLabel.toLowerCase(),
                        )
                        .map((o) => String(o.label))
                    : [])
                return (
                  <TableRow key={row.id}>
                    <TableCell label={columns[0]} className="cell-title">
                      <div className="space-y-1">
                        <Link to={`/facebook-accounts/${row.id}`} className="font-medium text-brand-text hover:underline">
                          {String(row.label)}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge tone={ownership === 'client_provided' ? 'info' : 'neutral'}>
                            {t(`fb.ownership.${ownership}` as never)}
                          </Badge>
                          {clientName && <span className="text-ink-muted">{clientName}</span>}
                  {Boolean(row.external_reference_id) && (
                    <span className="font-mono text-ink-muted">ID: {String(row.external_reference_id)}</span>
                  )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell label={columns[1]} className="text-xs">
                      {hasEnv ? (
                        <div className="space-y-0.5" data-testid={`fb-env-${row.id}`}>
                          {deviceLabel && (
                            <p>
                              <span className="text-ink-muted">{t('fb.deviceLabel')}:</span>{' '}
                              <button
                                type="button"
                                onClick={() => setEditingRecord(row)}
                                className="font-medium text-brand-text hover:underline"
                                title="Đổi nhanh Thiết bị / Máy trạm cố định"
                              >
                                {deviceLabel} ✎
                              </button>
                            </p>
                          )}
                          {browserLabel && (
                            <p className="flex flex-wrap items-center gap-1.5">
                              <span>
                                <span className="text-ink-muted">{t('fb.browserLabel')}:</span>{' '}
                                <Link
                                  to="/assets?tab=browser-profile-references"
                                  className="font-medium text-brand-text hover:underline"
                                  title="Kết nối trực tiếp tới Hồ sơ trình duyệt trong Tài sản"
                                >
                                  {browserLabel} ↗
                                </Link>
                              </span>
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
                                className="inline-flex items-center rounded border border-emerald-600/50 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-300"
                                title={`Tự động bật cửa sổ Google Chrome (${browserLabel}) kèm Proxy của VIA ${String(row.label ?? '')}`}
                              >
                                🚀 Mở Chrome
                              </button>
                            </p>
                          )}
                          {networkLabel && (
                            <p className="flex flex-wrap items-center gap-1.5">
                              <span>
                                <span className="text-ink-muted">IP/Mạng:</span>{' '}
                                <Link
                                  to="/assets?tab=proxy-references"
                                  className="font-mono font-semibold text-brand-text hover:underline"
                                  title="Kết nối trực tiếp tới Nhà mạng Proxy IP trong Tài sản"
                                >
                                  {networkLabel} ↗
                                </Link>
                              </span>
                              <Badge
                                tone={sharedNetwork.length === 0 ? 'positive' : sharedNetwork.length === 1 ? 'caution' : 'attention'}
                                title="Hạn mức an toàn: 1 Proxy nuôi tối đa 1–2 Via Facebook"
                              >
                                {`${sharedNetwork.length + 1}/2 Via · ${sharedNetwork.length === 0 ? '1 Via riêng' : sharedNetwork.length === 1 ? 'Đủ 2 Via/Proxy' : 'Quá tải Proxy'}`}
                              </Badge>
                              {parseProxyString(networkLabel) && (
                                <button
                                  type="button"
                                  onClick={() => downloadSwitchyOmegaConfig(networkLabel, String(row.label ?? ''))}
                                  className="inline-flex items-center rounded border border-brand/40 bg-brand-soft/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-text hover:bg-brand-soft/40"
                                  title="Xuất file cấu hình .bak cho tiện ích Proxy SwitchyOmega (hoặc bấm Mở Chrome để tự động gắn Proxy)"
                                >
                                  🔌 SwitchyOmega (.bak)
                                </button>
                              )}
                            </p>
                          )}
                          {sharedBrowser.length > 0 && (
                            <div className="pt-1" data-testid={`fb-collision-browser-${row.id}`}>
                              <Badge tone="caution">
                                {t('fb.env.collisionBrowser', { names: sharedBrowser.join(', ') })}
                              </Badge>
                            </div>
                          )}
                          {sharedNetwork.length > 0 && (
                            <div className="pt-1" data-testid={`fb-collision-network-${row.id}`}>
                              <Badge tone="caution">
                                {t('fb.env.collisionNetwork', { names: sharedNetwork.join(', ') })}
                              </Badge>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink-faint">{t('fb.env.unconfigured')}</span>
                      )}
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
                                ? 'Chạm trần tạo BM (Max 4)'
                                : 'Via Tổng / Partner'}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell label={columns[5]}>{s ? s.ad_account_count : '—'}</TableCell>
                    <TableCell label={columns[6]}>
                      <Badge tone={String(row.status) === 'active' ? 'positive' : 'neutral'}>
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
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            {t('fb.form.editBtn')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            aria-label={t('ref.archive.confirm')}
                            className="border-danger-line text-danger-text hover:bg-danger-soft"
                            disabled={archive.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  language === 'vi'
                                    ? `Bạn có chắc muốn xóa tài khoản Facebook "${String(row.label)}"?`
                                    : `Delete Facebook account "${String(row.label)}"?`,
                                )
                              ) {
                                archive.mutate(row.id)
                              }
                            }}
                            data-testid={`fb-delete-${row.id}`}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
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
        open={creating || editingRecord !== null}
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
