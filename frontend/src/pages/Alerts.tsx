import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api, query } from '../lib/api'
import type { AlertRow, AlertSummary, Paged } from '../lib/types'
import AlertDrawer from '../components/AlertDrawer'
import { ALERT_SEVERITY_META, ALERT_STATUS_META, DELIVERY_STATUS_META } from '../lib/alerts'
import { HEALTH_META } from '../lib/health'
import { READINESS_META } from '../lib/readiness'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { columnsStorageKey, loadColumns, saveColumns } from '../lib/columnPrefs'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, PartialDataNote } from '../components/states'
import { PageHeader } from '../components/page/PageHeader'
import { CheckField, FilterChips, SearchField, SelectField } from '../components/page/Filters'
import type { FilterChip } from '../components/page/Filters'
import { ColumnChooser, ListToolbar } from '../components/page/ListToolbar'
import { Pager } from '../components/page/Pager'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { Note } from './account/parts'

const SORT_KEYS = ['severity', 'last_observed_at', 'first_observed_at', 'title'] as const
const SEVERITY_OPTIONS = ['critical', 'warning', 'info']
const STATUS_OPTIONS = ['open', 'acknowledged', 'suppressed', 'resolved', 'expired']
const SOURCE_OPTIONS = ['health_signal', 'health_evaluation_run', 'discovery_sweep']
const HEALTH_OPTIONS = ['critical', 'warning', 'attention_needed', 'unknown', 'clear_signals']
const READINESS_OPTIONS = ['operationally_ready', 'ready_with_warnings', 'not_ready', 'unknown']
const DELIVERY_OPTIONS = ['pending', 'sent', 'failed_transient', 'failed_final', 'skipped', 'cancelled']

