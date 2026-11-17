import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api, query } from '../lib/api'
import type { AccountHealthRow, HealthRule, Paged } from '../lib/types'
import { HEALTH_META, FRESHNESS_META, SEVERITY_META } from '../lib/health'
import { READINESS_META, accountStatusTone } from '../lib/readiness'
import { useAuth } from '../hooks/useAuth'
import { formatCount, formatDateTime, formatRelative } from '../lib/format'
import { columnsStorageKey, loadColumns, saveColumns } from '../lib/columnPrefs'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n'
import { useEnumLabel } from '../i18n/labels'
import { Badge } from '../components/primitives/badge'
import { Button } from '../components/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/primitives/table'
import { EmptyState, ErrorState, PartialDataNote } from '../components/states'
import { PageHeader } from '../components/page/PageHeader'
import { CheckField, FilterChips, SearchField, SelectField } from '../components/page/Filters'
import type { FilterChip } from '../components/page/Filters'
import { ColumnChooser, ListToolbar } from '../components/page/ListToolbar'
import { Pager } from '../components/page/Pager'
import { TableSkeleton } from '../components/page/TableSkeleton'
import { ConfirmDialog } from '../components/page/ConfirmDialog'
import { DisabledReason, Note } from './account/parts'

const SORT_KEYS = ['health_severity', 'last_evaluated_at', 'display_name'] as const
const HEALTH_OPTIONS = ['critical', 'warning', 'attention_needed', 'unknown', 'clear_signals']
const FRESHNESS_OPTIONS = ['current', 'stale', 'unknown']
const SEVERITY_OPTIONS = ['critical', 'warning', 'attention', 'unknown']
const READINESS_OPTIONS = ['operationally_ready', 'ready_with_warnings', 'not_ready', 'unknown']

