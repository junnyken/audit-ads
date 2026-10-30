import { useMemo, useState } from 'react'
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
  downloadWindowsChromeLauncherBat,
  launchInAssignedChromeProfile,
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
        description={t('fb.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={downloadWindowsChromeLauncherBat}
              title="Tải và chạy 1 lần trên máy Windows để khi bấm nút Mở Chrome / Kháng nghị / Thanh toán trên web sẽ tự động bật đúng cửa sổ Chrome Profile của Via đó"
              data-testid="fb-chrome-launcher-setup"
            >
              ⚡ Cài đặt Tự động mở Chrome Profile (1 lần)
            </Button>
            {canWrite && (
              <Button type="button" onClick={() => setCreating(true)}>
                {t('fb.empty.action')}
              </Button>
            )}
          </div>
        }
      />
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
                                  )
                                }
                                className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                                title={`Tự động bật cửa sổ Google Chrome (${browserLabel}) của VIA ${String(row.label ?? '')}`}
                              >
                                🚀 Mở Chrome
                              </button>
                            </p>
                          )}
                          {networkLabel && (
                            <p>
                              <span className="text-ink-muted">IP/Mạng:</span>{' '}
                              <Link
                                to="/assets?tab=proxy-references"
                                className="font-mono font-medium text-brand-text hover:underline"
                                title="Kết nối trực tiếp tới Nhà mạng Proxy IP trong Tài sản"
                              >
                                {networkLabel} ↗
                              </Link>
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
                    <TableCell label={columns[4]}>{s ? s.business_manager_count : '—'}</TableCell>
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