const COLUMN_IDS = ['severity', 'account', 'health', 'readiness', 'source', 'status', 'first', 'last', 'delivery', 'notified', 'suppression'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_COLUMNS: ColumnId[] = ['severity', 'account', 'health', 'status', 'last', 'delivery', 'suppression']
const COLUMN_LABEL: Record<ColumnId, TranslationKey> = {
  severity: 'al.col.severity',
  account: 'al.col.account',
  health: 'al.col.health',
  readiness: 'al.col.readiness',
  source: 'al.col.source',
  status: 'al.col.status',
  first: 'al.col.first',
  last: 'al.col.last',
  delivery: 'al.col.delivery',
  notified: 'al.col.notified',
  suppression: 'al.col.suppression',
}

export default function Alerts() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)

  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    severity: params.get('severity') ?? '',
    source_type: params.get('source_type') ?? '',
    health_status: params.get('health_status') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    ad_account_id: params.get('ad_account_id') ?? '',
    delivery_status: params.get('delivery_status') ?? '',
    suppressed: params.get('suppressed') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
    sort: params.get('sort') ?? 'severity',
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

  const storageKey = columnsStorageKey('alerts', user?.id)
  const [visible, setVisible] = useState<ColumnId[]>(() => loadColumns(storageKey, COLUMN_IDS, DEFAULT_COLUMNS))
  const shown = COLUMN_IDS.filter((id) => visible.includes(id))
  function chooseColumns(next: ColumnId[]) {
    setVisible(next)
    saveColumns(storageKey, next)
  }

  const rows = useQuery({
    queryKey: ['alerts', filters],
    queryFn: () => api.get<Paged<AlertRow>>(`/api/v1/alerts${query(filters)}`),
  })
  const summary = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<AlertSummary>('/api/v1/alerts/summary'),
  })

  function refresh() {
    void rows.refetch()
    void summary.refetch()
  }

  const chips: FilterChip[] = []
  if (filters.search) chips.push({ key: 'search', text: `${t('pg.search')}: ${filters.search}`, clear: { search: null } })
  if (filters.severity) chips.push({ key: 'severity', text: `${t('al.filter.severity')}: ${enumLabel('alertSeverity', filters.severity)}`, clear: { severity: null } })
  if (filters.status) chips.push({ key: 'status', text: `${t('al.filter.status')}: ${enumLabel('alertStatus', filters.status)}`, clear: { status: null } })
  if (filters.delivery_status) chips.push({ key: 'delivery_status', text: `${t('al.filter.delivery')}: ${enumLabel('delivery', filters.delivery_status)}`, clear: { delivery_status: null } })
  if (filters.source_type) chips.push({ key: 'source_type', text: `${t('al.filter.source')}: ${enumLabel('alertSource', filters.source_type)}`, clear: { source_type: null } })
  if (filters.health_status) chips.push({ key: 'health_status', text: `${t('al.filter.health')}: ${enumLabel('health', filters.health_status)}`, clear: { health_status: null } })
  if (filters.readiness_status) chips.push({ key: 'readiness_status', text: `${t('al.filter.readiness')}: ${enumLabel('readiness', filters.readiness_status)}`, clear: { readiness_status: null } })
  if (filters.ad_account_id) chips.push({ key: 'ad_account_id', text: `${t('al.col.account')}: ${filters.ad_account_id}`, clear: { ad_account_id: null } })
  if (filters.suppressed === 'true') chips.push({ key: 'suppressed', text: t('al.filter.suppressedOnly'), clear: { suppressed: null } })
  if (filters.archived) chips.push({ key: 'archived', text: t('filter.archivedOnly'), clear: { archived: null } })
  const filtersActive = chips.length > 0
  const moreCount = [filters.source_type, filters.health_status, filters.readiness_status, filters.suppressed, filters.archived ? 'x' : ''].filter(Boolean).length
  const clearAll = () => setParams({}, { replace: true })

  // Only when the summary says so: an unloaded summary is "not known", never "configured".
  const transportMissing =
    summary.data && (!summary.data.telegram_transport_configured || !summary.data.recipient_configured)

  const items = rows.data?.items ?? []

  function cell(id: ColumnId, row: AlertRow) {
    const label = t(COLUMN_LABEL[id])
    const severity = ALERT_SEVERITY_META[row.severity]
    const status = ALERT_STATUS_META[row.status]
    const delivery = row.delivery_status ? DELIVERY_STATUS_META[row.delivery_status] : null
    switch (id) {
      case 'severity':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={severity?.tone ?? 'neutral'} dot title={enumLabel('alertSeverityHint', row.severity)}>
              {enumLabel('alertSeverity', row.severity)}
            </Badge>
          </TableCell>
        )
      case 'account':
        return (
          <TableCell key={id} label={label}>
            {row.ad_account_id ? (
              <Link to={`/accounts/${row.ad_account_id}?tab=health`} className="text-brand-text hover:underline">
                {row.account_display_name}
              </Link>
            ) : (
              '—'
            )}
            <span className="block font-mono text-xs text-ink-muted">{row.account_reference ?? '—'}</span>
          </TableCell>
        )
      case 'health':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={HEALTH_META[row.health_status]?.tone ?? 'neutral'}>{enumLabel('health', row.health_status)}</Badge>
          </TableCell>
        )
      case 'readiness':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={READINESS_META[row.readiness_status]?.tone ?? 'neutral'}>{enumLabel('readiness', row.readiness_status)}</Badge>
          </TableCell>
        )
      case 'source':
        return (
          <TableCell key={id} label={label} className="text-xs">
            {row.source_label}
          </TableCell>
        )
      case 'status':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={status?.tone ?? 'neutral'} title={enumLabel('alertStatusHint', row.status)}>
              {enumLabel('alertStatus', row.status)}
            </Badge>
          </TableCell>
        )
      case 'first':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(row.first_observed_at)}>
            {formatRelative(row.first_observed_at)}
          </TableCell>
        )
      case 'last':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(row.last_observed_at)}>
            {formatRelative(row.last_observed_at)}
          </TableCell>
        )
      case 'delivery':
        return (
          <TableCell key={id} label={label}>
            {delivery && row.delivery_status ? (
              <Badge tone={delivery.tone} title={enumLabel('deliveryHint', row.delivery_status)}>
                {enumLabel('delivery', row.delivery_status)}
              </Badge>
            ) : (
              <span className="text-ink-faint">—</span>
            )}
            {row.delivery_skip_reason && (
              <span className="mt-0.5 block max-w-[220px] text-2xs text-ink-muted">{enumLabel('skipReason', row.delivery_skip_reason)}</span>
            )}
          </TableCell>
        )
      case 'notified':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted">
            {formatRelative(row.last_notified_at)}
          </TableCell>
        )
      case 'suppression':
        return (
          <TableCell key={id} label={label} className="text-xs text-ink-muted">
            {row.suppressed_until
              ? t('al.suppressedUntil', { time: formatDateTime(row.suppressed_until) })
              : row.quiet_hours_deferred
                ? t('al.deferred', { time: formatDateTime(row.delivery_scheduled_for) })
                : '—'}
          </TableCell>
        )
    }
  }

  const headerNames = [t('al.col.alert'), ...shown.map((id) => t(COLUMN_LABEL[id])), t('col.actions')]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('al.title')}
        description={t('al.desc')}
        meta={rows.data ? t('al.count', { count: formatCount(rows.data.total) }) : '—'}
      />

      {transportMissing && (
        <Note tone="caution" role="status">
          <strong>{t('al.transport')}</strong>{' '}
          <Link to="/settings" className="font-medium underline">
            {t('al.transport.link')}
          </Link>
          .
        </Note>
      )}
      {summary.isError && <PartialDataNote>{t('al.partial.summary')}</PartialDataNote>}

      <ListToolbar
        label={t('al.toolbar')}
        moreCount={moreCount}
        primary={
          <>
            <SearchField label={t('pg.search')} placeholder={t('al.search.placeholder')} value={filters.search} onApply={(value) => update({ search: value })} />
            <SelectField
              label={t('al.filter.severity')}
              value={filters.severity}
              onChange={(value) => update({ severity: value })}
              options={[['', t('filter.any')], ...SEVERITY_OPTIONS.map((v) => [v, enumLabel('alertSeverity', v)] as [string, string])]}
            />
            <SelectField
              label={t('al.filter.status')}
              value={filters.status}
              onChange={(value) => update({ status: value })}
              options={[['', t('al.filter.statusActive')], ...STATUS_OPTIONS.map((v) => [v, enumLabel('alertStatus', v)] as [string, string])]}
            />
            <SelectField
              label={t('al.filter.delivery')}
              value={filters.delivery_status}
              onChange={(value) => update({ delivery_status: value })}
              options={[
                ['', t('filter.any')],
                ...DELIVERY_OPTIONS.map((v) => [v, v === 'failed_final' ? t('al.filter.deliveryFailed') : enumLabel('delivery', v)] as [string, string]),
              ]}
            />
          </>
        }
        more={
          <>
            <SelectField
              label={t('al.filter.source')}
              value={filters.source_type}
              onChange={(value) => update({ source_type: value })}
              options={[['', t('filter.any')], ...SOURCE_OPTIONS.map((v) => [v, enumLabel('alertSource', v)] as [string, string])]}
            />
            <SelectField
              label={t('al.filter.health')}
              value={filters.health_status}
              onChange={(value) => update({ health_status: value })}
              options={[['', t('filter.any')], ...HEALTH_OPTIONS.map((v) => [v, enumLabel('health', v)] as [string, string])]}
            />
            <SelectField
              label={t('al.filter.readiness')}
              value={filters.readiness_status}
              onChange={(value) => update({ readiness_status: value })}
              options={[['', t('filter.any')], ...READINESS_OPTIONS.map((v) => [v, enumLabel('readiness', v)] as [string, string])]}
            />
            <SelectField
              label={t('filter.sort')}
              value={filters.sort}
              onChange={(value) => update({ sort: value })}
              options={SORT_KEYS.map((key) => [key, t(`al.sort.${key}`)] as [string, string])}
            />
            <CheckField label={t('al.filter.suppressedOnly')} checked={filters.suppressed === 'true'} onChange={(checked) => update({ suppressed: checked ? 'true' : '' })} />
            <CheckField label={t('pg.archivedOnly')} checked={filters.archived} onChange={(checked) => update({ archived: checked })} />
          </>
        }
        columns={<ColumnChooser ids={COLUMN_IDS} labelOf={COLUMN_LABEL} visible={visible} defaults={DEFAULT_COLUMNS} onChange={chooseColumns} />}
      />
      <FilterChips chips={chips} onClear={update} onClearAll={clearAll} />

      {rows.isLoading ? (
        <TableSkeleton columns={headerNames} rows={8} />
      ) : rows.isError ? (
        <ErrorState error={rows.error} onRetry={() => rows.refetch()} title={t('al.error.title')} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('al.empty.filtered.title') : t('al.empty.none.title')}
          description={filtersActive ? t('al.empty.filtered.body') : t('al.empty.none.body')}
          action={
            filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearAll}>
                {t('filter.clear')}
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link to="/account-health">{t('al.empty.open')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <Card>
            <Table cards aria-label={t('al.title')}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('al.col.alert')}</TableHead>
                  {shown.map((id) => (
                    <TableHead key={id}>{t(COLUMN_LABEL[id])}</TableHead>
                  ))}
                  <TableHead>
                    <span className="sr-only">{t('col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="cell-title min-w-[240px] max-w-[320px]">
                      <button type="button" className="text-left font-medium text-brand-text hover:underline" onClick={() => setSelected(row.id)}>
                        {row.title}
                      </button>
                      <p className="text-xs text-ink-muted">{row.summary}</p>
                    </TableCell>
                    {shown.map((id) => cell(id, row))}
                    <TableCell className="w-10 text-right">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('al.openNamed', { title: row.title })} onClick={() => setSelected(row.id)}>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager
            page={rows.data!.page}
            pages={rows.data!.total_pages}
            total={rows.data!.total}
            onPage={(page) => update({ page })}
            note={
              summary.data
                ? summary.data.last_successful_notification_at
                  ? t('al.lastSuccess', { time: formatRelative(summary.data.last_successful_notification_at) })
                  : t('al.lastSuccessNone')
                : undefined
            }
          />
        </>
      )}

      <Note>{t('al.disclaimer')}</Note>

      <AlertDrawer alertId={selected} onClose={() => setSelected(null)} onChanged={refresh} />
    </div>
  )
}