const COLUMN_IDS = ['bm', 'status', 'readiness', 'health', 'freshness', 'critical', 'warnings', 'attention', 'evaluated', 'reason'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_COLUMNS: ColumnId[] = ['readiness', 'health', 'freshness', 'critical', 'warnings', 'evaluated', 'reason']
const COLUMN_LABEL: Record<ColumnId, TranslationKey> = {
  bm: 'ah.col.bm',
  status: 'ah.col.status',
  readiness: 'ah.col.readiness',
  health: 'ah.col.health',
  freshness: 'ah.col.freshness',
  critical: 'ah.col.critical',
  warnings: 'ah.col.warnings',
  attention: 'ah.col.attention',
  evaluated: 'ah.col.evaluated',
  reason: 'ah.col.reason',
}
const NUMERIC: ColumnId[] = ['critical', 'warnings', 'attention']

export default function AccountHealth() {
  const { t } = useI18n()
  const enumLabel = useEnumLabel()
  /** Filters live in the URL, matching the A1 registry convention. */
  const [params, setParams] = useSearchParams()
  const [showRules, setShowRules] = useState(false)
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const filters = {
    search: params.get('search') ?? '',
    health_status: params.get('health_status') ?? '',
    freshness_status: params.get('freshness_status') ?? '',
    severity: params.get('severity') ?? '',
    rule_key: params.get('rule_key') ?? '',
    account_type: params.get('account_type') ?? '',
    readiness_status: params.get('readiness_status') ?? '',
    archived: params.get('archived') === 'true',
    page: Number(params.get('page') ?? '1'),
    page_size: Number(params.get('page_size') ?? '25'),
    sort: params.get('sort') ?? 'health_severity',
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

  const storageKey = columnsStorageKey('account-health', user?.id)
  const [visible, setVisible] = useState<ColumnId[]>(() => loadColumns(storageKey, COLUMN_IDS, DEFAULT_COLUMNS))
  const shown = COLUMN_IDS.filter((id) => visible.includes(id))
  function chooseColumns(next: ColumnId[]) {
    setVisible(next)
    saveColumns(storageKey, next)
  }

  const rows = useQuery({
    queryKey: ['account-health', filters],
    queryFn: () => api.get<Paged<AccountHealthRow>>(`/api/v1/account-health${query(filters)}`),
  })
  const rules = useQuery({
    queryKey: ['health-rules'],
    queryFn: () => api.get<HealthRule[]>('/api/v1/account-health/rules'),
  })

  const queryClient = useQueryClient()
  const [confirmOff, setConfirmOff] = useState<HealthRule | null>(null)
  const [readBack, setReadBack] = useState<{ ok: boolean; text: string } | null>(null)
  const toggle = useMutation({
    mutationFn: async ({ rule, enabled }: { rule: HealthRule; enabled: boolean }) => {
      await api.patch(`/api/v1/account-health/rules/${rule.rule_key}`, { enabled })
      // Read the rule list back from the server and say what it now holds (skill 6.4).
      const fresh = await queryClient.fetchQuery({
        queryKey: ['health-rules'],
        queryFn: () => api.get<HealthRule[]>('/api/v1/account-health/rules'),
        staleTime: 0,
      })
      const now = fresh.find((item) => item.rule_key === rule.rule_key)
      return { rule, enabled, matches: now?.enabled === enabled }
    },
    onSuccess: ({ rule, enabled, matches }) => {
      // Turning a check off changes what every account's health says, so the lists that read it
      // must not keep showing the previous answer.
      void queryClient.invalidateQueries({ queryKey: ['health-rules'] })
      void queryClient.invalidateQueries({ queryKey: ['account-health'] })
      void queryClient.invalidateQueries({ queryKey: ['health-summary'] })
      setReadBack(
        matches
          ? { ok: true, text: t(enabled ? 'ah.readback.on' : 'ah.readback.off', { name: rule.name }) }
          : { ok: false, text: t('ah.readback.mismatch', { name: rule.name }) },
      )
      setConfirmOff(null)
    },
  })

  const ruleName = rules.data?.find((rule) => rule.rule_key === filters.rule_key)?.name ?? filters.rule_key
  const chips: FilterChip[] = []
  if (filters.search) chips.push({ key: 'search', text: `${t('pg.search')}: ${filters.search}`, clear: { search: null } })
  if (filters.health_status) chips.push({ key: 'health_status', text: `${t('ah.filter.health')}: ${enumLabel('health', filters.health_status)}`, clear: { health_status: null } })
  if (filters.readiness_status) chips.push({ key: 'readiness_status', text: `${t('ah.filter.readiness')}: ${enumLabel('readiness', filters.readiness_status)}`, clear: { readiness_status: null } })
  if (filters.freshness_status) chips.push({ key: 'freshness_status', text: `${t('ah.filter.freshness')}: ${enumLabel('healthFreshness', filters.freshness_status)}`, clear: { freshness_status: null } })
  if (filters.severity) chips.push({ key: 'severity', text: `${t('ah.filter.severity')}: ${enumLabel('severity', filters.severity)}`, clear: { severity: null } })
  if (filters.rule_key) chips.push({ key: 'rule_key', text: `${t('ah.filter.rule')}: ${ruleName}`, clear: { rule_key: null } })
  if (filters.archived) chips.push({ key: 'archived', text: t('filter.archivedOnly'), clear: { archived: null } })
  const filtersActive = chips.length > 0
  const moreCount = [filters.freshness_status, filters.severity, filters.rule_key, filters.archived ? 'x' : ''].filter(Boolean).length
  const clearAll = () => setParams({}, { replace: true })

  const items = rows.data?.items ?? []
  const staleCount = items.filter((row) => row.freshness_status === 'stale').length

  function cell(id: ColumnId, row: AccountHealthRow) {
    const label = t(COLUMN_LABEL[id])
    const health = HEALTH_META[row.health_status]
    const freshness = FRESHNESS_META[row.freshness_status]
    const readiness = READINESS_META[row.readiness_status]
    switch (id) {
      case 'bm':
        return (
          <TableCell key={id} label={label}>
            {row.business_manager_name ?? row.personal_account_reference_label ?? (row.owner_label || '—')}
          </TableCell>
        )
      case 'status':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={accountStatusTone(row.account_status)}>{enumLabel('accountStatus', row.account_status)}</Badge>
          </TableCell>
        )
      case 'readiness':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={readiness?.tone ?? 'neutral'} title={enumLabel('readinessHint', row.readiness_status)}>
              {enumLabel('readiness', row.readiness_status)}
            </Badge>
          </TableCell>
        )
      case 'health':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={health?.tone ?? 'neutral'} dot title={enumLabel('healthHint', row.health_status)}>
              {enumLabel('health', row.health_status)}
            </Badge>
          </TableCell>
        )
      case 'freshness':
        return (
          <TableCell key={id} label={label}>
            <Badge tone={freshness?.tone ?? 'neutral'} title={enumLabel('healthFreshnessHint', row.freshness_status)}>
              {enumLabel('healthFreshness', row.freshness_status)}
            </Badge>
          </TableCell>
        )
      case 'critical':
        return (
          <TableCell key={id} label={label} numeric className="font-mono">
            {formatCount(row.open_critical_count)}
          </TableCell>
        )
      case 'warnings':
        return (
          <TableCell key={id} label={label} numeric className="font-mono">
            {formatCount(row.open_warning_count)}
          </TableCell>
        )
      case 'attention':
        return (
          <TableCell key={id} label={label} numeric className="font-mono">
            {formatCount(row.open_attention_count)}
          </TableCell>
        )
      case 'evaluated':
        return (
          <TableCell key={id} label={label} className="whitespace-nowrap text-xs text-ink-muted" title={formatDateTime(row.last_evaluated_at)}>
            {formatRelative(row.last_evaluated_at)}
          </TableCell>
        )
      case 'reason':
        return (
          <TableCell key={id} label={label} className="max-w-[280px] text-xs text-ink-muted">
            {row.top_reason ? row.top_reason.message : '—'}
          </TableCell>
        )
    }
  }

  const headerNames = [t('col.account'), ...shown.map((id) => t(COLUMN_LABEL[id])), t('col.actions')]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('ah.title')}
        description={t('ah.desc')}
        meta={rows.data ? t('ah.count', { count: formatCount(rows.data.total) }) : '—'}
        actions={
          <Button type="button" variant="secondary" aria-expanded={showRules} onClick={() => setShowRules((open) => !open)}>
            {showRules ? t('ah.rules.hide') : t('ah.rules.show', { count: rules.data ? rules.data.length : '—' })}
          </Button>
        }
      />

      {showRules && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('ah.rules.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              {t('ah.rules.intro')} {isOwner ? t('ah.rules.owner') : t('ah.rules.nonOwner')}
            </p>
            <Note tone="caution">{t('ah.rules.consequence')}</Note>
            {rules.isLoading ? (
              <p className="text-sm text-ink-muted">{t('common.loading')}</p>
            ) : rules.isError ? (
              <ErrorState error={rules.error} onRetry={() => rules.refetch()} title={t('ah.rules.error')} compact />
            ) : (rules.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">{t('ah.rules.empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(rules.data ?? []).map((rule) => (
                  <li key={`${rule.rule_key}-${rule.version}`} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_META[rule.severity]?.tone ?? 'neutral'}>{enumLabel('severity', rule.severity)}</Badge>
                      <span className="font-medium">{rule.name}</span>
                      <span className="font-mono text-xs text-ink-faint">
                        {rule.rule_key} v{rule.version}
                      </span>
                      {!rule.enabled && <Badge tone="neutral">{t('ah.rules.off')}</Badge>}
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('ah.rules.filterNamed', { name: rule.name })}
                          onClick={() => update({ rule_key: rule.rule_key })}
                        >
                          {t('ah.rules.filter')}
                        </Button>
                        <DisabledReason reason={isOwner ? null : t('ah.rules.nonOwner')} id={`rule-${rule.rule_key}-reason`}>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!isOwner || toggle.isPending}
                            aria-label={`${rule.enabled ? t('ah.rules.turnOff') : t('ah.rules.turnOn')}: ${rule.name}`}
                            onClick={() => {
                              setReadBack(null)
                              if (rule.enabled) setConfirmOff(rule)
                              else toggle.mutate({ rule, enabled: true })
                            }}
                          >
                            {rule.enabled ? t('ah.rules.turnOff') : t('ah.rules.turnOn')}
                          </Button>
                        </DisabledReason>
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">{rule.description}</p>
                    {!rule.enabled && <p className="mt-0.5 text-xs text-tone-caution-fg">{t('ah.rules.disabledNote')}</p>}
                  </li>
                ))}
              </ul>
            )}
            {readBack && (
              <Note role="status" tone={readBack.ok ? undefined : 'caution'}>
                {readBack.text}
              </Note>
            )}
            {toggle.isError && !confirmOff && <ErrorState error={toggle.error} noPermissionText={t('acct.error.noPermissionWrite')} compact />}
          </CardContent>
        </Card>
      )}

      <ListToolbar
        label={t('ah.toolbar')}
        moreCount={moreCount}
        primary={
          <>
            <SearchField label={t('pg.search')} placeholder={t('ah.search.placeholder')} value={filters.search} onApply={(value) => update({ search: value })} />
            <SelectField
              label={t('ah.filter.health')}
              value={filters.health_status}
              onChange={(value) => update({ health_status: value })}
              options={[['', t('filter.any')], ...HEALTH_OPTIONS.map((v) => [v, enumLabel('health', v)] as [string, string])]}
            />
            <SelectField
              label={t('ah.filter.readiness')}
              value={filters.readiness_status}
              onChange={(value) => update({ readiness_status: value })}
              options={[['', t('filter.any')], ...READINESS_OPTIONS.map((v) => [v, enumLabel('readiness', v)] as [string, string])]}
            />
            <SelectField
              label={t('filter.sort')}
              value={filters.sort}
              onChange={(value) => update({ sort: value })}
              options={SORT_KEYS.map((key) => [key, t(`ah.sort.${key}`)] as [string, string])}
            />
          </>
        }
        more={
          <>
            <SelectField
              label={t('ah.filter.freshness')}
              value={filters.freshness_status}
              onChange={(value) => update({ freshness_status: value })}
              options={[['', t('filter.any')], ...FRESHNESS_OPTIONS.map((v) => [v, enumLabel('healthFreshness', v)] as [string, string])]}
            />
            <SelectField
              label={t('ah.filter.severity')}
              value={filters.severity}
              onChange={(value) => update({ severity: value })}
              options={[['', t('filter.any')], ...SEVERITY_OPTIONS.map((v) => [v, enumLabel('severity', v)] as [string, string])]}
            />
            <SelectField
              label={t('filter.order')}
              value={filters.sort_direction}
              onChange={(value) => update({ sort_direction: value })}
              options={[['desc', t('filter.desc')], ['asc', t('filter.asc')]]}
            />
            <CheckField label={t('pg.archivedOnly')} checked={filters.archived} onChange={(checked) => update({ archived: checked })} />
          </>
        }
        columns={<ColumnChooser ids={COLUMN_IDS} labelOf={COLUMN_LABEL} visible={visible} defaults={DEFAULT_COLUMNS} onChange={chooseColumns} />}
      />
      <FilterChips chips={chips} onClear={update} onClearAll={clearAll} />

      {rules.isError && !showRules && <PartialDataNote>{t('ah.partial.rules')}</PartialDataNote>}

      {rows.isLoading ? (
        <TableSkeleton columns={headerNames} rows={8} />
      ) : rows.isError ? (
        <ErrorState error={rows.error} onRetry={() => rows.refetch()} title={t('ah.error.title')} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('ah.empty.filtered.title') : t('ah.empty.none.title')}
          description={filtersActive ? t('ah.empty.filtered.body') : t('ah.empty.none.body')}
          action={
            filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearAll}>
                {t('filter.clear')}
              </Button>
            ) : (
              <Button asChild>
                <Link to="/accounts">{t('ah.empty.open')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          {staleCount > 0 && <PartialDataNote>{t('ah.partial.stale', { count: staleCount })}</PartialDataNote>}
          <Card>
            <Table cards aria-label={t('ah.title')}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('col.account')}</TableHead>
                  {shown.map((id) => (
                    <TableHead key={id} numeric={NUMERIC.includes(id)}>
                      {t(COLUMN_LABEL[id])}
                    </TableHead>
                  ))}
                  <TableHead>
                    <span className="sr-only">{t('col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.ad_account_id}>
                    <TableCell className="cell-title min-w-[220px]">
                      <Link to={`/accounts/${row.ad_account_id}?tab=health`} className="font-medium text-brand-text hover:underline">
                        {row.display_name}
                      </Link>
                      <span className="block font-mono text-xs text-ink-muted">{row.external_account_id ?? '—'}</span>
                    </TableCell>
                    {shown.map((id) => cell(id, row))}
                    <TableCell className="w-10 text-right">
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                        <Link to={`/accounts/${row.ad_account_id}?tab=health`} aria-label={t('row.open', { name: row.display_name })}>
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager page={rows.data!.page} pages={rows.data!.total_pages} total={rows.data!.total} onPage={(page) => update({ page })} />
        </>
      )}

      <Note>{t('ah.disclaimer')}</Note>

      <ConfirmDialog
        open={confirmOff !== null}
        onCancel={() => {
          setConfirmOff(null)
          toggle.reset()
        }}
        title={confirmOff ? t('ah.off.title', { name: confirmOff.name }) : ''}
        object={confirmOff ? t('ah.off.object', { key: confirmOff.rule_key, version: confirmOff.version }) : ''}
        effects={[t('ah.rules.consequence'), t('ah.off.scope'), t('ah.off.reversible')]}
        confirmLabel={t('ah.off.confirm')}
        pending={toggle.isPending}
        error={toggle.isError ? toggle.error : undefined}
        onConfirm={() => confirmOff && toggle.mutate({ rule: confirmOff, enabled: false })}
      />
    </div>
  )
}
