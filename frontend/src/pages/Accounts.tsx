import { Fragment, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Columns3, Download, ListFilter, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { api, query } from '../lib/api'
import type { AdAccount, Paged, ReferenceRecord } from '../lib/types'
import AccountFormDrawer from '../components/AccountFormDrawer'
import { QuickMetaSyncBanner } from '../components/meta/QuickMetaSyncBanner'
import AccountSpendCell from '../components/AccountSpendCell'
import PlatformStatusBadge from '../components/PlatformStatusBadge'
import { ChecklistProgress } from '../components/dashboard/ChecklistProgress'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/primitives/dropdown-menu'
import { Skeleton } from '../components/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, LoadingRegion, PartialDataNote } from '../components/states'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { columnsStorageKey, loadColumns, saveColumns } from '../lib/columnPrefs'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import type { TranslationKey } from '../i18n'

const SORT_KEYS = ['updated_at', 'last_manual_review_at', 'readiness_status', 'display_name'] as const

/**
 * The columns after the always-on "Tài khoản" and the row action. Default = 6 (so 8 including the
 * two fixed ones, U1 T2); the rest are opt-in through the "Cột" chooser.
 */
const COLUMN_IDS = ['recorded', 'platform', 'readiness', 'checklist', 'spend', 'facebookIdentity', 'paymentProfile', 'currency', 'updated', 'type', 'browserRef', 'proxyRef', 'review'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_COLUMNS: ColumnId[] = ['recorded', 'platform', 'readiness', 'checklist', 'spend', 'updated']

const COLUMN_LABEL: Record<ColumnId, TranslationKey> = {
  recorded: 'col.recorded',
  platform: 'col.platform',
  readiness: 'col.readiness',
  checklist: 'col.checklist',
  spend: 'col.spend',
  facebookIdentity: 'fb.title',
  paymentProfile: 'col.paymentProfile',
  currency: 'col.currency',
  updated: 'col.updated',
  type: 'col.type',
  browserRef: 'col.browserRef',
  proxyRef: 'col.proxyRef',
  review: 'col.review',
}
/** Shorter caption for card mode, where the column header is hidden and the label prefixes a value. */
const COLUMN_CARD_LABEL: Partial<Record<ColumnId, TranslationKey>> = { spend: 'col.spendShort' }

const READINESS_OPTIONS = ['operationally_ready', 'ready_with_warnings', 'not_ready', 'unknown']
const RECORDED_OPTIONS = ['unknown', 'active', 'warning', 'restricted', 'disabled']
const TYPE_OPTIONS = ['business_manager', 'personal_reference', 'unknown']

export default function Accounts() {
  const { t, language } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  /** Filters live in the URL so a filtered view can be bookmarked and shared. */
  const [params, setParams] = useSearchParams()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<AdAccount | null>(null)
  const [viewMode, setViewMode] = useState<'all' | 'bm' | 'via' | 'client'>('all')

  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    account_type: params.get('account_type') ?? '',
    business_manager_id: params.get('business_manager_id') ?? '',
    facebook_identity_id: params.get('facebook_identity_id') ?? '',
    has_browser_reference: params.get('has_browser_reference') ?? '',
    has_proxy_reference: params.get('has_proxy_reference') ?? '',
    unassigned_identity: params.get('unassigned_identity') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
    sort: params.get('sort') ?? 'updated_at',
    sort_direction: params.get('sort_direction') ?? 'desc',
  }

  function update(patch: Record<string, string | number | boolean | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === false) next.delete(key)
      else next.set(key, String(value))
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  // ---- columns (persisted per viewer; storage may throw, see lib/columnPrefs) -------------------
  const storageKey = columnsStorageKey('accounts', user?.id)
  const [visible, setVisible] = useState<ColumnId[]>(() => loadColumns(storageKey, COLUMN_IDS, DEFAULT_COLUMNS))
  const shown = COLUMN_IDS.filter((id) => visible.includes(id))
  function chooseColumns(next: ColumnId[]) {
    setVisible(next)
    saveColumns(storageKey, next)
  }

  const businessManagers = useQuery({
    queryKey: ['business-managers', 'options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>(`/api/v1/business-managers${query({ page_size: 200 })}`),
  })

  const facebookIdentities = useQuery({
    queryKey: ['personal-account-references', 'facebook-options'],
    queryFn: () => api.get<Paged<ReferenceRecord>>('/api/v1/personal-account-references?page_size=200'),
  })

  const accounts = useQuery({
    queryKey: ['accounts', 'list', filters],
    queryFn: () => api.get<Paged<AdAccount>>(`/api/v1/ad-accounts${query(filters)}`),
  })

  const rows = accounts.data?.items ?? []
  const bmOptions = (businessManagers.data?.items ?? []).map((bm) => [bm.id, String(bm.name)] as [string, string])
  const facebookOptions = (facebookIdentities.data?.items ?? []).map((identity) => [identity.id, String(identity.label)] as [string, string])

  // ---- active-filter chips ----------------------------------------------------------------------
  const yesNo = (value: string) => (value === 'true' ? t('filter.assigned') : t('filter.notAssigned'))
  const chips: { key: string; text: string; clear: Record<string, null> }[] = []
  if (filters.search) chips.push({ key: 'search', text: `${t('accounts.search.label')}: ${filters.search}`, clear: { search: null } })
  if (filters.readiness_status)
    chips.push({ key: 'readiness_status', text: `${t('filter.readiness')}: ${enumLabel('readiness', filters.readiness_status)}`, clear: { readiness_status: null } })
  if (filters.status)
    chips.push({ key: 'status', text: `${t('filter.recorded')}: ${enumLabel('accountStatus', filters.status)}`, clear: { status: null } })
  if (filters.business_manager_id)
    chips.push({
      key: 'business_manager_id',
      text: `${t('filter.bm')}: ${bmOptions.find(([id]) => id === filters.business_manager_id)?.[1] ?? filters.business_manager_id}`,
      clear: { business_manager_id: null },
    })
  if (filters.facebook_identity_id)
    chips.push({ key: 'facebook_identity_id', text: `${t('fb.title')}: ${facebookOptions.find(([id]) => id === filters.facebook_identity_id)?.[1] ?? filters.facebook_identity_id}`, clear: { facebook_identity_id: null } })
  if (filters.account_type)
    chips.push({ key: 'account_type', text: `${t('filter.type')}: ${enumLabel('accountType', filters.account_type)}`, clear: { account_type: null } })
  if (filters.has_browser_reference)
    chips.push({ key: 'has_browser_reference', text: `${t('filter.browserRef')}: ${yesNo(filters.has_browser_reference)}`, clear: { has_browser_reference: null } })
  if (filters.has_proxy_reference)
    chips.push({ key: 'has_proxy_reference', text: `${t('filter.proxyRef')}: ${yesNo(filters.has_proxy_reference)}`, clear: { has_proxy_reference: null } })
  if (filters.unassigned_identity)
    chips.push({ key: 'unassigned_identity', text: `${t('filter.unassignedIdentity')}: ${yesNo(filters.unassigned_identity)}`, clear: { unassigned_identity: null } })
  if (filters.archived) chips.push({ key: 'archived', text: t('filter.archivedOnly'), clear: { archived: null } })
  const filtersActive = chips.length > 0

  const moreCount = [
    filters.facebook_identity_id,
    filters.account_type,
    filters.has_browser_reference,
    filters.has_proxy_reference,
    filters.archived ? 'x' : '',
    filters.sort_direction !== 'desc' ? 'x' : '',
  ].filter(Boolean).length
  const [moreOpen, setMoreOpen] = useState(moreCount > 0)
  const moreId = useId()

  const clearAll = () => setParams({}, { replace: true })

  function renderCell(id: ColumnId, account: AdAccount) {
    const label = t(COLUMN_CARD_LABEL[id] ?? COLUMN_LABEL[id])
    switch (id) {
      case 'recorded':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={accountStatusTone(account.status)}>{enumLabel('accountStatus', account.status)}</Badge>
          </TableCell>
        )
      case 'platform':
        return (
          <TableCell key={id} label={label}>
            <PlatformStatusBadge value={account.platform_status} />
          </TableCell>
        )
      case 'readiness': {
        const meta = READINESS_META[account.readiness_status]
        return (
          <TableCell key={id} label={label}>
            <Badge
              tone={meta?.tone ?? 'neutral'}
              dot
              title={meta ? t(`readinessHint.${account.readiness_status}`) : undefined}
            >
              {enumLabel('readiness', account.readiness_status)}
            </Badge>
          </TableCell>
        )
      }
      case 'checklist':
        return (
          <TableCell key={id} label={label}>
            <ChecklistProgress done={account.completed_item_count} total={account.required_item_count} />
          </TableCell>
        )
      case 'facebookIdentity':
        return (
          <TableCell key={id} label={label}>
            {account.facebook_identities?.length ? (
              <div className="space-y-1">
                {account.facebook_identities.map((identity) => {
                  const envMeta = [identity.device_label, identity.browser_profile_label]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <div key={identity.id}>
                      <Link
                        to={`/facebook-accounts/${identity.id}`}
                        className="text-brand-text hover:underline"
                      >
                        {identity.label}
                      </Link>
                      {envMeta && (
                        <span className="block text-2xs text-ink-muted">{envMeta}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="text-ink-faint">—</span>
            )}
          </TableCell>
        )
      case 'spend':
        return (
          <TableCell key={id} label={label} numeric>
            <AccountSpendCell spend={account.spend} periods={account.spend_periods} />
          </TableCell>
        )
      case 'paymentProfile':
        return (
          <TableCell key={id} label={label}>
            {account.payment_profile_labels?.length ? (
              <div className="flex flex-wrap gap-1">
                {account.payment_profile_labels.map((pay) => (
                  <Badge key={pay} tone="neutral">
                    {pay}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-ink-faint">{'—'}</span>
            )}
          </TableCell>
        )
      case 'currency': {
        const curr = account.currency || account.spend?.observed_currency
        return (
          <TableCell key={id} label={label} className="font-mono text-xs">
            {curr ? <Badge tone="neutral">{curr}</Badge> : <span className="text-ink-faint">{'—'}</span>}
          </TableCell>
        )
      }
      case 'updated':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(account.updated_at)}>
            {formatRelative(account.updated_at)}
          </TableCell>
        )
      case 'type':
        return (
          <TableCell key={id} label={label}>
            {enumLabel('accountType', account.account_type)}
          </TableCell>
        )
      case 'browserRef':
      case 'proxyRef': {
        const value = id === 'browserRef' ? account.has_browser_reference : account.has_proxy_reference
        return (
          <TableCell key={id} label={label}>
            {value === undefined ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <Badge tone={value ? 'neutral' : 'muted'}>{value ? t('row.assigned') : t('row.notAssigned')}</Badge>
            )}
          </TableCell>
        )
      }
      case 'review':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted">
            {account.last_manual_review_at ? formatRelative(account.last_manual_review_at) : t('format.never')}
          </TableCell>
        )
    }
  }

  const headerCells = shown.map((id) => (
    <TableHead key={id} numeric={id === 'spend'}>
      {t(COLUMN_LABEL[id])}
    </TableHead>
  ))

  const orphanCount = rows.filter(
    (r) =>
      Array.isArray(r.facebook_identities) &&
      r.facebook_identities.length === 0 &&
      !r.personal_account_reference_id,
  ).length

  function exportCsv() {
    if (!rows.length) return
    const esc = (val: string | null | undefined) => {
      const s = val ?? '—'
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const headers = [
      t('col.account'),
      'External ID',
      t('fb.clientName'),
      'Business Manager',
      t('fb.title'),
      t('col.currency'),
      t('col.paymentProfile'),
      t('overview.spend.periodToday'),
      t('col.spend'),
      t('overview.spend.period7d'),
      t('overview.spend.periodMtd'),
      t('sp.pacing.dailyBudget'),
      t('sp.pacing.monthlyBudget'),
      t('col.recorded'),
      t('col.platform'),
      t('col.readiness'),
      'Tags',
    ]
    const csvRows = [
      headers.map(esc).join(','),
      ...rows.map((a) => {
        const curr = a.spend?.observed_currency || a.currency || '—'
        const vias = a.facebook_identities?.map((i) => i.label).join('; ') || '—'
        const pttt = a.payment_profile_labels?.join('; ') || '—'
        return [
          a.display_name,
          a.external_account_id || '—',
          a.client_name || '—',
          a.business_manager_name || a.personal_account_reference_label || '—',
          vias,
          curr,
          pttt,
          a.spend_periods?.today_partial_raw ?? '—',
          a.spend?.latest_complete_day?.spend_raw ?? '—',
          a.spend_periods?.last_7d_raw ?? '—',
          a.spend_periods?.mtd_raw ?? '—',
          a.planned_daily_budget_raw ?? '—',
          a.planned_monthly_budget_raw ?? '—',
          enumLabel('accountStatus', a.status),
          a.platform_status?.status ?? '—',
          enumLabel('readiness', a.readiness_status),
          a.tags.join('; ') || '—',
        ]
          .map(esc)
          .join(',')
      }),
    ]
    const blob = new Blob(['\uFEFF' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `adsops-accounts-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const groupedRows = (() => {
    if (viewMode === 'all') return null
    const map = new Map<string, AdAccount[]>()
    for (const acc of rows) {
      let keys: string[] = []
      if (viewMode === 'bm') {
        keys = [acc.business_manager_name || t('accounts.group.noBm')]
      } else if (viewMode === 'via') {
        keys = acc.facebook_identities?.length
          ? acc.facebook_identities.map((i) => i.label)
          : [acc.personal_account_reference_label || t('accounts.group.noVia')]
      } else if (viewMode === 'client') {
        keys = [acc.client_name?.trim() || t('accounts.group.noClient')]
      }
      for (const k of keys) {
        const list = map.get(k) ?? []
        list.push(acc)
        map.set(k, list)
      }
    }
    return Array.from(map.entries())
  })()

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold leading-7 min-[1024px]:text-2xl min-[1024px]:leading-8">{t('accounts.title')}</h1>
          <p className="text-xs text-ink-muted">
            {accounts.data ? t('accounts.count', { count: formatCount(accounts.data.total) }) : '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={exportCsv}
              data-testid="accounts-export-csv"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('accounts.exportCsv')}
            </Button>
          )}
          <Button type="button" onClick={() => setDrawerOpen(true)}>
            {t('accounts.register')}
          </Button>
        </div>
      </header>

      <QuickMetaSyncBanner />

      {(orphanCount > 0 || filters.unassigned_identity === 'true') && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tone-caution-border bg-tone-caution-bg px-4 py-2.5 text-sm text-tone-caution-fg"
          data-testid="accounts-orphan-banner"
        >
          <span className="font-medium">
            {t('accounts.orphanBanner', { count: formatCount(orphanCount || rows.length) })}
          </span>
          {filters.unassigned_identity === 'true' ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => update({ unassigned_identity: null })}
            >
              {t('accounts.orphanClearBtn')}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => update({ unassigned_identity: 'true' })}
            >
              {t('accounts.orphanFilterBtn')}
            </Button>
          )}
        </div>
      )}

      <section aria-label={t('accounts.toolbar.label')} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="label" htmlFor="accounts-search">
              {t('accounts.search.label')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input
                id="accounts-search"
                key={filters.search}
                type="search"
                className="input pl-8"
                placeholder={t('accounts.search.placeholder')}
                defaultValue={filters.search}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') update({ search: (event.target as HTMLInputElement).value })
                }}
                onBlur={(event) => {
                  if (event.target.value !== filters.search) update({ search: event.target.value })
                }}
              />
            </div>
          </div>
          <SelectField
            label={t('filter.readiness')}
            value={filters.readiness_status}
            onChange={(value) => update({ readiness_status: value })}
            options={[['', t('filter.any')], ...READINESS_OPTIONS.map((v) => [v, enumLabel('readiness', v)] as [string, string])]}
          />
          <SelectField
            label={t('filter.recorded')}
            value={filters.status}
            onChange={(value) => update({ status: value })}
            options={[['', t('filter.any')], ...RECORDED_OPTIONS.map((v) => [v, enumLabel('accountStatus', v)] as [string, string])]}
          />
          <SelectField
            label={t('filter.bm')}
            value={filters.business_manager_id}
            onChange={(value) => update({ business_manager_id: value })}
            options={[['', t('filter.any')], ...bmOptions]}
          />
          <SelectField
            label={t('fb.title')}
            value={filters.facebook_identity_id}
            onChange={(value) => update({ facebook_identity_id: value })}
            options={[['', t('filter.any')], ...facebookOptions]}
          />
          <SelectField
            label={t('filter.sort')}
            value={filters.sort}
            onChange={(value) => update({ sort: value })}
            options={SORT_KEYS.map((key) => [key, t(`sort.${key}`)] as [string, string])}
          />
          <Button
            type="button"
            variant="secondary"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            {t('filter.more')}
            {moreCount > 0 && (
              <span className="rounded-full bg-brand-light px-1.5 text-2xs font-semibold text-brand-text">{moreCount}</span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary">
                <Columns3 className="h-4 w-4" aria-hidden="true" />
                {t('col.chooser')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('col.chooserLabel')}</DropdownMenuLabel>
              {COLUMN_IDS.map((id) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={visible.includes(id)}
                  // Keep the menu open so several columns can be toggled in one go.
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    chooseColumns(COLUMN_IDS.filter((c) => (c === id ? checked : visible.includes(c))))
                  }
                >
                  {t(COLUMN_LABEL[id])}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => chooseColumns([...DEFAULT_COLUMNS])}>{t('col.chooserReset')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {moreOpen && (
          <Card id={moreId} className="flex flex-wrap items-end gap-3 p-3">
            <SelectField
              label={t('filter.type')}
              value={filters.account_type}
              onChange={(value) => update({ account_type: value })}
              options={[['', t('filter.any')], ...TYPE_OPTIONS.map((v) => [v, enumLabel('accountType', v)] as [string, string])]}
            />
            <SelectField
              label={t('filter.browserRef')}
              value={filters.has_browser_reference}
              onChange={(value) => update({ has_browser_reference: value })}
              options={[['', t('filter.any')], ['true', t('filter.assigned')], ['false', t('filter.notAssigned')]]}
            />
            <SelectField
              label={t('filter.proxyRef')}
              value={filters.has_proxy_reference}
              onChange={(value) => update({ has_proxy_reference: value })}
              options={[['', t('filter.any')], ['true', t('filter.assigned')], ['false', t('filter.notAssigned')]]}
            />
            <SelectField
              label={t('filter.order')}
              value={filters.sort_direction}
              onChange={(value) => update({ sort_direction: value })}
              options={[['desc', t('filter.desc')], ['asc', t('filter.asc')]]}
            />
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input type="checkbox" checked={filters.archived} onChange={(event) => update({ archived: event.target.checked })} />
              {t('filter.archivedOnly')}
            </label>
          </Card>
        )}

        {filtersActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>{t('filter.active')}</span>
            {chips.map((chip) => (
              <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface py-0.5 pl-2.5 pr-1 text-ink">
                {chip.text}
                <button
                  type="button"
                  aria-label={t('filter.remove', { name: chip.text })}
                  className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink"
                  onClick={() => update(chip.clear)}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" className="font-medium text-brand-text hover:underline" onClick={clearAll}>
              {t('filter.clear')}
            </button>
          </div>
        )}
      </section>

      {businessManagers.isError && <PartialDataNote>{t('accounts.partial.bm')}</PartialDataNote>}

      {accounts.isLoading ? (
        <LoadingRegion>
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('col.account')}</TableHead>
                  {headerCells}
                  <TableHead className="text-right">{t('col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index} className="hover:bg-transparent">
                    {Array.from({ length: shown.length + 2 }).map((__, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-4 w-4/5" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </LoadingRegion>
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} title={t('accounts.error.title')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('accounts.empty.filtered.title') : t('accounts.empty.none.title')}
          description={filtersActive ? t('accounts.empty.filtered.body') : t('accounts.empty.none.body')}
          action={
            filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearAll}>
                {t('filter.clear')}
              </Button>
            ) : (
              <>
                <Button asChild variant="secondary">
                  <Link to="/business-managers">{t('accounts.empty.addBm')}</Link>
                </Button>
                <Button type="button" onClick={() => setDrawerOpen(true)}>
                  {t('accounts.register')}
                </Button>
              </>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="accounts-view-mode">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-1 text-xs">
              <span className="px-2 text-ink-muted">{t('accounts.viewMode.label')}:</span>
              {(
                [
                  ['all', t('accounts.viewMode.all')],
                  ['bm', t('accounts.viewMode.byBm')],
                  ['via', t('accounts.viewMode.byVia')],
                  ['client', t('accounts.viewMode.byClient')],
                ] as const
              ).map(([mode, labelText]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-brand-soft text-brand-text'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                  }`}
                >
                  {labelText}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <Table cards aria-label={t('accounts.title')}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('col.account')}</TableHead>
                  {headerCells}
                  <TableHead className="text-right">{t('col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(groupedRows ?? [['', rows] as [string, AdAccount[]]]).map(([groupTitle, groupItems]) => (
                  <Fragment key={groupTitle || 'all'}>
                    {viewMode !== 'all' && (
                      <TableRow key={`group-${groupTitle}`} className="bg-surface-muted hover:bg-surface-muted">
                        <TableCell colSpan={shown.length + 2} className="py-2 font-semibold text-ink">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>{groupTitle}</span>
                            <span className="text-xs font-normal text-ink-muted">
                              {t('accounts.group.summary', {
                                total: formatCount(groupItems.length),
                                active: formatCount(
                                  groupItems.filter((a) => a.status === 'active').length,
                                ),
                                blocked: formatCount(
                                  groupItems.filter((a) =>
                                    ['restricted', 'disabled', 'warning'].includes(a.status),
                                  ).length,
                                ),
                              })}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {groupItems.map((account) => {
                      const currBadge = account.currency || account.spend?.observed_currency
                      return (
                        <TableRow key={`${groupTitle}-${account.id}`}>
                          <TableCell className="cell-title min-w-[220px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link to={`/accounts/${account.id}`} className="font-medium text-brand-text hover:underline">
                                {account.display_name}
                              </Link>
                              {currBadge && (
                                <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-2xs font-medium text-ink-muted">
                                  {currBadge}
                                </span>
                              )}
                            </div>
                            {account.external_account_id && (
                              <span className="block font-mono text-xs text-ink-muted">{account.external_account_id}</span>
                            )}
                            <span className="block text-xs text-ink-muted">
                              {account.business_manager_name ?? account.personal_account_reference_label ?? '—'}
                            </span>
                            {account.payment_profile_labels && account.payment_profile_labels.length > 0 && (
                              <span className="mt-0.5 block text-2xs font-medium text-ink-muted" data-testid="account-row-pttt">
                                {`PTTT: ${account.payment_profile_labels.join(' · ')}`}
                              </span>
                            )}
                            {account.client_name && (
                              <span className="block text-xs font-medium text-brand-text">
                                {`${t('fb.clientName')}: ${account.client_name}`}
                              </span>
                            )}
                            {account.tags.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {account.tags.map((tag) => (
                                  <span key={tag} className="rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-muted">
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            )}
                          </TableCell>
                          {shown.map((id) => renderCell(id, account))}
                          <TableCell className="whitespace-nowrap text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {!account.archived_at && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setEditingAccount(account)}
                                  data-testid={`account-edit-${account.id}`}
                                >
                                  <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                  {t('pg.edit')}
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className={
                                  account.archived_at
                                    ? undefined
                                    : 'border-danger-line text-danger-text hover:bg-danger-soft'
                                }
                                onClick={() => {
                                  const action = account.archived_at ? 'restore' : 'archive'
                                  const msg = account.archived_at
                                    ? language === 'vi'
                                      ? `Khôi phục tài khoản quảng cáo "${account.display_name}"?`
                                      : `Restore ad account "${account.display_name}"?`
                                    : language === 'vi'
                                      ? `Bạn có chắc muốn xóa tài khoản quảng cáo "${account.display_name}"?`
                                      : `Delete ad account "${account.display_name}"?`
                                  if (window.confirm(msg)) {
                                    void api
                                      .post(`/api/v1/ad-accounts/${account.id}/${action}`)
                                      .then(() => {
                                        void accounts.refetch()
                                      })
                                  }
                                }}
                                data-testid={`account-delete-${account.id}`}
                              >
                                {account.archived_at ? (
                                  <>
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                    {t('pg.restore')}
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                    {language === 'vi' ? 'Xóa' : 'Delete'}
                                  </>
                                )}
                              </Button>
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                <Link to={`/accounts/${account.id}`} aria-label={t('row.open', { name: account.display_name })}>
                                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">
              {t('pager.page', { page: accounts.data!.page, pages: accounts.data!.total_pages || 1 })} · {t('pager.note')}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>
                {t('pager.prev')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={filters.page >= (accounts.data!.total_pages || 1)}
                onClick={() => update({ page: filters.page + 1 })}
              >
                {t('pager.next')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-ink-faint">{t('accounts.metaNote')}</p>
        </>
      )}

      <AccountFormDrawer
        open={drawerOpen || editingAccount !== null}
        account={editingAccount}
        onClose={() => {
          setDrawerOpen(false)
          setEditingAccount(null)
        }}
        onSaved={() => {
          void accounts.refetch()
        }}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: [string, string][]
}) {
  const id = useId()
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input min-w-[130px]" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}
